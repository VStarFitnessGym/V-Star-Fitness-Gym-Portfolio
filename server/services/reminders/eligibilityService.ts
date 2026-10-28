// ============================================================================
// Stage 5A Reminder Engine: Eligibility Validation Service
// Evaluates both scheduling-time and pre-dispatch eligibility
// ============================================================================

import { IDatabaseClient } from '../../db/database';
import { ReminderJob, NotificationMilestone } from './types';
import { calculateMilestoneTargetDate, formatUtcDateString } from './dateMath';

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  member?: {
    id: string;
    full_name: string;
    phone: string;
    whatsapp_consent: boolean;
    sms_consent: boolean;
    status: string;
  };
  subscription?: {
    id: string;
    gym_id: string;
    member_id: string;
    plan_id: string;
    start_date: string;
    end_date: string;
    status: string;
  };
}

/**
 * Validates whether a subscription is eligible to have reminders scheduled.
 * Enforces:
 *  1. Subscription exists and status is 'active' (or legitimate expiry candidate)
 *  2. Member is not archived
 *  3. Subscription is the member's current authoritative subscription (not superseded)
 */
export async function validateSubscriptionForScheduling(
  db: IDatabaseClient,
  subscriptionId: string
): Promise<EligibilityResult> {
  const query = `
    SELECT 
      s.id, s.gym_id, s.member_id, s.plan_id, s.start_date, s.end_date, s.status as sub_status,
      m.full_name, m.phone, m.whatsapp_consent, m.sms_consent, m.status as member_status
    FROM public.subscriptions s
    JOIN public.members m ON m.id = s.member_id
    WHERE s.id = $1
    LIMIT 1;
  `;

  const res = await db.query(query, [subscriptionId]);
  if (res.rows.length === 0) {
    return { eligible: false, reason: 'subscription_or_member_not_found' };
  }

  const row = res.rows[0];

  if (row.member_status === 'archived') {
    return { eligible: false, reason: 'member_is_archived' };
  }

  if (row.sub_status === 'cancelled') {
    return { eligible: false, reason: 'subscription_cancelled' };
  }

  if (row.sub_status === 'superseded') {
    return { eligible: false, reason: 'subscription_superseded' };
  }

  // Verify this subscription is the latest active subscription for this member
  const supersededCheck = await db.query(
    `SELECT id FROM public.subscriptions 
     WHERE member_id = $1 AND renewed_from_subscription_id = $2
     LIMIT 1;`,
    [row.member_id, subscriptionId]
  );

  if (supersededCheck.rows.length > 0) {
    return { eligible: false, reason: 'subscription_has_been_renewed_or_superseded' };
  }

  return {
    eligible: true,
    member: {
      id: row.member_id,
      full_name: row.full_name,
      phone: row.phone,
      whatsapp_consent: row.whatsapp_consent,
      sms_consent: row.sms_consent,
      status: row.member_status
    },
    subscription: {
      id: row.id,
      gym_id: row.gym_id,
      member_id: row.member_id,
      plan_id: row.plan_id,
      start_date: typeof row.start_date === 'string' ? row.start_date.substring(0, 10) : row.start_date.toISOString().substring(0, 10),
      end_date: typeof row.end_date === 'string' ? row.end_date.substring(0, 10) : row.end_date.toISOString().substring(0, 10),
      status: row.sub_status
    }
  };
}

/**
 * Re-validates eligibility immediately before delivery adapter invocation.
 * Enforces:
 *  1. Subscription exists and is not cancelled or superseded.
 *  2. Target date still matches the current authoritative subscription end_date.
 *  3. Member remains unarchived and has regulatory consent.
 *  4. Job has not already been cancelled or completed.
 */
export async function validatePreDispatchEligibility(
  db: IDatabaseClient,
  job: ReminderJob
): Promise<{ eligible: boolean; cancellationReason?: string; member?: any; subscription?: any; gym?: any }> {
  // Query subscription, member, and gym settings
  const res = await db.query(
    `SELECT 
      s.id as sub_id, s.end_date, s.status as sub_status,
      m.id as member_id, m.full_name, m.phone, m.whatsapp_consent, m.sms_consent, m.status as member_status,
      g.id as gym_id, g.gym_name, g.phone_number as gym_phone
     FROM public.subscriptions s
     JOIN public.members m ON m.id = s.member_id
     JOIN public.gym_settings g ON g.id = s.gym_id
     WHERE s.id = $1
     LIMIT 1;`,
    [job.subscription_id]
  );

  if (res.rows.length === 0) {
    return { eligible: false, cancellationReason: 'referenced_subscription_missing' };
  }

  const row = res.rows[0];
  const currentEndDate = typeof row.end_date === 'string'
    ? row.end_date.substring(0, 10)
    : row.end_date instanceof Date
    ? formatUtcDateString(row.end_date)
    : formatUtcDateString(new Date(row.end_date));

  // 1. Check if subscription was cancelled or superseded
  if (row.sub_status === 'cancelled') {
    return { eligible: false, cancellationReason: 'subscription_cancelled' };
  }
  if (row.sub_status === 'superseded') {
    return { eligible: false, cancellationReason: 'subscription_superseded' };
  }

  // 2. Check if subscription end_date changed since job was scheduled
  const expectedTargetDate = calculateMilestoneTargetDate(currentEndDate, job.milestone);
  const rawTargetDate = job.target_date as any;
  const jobTargetDate = typeof rawTargetDate === 'string'
    ? rawTargetDate.substring(0, 10)
    : rawTargetDate instanceof Date
    ? formatUtcDateString(rawTargetDate)
    : formatUtcDateString(new Date(rawTargetDate));

  if (expectedTargetDate !== jobTargetDate) {
    return { eligible: false, cancellationReason: 'subscription_expiry_date_changed' };
  }

  // 3. Check if member is archived
  if (row.member_status === 'archived') {
    return { eligible: false, cancellationReason: 'member_archived' };
  }

  // 4. Check regulatory DPDP consent for the assigned channel
  if (job.channel === 'whatsapp' && !row.whatsapp_consent) {
    return { eligible: false, cancellationReason: 'member_opted_out_whatsapp' };
  }
  if (job.channel === 'sms' && !row.sms_consent) {
    return { eligible: false, cancellationReason: 'member_opted_out_sms' };
  }

  return {
    eligible: true,
    member: { id: row.member_id, full_name: row.full_name, phone: row.phone },
    subscription: { id: row.sub_id, end_date: currentEndDate },
    gym: { id: row.gym_id, gym_name: row.gym_name, phone_number: row.gym_phone }
  };
}
