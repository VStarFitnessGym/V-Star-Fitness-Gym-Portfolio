// ============================================================================
// Stage 5A Reminder Engine: Reconciliation Service
// Sweeps orphaned leases and safely resolves ambiguous dispatch outcomes
// ============================================================================

import { IDatabaseClient } from '../../db/database';

export interface ReconciliationSummary {
  orphanedLeasesReset: number;
  ambiguousJobsFlagged: number;
  jobsReconciled: number;
}

/**
 * Sweeps expired worker leases:
 *  - If worker crashed BEFORE recording dispatch intent: safely resets job to 'pending'
 *  - If dispatch intent was recorded: transitions job to 'reconciling' to prevent duplicate sends
 */
export async function sweepExpiredLeases(db: IDatabaseClient): Promise<{ resetCount: number; flaggedCount: number }> {
  // 1. Safe reset: Expired lease with ZERO dispatch intent recorded
  const safeResetRes = await db.query(`
    UPDATE public.notification_jobs j
    SET 
      status = 'pending'::public.notification_job_status_enum,
      worker_id = NULL,
      lease_expires_at = NULL,
      updated_at = NOW()
    WHERE 
      j.status = 'claimed'::public.notification_job_status_enum
      AND j.lease_expires_at < NOW()
      AND j.attempt_count < j.max_attempts
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_attempts a 
        WHERE a.job_id = j.id
      )
    RETURNING j.id;
  `);

  // 2. Ambiguous dispatch: Expired lease where dispatch intent WAS recorded
  const ambiguousRes = await db.query(`
    UPDATE public.notification_jobs j
    SET 
      status = 'reconciling'::public.notification_job_status_enum,
      worker_id = NULL,
      updated_at = NOW()
    WHERE 
      j.status IN ('claimed'::public.notification_job_status_enum, 'dispatching'::public.notification_job_status_enum)
      AND j.lease_expires_at < NOW()
      AND EXISTS (
        SELECT 1 FROM public.notification_attempts a 
        WHERE a.job_id = j.id 
        AND a.status IN ('dispatching', 'sent', 'unknown')
      )
    RETURNING j.id;
  `);

  return {
    resetCount: safeResetRes.rows.length,
    flaggedCount: ambiguousRes.rows.length
  };
}

/**
 * Reconciles ambiguous jobs in 'reconciling' status based on verified provider receipts
 */
export async function reconcileAmbiguousJob(
  db: IDatabaseClient,
  jobId: string,
  resolution: { outcome: 'delivered' | 'failed' | 'retry'; verifiedReceiptId?: string; note?: string }
): Promise<boolean> {
  if (resolution.outcome === 'delivered') {
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'delivered', delivered_at = NOW(), provider_message_id = COALESCE($1, provider_message_id)
       WHERE job_id = $2 AND status = 'unknown';`,
      [resolution.verifiedReceiptId || null, jobId]
    );

    await db.query(
      `UPDATE public.notification_jobs
       SET status = 'completed'::public.notification_job_status_enum,
           processed_at = NOW(),
           cancellation_reason = $1,
           updated_at = NOW()
       WHERE id = $2 AND status = 'reconciling';`,
      [resolution.note || 'reconciled_as_delivered', jobId]
    );
    return true;
  }

  if (resolution.outcome === 'failed') {
    await db.query(
      `UPDATE public.notification_attempts
       SET status = 'failed_permanent', error_message = $1
       WHERE job_id = $2 AND status = 'unknown';`,
      [resolution.note || 'reconciled_as_undelivered', jobId]
    );

    await db.query(
      `UPDATE public.notification_jobs
       SET status = 'failed'::public.notification_job_status_enum,
           cancellation_reason = $1,
           updated_at = NOW()
       WHERE id = $2 AND status = 'reconciling';`,
      [resolution.note || 'reconciled_as_failed', jobId]
    );
    return true;
  }

  if (resolution.outcome === 'retry') {
    await db.query(
      `UPDATE public.notification_jobs
       SET status = 'pending'::public.notification_job_status_enum,
           scheduled_for = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status = 'reconciling';`,
      [jobId]
    );
    return true;
  }

  return false;
}
