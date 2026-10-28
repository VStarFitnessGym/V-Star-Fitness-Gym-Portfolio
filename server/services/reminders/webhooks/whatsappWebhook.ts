// ============================================================================
// Stage 5B Remediation: WhatsApp Webhook Verification & Delivery Event Processing
// Conforms to Meta Business Platform Webhooks specifications
// Enforces cryptographic HMAC-SHA256 signature verification, explicit state transitions,
// atomic transaction boundaries, and idempotent duplicate handling.
// ============================================================================

import crypto from 'crypto';
import { IDatabaseClient } from '../../../db/database';
import { DeliveryStatusEvent, WebhookVerificationResult } from '../providerTypes';

/**
 * Verifies Meta WhatsApp webhook X-Hub-Signature-256 signature using HMAC-SHA256.
 * Bounded length and hex regex checks guarantee timingSafeEqual never crashes on malformed inputs.
 */
export function verifyWhatsAppSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret || typeof signatureHeader !== 'string') {
    return false;
  }

  // Meta signature format: "sha256=<64_hex_digits>"
  if (!signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedSignatureHex = signatureHeader.substring(7); // Strip 'sha256='

  // Strictly validate 64 hex characters (32 bytes HMAC-SHA256) to prevent RangeError in timingSafeEqual
  if (!/^[0-9a-fA-F]{64}$/.test(expectedSignatureHex)) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', appSecret);

  if (Buffer.isBuffer(rawBody)) {
    hmac.update(rawBody);
  } else {
    hmac.update(Buffer.from(rawBody, 'utf-8'));
  }

  const calculatedSignatureHex = hmac.digest('hex');

  const expectedBuf = Buffer.from(expectedSignatureHex, 'hex');
  const calculatedBuf = Buffer.from(calculatedSignatureHex, 'hex');

  if (expectedBuf.length !== calculatedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, calculatedBuf);
}

/**
 * Parses incoming Meta WhatsApp webhook JSON payload into typed DeliveryStatusEvent array
 */
export function parseWhatsAppWebhookPayload(payload: any): DeliveryStatusEvent[] {
  const events: DeliveryStatusEvent[] = [];

  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    return events;
  }

  for (const entry of payload.entry) {
    if (!Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      const value = change?.value;
      if (!value || value.messaging_product !== 'whatsapp') continue;

      const statuses = value.statuses;
      if (!Array.isArray(statuses)) continue;

      for (const st of statuses) {
        if (!st.id || !st.status) continue;

        let mappedStatus: DeliveryStatusEvent['status'] = 'sent';
        if (st.status === 'delivered') mappedStatus = 'delivered';
        else if (st.status === 'read') mappedStatus = 'read';
        else if (st.status === 'failed') mappedStatus = 'failed';
        else if (st.status === 'sent') mappedStatus = 'sent';
        else mappedStatus = st.status as any; // Retain unmapped provider status for safe handling

        let errorCode: string | undefined;
        let errorMessage: string | undefined;
        let isPermanentDeliveryFailure = false;

        if (Array.isArray(st.errors) && st.errors.length > 0) {
          const errCodeNum = Number(st.errors[0].code);
          errorCode = String(st.errors[0].code || 'UNKNOWN_META_ERROR');
          errorMessage = st.errors[0].message || st.errors[0].title || 'Delivery failure reported by Meta';
          // 131030, 131026, 131047, 131051, 131052, 131053 confirmed recipient delivery failures
          isPermanentDeliveryFailure = [131030, 131026, 131047, 131051, 131052, 131053].includes(errCodeNum);
        }

        events.push({
          provider: 'meta_whatsapp',
          providerMessageId: st.id,
          status: mappedStatus,
          timestamp: st.timestamp ? new Date(parseInt(st.timestamp, 10) * 1000).toISOString() : new Date().toISOString(),
          recipientPhone: st.recipient_id,
          errorCode,
          errorMessage,
          isPermanentDeliveryFailure,
          rawEvent: st
        });
      }
    }
  }

  return events;
}

export type WebhookTransitionAction =
  | { type: 'apply'; attemptStatus: 'sent' | 'delivered' | 'read' | 'failed_permanent'; jobStatus?: 'dispatching' | 'completed' | 'failed' }
  | { type: 'superseded'; reason: string }
  | { type: 'duplicate'; reason: string }
  | { type: 'conflict'; reason: string }
  | { type: 'unmapped_status'; reason: string };

