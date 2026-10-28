// ============================================================================
// Reminders Management Controller (Stage 5C)
// Provides tenant-scoped reminder queries, queue telemetry, and safe manual retries
// ============================================================================

import { Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AuthenticatedRequest } from '../types';
import { db } from '../db/database';
import {
  GetRemindersQuerySchema,
  RetryReminderBodySchema
} from '../validators/reminderValidators';
import { maskPhone } from '../services/reminders/providerTypes';
import { sendProblem } from '../utils/problemDetails';
import { logger } from '../utils/logger';

/**
 * GET /api/reminders
 * Tenant-scoped, paginated, and filtered reminder job list with attempt history
 */
export async function getReminders(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  const requestId = req.requestId;

  if (!req.user) {
    sendProblem(res, {
      status: 401,
      code: 'UNAUTHORIZED',
      title: 'Authentication Required',
      detail: 'Authentication is required to query reminders.',
      instance: req.originalUrl,
      requestId
    });
    return;
  }

  try {
    const query = GetRemindersQuerySchema.parse(req.query);
    const { page, limit, status, milestone, channel, search, date_from, date_to } = query;
    const offset = (page - 1) * limit;
    const gymId = req.user.gym_id;

    // Build parameterized query with explicit tenant scoping
    const whereClauses: string[] = ['j.gym_id = $1'];
    const queryParams: any[] = [gymId];
    let paramIndex = 2;

    if (status) {
      whereClauses.push(`j.status = $${paramIndex}::public.notification_job_status_enum`);
      queryParams.push(status);
      paramIndex++;
    }

    if (milestone) {
      whereClauses.push(`j.milestone = $${paramIndex}::public.notification_milestone_enum`);
      queryParams.push(milestone);
      paramIndex++;
    }

    if (channel) {
      whereClauses.push(`j.channel = $${paramIndex}::public.notification_channel_enum`);
      queryParams.push(channel);
      paramIndex++;
    }

    if (date_from) {
      whereClauses.push(`j.target_date >= $${paramIndex}::date`);
      queryParams.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      whereClauses.push(`j.target_date <= $${paramIndex}::date`);
      queryParams.push(date_to);
      paramIndex++;
    }

    if (search) {
      whereClauses.push(`(m.full_name ILIKE $${paramIndex} OR m.phone ILIKE $${paramIndex})`);
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    const whereSql = whereClauses.join(' AND ');

    // 1. Get total count for pagination
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM public.notification_jobs j
      JOIN public.members m ON m.id = j.member_id
      WHERE ${whereSql};
    `;
    const countRes = await db.query(countSql, queryParams);
    const total = countRes.rows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // 2. Fetch paginated records with deterministic, stable sorting
    const dataSql = `
      SELECT 
        j.id,
        j.gym_id,
        j.member_id,
        j.subscription_id,
        j.milestone,
        j.target_date,
        j.channel,
        j.status,
        j.idempotency_key,
        j.scheduled_for,
        j.claimed_at,
        j.lease_expires_at,
        j.worker_id,
        j.attempt_count,
        j.max_attempts,
        j.processed_at,
        j.cancellation_reason,
        j.created_at,
        j.updated_at,
        m.full_name AS member_name,
        m.phone AS member_phone,
        p.name AS plan_name,
        s.start_date AS subscription_start_date,
        s.end_date AS subscription_end_date
      FROM public.notification_jobs j
      JOIN public.members m ON m.id = j.member_id
      JOIN public.subscriptions s ON s.id = j.subscription_id
      JOIN public.membership_plans p ON p.id = s.plan_id
      WHERE ${whereSql}
      ORDER BY j.scheduled_for DESC, j.id DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;

    const dataParams = [...queryParams, limit, offset];
    const dataRes = await db.query(dataSql, dataParams);
    const jobIds = dataRes.rows.map((r: any) => r.id);

    // 3. Batch query attempts for the fetched jobs
    const attemptsMap: Record<string, any[]> = {};
    if (jobIds.length > 0) {
      const attemptsSql = `
        SELECT 
          id,
          job_id,
          channel,
          provider,
          provider_message_id,
          status,
          error_code,
          error_message,
          sent_at,
          delivered_at,
          created_at
        FROM public.notification_attempts
        WHERE job_id = ANY($1)
        ORDER BY created_at ASC;
      `;
      const attemptsRes = await db.query(attemptsSql, [jobIds]);
      for (const att of attemptsRes.rows) {
        if (!attemptsMap[att.job_id]) {
          attemptsMap[att.job_id] = [];
        }
        attemptsMap[att.job_id].push({
          id: att.id,
          channel: att.channel,
          provider: att.provider,
          provider_message_id: att.provider_message_id,
          status: att.status,
          error_code: att.error_code,
          error_message: att.error_message,
          sent_at: att.sent_at,
          delivered_at: att.delivered_at,
          created_at: att.created_at
        });
      }
    }

    // Format records with masked phone numbers for privacy
    const data = dataRes.rows.map((row: any) => ({
      id: row.id,
      gym_id: row.gym_id,
      member_id: row.member_id,
      member_name: row.member_name,
      member_phone: maskPhone(row.member_phone),
      subscription_id: row.subscription_id,
      plan_name: row.plan_name,
      subscription_start_date: row.subscription_start_date,
      subscription_end_date: row.subscription_end_date,
      milestone: row.milestone,
      target_date: typeof row.target_date === 'string' ? row.target_date.substring(0, 10) : row.target_date?.toISOString?.().substring(0, 10),
      channel: row.channel,
      status: row.status,
      idempotency_key: row.idempotency_key,
      scheduled_for: typeof row.scheduled_for === 'string' ? row.scheduled_for : row.scheduled_for?.toISOString?.(),
      claimed_at: row.claimed_at ? (typeof row.claimed_at === 'string' ? row.claimed_at : row.claimed_at.toISOString()) : null,
      lease_expires_at: row.lease_expires_at ? (typeof row.lease_expires_at === 'string' ? row.lease_expires_at : row.lease_expires_at.toISOString()) : null,
      worker_id: row.worker_id,
      attempt_count: parseInt(row.attempt_count, 10),
      max_attempts: parseInt(row.max_attempts, 10),
      processed_at: row.processed_at ? (typeof row.processed_at === 'string' ? row.processed_at : row.processed_at.toISOString()) : null,
      cancellation_reason: row.cancellation_reason,
      created_at: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString(),
      attempts: attemptsMap[row.id] || []
    }));

    res.status(200).json({
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages
      }
    });
  } catch (err: any) {
    if (err instanceof ZodError || err.name === 'ZodError') {
      _next(err);
      return;
    }

    logger.error('Failed to query reminders', err, { requestId });
    sendProblem(res, {
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      title: 'Internal Server Error',
      detail: 'An error occurred while querying the reminder queue.',
      instance: req.originalUrl,
      requestId
    });
  }
}

