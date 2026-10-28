// ============================================================================
// Global RFC 7807 Error Handling Middleware
// Formats validation errors, PostgreSQL database codes, and unhandled exceptions
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { sendProblem } from '../utils/problemDetails';
import { logger } from '../utils/logger';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as any).requestId;
  const instance = req.originalUrl;

  // 1. Zod Validation Errors
  if (err instanceof ZodError) {
    const invalidParams = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message
    }));

    sendProblem(res, {
      status: 400,
      code: 'VALIDATION_ERROR',
      title: 'Validation Error',
      detail: 'The provided request parameters failed validation rules.',
      instance,
      invalidParams,
      requestId
    });
    return;
  }

  // 2. JSON Body Parsing Errors
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400 && 'body' in err) {
    sendProblem(res, {
      status: 400,
      code: 'MALFORMED_JSON',
      title: 'Malformed Request Body',
      detail: 'The request body could not be parsed as valid JSON.',
      instance,
      requestId
    });
    return;
  }

  // 3. PostgreSQL Database Error Codes
  const pgCode = err.code || err.pgCode;
  if (pgCode) {
    // 23P01: Exclusion Constraint Violation (no_overlapping_active_subscriptions)
    if (pgCode === '23P01' || err.message?.includes('no_overlapping_active_subscriptions') || err.message?.includes('exclusion')) {
      sendProblem(res, {
        status: 409,
        code: 'SUBSCRIPTION_OVERLAP_CONFLICT',
        title: 'Subscription Period Conflict',
        detail: 'The proposed subscription dates overlap with an existing active membership for this member.',
        instance,
        requestId
      });
      return;
    }

    // 23505: Unique Constraint Violation
    if (pgCode === '23505' || err.message?.includes('unique constraint') || err.message?.includes('duplicate key')) {
      let detail = 'A record with conflicting unique parameters already exists.';
      if (err.message?.includes('uq_subscriptions_gym_idempotency')) {
        detail = 'A renewal request with this idempotency key has already been submitted with conflicting parameters.';
      } else if (err.message?.includes('uq_subscriptions_renewed_from')) {
        detail = 'This subscription has already been renewed. A subscription can only have one renewal successor.';
      } else if (err.message?.includes('uq_members_gym_phone_active')) {
        detail = 'An active member with this phone number already exists in this gym.';
      }

      sendProblem(res, {
        status: 409,
        code: 'UNIQUE_CONSTRAINT_CONFLICT',
        title: 'Resource Conflict',
        detail,
        instance,
        requestId
      });
      return;
    }

    // 23503: Foreign Key Violation
    if (pgCode === '23503') {
      sendProblem(res, {
        status: 404,
        code: 'ENTITY_NOT_FOUND',
        title: 'Referenced Entity Not Found',
        detail: 'One or more referenced entities (such as member_id or plan_id) do not exist.',
        instance,
        requestId
      });
      return;
    }

    // 42501: Permission Denied
    if (pgCode === '42501') {
      sendProblem(res, {
        status: 403,
        code: 'FORBIDDEN',
        title: 'Permission Denied',
        detail: 'Database access permission was denied for this operation.',
        instance,
        requestId
      });
      return;
    }
  }

  // 4. Custom Application Errors with Status
  if (err.statusCode || err.status) {
    const statusCode = err.statusCode || err.status;
    sendProblem(res, {
      status: statusCode,
      code: err.code || 'REQUEST_FAILED',
      title: err.title || 'Request Failed',
      detail: err.message || 'The request could not be processed.',
      instance,
      requestId
    });
    return;
  }

  // 5. Unhandled Internal Server Errors
  logger.error('Unhandled server exception', err, { instance, requestId });
  sendProblem(res, {
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    title: 'Internal Server Error',
    detail: 'An unexpected internal error occurred. Please contact system support.',
    instance,
    requestId
  });
}