/**
 * Explicit state machine transition evaluator.
 * Replaces fragile numeric rank with definitive provider-neutral transition rules.
 */
export function evaluateWebhookStateTransition(
  currentAttemptStatus: string,
  incomingStatus: DeliveryStatusEvent['status']
): WebhookTransitionAction {
  // Check for unknown or unmapped provider status
  if (!['sent', 'delivered', 'read', 'failed'].includes(incomingStatus)) {
    return {
      type: 'unmapped_status',
      reason: `unmapped_provider_status: ${incomingStatus}`
    };
  }

  // 1. Terminal Failure States
  if (currentAttemptStatus === 'failed_permanent') {
    if (incomingStatus === 'failed') {
      return { type: 'duplicate', reason: 'already_failed_permanent' };
    }
    if (incomingStatus === 'sent') {
      return { type: 'superseded', reason: 'late_sent_after_permanent_failure' };
    }
    // Conflicting outcome: Carrier previously confirmed permanent failure, now reporting delivered/read!
    if (incomingStatus === 'delivered' || incomingStatus === 'read') {
      return {
        type: 'conflict',
        reason: `conflicting_callback: received ${incomingStatus} after confirmed failed_permanent`
      };
    }
  }

  // 2. Terminal Handset Delivery / Read States
  if (currentAttemptStatus === 'read') {
    if (incomingStatus === 'read') {
      return { type: 'duplicate', reason: 'already_read' };
    }
    if (incomingStatus === 'sent' || incomingStatus === 'delivered') {
      return { type: 'superseded', reason: `late_${incomingStatus}_after_read` };
    }
    if (incomingStatus === 'failed') {
      return {
        type: 'conflict',
        reason: 'conflicting_callback: received failed after confirmed read'
      };
    }
  }

  if (currentAttemptStatus === 'delivered') {
    if (incomingStatus === 'delivered') {
      return { type: 'duplicate', reason: 'already_delivered' };
    }
    if (incomingStatus === 'read') {
      return { type: 'apply', attemptStatus: 'read' };
    }
    if (incomingStatus === 'sent') {
      return { type: 'superseded', reason: 'late_sent_after_delivered' };
    }
    if (incomingStatus === 'failed') {
      return {
        type: 'conflict',
        reason: 'conflicting_callback: received failed after confirmed delivered'
      };
    }
  }

  // 3. Upstream Sent State
  if (currentAttemptStatus === 'sent') {
    if (incomingStatus === 'sent') {
      return { type: 'duplicate', reason: 'already_sent' };
    }
    if (incomingStatus === 'delivered') {
      return { type: 'apply', attemptStatus: 'delivered', jobStatus: 'completed' };
    }
    if (incomingStatus === 'read') {
      return { type: 'apply', attemptStatus: 'read', jobStatus: 'completed' };
    }
    if (incomingStatus === 'failed') {
      return { type: 'apply', attemptStatus: 'failed_permanent', jobStatus: 'failed' };
    }
  }

  // 4. Initial / In-Flight / Ambiguous States (initiated, dispatching, unknown, unconfirmed_stale)
  if (incomingStatus === 'sent') {
    return { type: 'apply', attemptStatus: 'sent', jobStatus: 'dispatching' };
  }
  if (incomingStatus === 'delivered') {
    return { type: 'apply', attemptStatus: 'delivered', jobStatus: 'completed' };
  }
  if (incomingStatus === 'read') {
    return { type: 'apply', attemptStatus: 'read', jobStatus: 'completed' };
  }
  if (incomingStatus === 'failed') {
    return { type: 'apply', attemptStatus: 'failed_permanent', jobStatus: 'failed' };
  }

  return { type: 'unmapped_status', reason: `unexpected_state_combination: ${currentAttemptStatus} -> ${incomingStatus}` };
}

export interface WebhookProcessResult {
  processed: boolean;
  reason?: string;
  jobId?: string;
  attemptId?: string;
  permanentDeliveryFailure?: boolean;
  isConflict?: boolean;
}

/**
 * Processes a single DeliveryStatusEvent idempotently inside an atomic database transaction
 */
