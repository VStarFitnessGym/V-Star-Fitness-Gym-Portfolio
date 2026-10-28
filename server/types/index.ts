// ============================================================================
// Server Types & RFC 7807 Problem Details Interfaces
// ============================================================================

import { Request } from 'express';

export type UserRole = 'owner' | 'admin' | 'staff';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: UserRole;
  gym_id: string;
  full_name: string;
  gym_name?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  requestId?: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  invalid_params?: Array<{
    field: string;
    message: string;
  }>;
  request_id?: string;
  timestamp: string;
}

export interface MemberListItem {
  id: string;
  gym_id: string;
  member_code: string;
  full_name: string;
  phone: string;
  email?: string | null;
  status: 'active' | 'expiring' | 'expired' | 'archived';
  whatsapp_consent: boolean;
  sms_consent: boolean;
  created_at: string;
  current_subscription?: {
    id: string;
    plan_name: string;
    start_date: string;
    end_date: string;
    status: string;
  } | null;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

export interface RenewalResponse {
  subscription_id: string;
  member_id: string;
  plan_id: string;
  start_date: string;
  end_date: string;
  amount_paid: number;
  status: string;
  idempotency_key: string;
  renewed_from_subscription_id?: string | null;
  idempotent_replay?: boolean;
}
