// ============================================================================
// Stage 5B: Dispatch & Safe SMS Fallback Orchestrator
// Coordinates outbound dispatch, error mapping, and strictly conditional SMS fallback
// ============================================================================

import { IDatabaseClient } from '../../db/database';
import { ReminderJob } from './types';
import {
  IProviderAdapter,
  OutboundMessageRequest,
  ProviderSubmissionResult
} from './providerTypes';
import { validatePreDispatchEligibility } from './eligibilityService';
import { calculateBackoffSeconds } from './workerService';

export interface DispatchOutcome {
  status: 'accepted' | 'completed' | 'cancelled' | 'retry_scheduled' | 'failed_terminal' | 'reconciling' | 'fallback_dispatched';
  submissionResult?: ProviderSubmissionResult;
  reason?: string;
  fallbackTriggered?: boolean;
}

/**
 * Dispatches a claimed reminder job through the safe provider lifecycle
 */
export async function dispatchReminderJob(
  db: IDatabaseClient,
  job: ReminderJob,
  primaryAdapter: IProviderAdapter,
  smsAdapter: IProviderAdapter | null,
  workerId: string
): Promise<DispatchOutcome> {
  // Step 1: Immediate Pre-dispatch Eligibility Re-check
  const eligibility = await validatePreDispatchEligibility(db, job);
  if (!eligibility.eligible) {
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

  // Step 2: Record Two-Phase Dispatch Intent in notification_attempts BEFORE external API call
  const intentRes = await db.query(
    `INSERT INTO public.notification_attempts (
       job_id, channel, provider, status, request_payload, sent_at
     ) VALUES ($1, $2, $3, 'dispatching', $4, NOW())
     RETURNING id;`,
    [
      job.id,
      job.channel,
      primaryAdapter.name,
      JSON.stringify({
        milestone: job.milestone,
        target_date: job.target_date,
        recipient_phone: eligibility.member.phone
      })
    ]
  );
  const attemptId = intentRes.rows[0].id;

  // Step 3: Atomic Final Subscription State Guard
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
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'unconfirmed_stale', error_code = 'SUBSCRIPTION_STATE_CHANGED_CONCURRENTLY'
       WHERE id = $1;`,
      [attemptId]
    );

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

  // Step 4: Dispatch via Primary Adapter
  const outboundRequest: OutboundMessageRequest = {
    jobId: job.id,
    subscriptionId: eligibility.subscription.id,
    memberId: eligibility.member.id,
    gymId: eligibility.gym.id,
    recipientPhone: eligibility.member.phone,
    channel: primaryAdapter.channel,
    milestone: job.milestone,
    template: {
      name: 'membership_expiry_reminder',
      language: 'en',
      parameters: {
        member_name: eligibility.member.full_name,
        expiry_date: eligibility.subscription.end_date,
        plan_name: 'Fitness Membership',
        gym_name: eligibility.gym.gym_name
      }
    }
  };

  const result = await primaryAdapter.send(outboundRequest);

  // Step 5: Handle Submission Outcome

  // A. Submission Accepted by Provider Gateway
  if (result.outcome === 'accepted') {
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'sent',
           provider_message_id = $1
       WHERE id = $2;`,
      [result.providerMessageId || 'msg_unknown', attemptId]
    );

    // If local mock adapter, complete immediately since no webhook will arrive
    if (result.isMock) {
      await db.query(
        `UPDATE public.notification_jobs
         SET status = 'completed'::public.notification_job_status_enum,
             processed_at = NOW(),
             worker_id = NULL,
             updated_at = NOW()
         WHERE id = $1;`,
        [job.id]
      );
      return { status: 'completed', submissionResult: result };
    }

    // Live provider: job remains in 'dispatching' until webhook confirms 'delivered'
    return { status: 'accepted', submissionResult: result };
  }

  // B. Ambiguous Outcome (Timeout / Socket Drop)
  if (result.outcome === 'ambiguous_timeout') {
    // CRITICAL INVARIANT: Never resend automatically and NEVER fall back to SMS!
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'unknown',
           error_code = $1,
           error_message = $2
       WHERE id = $3;`,
      [result.errorCode || 'TIMEOUT', result.errorMessage || 'Ambiguous transport timeout', attemptId]
    );

    await db.query(
      `UPDATE public.notification_jobs
       SET status = 'reconciling'::public.notification_job_status_enum,
           worker_id = NULL,
           updated_at = NOW()
       WHERE id = $1;`,
      [job.id]
    );

    return {
      status: 'reconciling',
      submissionResult: result,
      reason: 'ambiguous_timeout_requires_reconciliation'
    };
  }

  // C. Retryable Failure (Gateway Throttling / Transient 5xx)
  if (result.outcome === 'retryable_rejection') {
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'failed_transient',
           error_code = $1,
           error_message = $2
       WHERE id = $3;`,
      [result.errorCode || 'RATE_LIMITED', result.errorMessage || 'Retryable failure', attemptId]
    );

    if (job.attempt_count >= job.max_attempts) {
      await db.query(
        `UPDATE public.notification_jobs
         SET status = 'failed'::public.notification_job_status_enum,
             cancellation_reason = 'max_attempts_exceeded',
             worker_id = NULL,
             updated_at = NOW()
         WHERE id = $1;`,
        [job.id]
      );
      return { status: 'failed_terminal', submissionResult: result, reason: 'max_attempts_exceeded' };
    }

    const backoffSeconds = calculateBackoffSeconds(job.attempt_count);
    await db.query(
      `UPDATE public.notification_jobs
       SET status = 'pending'::public.notification_job_status_enum,
           scheduled_for = NOW() + ($1::text || ' seconds')::interval,
           worker_id = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $2;`,
      [backoffSeconds, job.id]
    );

    return { status: 'retry_scheduled', submissionResult: result };
  }

  // D. Confirmed Permanent Rejection -> Evaluate Strictly Conditional SMS Fallback
  await db.query(
    `UPDATE public.notification_attempts
     SET status = 'failed_permanent',
         error_code = $1,
         error_message = $2
     WHERE id = $3;`,
    [result.errorCode || 'PERMANENT_REJECTION', result.errorMessage || 'Permanent delivery rejection', attemptId]
  );

  // Evaluate SMS Fallback ONLY when confirmed recipient delivery failure occurred (NOT on config/template/auth rejections)
  if (smsAdapter && primaryAdapter.channel === 'whatsapp' && result.isPermanentDeliveryFailure === true) {
    const fallbackResult = await evaluateAndExecuteSmsFallback(
      db,
      job,
      smsAdapter,
      outboundRequest,
      workerId
    );

    if (fallbackResult.fallbackTriggered) {
      return {
        status: 'fallback_dispatched',
        submissionResult: fallbackResult.submissionResult,
        fallbackTriggered: true
      };
    }
  }

  // Terminal failure if no fallback eligible
  await db.query(
    `UPDATE public.notification_jobs
     SET status = 'failed'::public.notification_job_status_enum,
         cancellation_reason = $1,
         worker_id = NULL,
         updated_at = NOW()
     WHERE id = $2;`,
    [result.errorMessage || 'permanent_rejection_no_fallback', job.id]
  );

  return { status: 'failed_terminal', submissionResult: result };
}

