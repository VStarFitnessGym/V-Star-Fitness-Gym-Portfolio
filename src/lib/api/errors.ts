// ============================================================================
// API Client Error Classes (Stage 4)
// Safe RFC 7807 Error Parsing without Leaking Server Internals
// ============================================================================

import { ProblemDetails } from './types';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly problem?: ProblemDetails;
  public readonly isTimeout: boolean;
  public readonly isNetworkError: boolean;
  public readonly requestId?: string;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    problem?: ProblemDetails;
    isTimeout?: boolean;
    isNetworkError?: boolean;
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.status = params.status;
    this.code = params.code || 'UNKNOWN_ERROR';
    this.problem = params.problem;
    this.isTimeout = !!params.isTimeout;
    this.isNetworkError = !!params.isNetworkError;
    this.requestId = params.requestId || params.problem?.requestId;

    // Restore prototype chain in transpiled environments
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }

  /**
   * User-friendly message suitable for presentation in UI toast or alert banner
   */
  getUserMessage(): string {
    if (this.isTimeout) {
      return 'The request timed out. If you were renewing a membership, please use the retry button to verify the outcome safely.';
    }
    if (this.isNetworkError) {
      return 'Unable to reach the gym backend server. Please check your network connection.';
    }
    if (this.status === 401) {
      return 'Your session is not authenticated or has expired. Please log in with staff credentials.';
    }
    if (this.status === 403) {
      return 'Access denied. Your account does not have permission for this operation or gym workspace.';
    }
    if (this.status === 404) {
      return this.problem?.detail || 'The requested resource was not found.';
    }
    if (this.status === 409) {
      return this.problem?.detail || 'A conflicting record or duplicate renewal already exists.';
    }
    if (this.status === 400 && this.problem?.invalidParams && this.problem.invalidParams.length > 0) {
      const fieldErrors = this.problem.invalidParams.map((p) => `${p.field}: ${p.message}`).join(', ');
      return `Validation failed: ${fieldErrors}`;
    }
    if (this.problem?.detail) {
      return this.problem.detail;
    }
    return 'An unexpected error occurred while processing the request.';
  }
}
