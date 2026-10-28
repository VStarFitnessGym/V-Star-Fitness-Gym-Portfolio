// ============================================================================
// Stage 5A Reminder Engine: Worker Service
// Atomic claiming, pre-dispatch validation, two-phase intent, & state transitions
// ============================================================================

import { IDatabaseClient } from '../../db/database';
import { ReminderJob, IDeliveryAdapter, WorkerBatchResult, DeliveryResult } from './types';
import { validatePreDispatchEligibility } from './eligibilityService';

/**
 * Calculates exponential backoff delay in seconds based on current attempt count
 * Attempt 1: 60s (1m), Attempt 2: 300s (5m), Attempt 3: 900s (15m)
 */
export function calculateBackoffSeconds(attemptCount: number): number {
  switch (attemptCount) {
    case 1:
      return 60;
    case 2:
      return 300;
    default:
      return 900;
  }
}

/**
 * Claims a batch of pending/expired eligible jobs atomically using claim_notification_jobs() RPC
 */
export async function claimJobs(
  db: IDatabaseClient,
  workerId: string,
  batchSize: number = 25,
  leaseDurationSeconds: number = 300
): Promise<ReminderJob[]> {
  const query = `
    SELECT 
      id, gym_id, member_id, subscription_id, milestone, target_date, channel, status,
      idempotency_key, scheduled_for, claimed_at, lease_expires_at, worker_id,
      attempt_count, max_attempts, processed_at, cancellation_reason, created_at, updated_at
    FROM public.claim_notification_jobs($1, $2, $3);
  `;

  const res = await db.query(query, [workerId, batchSize, leaseDurationSeconds]);
  return res.rows.map((row: any) => ({
    id: row.id,
    gym_id: row.gym_id,
    member_id: row.member_id,
    subscription_id: row.subscription_id,
    milestone: row.milestone,
    target_date: typeof row.target_date === 'string' ? row.target_date.substring(0, 10) : row.target_date.toISOString().substring(0, 10),
    channel: row.channel,
    status: row.status,
    idempotency_key: row.idempotency_key,
    scheduled_for: typeof row.scheduled_for === 'string' ? row.scheduled_for : row.scheduled_for.toISOString(),
    claimed_at: row.claimed_at ? (typeof row.claimed_at === 'string' ? row.claimed_at : row.claimed_at.toISOString()) : null,
    lease_expires_at: row.lease_expires_at ? (typeof row.lease_expires_at === 'string' ? row.lease_expires_at : row.lease_expires_at.toISOString()) : null,
    worker_id: row.worker_id,
    attempt_count: parseInt(row.attempt_count, 10),
    max_attempts: parseInt(row.max_attempts, 10),
    processed_at: row.processed_at ? (typeof row.processed_at === 'string' ? row.processed_at : row.processed_at.toISOString()) : null,
    cancellation_reason: row.cancellation_reason,
    created_at: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  }));
}

export interface ProcessJobOutcome {
  status: 'completed' | 'cancelled' | 'retry_scheduled' | 'failed_terminal' | 'reconciling' | 'lease_lost';
  deliveryResult?: DeliveryResult;
  reason?: string;
}

/**
 * Processes a single claimed job through the full lifecycle:
 *  1. Immediate pre-dispatch eligibility re-check
 *  2. Durable Two-Phase dispatch intent record
 *  3. Delivery adapter execution
 *  4. Strict state transition with lease ownership check
 */