/**
 * Evaluates regulatory consent and executes SMS fallback ONLY after confirmed permanent WhatsApp failure.
 * Strictly re-verifies consent, active subscription status, and prevents duplicate fallback via unique constraint.
 */
export async function evaluateAndExecuteSmsFallback(
  db: IDatabaseClient,
  job: ReminderJob,
  smsAdapter: IProviderAdapter,
  outboundRequest: OutboundMessageRequest,
  workerId: string
): Promise<{ fallbackTriggered: boolean; submissionResult?: ProviderSubmissionResult; reason?: string }> {
  // 1. Idempotency Check: Prevent duplicate SMS fallback attempts for the same job
  const existingSmsRes = await db.query(
    `SELECT id FROM public.notification_attempts WHERE job_id = $1 AND channel = 'sms' LIMIT 1;`,
    [job.id]
  );
  if (existingSmsRes.rows.length > 0) {
    return {
      fallbackTriggered: false,
      reason: 'sms_fallback_already_attempted'
    };
  }

  // 2. Comprehensive Pre-dispatch Eligibility Re-check immediately before SMS dispatch
  const eligibility = await validatePreDispatchEligibility(db, { ...job, channel: 'sms' });
  if (!eligibility.eligible) {
    return {
      fallbackTriggered: false,
      reason: eligibility.cancellationReason || 'eligibility_criteria_failed'
    };
  }

  // 3. Record fallback dispatch intent in notification_attempts (protected by unique index idx_notification_attempts_sms_unique)
  let fallbackAttemptId: string;
  try {
    const fallbackIntent = await db.query(
      `INSERT INTO public.notification_attempts (
         job_id, channel, provider, status, request_payload, sent_at
       ) VALUES ($1, 'sms', $2, 'dispatching', $3, NOW())
       RETURNING id;`,
      [
        job.id,
        smsAdapter.name,
        JSON.stringify({
          fallback_for_channel: 'whatsapp',
          milestone: job.milestone,
          recipient_phone: eligibility.member.phone
        })
      ]
    );
    fallbackAttemptId = fallbackIntent.rows[0].id;
  } catch (err: any) {
    // Unique constraint violation caught safely
    return {
      fallbackTriggered: false,
      reason: 'duplicate_fallback_prevented_by_unique_constraint'
    };
  }

  // 4. Dispatch via SMS Adapter
  const smsRequest: OutboundMessageRequest = {
    ...outboundRequest,
    channel: 'sms',
    recipientPhone: eligibility.member.phone,
    bodyText: `FITFUSION: Your membership expires on ${outboundRequest.template.parameters['expiry_date']}. Please renew to maintain access.`
  };

  const smsResult = await smsAdapter.send(smsRequest);

  if (smsResult.outcome === 'accepted') {
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'sent', provider_message_id = $1
       WHERE id = $2;`,
      [smsResult.providerMessageId || 'sms_unknown', fallbackAttemptId]
    );

    return { fallbackTriggered: true, submissionResult: smsResult };
  }

  await db.query(
    `UPDATE public.notification_attempts
     SET status = 'failed_permanent', error_code = $1, error_message = $2
     WHERE id = $3;`,
    [smsResult.errorCode || 'SMS_FALLBACK_FAILED', smsResult.errorMessage || 'SMS fallback rejected', fallbackAttemptId]
  );

  return { fallbackTriggered: false, submissionResult: smsResult, reason: 'sms_fallback_rejected' };
}
