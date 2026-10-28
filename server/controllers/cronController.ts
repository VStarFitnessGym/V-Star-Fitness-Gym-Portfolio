// ============================================================================
// Cron Execution Controller (Stage 5C)
// Coordinates scheduled reminder creation, worker batch processing, and lease sweep
// Protected by distributed advisory lock coordination and bounded batch processing
// ============================================================================

import { Request, Response } from 'express';
import crypto from 'crypto';
import { db, ISessionClient } from '../db/database';
import { scheduleRemindersForGym } from '../services/reminders/schedulerService';
import { processWorkerBatch } from '../services/reminders/workerService';
import { sweepExpiredLeases } from '../services/reminders/reconciliationService';
import { MockDeliveryAdapter } from '../services/reminders/mockAdapter';
import { loadProviderConfig } from '../services/reminders/config';
import { logger } from '../utils/logger';
import { sendProblem } from '../utils/problemDetails';

/**
 * POST /api/cron/reminders
 * Executes the full reminder lifecycle pipeline across all gym tenants:
 * 1. Idempotent milestone scheduling
 * 2. Bounded worker batch claim and dispatch
 * 3. Expired lease & ambiguous timeout reconciliation
 *
 * Connection Ownership & Lock Lifetime Invariant:
 * - A single dedicated database session client is checked out from the pool.
 * - pg_try_advisory_lock, scheduling, worker dispatch, lease sweep, and pg_advisory_unlock
 *   all execute on that EXACT SAME session connection.
 * - The connection is NEVER returned to the pool while the session lock is held.
 * - The session is guaranteed to be released in an outer finally block.
 * - External provider calls run without holding an open database transaction.
 */
export async function triggerReminderCron(req: Request, res: Response): Promise<void> {
  const requestId = (req as any).requestId;
  const workerId = `cron_worker_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const batchSize = Math.min(Math.max(parseInt(req.query.batch_size as string || '25', 10), 1), 50);

  let lockAcquired = false;
  let session: ISessionClient | null = null;
  let pipelineError: any = null;

  try {
    // 1. Explicitly check out a dedicated database session client from the pool
    session = await db.acquireSessionClient();

    // 2. Cluster-wide session advisory lock acquired on THIS SPECIFIC SESSION
    const lockRes = await session.query(
      `SELECT pg_try_advisory_lock(hashtext('fitfusion_cron_reminders')) AS acquired;`
    );
    lockAcquired = lockRes.rows[0]?.acquired === true;

    if (!lockAcquired) {
      logger.warn('Cron execution skipped: concurrent execution actively holding lock');
      res.status(200).json({
        status: 'skipped',
        message: 'Concurrent cron execution in progress. Operation skipped.',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // 3. Step 1: Idempotent Reminder Scheduling for all active gyms on the dedicated session
    const gymsRes = await session.query(`SELECT id, gym_name FROM public.gym_settings ORDER BY created_at ASC;`);
    let totalJobsCreated = 0;
    let totalJobsSkipped = 0;

    for (const gym of gymsRes.rows) {
      const schedRes = await scheduleRemindersForGym(session, gym.id);
      totalJobsCreated += schedRes.jobsCreated;
      totalJobsSkipped += schedRes.jobsSkipped;
    }

    // 4. Step 2: Bounded Worker Batch Claiming & Processing on the dedicated session
    // Always use safe MockDeliveryAdapter unless live providers are explicitly enabled and not in test
    const providerConfig = loadProviderConfig();
    const adapter = new MockDeliveryAdapter();

    const batchResult = await processWorkerBatch(session, workerId, adapter, batchSize);

    // 5. Step 3: Expired Lease & Ambiguous Outcome Sweep on the dedicated session
    const sweepResult = await sweepExpiredLeases(session);

    logger.info('Cron reminder pipeline completed successfully', {
      gymsCount: gymsRes.rows.length,
      jobsCreated: totalJobsCreated,
      jobsSkipped: totalJobsSkipped,
      claimedCount: batchResult.claimedCount,
      processedCount: batchResult.processedCount,
      successCount: batchResult.successCount,
      orphanedLeasesReset: sweepResult.resetCount,
      ambiguousJobsFlagged: sweepResult.flaggedCount
    });

    res.status(200).json({
      status: 'success',
      timestamp: new Date().toISOString(),
      scheduler: {
        gymsProcessed: gymsRes.rows.length,
        jobsCreated: totalJobsCreated,
        jobsSkipped: totalJobsSkipped
      },
      worker: {
        workerId,
        claimedCount: batchResult.claimedCount,
        processedCount: batchResult.processedCount,
        successCount: batchResult.successCount,
        retryableFailCount: batchResult.retryableFailCount,
        permanentFailCount: batchResult.permanentFailCount,
        ambiguousCount: batchResult.ambiguousCount,
        cancelledCount: batchResult.cancelledCount
      },
      reconciliation: {
        orphanedLeasesReset: sweepResult.resetCount,
        ambiguousJobsFlagged: sweepResult.flaggedCount
      }
    });
  } catch (err: any) {
    pipelineError = err;
    logger.error('Failed to execute cron reminder pipeline', err, { requestId });
    sendProblem(res, {
      status: 500,
      code: 'CRON_EXECUTION_FAILED',
      title: 'Internal Server Error',
      detail: 'An unexpected error occurred while executing the cron reminder pipeline.',
      instance: req.originalUrl,
      requestId
    });
  } finally {
    // 6. Guaranteed release sequence:
    // First: unlock the session advisory lock on THIS EXACT SAME session connection
    // Second: release the checked-out session connection back to the pool
    if (session) {
      try {
        if (lockAcquired) {
          await session.query(`SELECT pg_advisory_unlock(hashtext('fitfusion_cron_reminders'));`);
          lockAcquired = false;
        }
      } catch (unlockErr: any) {
        logger.error('Failed to release cron advisory lock', unlockErr, {
          requestId,
          originalPipelineError: pipelineError?.message
        });
      } finally {
        try {
          await session.release();
        } catch (releaseErr: any) {
          logger.error('Failed to release database session client back to pool', releaseErr, { requestId });
        }
      }
    }
  }
}
