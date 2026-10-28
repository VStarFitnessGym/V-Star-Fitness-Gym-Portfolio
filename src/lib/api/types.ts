// ============================================================================
// Frontend API Client Contracts & Response Types (Stage 4)
// Matches Stage 3 Backend Controllers & RFC 7807 Problem Details
// ============================================================================

export type UserRole = 'owner' | 'manager' | 'admin' | 'staff';

export interface ApiHealthResponse {
  status: 'healthy' | 'degraded';
  database: 'connected' | 'disconnected';
  timestamp: string;
  uptime_seconds: number;
  version: string;
}

export interface ApiUserMeResponse {
  id: string;
  email: string | null;
  full_name: string;
  role: UserRole;
  gym: {
    id: string;
    name: string | null;
  };
}

export interface ApiMemberCurrentSubscription {
  id: string;
  plan_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  status: string;
}

export interface ApiMemberListItem {
  id: string;
  gym_id: string;
  member_code: string;
  full_name: string;
  phone: string;
  email: string | null;
  status: 'active' | 'expiring' | 'expired' | 'archived';
  whatsapp_consent: boolean;
  sms_consent: boolean;
  created_at: string;
  current_subscription: ApiMemberCurrentSubscription | null;
}

export interface ApiPagination {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface ApiMemberListResponse {
  data: ApiMemberListItem[];
  pagination: ApiPagination;
}

export interface ApiGetMembersParams {
  page?: number;
  limit?: number;
  status?: 'active' | 'expiring' | 'expired' | 'archived';
  search?: string;
  sort_by?: 'full_name' | 'created_at' | 'member_code';
  sort_order?: 'asc' | 'desc';
}

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'other';

export interface ApiRenewSubscriptionInput {
  member_id: string;
  plan_id: string;
  amount_paid: number;
  payment_method: PaymentMethod;
  idempotency_key: string;
  start_date?: string;
  notes?: string;
}

export interface ApiRenewalResponse {
  subscription_id: string;
  member_id: string;
  plan_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  amount_paid: number;
  status: string;
  idempotency_key: string;
  renewed_from_subscription_id?: string | null;
  idempotent_replay: boolean;
}

export interface ProblemDetailsInvalidParam {
  field: string;
  message: string;
}

export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  invalidParams?: ProblemDetailsInvalidParam[];
  requestId?: string;
  timestamp?: string;
}

// ============================================================================
// Reminder Operations & Telemetry API Types (Stage 5C)
// ============================================================================

export type ApiReminderMilestone = 'EXPIRY_MINUS_3' | 'EXPIRY_ZERO' | 'EXPIRY_PLUS_3' | 'MANUAL_TRIGGER';

export type ApiReminderJobStatus =
  | 'pending'
  | 'claimed'
  | 'dispatching'
  | 'reconciling'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface ApiReminderAttempt {
  id: string;
  channel: 'whatsapp' | 'sms';
  provider: string;
  provider_message_id?: string | null;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
  sent_at: string;
  delivered_at?: string | null;
  created_at: string;
}

export interface ApiReminderJob {
  id: string;
  gym_id: string;
  member_id: string;
  member_name: string;
  member_phone: string;
  subscription_id: string;
  plan_name: string;
  subscription_start_date: string;
  subscription_end_date: string;
  milestone: ApiReminderMilestone;
  target_date: string;
  channel: 'whatsapp' | 'sms';
  status: ApiReminderJobStatus;
  idempotency_key: string;
  scheduled_for: string;
  claimed_at: string | null;
  lease_expires_at: string | null;
  worker_id: string | null;
  attempt_count: number;
  max_attempts: number;
  processed_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  attempts: ApiReminderAttempt[];
}

export interface ApiReminderListResponse {
  data: ApiReminderJob[];
  pagination: ApiPagination;
}

export interface ApiReminderTelemetryResponse {
  scheduledToday: number;
  completedToday: number;
  reconciling: number;
  failed: number;
  activeLeases: number;
  statusCounts: Record<string, number>;
}

export interface ApiGetRemindersParams {
  page?: number;
  limit?: number;
  status?: ApiReminderJobStatus;
  milestone?: ApiReminderMilestone;
  channel?: 'whatsapp' | 'sms';
  search?: string;
  date_from?: string;
  date_to?: string;
}

export interface ApiRetryReminderInput {
  reason?: string;
}