export async function processClaimedJob(
  db: IDatabaseClient,
  job: ReminderJob,
  adapter: IDeliveryAdapter,
  workerId: string
): Promise<ProcessJobOutcome> {
  // Step 1: Immediate Pre-dispatch Eligibility Re-check
  const eligibility = await validatePreDispatchEligibility(db, job);
  if (!eligibility.eligible) {
    // Cancel the job immediately; do not invoke delivery adapter!
    await db.query(
      `UPDATE public.notification_jobs 
       SET status = 'cancelled'::public.notification_job_status_enum, 
           cancellation_reason = $1, 
           worker_id = NULL,
           updated_at = NOW()
       WHERE id = $2 AND worker_id = $3;`,
      [eligibility.cancellationReason || 'eligibility_criteria_failed', job.id, workerId]
    );

    return {
      status: 'cancelled',
      reason: eligibility.cancellationReason
    };
  }

  // Step 2: Record Two-Phase Dispatch Intent in notification_attempts
  const intentRes = await db.query(
    `INSERT INTO public.notification_attempts (
       job_id, channel, provider, status, request_payload, sent_at
     ) VALUES ($1, $2, $3, 'dispatching', $4, NOW())
     RETURNING id;`,
    [
      job.id,
      job.channel,
      adapter.name,
      JSON.stringify({
        milestone: job.milestone,
        target_date: job.target_date,
        recipient_phone: eligibility.member.phone
      })
    ]
  );
  const attemptId = intentRes.rows[0].id;

  // Mark job as dispatching WITH ATOMIC FINAL SUBSCRIPTION STATE GUARD
  // Ensures subscription hasn't been cancelled or extended in a concurrent transaction
  const markDispatchingRes = await db.query(
    `UPDATE public.notification_jobs j
     SET status = 'dispatching'::public.notification_job_status_enum, updated_at = NOW()
     WHERE j.id = $1 AND j.worker_id = $2
       AND EXISTS (
         SELECT 1 FROM public.subscriptions s
         WHERE s.id = j.subscription_id
           AND s.status = 'active'
           AND s.end_date::date = $3::date
       )
     RETURNING j.id;`,
    [job.id, workerId, eligibility.subscription.end_date]
  );

  if (markDispatchingRes.rows.length === 0) {
    // Subscription was cancelled, renewed, or modified concurrently!
    // Cancel the attempt as unconfirmed_stale
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'unconfirmed_stale', error_code = 'SUBSCRIPTION_STATE_CHANGED_CONCURRENTLY'
       WHERE id = $1;`,
      [attemptId]
    );

    // Cancel the job immediately and NEVER invoke the delivery adapter!
    await db.query(
      `UPDATE public.notification_jobs 
       SET status = 'cancelled'::public.notification_job_status_enum, 
           cancellation_reason = 'subscription_state_changed_concurrently', 
           worker_id = NULL,
           updated_at = NOW()
       WHERE id = $1;`,
      [job.id]
    );

    return {
      status: 'cancelled',
      reason: 'subscription_state_changed_concurrently'
    };
  }

  // Step 3: Invoke Delivery Adapter
  let deliveryResult: DeliveryResult;
  try {
    deliveryResult = await adapter.deliver({
      job,
      member: eligibility.member,
      subscription: eligibility.subscription,
      gym: eligibility.gym
    });
  } catch (err: any) {
    // Caught exception during delivery treated as ambiguous socket/network failure
    deliveryResult = {
      outcome: 'ambiguous_timeout',
      provider: adapter.name,
      error_code: 'UNHANDLED_ADAPTER_EXCEPTION',
      error_message: err?.message || 'Unexpected exception during message dispatch',
      is_mock: true
    };
  }

  // Step 4: Validate worker ownership before committing state transition
  const ownershipCheck = await db.query(
    `SELECT worker_id, lease_expires_at, status 
     FROM public.notification_jobs 
     WHERE id = $1;`,
    [job.id]
  );
  const currentJobState = ownershipCheck.rows[0];
  if (currentJobState?.worker_id !== workerId) {
    // Worker lost ownership (e.g. lease expired and another process intervened)
    return {
      status: 'lease_lost',
      reason: 'worker_lease_expired_or_reassigned',
      deliveryResult
    };
  }

  // Step 5: Process Delivery Outcome

  // A. Delivered Successfully
  if (deliveryResult.outcome === 'delivered') {
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'delivered', 
           provider_message_id = $1, 
           delivered_at = NOW()
       WHERE id = $2;`,
      [deliveryResult.provider_message_id || 'mock_delivered', attemptId]
    );

    // Atomic completion
    const completeOk = await db.query(
      `SELECT public.safe_complete_notification_job($1, $2) as completed;`,
      [job.id, workerId]
    );

    return {
      status: completeOk.rows[0]?.completed ? 'completed' : 'lease_lost',
      deliveryResult
    };
  }

  // B. Ambiguous Outcome (Timeout / Network Drop)
  if (deliveryResult.outcome === 'ambiguous_timeout') {
    // CRITICAL: Never automatically retry an ambiguous outcome! Transition to reconciling.
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'unknown',
           error_code = $1,
           error_message = $2
       WHERE id = $3;`,
      [deliveryResult.error_code || 'TIMEOUT', deliveryResult.error_message || 'Ambiguous outcome', attemptId]
    );

    await db.query(
      `UPDATE public.notification_jobs
       SET status = 'reconciling'::public.notification_job_status_enum,
           worker_id = NULL,
           updated_at = NOW()
       WHERE id = $1 AND worker_id = $2;`,
      [job.id, workerId]
    );

    return {
      status: 'reconciling',
      deliveryResult
    };
  }

  // C. Retryable Failure (Transient Gateway Timeout, Carrier Busy)
  if (deliveryResult.outcome === 'retryable_failure') {
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'failed_transient',
           error_code = $1,
           error_message = $2
       WHERE id = $3;`,
      [deliveryResult.error_code, deliveryResult.error_message, attemptId]
    );

    // Check if max attempts reached
    if (job.attempt_count >= job.max_attempts) {
      await db.query(
        `UPDATE public.notification_jobs
         SET status = 'failed'::public.notification_job_status_enum,
             cancellation_reason = 'max_attempts_exceeded',
             worker_id = NULL,
             updated_at = NOW()
         WHERE id = $1 AND worker_id = $2;`,
        [job.id, workerId]
      );
      return { status: 'failed_terminal', deliveryResult, reason: 'max_attempts_exceeded' };
    }

    // Schedule retry with exponential backoff
    const backoffSeconds = calculateBackoffSeconds(job.attempt_count);
    await db.query(
      `UPDATE public.notification_jobs
       SET status = 'pending'::public.notification_job_status_enum,
           scheduled_for = NOW() + ($1::text || ' seconds')::interval,
           worker_id = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $2 AND worker_id = $3;`,
      [backoffSeconds, job.id, workerId]
    );

    return { status: 'retry_scheduled', deliveryResult };
  }

  // D. Permanent Failure (Unallocated number, invalid recipient)
  await db.query(
    `UPDATE public.notification_attempts
     SET status = 'failed_permanent',
         error_code = $1,
         error_message = $2
     WHERE id = $3;`,
    [deliveryResult.error_code, deliveryResult.error_message, attemptId]
  );

  await db.query(
    `UPDATE public.notification_jobs
     SET status = 'failed'::public.notification_job_status_enum,
         cancellation_reason = $1,
         worker_id = NULL,
         updated_at = NOW()
     WHERE id = $2 AND worker_id = $3;`,
    [deliveryResult.error_message || 'permanent_delivery_failure', job.id, workerId]
  );

  return { status: 'failed_terminal', deliveryResult };
}

/**
 * Runs a complete worker iteration: claims a batch of jobs and processes them
 */
export async function processWorkerBatch(
  db: IDatabaseClient,
  workerId: string,
  adapter: IDeliveryAdapter,
  batchSize: number = 25
): Promise<WorkerBatchResult> {
  const jobs = await claimJobs(db, workerId, batchSize);
  const result: WorkerBatchResult = {
    claimedCount: jobs.length,
    processedCount: 0,
    successCount: 0,
    retryableFailCount: 0,
    permanentFailCount: 0,
    ambiguousCount: 0,
    cancelledCount: 0
  };

  for (const job of jobs) {
    const outcome = await processClaimedJob(db, job, adapter, workerId);
    result.processedCount++;

    switch (outcome.status) {
      case 'completed':
        result.successCount++;
        break;
      case 'cancelled':
        result.cancelledCount++;
        break;
      case 'retry_scheduled':
        result.retryableFailCount++;
        break;
      case 'failed_terminal':
        result.permanentFailCount++;
        break;
      case 'reconciling':
        result.ambiguousCount++;
        break;
    }
  }

  return result;
}
