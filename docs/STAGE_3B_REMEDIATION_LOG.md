# Stage 3B Remediation Log

## Gym Membership Management and Automated Notification System

**Document Version:** 1.0.0  
**Status:** All Confirmed Defects Remediated & Verified  
**Auditor:** Independent Security & Systems Reviewer  
**Date:** October 20, 2026  

---

### 1. Summary of Confirmed Defects & Fixes

During the Stage 3B independent audit, three code-level defects and two architectural roadmap observations were identified and addressed.

| Issue ID | Severity | File | Description | Action Taken | Verification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Critical | `server/db/database.ts` | Production persistence was not isolated; in-memory PGlite would execute in production. | Implemented `ProductionUnconfiguredClient` and fail-closed guard throwing `[CRITICAL_SECURITY_DEFECT]` in production. | Tests 17A & 17B (PASSED) |
| **SEC-02** | High | `server/middleware/authMiddleware.ts` | JWT algorithm was unverified and secret signature check was optional (`if (secret)`). | Enforced `HS256` header algorithm check, timingSafeEqual comparison, and required secret in production. | Tests 4D & 4E (PASSED) |
| **SEC-03** | Medium | `server/app.ts` | `cors({ origin: true, credentials: true })` dynamically reflected untrusted origins. | Hardened CORS policy to check against `ALLOWED_ORIGINS` whitelist. | Verified in app.ts |
| **ARCH-01**| Medium | `20261020000002_functions_and_triggers.sql` | In-place subscription end_date update does not cancel stale jobs for `subscription_id = NEW.id`. | Documented contract: Stage 5 worker must verify `job.target_date == sub.end_date` before dispatch. | Documented in Stage 3B Audit Report |
| **ARCH-02**| Low | `server/middleware/authMiddleware.ts` | Supabase asymmetric JWKS roadmap. | Documented architecture requirements for transition from symmetric HS256 to asymmetric JWKS. | Documented in Stage 3B Audit Report |

---

### 2. Remediation Details

#### Fix 1: Database Production Persistence Guard (`server/db/database.ts`)
- **Diff Summary:**
  ```diff
  + export class ProductionUnconfiguredClient implements IDatabaseClient {
  +   async isReady(): Promise<boolean> { return false; }
  +   async query() {
  +     throw new Error('[CRITICAL_CONFIG_ERROR] Production persistence not configured: DATABASE_URL is missing.');
  +   }
  +   ...
  + }
  
  + if ((process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') && !process.env.ALLOW_IN_MEMORY_PGLITE_IN_PROD) {
  +   throw new Error('[CRITICAL_SECURITY_DEFECT] Production environment detected. Ephemeral in-memory PGlite cannot be used for production persistence.');
  + }
  ```
- **Rationale:** Ensures that no deployment or production container can silently instantiate an ephemeral in-memory database that discards membership data on cold start or restart.

#### Fix 2: Cryptographic JWT Verification Hardening (`server/middleware/authMiddleware.ts`)
- **Diff Summary:**
  ```diff
  + let header: { alg?: string; typ?: string };
  + const headerJson = decodeBase64Url(headerB64);
  + header = JSON.parse(headerJson);
  + if (!header || typeof header !== 'object' || header.alg !== 'HS256') {
  +   throw new Error(`Unsupported or missing JWT algorithm: ${header?.alg || 'none'}`);
  + }
  
  + if (secret) {
  +   const sigBuf = Buffer.from(signatureB64, 'utf-8');
  +   const expectedBuf = Buffer.from(expectedSig, 'utf-8');
  +   if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
  +     throw new Error('Invalid token cryptographic signature');
  +   }
  + } else if (process.env.NODE_ENV === 'production') {
  +   throw new Error('SUPABASE_JWT_SECRET is required in production for cryptographic token verification');
  + }
  ```
- **Rationale:** Prohibits `alg: "none"` bypass attacks, enforces constant-time signature comparison, and prevents running in production without cryptographic token verification.

#### Fix 3: CORS Origin Policy Hardening (`server/app.ts`)
- **Diff Summary:**
  ```diff
  - app.use(cors({ origin: true, credentials: true }));
  + const allowedOrigins = process.env.ALLOWED_ORIGINS
  +   ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  +   : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];
  + app.use(cors({
  +   origin: (origin, callback) => {
  +     if (!origin) return callback(null, true);
  +     if (process.env.NODE_ENV !== 'production' || allowedOrigins.includes(origin)) {
  +       return callback(null, true);
  +     }
  +     return callback(new Error('CORS request blocked by origin security policy'));
  +   },
  +   credentials: true
  + }));
  ```
- **Rationale:** Eliminates dynamic reflection of arbitrary requesting origins with credentials enabled.