/**
 * GET /api/reminders/telemetry
 * Real database-backed telemetry counts scoped strictly to authenticated gym tenant
 */
export async function getReminderTelemetry(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  const requestId = req.requestId;

  if (!req.user) {
    sendProblem(res, {
      status: 401,
      code: 'UNAUTHORIZED',
      title: 'Authentication Required',
      detail: 'Authentication is required to query telemetry.',
      instance: req.originalUrl,
      requestId
    });
    return;
  }

  const gymId = req.user.gym_id;

  try {
    // 1. Grouped counts by job status
    const statusCountsSql = `
      SELECT status, COUNT(*)::int AS count
      FROM public.notification_jobs
      WHERE gym_id = $1
      GROUP BY status;
    `;
    const statusCountsRes = await db.query(statusCountsSql, [gymId]);

    const statusCounts: Record<string, number> = {
      pending: 0,
      claimed: 0,
      dispatching: 0,
      reconciling: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0
    };

    for (const row of statusCountsRes.rows) {
      statusCounts[row.status] = parseInt(row.count, 10);
    }

    // 2. Summary stats for KPI cards
    const summarySql = `
      SELECT 
        COUNT(*) FILTER (WHERE scheduled_for::date = CURRENT_DATE)::int AS scheduled_today,
        COUNT(*) FILTER (WHERE status = 'completed' AND processed_at::date = CURRENT_DATE)::int AS completed_today,
        COUNT(*) FILTER (WHERE status = 'reconciling')::int AS reconciling_count,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
        COUNT(*) FILTER (WHERE status = 'claimed' AND lease_expires_at > NOW())::int AS active_leases
      FROM public.notification_jobs
      WHERE gym_id = $1;
    `;
    const summaryRes = await db.query(summarySql, [gymId]);
    const summary = summaryRes.rows[0] || {};

    res.status(200).json({
      scheduledToday: summary.scheduled_today || 0,
      completedToday: summary.completed_today || 0,
      reconciling: summary.reconciling_count || 0,
      failed: summary.failed_count || 0,
      activeLeases: summary.active_leases || 0,
      statusCounts
    });
  } catch (err: any) {
    logger.error('Failed to query reminder telemetry', err, { requestId });
    sendProblem(res, {
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      title: 'Internal Server Error',
      detail: 'An error occurred while calculating reminder telemetry.',
      instance: req.originalUrl,
      requestId
    });
  }
}

