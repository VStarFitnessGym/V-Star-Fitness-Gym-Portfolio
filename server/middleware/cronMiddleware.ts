// ============================================================================
// Cron Machine-to-Machine Authentication Middleware (Stage 5C)
// Validates CRON_SECRET independently of interactive staff JWT authentication
// Enforces constant-time comparison on SHA-256 digests to eliminate timing attacks and RangeError
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { sendProblem } from '../utils/problemDetails';
import { logger } from '../utils/logger';

/**
 * Validates that an incoming request possesses a valid CRON_SECRET token.
 * Authenticates machine-to-machine schedulers without relying on user JWT profiles.
 */
export function authenticateCronSecret(req: Request, res: Response, next: NextFunction): void {
  const configuredSecret = process.env.CRON_SECRET;
  const requestId = (req as any).requestId;

  // Fail-closed guard: Reject if server has no configured secret or if it is empty whitespace
  if (!configuredSecret || typeof configuredSecret !== 'string' || configuredSecret.trim().length === 0) {
    logger.error('CRITICAL: Cron endpoint called but CRON_SECRET is not configured on server');
    sendProblem(res, {
      status: 401,
      code: 'UNAUTHORIZED_CRON',
      title: 'Unauthorized',
      detail: 'Invalid or missing cron execution credentials.',
      instance: req.originalUrl,
      requestId
    });
    return;
  }

  // Canonical Header Contract: Authorization: Bearer <CRON_SECRET>
  // Strictly enforce single header standard (RFC 6750); custom headers rejected
  const authHeader = req.headers.authorization;
  let incomingToken: string | undefined;

  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      incomingToken = match[1].trim();
    }
  }

  // Reject missing credentials
  if (!incomingToken || incomingToken.length === 0) {
    logger.warn('Cron request rejected: missing authorization token', { ip: req.ip });
    sendProblem(res, {
      status: 401,
      code: 'UNAUTHORIZED_CRON',
      title: 'Unauthorized',
      detail: 'Invalid or missing cron execution credentials.',
      instance: req.originalUrl,
      requestId
    });
    return;
  }

  // Cryptographic Constant-Time Comparison via SHA-256 Digests
  // Eliminates Node timingSafeEqual RangeError when buffer lengths differ
  const expectedHash = crypto.createHash('sha256').update(configuredSecret.trim(), 'utf8').digest();
  const incomingHash = crypto.createHash('sha256').update(incomingToken, 'utf8').digest();

  const isMatch = crypto.timingSafeEqual(expectedHash, incomingHash);

  if (!isMatch) {
    logger.warn('Cron request rejected: token mismatch', { ip: req.ip });
    sendProblem(res, {
      status: 401,
      code: 'UNAUTHORIZED_CRON',
      title: 'Unauthorized',
      detail: 'Invalid or missing cron execution credentials.',
      instance: req.originalUrl,
      requestId
    });
    return;
  }

  // Authentication succeeded; proceed to pipeline
  next();
}
