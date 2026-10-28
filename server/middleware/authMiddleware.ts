// ============================================================================
// Authentication & Role-Based Authorization Middleware
// Verifies Bearer tokens, resolves tenant profile, and fails closed
// ============================================================================

import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest, UserRole } from '../types';
import { db } from '../db/database';
import { sendProblem } from '../utils/problemDetails';
import { logger } from '../utils/logger';

interface DecodedToken {
  sub: string;
  email?: string;
  role?: string;
  exp?: number;
  aud?: string;
  iss?: string;
}

// Minimal, secure base64url decoder
function decodeBase64Url(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// In-process cryptographic JWT verifier
export function verifyJwtToken(token: string, secret?: string): DecodedToken {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token structure');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Verify Header & Algorithm
  let header: { alg?: string; typ?: string };
  try {
    const headerJson = decodeBase64Url(headerB64);
    header = JSON.parse(headerJson);
  } catch {
    throw new Error('Malformed token header');
  }

  if (!header || typeof header !== 'object' || header.alg !== 'HS256') {
    throw new Error(`Unsupported or missing JWT algorithm: ${header?.alg || 'none'}`);
  }

  // 2. Cryptographic signature check
  if (secret) {
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signatureB64, 'utf-8');
    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new Error('Invalid token cryptographic signature');
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_JWT_SECRET is required in production for cryptographic token verification');
  }

  // 3. Decode & validate payload claims
  let payload: DecodedToken;
  try {
    const payloadJson = decodeBase64Url(payloadB64);
    payload = JSON.parse(payloadJson) as DecodedToken;
  } catch {
    throw new Error('Malformed token payload');
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Token payload missing valid sub claim');
  }

  // Expiry check
  if (payload.exp && typeof payload.exp === 'number') {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSeconds) {
      throw new Error('Token has expired');
    }
  }

  return payload;
}

// Helper to generate cryptographically signed test tokens for integration tests
export function createTestToken(
  payload: { sub: string; email?: string; role?: string; expMinutes?: number },
  secret = 'test-secret',
  alg = 'HS256'
): string {
  const header = { alg, typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + (payload.expMinutes !== undefined ? payload.expMinutes * 60 : 3600);
  const fullPayload = {
    sub: payload.sub,
    email: payload.email || 'staff@fitfusion.test',
    role: payload.role || 'authenticated',
    exp
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  if (alg === 'none') {
    return `${headerB64}.${payloadB64}.`;
  }

  const signatureB64 = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

// Authentication Middleware
export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    sendProblem(res, {
      status: 401,
      code: 'UNAUTHORIZED',
      title: 'Missing Authentication Token',
      detail: 'An Authorization header with a Bearer access token is required.',
      instance: req.originalUrl,
      requestId: req.requestId
    });
    return;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    sendProblem(res, {
      status: 401,
      code: 'UNAUTHORIZED',
      title: 'Malformed Authorization Header',
      detail: 'Authorization header format must be Bearer <token>.',
      instance: req.originalUrl,
      requestId: req.requestId
    });
    return;
  }

  const rawToken = match[1].trim();

  let decoded: DecodedToken;
  try {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    decoded = verifyJwtToken(rawToken, jwtSecret);
  } catch (err: any) {
    const isExpired = err.message?.includes('expired');
    sendProblem(res, {
      status: 401,
      code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      title: 'Authentication Failed',
      detail: isExpired ? 'The provided access token has expired.' : 'The access token is invalid or malformed.',
      instance: req.originalUrl,
      requestId: req.requestId
    });
    return;
  }

  // Resolve user profile and tenant gym association from database
  try {
    const profileRes = await db.query(
      `SELECT p.id, p.gym_id, p.full_name, p.role, g.gym_name
       FROM public.profiles p
       JOIN public.gym_settings g ON g.id = p.gym_id
       WHERE p.id = $1
       LIMIT 1;`,
      [decoded.sub]
    );

    if (profileRes.rows.length === 0) {
      logger.warn('Authenticated user lacks an associated gym staff profile', { userId: decoded.sub });
      sendProblem(res, {
        status: 403,
        code: 'FORBIDDEN',
        title: 'Access Denied',
        detail: 'The authenticated user does not have an active gym staff profile.',
        instance: req.originalUrl,
        requestId: req.requestId
      });
      return;
    }

    const row = profileRes.rows[0];
    req.user = {
      id: row.id,
      email: decoded.email,
      role: row.role as UserRole,
      gym_id: row.gym_id,
      full_name: row.full_name,
      gym_name: row.gym_name
    };

    next();
  } catch (dbErr: any) {
    logger.error('Database error during profile resolution', dbErr, { userId: decoded.sub });
    sendProblem(res, {
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      title: 'Internal Server Error',
      detail: 'An error occurred while verifying user authorization.',
      instance: req.originalUrl,
      requestId: req.requestId
    });
  }
}

// Role Authorization Middleware
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendProblem(res, {
        status: 401,
        code: 'UNAUTHORIZED',
        title: 'Authentication Required',
        detail: 'Authentication must be completed before role verification.',
        instance: req.originalUrl,
        requestId: req.requestId
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      sendProblem(res, {
        status: 403,
        code: 'FORBIDDEN',
        title: 'Insufficient Permissions',
        detail: `This operation requires one of the following roles: [${allowedRoles.join(', ')}].`,
        instance: req.originalUrl,
        requestId: req.requestId
      });
      return;
    }

    next();
  };
}
