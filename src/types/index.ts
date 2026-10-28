export type MemberStatus = 'active' | 'expiring' | 'expired' | 'archived';

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'superseded';

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

export interface MembershipPlan {
  id: string;
  name: string;
  duration_days: number;
  price: number;
  description: string;
  perks: string[];
  is_active: boolean;
  popular?: boolean;
}

export interface Subscription {
  id: string;
  member_id: string;
  plan_id: string;
  plan_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  status: SubscriptionStatus;
  amount_paid: number;
  payment_method: 'cash' | 'upi' | 'card' | 'bank_transfer' | 'other';
  notes?: string;
  version: number;
  idempotency_key?: string;
  renewed_from_subscription_id?: string | null;
  created_at: string;
}

export interface Member {
  id: string;
  member_code: string;
  full_name: string;
  phone: string;
  email?: string | null;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  status: MemberStatus;
  whatsapp_consent: boolean;
  whatsapp_consent_at: string;
  sms_consent: boolean;
  sms_consent_at: string;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  notes?: string | null;
  created_at: string;
  current_subscription?: Subscription;
}

export interface NotificationAttempt {
  id: string;
  job_id: string;
  channel: NotificationChannel;
  provider: 'meta_whatsapp' | 'fast2sms' | 'msg91';
  provider_message_id?: string;
  status: NotificationAttemptStatus;
  sent_at: string;
  delivered_at?: string;
  error_code?: string;
  error_message?: string;
}

export interface NotificationJob {
  id: string;
  member_id: string;
  member_name: string;
  member_phone: string;
  subscription_id: string;
  milestone: NotificationMilestone;
  target_date: string;
  channel: NotificationChannel;
  status: NotificationJobStatus;
  scheduled_for: string;
  attempt_count: number;
  max_attempts: number;
  cancellation_reason?: string;
  attempts?: NotificationAttempt[];
}

export interface DashboardStats {
  totalMembers: number;
  activeMembers: number;
  expiringIn7Days: number;
  expiredMembers: number;
  todayReminders: {
    scheduled: number;
    claimed: number;
    completed: number;
    reconciling: number;
    failed: number;
  };
  integrations: {
    whatsappConnected: boolean;
    smsConnected: boolean;
    dltRegistered: boolean;
  };
}
