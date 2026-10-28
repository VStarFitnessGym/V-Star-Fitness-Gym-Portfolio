// ============================================================================
// Stage 5A Reminder Engine: Scheduling Service
// Generates idempotent, calendar-accurate reminder jobs for subscriptions
// ============================================================================

import { IDatabaseClient } from '../../db/database';
import { NotificationMilestone, ScheduleResult } from './types';
import {
  calculateMilestoneTargetDate,
  convertTargetDateToUtcSchedule,
  isMilestoneStale,
  formatUtcDateString,
  getGymLocalCalendarDate
} from './dateMath';
import { validateSubscriptionForScheduling } from './eligibilityService';

export const REMINDER_MILESTONES: NotificationMilestone[] = [
  'EXPIRY_MINUS_3',
  'EXPIRY_ZERO',
  'EXPIRY_PLUS_3'
];

/**
 * Derives a deterministic idempotency key for a reminder job.
 * Guaranteed to be unique per subscription, milestone, and target date.
 */
export function generateReminderIdempotencyKey(
  subscriptionId: string,
  milestone: NotificationMilestone,
  targetDate: string
): string {
  return `rem:${subscriptionId}:${milestone}:${targetDate}`;
}

export interface ScheduleOptions {
  currentDate?: string; // YYYY-MM-DD for deterministic testing of scheduler runs
  gracePeriodDays?: number; // Days in past allowed before marking a missed milestone stale (default 1)
}

/**
 * Schedules the 3 reminder milestones for a single subscription.
 */
export async function scheduleRemindersForSubscription(
  db: IDatabaseClient,
  subscriptionId: string,
  options: ScheduleOptions = {}
): Promise<ScheduleResult> {
  const validation = await validateSubscriptionForScheduling(db, subscriptionId);
  if (!validation.eligible || !validation.subscription || !validation.member) {
    return { jobsCreated: 0, jobsSkipped: 0, jobIds: [] };
  }

  const sub = validation.subscription;
  const member = validation.member;

  // Retrieve gym timezone & configured send hour
  const gymRes = await db.query(
    `SELECT timezone, reminder_send_hour FROM public.gym_settings WHERE id = $1 LIMIT 1;`,
    [sub.gym_id]
  );
  const timezone = gymRes.rows[0]?.timezone || 'Asia/Kolkata';
  const sendHour = gymRes.rows[0]?.reminder_send_hour || 10;

  // Current calendar date in gym's configured local timezone
  const todayStr = options.currentDate || getGymLocalCalendarDate(new Date(), timezone);
  const graceDays = options.gracePeriodDays ?? 1;

  // Preferred channel based on regulatory consent (WhatsApp primary, SMS secondary)
  const channel = member.whatsapp_consent ? 'whatsapp' : member.sms_consent ? 'sms' : null;
  if (!channel) {
    return { jobsCreated: 0, jobsSkipped: 3, jobIds: [] };
  }

  // Pre-emptive cleanup: If the subscription end_date changed, cancel any existing pending
  // jobs for this subscription that do not match the new target dates
  const newTargetDates = REMINDER_MILESTONES.map(m => calculateMilestoneTargetDate(sub.end_date, m));
  await db.query(
    `UPDATE public.notification_jobs
     SET status = 'cancelled'::public.notification_job_status_enum,
         cancellation_reason = 'subscription_end_date_changed',
         updated_at = NOW()
     WHERE subscription_id = $1 
       AND status = 'pending'::public.notification_job_status_enum
       AND target_date NOT IN ($2, $3, $4);`,
    [sub.id, newTargetDates[0], newTargetDates[1], newTargetDates[2]]
  );

  let jobsCreated = 0;
  let jobsSkipped = 0;
  const jobIds: string[] = [];

  for (const milestone of REMINDER_MILESTONES) {
    const targetDate = calculateMilestoneTargetDate(sub.end_date, milestone);
    const idempotencyKey = generateReminderIdempotencyKey(sub.id, milestone, targetDate);
    const scheduledFor = convertTargetDateToUtcSchedule(targetDate, sendHour, timezone);

    // Enforce Missed Scheduler Run Policy:
    // If the target date is in the past beyond grace period, mark job as skipped to prevent stale message bursts
    const isStale = isMilestoneStale(targetDate, todayStr, graceDays);
    const initialStatus = isStale ? 'skipped' : 'pending';
    const cancellationReason = isStale ? 'scheduler_missed_milestone_stale' : null;

    const insertSql = `
      INSERT INTO public.notification_jobs (
        gym_id,
        member_id,
        subscription_id,
        milestone,
        target_date,
        channel,
        status,
        idempotency_key,
        scheduled_for,
        cancellation_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id;
    `;

    const res = await db.query(insertSql, [
      sub.gym_id,
      sub.member_id,
      sub.id,
      milestone,
      targetDate,
      channel,
      initialStatus,
      idempotencyKey,
      scheduledFor,
      cancellationReason
    ]);

    if (res.rows.length > 0) {
      if (initialStatus === 'pending') {
        jobsCreated++;
      } else {
        jobsSkipped++;
      }
      jobIds.push(res.rows[0].id);
    }
  }

  return { jobsCreated, jobsSkipped, jobIds };
}

/**
 * Evaluates all active subscriptions for a gym tenant and generates reminder jobs idempotently.
 */
export async function scheduleRemindersForGym(
  db: IDatabaseClient,
  gymId: string,
  options: ScheduleOptions = {}
): Promise<ScheduleResult> {
  // Query active subscriptions that have not been superseded
  const query = `
    SELECT s.id 
    FROM public.subscriptions s
    JOIN public.members m ON m.id = s.member_id
    WHERE s.gym_id = $1 
      AND s.status = 'active'
      AND m.status != 'archived'
      AND NOT EXISTS (
        SELECT 1 FROM public.subscriptions sub_next 
        WHERE sub_next.renewed_from_subscription_id = s.id
      )
    ORDER BY s.end_date ASC;
  `;

  const subsRes = await db.query(query, [gymId]);
  let totalCreated = 0;
  let totalSkipped = 0;
  const allJobIds: string[] = [];

  for (const row of subsRes.rows) {
    const result = await scheduleRemindersForSubscription(db, row.id, options);
    totalCreated += result.jobsCreated;
    totalSkipped += result.jobsSkipped;
    allJobIds.push(...result.jobIds);
  }

  return {
    jobsCreated: totalCreated,
    jobsSkipped: totalSkipped,
    jobIds: allJobIds
  };
}