export async function processDeliveryStatusEvent(
  db: IDatabaseClient,
  event: DeliveryStatusEvent
): Promise<WebhookProcessResult> {
  const eventId = `${event.provider}:${event.providerMessageId}:${event.status}:${event.timestamp}`;

  return await db.transaction(async (tx) => {
    // 1. Atomic Idempotency Guard in webhook_events table
    const insertEventRes = await tx.query(
      `INSERT INTO public.webhook_events (provider, event_id, event_type, payload, processed, received_at)
       VALUES ($1, $2, $3, $4, false, NOW())
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id;`,
      [event.provider, eventId, `message.${event.status}`, JSON.stringify(event.rawEvent || event)]
    );

    if (insertEventRes.rows.length === 0) {
      // Event already recorded in webhook_events
      return { processed: false, reason: 'duplicate_event' };
    }

    // 2. Locate corresponding notification_attempt record by provider_message_id with row lock
    const attemptRes = await tx.query(
      `SELECT a.id as attempt_id, a.job_id, a.status as attempt_status, j.status as job_status, j.member_id, j.subscription_id
       FROM public.notification_attempts a
       JOIN public.notification_jobs j ON j.id = a.job_id
       WHERE a.provider_message_id = $1
       ORDER BY a.sent_at DESC
       LIMIT 1
       FOR UPDATE;`,
      [event.providerMessageId]
    );

    if (attemptRes.rows.length === 0) {
      // Attempt not found in local database (external system or broadcast)
      await tx.query(
        `UPDATE public.webhook_events 
         SET processed = true, processing_error = 'attempt_not_found_for_provider_message_id'
         WHERE event_id = $1;`,
        [eventId]
      );
      return { processed: false, reason: 'attempt_not_found' };
    }

    const attempt = attemptRes.rows[0];

    // 3. Evaluate explicit state machine transition
    const transition = evaluateWebhookStateTransition(attempt.attempt_status, event.status);

    if (transition.type === 'superseded' || transition.type === 'duplicate') {
      await tx.query(
        `UPDATE public.webhook_events SET processed = true, processing_error = $1 WHERE event_id = $2;`,
        [transition.reason, eventId]
      );
      return { processed: false, reason: transition.reason, jobId: attempt.job_id };
    }

    if (transition.type === 'unmapped_status') {
      await tx.query(
        `UPDATE public.webhook_events SET processed = true, processing_error = $1 WHERE event_id = $2;`,
        [transition.reason, eventId]
      );
      return { processed: false, reason: transition.reason, jobId: attempt.job_id };
    }

    if (transition.type === 'conflict') {
      // CONFLICT: Callback contradicts authoritative terminal state!
      // Move job into reconciling state with detailed cancellation_reason note; do not overwrite attempt.
      await tx.query(
        `UPDATE public.notification_jobs
         SET status = 'reconciling'::public.notification_job_status_enum,
             cancellation_reason = $1,
             updated_at = NOW()
         WHERE id = $2;`,
        [transition.reason, attempt.job_id]
      );

      await tx.query(
        `UPDATE public.webhook_events SET processed = true, processing_error = $1 WHERE event_id = $2;`,
        [transition.reason, eventId]
      );

      return {
        processed: false,
        reason: transition.reason,
        jobId: attempt.job_id,
        isConflict: true
      };
    }

    // 4. Apply Valid State Transition Atomically
    await tx.query(
      `UPDATE public.notification_attempts
       SET status = $1::public.notification_attempt_status_enum,
           delivered_at = CASE WHEN $1 IN ('delivered', 'read') THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
           error_code = CASE WHEN $1 = 'failed_permanent' THEN COALESCE($2, error_code) ELSE error_code END,
           error_message = CASE WHEN $1 = 'failed_permanent' THEN COALESCE($3, error_message) ELSE error_message END
       WHERE id = $4;`,
      [transition.attemptStatus, event.errorCode || null, event.errorMessage || null, attempt.attempt_id]
    );

    if (transition.jobStatus) {
      await tx.query(
        `UPDATE public.notification_jobs
         SET status = $1::public.notification_job_status_enum,
             processed_at = CASE WHEN $1 = 'completed' THEN COALESCE(processed_at, NOW()) ELSE processed_at END,
             cancellation_reason = CASE WHEN $1 = 'failed' THEN $2 ELSE cancellation_reason END,
             updated_at = NOW()
         WHERE id = $3 AND status NOT IN ('completed', 'cancelled');`,
        [transition.jobStatus, event.errorMessage || 'carrier_delivery_failed', attempt.job_id]
      );
    }

    await tx.query(
      `UPDATE public.webhook_events SET processed = true WHERE event_id = $1;`,
      [eventId]
    );

    return {
      processed: true,
      jobId: attempt.job_id,
      attemptId: attempt.attempt_id,
      permanentDeliveryFailure: transition.attemptStatus === 'failed_permanent'
    };
  });
}
