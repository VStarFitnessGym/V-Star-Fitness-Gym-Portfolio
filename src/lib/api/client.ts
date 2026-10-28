// ============================================================================
// Typed Frontend API Client (Stage 4)
// Communicates with Stage 3 Express / Vercel Serverless API
// ============================================================================

import {
  ApiHealthResponse,
  ApiUserMeResponse,
  ApiMemberListResponse,
  ApiGetMembersParams,
  ApiRenewSubscriptionInput,
  ApiRenewalResponse,
  ApiReminderListResponse,
  ApiGetRemindersParams,
  ApiReminderTelemetryResponse,
  ApiRetryReminderInput,
  ApiReminderJob,
  ProblemDetails
} from './types';
import { ApiClientError } from './errors';

export interface ApiClientConfig {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  getToken?: () => string | null;
}

export class FitFusionApiClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private tokenProvider: () => string | null;

  constructor(config: ApiClientConfig = {}) {
    // Single configurable base URL defaulting to /api, compatible with Vite and Node/test environments
    const envBaseUrl =
      typeof import.meta !== 'undefined' && (import.meta as any).env
        ? (import.meta as any).env.VITE_API_BASE_URL
        : typeof process !== 'undefined'
        ? process.env.VITE_API_BASE_URL
        : undefined;

    this.baseUrl = config.baseUrl || envBaseUrl || '/api';
    this.defaultTimeoutMs = config.defaultTimeoutMs || 10000;
    // In-memory token provider: Never store Bearer tokens in localStorage/sessionStorage
    this.tokenProvider = config.getToken || (() => null);
  }

  /**
   * Configure the in-memory token getter
   */
  setTokenProvider(provider: () => string | null): void {
    this.tokenProvider = provider;
  }

  /**
   * Shared fetch wrapper with abort timeout and safe RFC 7807 error parsing
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs: number = this.defaultTimeoutMs
  ): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = new Headers(options.headers || {});
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json, application/problem+json');
    }

    // Attach in-memory Bearer token if available
    const token = this.tokenProvider();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timer);

      // Handle successful responses (2xx)
      if (response.ok) {
        if (response.status === 204) {
          return undefined as unknown as T;
        }
        return (await response.json()) as T;
      }

      // Handle HTTP Error Responses
      let problem: ProblemDetails | undefined;
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('json') || contentType.includes('problem')) {
        try {
          problem = (await response.json()) as ProblemDetails;
        } catch {
          // JSON parse failed on error body
        }
      }

      throw new ApiClientError({
        message: problem?.detail || `HTTP error ${response.status}: ${response.statusText}`,
        status: response.status,
        code: problem?.code || `HTTP_${response.status}`,
        problem,
        requestId: problem?.requestId || response.headers.get('X-Request-Id') || undefined
      });
    } catch (err: any) {
      clearTimeout(timer);

      // Re-throw ApiClientError directly
      if (err instanceof ApiClientError) {
        throw err;
      }

      // Check for fetch abort / timeout
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        throw new ApiClientError({
          message: `The request timed out after ${timeoutMs}ms.`,
          status: 408,
          code: 'REQUEST_TIMEOUT',
          isTimeout: true
        });
      }

      // General network failures (DNS, connection refused, offline)
      throw new ApiClientError({
        message: 'Network connection failure. Please check your network and try again.',
        status: 0,
        code: 'NETWORK_ERROR',
        isNetworkError: true
      });
    }
  }

  // ==========================================================================
  // Public Endpoint Methods
  // ==========================================================================

  /**
   * GET /api/health
   * Public liveness and database readiness probe
   */
  async getHealth(): Promise<ApiHealthResponse> {
    return this.request<ApiHealthResponse>('/health');
  }

  /**
   * GET /api/me
   * Verified user identity, profile, and gym association
   */
  async getMe(): Promise<ApiUserMeResponse> {
    return this.request<ApiUserMeResponse>('/me');
  }

  /**
   * GET /api/members
   * Paginated, tenant-scoped member list
   */
  async getMembers(params: ApiGetMembersParams = {}): Promise<ApiMemberListResponse> {
    const searchParams = new URLSearchParams();
    if (params.page !== undefined) searchParams.set('page', String(params.page));
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.status) searchParams.set('status', params.status);
    if (params.search) searchParams.set('search', params.search);
    if (params.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params.sort_order) searchParams.set('sort_order', params.sort_order);

    const queryString = searchParams.toString();
    const endpoint = queryString ? `/members?${queryString}` : '/members';
    return this.request<ApiMemberListResponse>(endpoint);
  }

  /**
   * POST /api/subscriptions/renew
   * Atomic, serialized membership renewal with UUID idempotency key
   */
  async renewSubscription(input: ApiRenewSubscriptionInput): Promise<ApiRenewalResponse> {
    return this.request<ApiRenewalResponse>('/subscriptions/renew', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });
  }

  // ==========================================================================
  // Stage 5C Reminder Operations & Telemetry Methods
  // ==========================================================================

  /**
   * GET /api/reminders
   * Tenant-scoped, paginated, and filtered reminder queue
   */
  async getReminderJobs(params: ApiGetRemindersParams = {}): Promise<ApiReminderListResponse> {
    const searchParams = new URLSearchParams();
    if (params.page !== undefined) searchParams.set('page', String(params.page));
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.status) searchParams.set('status', params.status);
    if (params.milestone) searchParams.set('milestone', params.milestone);
    if (params.channel) searchParams.set('channel', params.channel);
    if (params.search) searchParams.set('search', params.search);
    if (params.date_from) searchParams.set('date_from', params.date_from);
    if (params.date_to) searchParams.set('date_to', params.date_to);

    const queryString = searchParams.toString();
    const endpoint = queryString ? `/reminders?${queryString}` : '/reminders';
    return this.request<ApiReminderListResponse>(endpoint);
  }

  /**
   * GET /api/reminders/telemetry
   * Aggregated database-backed telemetry counts for dashboard KPI cards
   */
  async getReminderTelemetry(): Promise<ApiReminderTelemetryResponse> {
    return this.request<ApiReminderTelemetryResponse>('/reminders/telemetry');
  }

  /**
   * POST /api/reminders/:jobId/retry
   * Safely retries an eligible failed reminder job with eligibility verification
   */
  async retryReminderJob(
    jobId: string,
    input: ApiRetryReminderInput = {}
  ): Promise<{ message: string; job: ApiReminderJob }> {
    return this.request<{ message: string; job: ApiReminderJob }>(`/reminders/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });
  }
}

// Default singleton instance
export const apiClient = new FitFusionApiClient();
