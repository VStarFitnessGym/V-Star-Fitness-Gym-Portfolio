// ============================================================================
// Stage 5A Reminder Engine Types & Interfaces
// ============================================================================

export type NotificationMilestone = 'EXPIRY_MINUS_3' | 'EXPIRY_ZERO' | 'EXPIRY_PLUS_3' | 'MANUAL_TRIGGER';

export type NotificationJobStatus =
  | 'pending'
  | 'claimed'
  | 'dispatching'
  | 'reconciling'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type NotificationAttemptStatus =
  | 'initiated'
  | 'dispatching'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed_permanent'
  | 'failed_transient'
  | 'unknown'
  | 'unconfirmed_stale';

export type NotificationChannel = 'whatsapp' | 'sms';

export interface ReminderJob {
  id: string;
  gym_id: string;
  member_id: string;
  subscription_id: string;
  milestone: NotificationMilestone;
  target_date: string; // YYYY-MM-DD
  channel: NotificationChannel;
  status: NotificationJobStatus;
  idempotency_key: string;
  scheduled_for: string; // ISO string
  claimed_at?: string | null;
  lease_expires_at?: string | null;
  worker_id?: string | null;
  attempt_count: number;
  max_attempts: number;
  processed_at?: string | null;
  cancellation_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryResult {
  outcome: 'delivered' | 'retryable_failure' | 'permanent_failure' | 'ambiguous_timeout';
  provider: string;
  provider_message_id?: string;
  error_code?: string;
  error_message?: string;
  is_mock?: boolean;
}

export interface IDeliveryAdapter {
  name: string;
  deliver(params: {
    job: ReminderJob;
    member: { id: string; full_name: string; phone: string };
    subscription: { id: string; end_date: string; plan_name?: string };
    gym: { id: string; gym_name: string; phone_number: string };
  }): Promise<DeliveryResult>;
}

export interface ScheduleResult {
  jobsCreated: number;
  jobsSkipped: number;
  jobIds: string[];
}

export interface WorkerBatchResult {
  claimedCount: number;
  processedCount: number;
  successCount: number;
  retryableFailCount: number;
  permanentFailCount: number;
  ambiguousCount: number;
  cancelledCount: number;
}
