// ============================================================================
// Stage 5B: Provider-Neutral Messaging Interfaces & Data Contracts
// Supports WhatsApp Business Platform Cloud API, SMS Provider, and Mock Adapter
// ============================================================================

import { NotificationMilestone, NotificationChannel } from './types';

export type ProviderSubmissionOutcome =
  | 'accepted'              // Submission accepted by provider API (assigned provider_message_id)
  | 'retryable_rejection'   // Provider rejected request but safe to retry (rate limit, 503, gateway busy)
  | 'permanent_rejection'   // Provider permanently rejected request (unallocated number, blocked, bad template)
  | 'ambiguous_timeout';    // Transport socket dropped or timed out after request was dispatched

export type DeliveryEventStatus =
  | 'sent'          // Message accepted by provider gateway/upstream carrier
  | 'delivered'     // Confirmed delivered to recipient handset
  | 'read'          // Confirmed read/viewed by recipient
  | 'failed'        // Confirmed delivery failure (carrier bounce, handset unreachable)
  | 'undeliverable'; // Message expired in transit without delivery

export interface OutboundMessageRequest {
  jobId: string;
  subscriptionId: string;
  memberId: string;
  gymId: string;
  recipientPhone: string;
  channel: NotificationChannel;
  milestone: NotificationMilestone;
  template: {
    name: string;
    language: string;
    parameters: Record<string, string>;
  };
  bodyText?: string;
  metadata?: Record<string, any>;
}

export interface ProviderSubmissionResult {
  outcome: ProviderSubmissionOutcome;
  provider: string;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryAfterSeconds?: number;
  rawResponse?: any;
  isMock?: boolean;
  isPermanentDeliveryFailure?: boolean; // True ONLY if confirmed recipient delivery failure (e.g. 131030, 131026)
}

export interface DeliveryStatusEvent {
  provider: string;
  providerMessageId: string;
  status: DeliveryEventStatus;
  timestamp: string; // ISO 8601 or UNIX timestamp string
  recipientPhone?: string;
  errorCode?: string;
  errorMessage?: string;
  isPermanentDeliveryFailure?: boolean;
  rawEvent?: any;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
  events?: DeliveryStatusEvent[];
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  json<T = any>(): Promise<T>;
}

export interface IHttpClient {
  post(url: string, options: HttpRequestOptions): Promise<HttpResponse>;
}

export interface IProviderAdapter {
  readonly name: string;
  readonly channel: NotificationChannel;
  send(request: OutboundMessageRequest): Promise<ProviderSubmissionResult>;
}

/**
 * Validates and normalizes phone numbers to standard E.164 format.
 * Defaults to India (+91) country code if a valid 10-digit national number is supplied.
 */
export function normalizeE164Phone(rawPhone: string): { valid: boolean; normalized?: string; error?: string } {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { valid: false, error: 'Phone number is missing or empty' };
  }

  // Strip spaces, dashes, dots, parentheses
  let cleaned = rawPhone.replace(/[\s\-\.\(\)]/g, '');

  // Handle leading zero
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // Handle 10-digit Indian mobile numbers without country code (must begin with 6, 7, 8, or 9)
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return { valid: true, normalized: `+91${cleaned}` };
  }

  // Handle numbers with explicit + (10 to 15 digits according to ITU-T E.164)
  if (cleaned.startsWith('+')) {
    const digitsOnly = cleaned.substring(1);
    if (/^\d{10,15}$/.test(digitsOnly)) {
      return { valid: true, normalized: `+${digitsOnly}` };
    }
    return { valid: false, error: `Invalid E.164 phone: ${rawPhone}. Must have 10-15 digits after '+'.` };
  }

  // Handle Indian numbers with country code 91 without leading +
  if (/^91[6-9]\d{9}$/.test(cleaned)) {
    return { valid: true, normalized: `+${cleaned}` };
  }

  // 10-digit numbers not starting with 6-9 cannot be assumed valid Indian mobile numbers
  if (/^\d{10}$/.test(cleaned)) {
    return {
      valid: false,
      error: `Invalid 10-digit phone number: ${rawPhone}. Indian mobile numbers must start with 6, 7, 8, or 9.`
    };
  }

  // International numbers without '+' (11-15 digits with valid country code prefix)
  if (/^\d{11,15}$/.test(cleaned)) {
    return { valid: true, normalized: `+${cleaned}` };
  }

  return {
    valid: false,
    error: `Invalid phone format: ${rawPhone}. Must be 10-15 digits in E.164 format.`
  };
}

/**
 * Masks sensitive phone numbers for logging (e.g. +9198****3210)
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return '***';
  const prefix = phone.substring(0, 5);
  const suffix = phone.substring(phone.length - 4);
  return `${prefix}****${suffix}`;
}

/**
 * Masks sensitive authorization tokens for logging (e.g. Bearer EAAB... -> Bearer [REDACTED])
 */
export function maskAuthHeader(header?: string): string {
  if (!header) return '[EMPTY]';
  if (header.startsWith('Bearer ')) {
    return 'Bearer [REDACTED]';
  }
  return '[REDACTED]';
}