/**
 * POST /api/reminders/:jobId/retry
 * Atomically validates and retries a failed reminder job
 * Strictly preserves state machine invariants: only failed jobs may be retried
 */
export async function retryReminderJob(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  const requestId = req.requestId;
  const rawJobId = req.params.jobId;
  const jobId = (Array.isArray(rawJobId) ? rawJobId[0] : rawJobId) || '';

  if (!req.user) {
    sendProblem(res, {
      status: 401,
      code: 'UNAUTHORIZED',
      title: 'Authentication Required',
      detail: 'Authentication is required to retry reminder jobs.',
      instance: req.originalUrl,
      requestId
    });
    return;
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(jobId)) {
    sendProblem(res, {
      status: 400,
      code: 'INVALID_IDENTIFIER',
      title: 'Invalid Job Identifier',
      detail: 'Job identifier must be a valid UUID format.',
      instance: req.originalUrl,
      requestId
    });
    return;
  }

  const gymId = req.user.gym_id;
  const actorId = req.user.id;

  let body = { reason: 'Staff initiated manual retry' };
  try {
    if (req.body && Object.keys(req.body).length > 0) {
      body = RetryReminderBodySchema.parse(req.body);
    }
  } catch (err: any) {
    _next(err);
    return;
  }

  try {
    const outcome = await db.transaction(async (tx) => {
      // 1. Lock and inspect job under tenant boundary
      const lockRes = await tx.query(
        `SELECT 
           j.id, j.gym_id, j.member_id, j.subscription_id, j.status,
           j.attempt_count, j.max_attempts, j.milestone, j.target_date, j.channel,
           m.status AS member_status, m.whatsapp_consent, m.sms_consent,
           s.status AS subscription_status, s.renewed_from_subscription_id, s.end_date
         FROM public.notification_jobs j
         JOIN public.members m ON m.id = j.member_id
         JOIN public.subscriptions s ON s.id = j.subscription_id
         WHERE j.id = $1 AND j.gym_id = $2
         FOR UPDATE OF j;`,
        [jobId, gymId]
      );

      if (lockRes.rows.length === 0) {
        return { type: 'not_found' as const };
      }

      const job = lockRes.rows[0];

      // 2. Strict State Machine Invariant: Only 'failed' status is retriable
      if (job.status !== 'failed') {
        return {
          type: 'invalid_state' as const,
          currentStatus: job.status
        };
      }

      // 3. Subscription Eligibility Check
      if (job.subscription_status !== 'active') {
        await tx.query(
          `UPDATE public.notification_jobs
           SET status = 'cancelled'::public.notification_job_status_enum,
               cancellation_reason = 'retry_aborted_subscription_inactive',
               updated_at = NOW()
           WHERE id = $1;`,
          [jobId]
        );
        return { type: 'subscription_ineligible' as const, reason: 'Subscription is no longer active.' };
      }

      // Check if subscription was superseded by a renewal
      const superRes = await tx.query(
        `SELECT id FROM public.subscriptions WHERE renewed_from_subscription_id = $1 LIMIT 1;`,
        [job.subscription_id]
      );
      if (superRes.rows.length > 0) {
        await tx.query(
          `UPDATE public.notification_jobs
           SET status = 'cancelled'::public.notification_job_status_enum,
               cancellation_reason = 'retry_aborted_subscription_superseded',
               updated_at = NOW()
           WHERE id = $1;`,
          [jobId]
        );
        return { type: 'subscription_ineligible' as const, reason: 'Subscription has already been renewed.' };
      }

      // 4. Member Consent & Status Check
      if (job.member_status === 'archived') {
        await tx.query(
          `UPDATE public.notification_jobs
           SET status = 'cancelled'::public.notification_job_status_enum,
               cancellation_reason = 'retry_aborted_member_archived',
               updated_at = NOW()
           WHERE id = $1;`,
          [jobId]
        );
        return { type: 'consent_ineligible' as const, reason: 'Member record has been archived.' };
      }

      if (!job.whatsapp_consent && !job.sms_consent) {
        await tx.query(
          `UPDATE public.notification_jobs
           SET status = 'cancelled'::public.notification_job_status_enum,
               cancellation_reason = 'retry_aborted_no_consent',
               updated_at = NOW()
           WHERE id = $1;`,
          [jobId]
        );
        return { type: 'consent_ineligible' as const, reason: 'Member has opted out of notifications.' };
      }

      // 5. Atomic Retry State Transition
      // Preserves attempt history and increments max_attempts to grant exactly one retry attempt
      const newMaxAttempts = parseInt(job.attempt_count, 10) + 1;
      const updateRes = await tx.query(
        `UPDATE public.notification_jobs
         SET 
           status = 'pending'::public.notification_job_status_enum,
           max_attempts = $1,
           scheduled_for = NOW(),
           worker_id = NULL,
           lease_expires_at = NULL,
           cancellation_reason = NULL,
           updated_at = NOW()
         WHERE id = $2 AND gym_id = $3
         RETURNING *;`,
        [newMaxAttempts, jobId, gymId]
      );

      // 6. Durable Administrative Audit Logging
      await tx.query(
        `INSERT INTO public.audit_logs (
           gym_id, actor_id, action, entity_type, entity_id, changes
         ) VALUES ($1, $2, 'notification_job.manual_retry', 'notification_job', $3, $4);`,
        [
          gymId,
          actorId,
          jobId,
          JSON.stringify({
            previous_status: job.status,
            new_status: 'pending',
            previous_attempts: job.attempt_count,
            new_max_attempts: newMaxAttempts,
            reason: body.reason
          })
        ]
      );

      return {
        type: 'success' as const,
        job: updateRes.rows[0]
      };
    });

    if (outcome.type === 'not_found') {
      sendProblem(res, {
        status: 404,
        code: 'JOB_NOT_FOUND',
        title: 'Job Not Found',
        detail: `Notification job ${jobId} does not exist in your gym.`,
        instance: req.originalUrl,
        requestId
      });
      return;
    }

    if (outcome.type === 'invalid_state') {
      sendProblem(res, {
        status: 409,
        code: 'INVALID_JOB_STATE',
        title: 'Retry State Conflict',
        detail: `Only jobs in 'failed' status can be manually retried. Job is currently in '${outcome.currentStatus}' status.`,
        instance: req.originalUrl,
        requestId
      });
      return;
    }

    if (outcome.type === 'subscription_ineligible' || outcome.type === 'consent_ineligible') {
      sendProblem(res, {
        status: 422,
        code: 'INELIGIBLE_FOR_RETRY',
        title: 'Retry Ineligible',
        detail: outcome.reason,
        instance: req.originalUrl,
        requestId
      });
      return;
    }

    logger.info('Notification job manually retried by staff', {
      jobId,
      gymId,
      actorId,
      reason: body.reason
    });

    res.status(200).json({
      message: 'Notification job successfully re-queued for processing.',
      job: outcome.job
    });
  } catch (err: any) {
    logger.error('Failed to retry notification job', err, { jobId, requestId });
    sendProblem(res, {
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      title: 'Internal Server Error',
      detail: 'An unexpected database error occurred while retrying the reminder job.',
      instance: req.originalUrl,
      requestId
    });
  }
}
