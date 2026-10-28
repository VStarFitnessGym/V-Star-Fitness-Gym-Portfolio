# API Design & Interface Specification

## Gym Membership Management and Automated Notification System

**Document Version:** 1.0.0  
**Status:** Approved for Technical Architecture  
**Protocol:** HTTPS / RESTful JSON  
**Base URL:** `/api`  
**Authentication:** Supabase JWT Bearer (`Authorization: Bearer <token>`) & Internal Secret (`Bearer <CRON_SECRET>`)  
**Error Standard:** RFC 7807 Problem Details compatible JSON

---

### 1. Global Standards & Error Handling Conventions

All endpoints adhere to consistent formatting, HTTP status codes, and deterministic error responses.

#### Standard Error Response Structure
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The provided member input failed validation rules.",
    "details": [
      {
        "field": "phone",
        "message": "Phone number must be a valid Indian mobile number (+91 followed by 10 digits starting with 6-9)."
      }
    ],
    "timestamp": "2026-10-20T10:00:00.000Z",
    "request_id": "req_01HP89X..."
  }
}
```

#### Standard Error Codes
| HTTP Status | Error Code | Description |
| :--- | :--- | :--- |
| `400` | `BAD_REQUEST` / `VALIDATION_ERROR` | Malformed JSON or input failing Zod validation. |
| `401` | `UNAUTHORIZED` | Missing, expired, or cryptographically invalid JWT. |
| `403` | `FORBIDDEN` | Valid token, but insufficient permissions or mismatched `gym_id`. |
| `404` | `NOT_FOUND` | Target entity does not exist in the tenant's workspace. |
| `409` | `CONFLICT` | Unique constraint violation (e.g., duplicate phone number or member code). |
| `429` | `RATE_LIMITED` | Request threshold exceeded for manual reminder or export triggers. |
| `500` | `INTERNAL_SERVER_ERROR` | Unhandled runtime exception (stack trace redacted in production). |

---

### 2. Member Management Endpoints

#### `GET /api/members`
Retrieves a paginated, filterable list of gym members.
- **Auth:** Required (Staff / Admin JWT)
- **Query Parameters:**
  - `page` (integer, default: `1`)
  - `limit` (integer, default: `20`, max: `100`)
  - `status` (`active` | `expiring` | `expired` | `archived`)
  - `search` (string, searches name, phone, member_code)
  - `sort_by` (`full_name` | `end_date` | `created_at`, default: `created_at`)
  - `sort_order` (`asc` | `desc`, default: `desc`)
- **Response (200 OK):**
```json
{
  "data": [
    {
      "id": "7b39a3f2-...",
      "member_code": "GYM-0104",
      "full_name": "Rajesh Kumar",
      "phone": "+919876543210",
      "email": "rajesh@example.com",
      "status": "active",
      "whatsapp_consent": true,
      "sms_consent": true,
      "current_subscription": {
        "id": "sub_99a...",
        "plan_name": "Annual Gold",
        "start_date": "2025-10-24",
        "end_date": "2026-10-23",
        "days_remaining": 3
      }
    }
  ],
  "pagination": {
    "total": 104,
    "page": 1,
    "limit": 20,
    "total_pages": 6
  }
}
```

#### `POST /api/members`
Creates a new gym member and optional initial subscription.
- **Auth:** Required (Staff / Admin JWT)
- **Zod Validation Schema:**
```typescript
import { z } from 'zod';

export const CreateMemberSchema = z.object({
  member_code: z.string().min(2).max(30),
  full_name: z.string().min(2).max(100),
  phone: z.string().regex(/^\+91[6-9]\d{9}$/, 'Must be valid Indian mobile (+91XXXXXXXXXX)'),
  email: z.string().email().optional().nullable(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  emergency_contact_name: z.string().optional().nullable(),
  emergency_contact_phone: z.string().regex(/^\+91[6-9]\d{9}$/).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  whatsapp_consent: z.boolean().default(true),
  sms_consent: z.boolean().default(true),
  initial_subscription: z.object({
    plan_id: z.string().uuid(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount_paid: z.number().nonnegative(),
    payment_method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'other'])
  }).optional()
});
```
- **Response (201 Created):** Full created member record.

#### `PATCH /api/members/:id`
Updates member personal details or communication preferences.
- **Auth:** Required (Staff / Admin JWT)
- **Response (200 OK):** Updated member record.

#### `DELETE /api/members/:id`
Soft-archives a member (`status = 'archived'`). Preserves historical subscriptions.
- **Auth:** Required (Admin JWT only)
- **Response (200 OK):** `{ "success": true, "message": "Member archived successfully" }`

---

### 3. Membership & Renewal Endpoints

#### `POST /api/subscriptions/renew`
Renews a member's subscription with non-destructive history preservation and automatic reminder queue invalidation.
- **Auth:** Required (Staff / Admin JWT)
- **Zod Validation Schema:**
```typescript
export const RenewSubscriptionSchema = z.object({
  member_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount_paid: z.number().nonnegative(),
  payment_method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'other']),
  idempotency_key: z.string().uuid({ message: 'A client-generated UUID idempotency key is required to prevent duplicate renewals.' }),
  expected_version: z.number().int().positive().optional(),
  notes: z.string().optional()
});
```
- **Transactional & Concurrency Behavior:**
  1. Opens PostgreSQL transaction with `ISOLATION LEVEL READ COMMITTED`.
  2. **Idempotency Verification:** Checks `SELECT * FROM subscriptions WHERE gym_id = :gym_id AND idempotency_key = :key`. If an identical request was already committed (e.g. from network retry), returns the existing subscription record immediately (HTTP 200).
  3. **Row-Level Mutual Exclusion:** Issues `SELECT id, status FROM members WHERE id = :member_id AND gym_id = :gym_id FOR UPDATE;` to serialize concurrent renewals for the same member.
  4. **Contiguous Coverage Calculation:**
     - Queries latest active subscription: `SELECT id, end_date FROM subscriptions WHERE member_id = :member_id AND status = 'active' ORDER BY end_date DESC LIMIT 1`.
     - If active subscription exists and not expired: defaults `start_date = active.end_date + 1 day`.
     - Calculates `end_date = start_date + plan.duration_days - 1 day`.
  5. **Insert with Exclusion Constraint Enforcement:** Inserts new row into `subscriptions` referencing `renewed_from_subscription_id`, `idempotency_key`, and authenticated staff `created_by`.
     - If concurrent transactions violate date range boundaries, PostgreSQL raises `23P01 (exclusion_violation)` via `no_overlapping_active_subscriptions`. Transaction rolls back cleanly and API responds with HTTP 409 Conflict.
  6. Database trigger (`public.cancel_stale_notification_jobs_on_renewal`) automatically cancels any `pending` notification jobs for older subscriptions.
- **Response (201 Created):**
```json
{
  "subscription_id": "sub_883...",
  "member_id": "7b39a3f2-...",
  "start_date": "2026-10-24",
  "end_date": "2027-10-23",
  "amount_paid": 12000.00,
  "idempotency_key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "cancelled_stale_jobs_count": 2
}
```

---

### 4. Admin Dashboard Telemetry Endpoint

#### `GET /api/dashboard/stats`
Computes real-time dashboard KPIs and notification health telemetry.
- **Auth:** Required (Staff / Admin JWT)
- **Response (200 OK):**
```json
{
  "members": {
    "total": 104,
    "active": 91,
    "expiring_soon": 7,
    "expired": 6
  },
  "today_notifications": {
    "scheduled": 5,
    "claimed": 0,
    "completed": 4,
    "unknown_in_flight": 1,
    "failed": 0
  },
  "integrations": {
    "whatsapp_connected": true,
    "sms_connected": true
  },
  "operational_alerts": [
    {
      "severity": "info",
      "message": "3 memberships expiring in the next 24 hours."
    }
  ]
}
```

---

### 5. Reminder Previews & Manual Dispatches

#### `GET /api/reminders/preview/:memberId`
Renders the exact template text and placeholders as the recipient will view it.
- **Auth:** Required (Staff / Admin JWT)
- **Response (200 OK):**
```json
{
  "member_id": "7b39a3f2-...",
  "phone": "+919876543210",
  "channel": "whatsapp",
  "template_name": "membership_expiry_reminder",
  "rendered_text": "Hi Rajesh Kumar, your Iron Fitness membership (Annual Gold) expires in 3 days on 23-Oct-2026. Please visit the front desk or reply here to renew your plan.",
  "parameters": {
    "member_name": "Rajesh Kumar",
    "gym_name": "Iron Fitness",
    "plan_name": "Annual Gold",
    "expiry_date": "23-Oct-2026"
  }
}
```

#### `POST /api/reminders/retry/:jobId`
Manually triggers an authorized re-dispatch of a failed notification job.
- **Auth:** Required (Admin JWT only)
- **Rate Limit:** Maximum 1 manual retry per job per 60 minutes.
- **Response (200 OK):** `{ "success": true, "attempt_id": "att_441..." }`

---

### 6. Cron Scheduled-Job Endpoint

#### `POST /api/cron/reminders`
Executed daily (10:00 AM IST) by the scheduler. Evaluates expiring subscriptions, generates idempotent jobs, and claims queue batches for dispatch.
- **Auth:** Internal Secret Token header: `Authorization: Bearer <CRON_SECRET>`
- **Security Check:** Constant-time cryptographic string comparison preventing timing attacks.
```typescript
import crypto from 'crypto';

export function verifyCronSecret(reqHeader: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !reqHeader) return false;
  const token = reqHeader.replace(/^Bearer\s+/i, '');
  if (token.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}
```
- **Execution Pipeline:**
  1. Scans active subscriptions matching T-3, T-0, and T+3 milestones relative to the gym's local business date (`Asia/Kolkata`).
  2. Inserts pending jobs using `idempotency_key = sha256(subscription_id + milestone + target_date)` with `ON CONFLICT DO NOTHING`.
  3. **Queue Batch Claiming (`claim_notification_jobs` RPC):** Calls PostgreSQL function claiming up to 25 eligible jobs. CRITICAL GUARD: Skips jobs where dispatch intent (`dispatching`) was already recorded by a prior worker.
  4. **Phase 1: Pre-Dispatch Verification:** Re-verifies that the member has not renewed or revoked consent since the job was claimed. If renewed, marks job `cancelled` and skips dispatch.
  5. **Phase 2: Durable Dispatch Intent:** Inserts `notification_attempts` with `status = 'dispatching'` and updates job `status = 'dispatching'` BEFORE opening any network connection.
  6. **Phase 3: External Dispatch & Outcome Classification:**
     - On Meta HTTP 200 OK: Records attempt `sent` with `wamid`, marks job `completed`.
     - On Network Timeout / ECONNABORTED: Records attempt `unknown`, transitions job to `reconciling`. **STRICTLY PROHIBITS SMS fallback and duplicate resends!**
     - On Permanent Error (e.g. Code 131026 Not on WhatsApp): Updates attempt to `failed_permanent`. Evaluates SMS fallback if `sms_consent == true`.
  7. **Reconciliation Sweeper:** Any jobs in `reconciling` for > 24 hours with zero matching webhook receipt are finalized as `completed_unconfirmed` with an admin audit alert (never resent).
- **Response (200 OK):**
```json
{
  "success": true,
  "jobs_generated": 4,
  "jobs_claimed": 4,
  "jobs_completed": 3,
  "jobs_reconciling": 1,
  "jobs_failed_terminal": 0,
  "sms_fallback_dispatched": 0,
  "execution_duration_ms": 1420
}
```

---

### 7. Meta WhatsApp Webhook Verification & Ingestion

#### `GET /api/webhooks/whatsapp`
Handles Meta Webhook Hub verification handshake when registering the webhook URL in the Meta App Dashboard.
- **Auth:** Public (Verification Handshake)
- **Query Parameters:**
  - `hub.mode` (must be `subscribe`)
  - `hub.verify_token` (must match server `META_VERIFY_TOKEN`)
  - `hub.challenge` (integer string sent by Meta)
- **Logic:**
```typescript
if (req.query['hub.mode'] === 'subscribe' && 
    req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
  return res.status(200).send(req.query['hub.challenge']);
}
return res.status(403).json({ error: 'Verification token mismatch' });
```

#### `POST /api/webhooks/whatsapp`
Receives asynchronous delivery receipts (`sent`, `delivered`, `read`, `failed`) and incoming messages from Meta.
- **Auth:** Payload Signature Verification (`X-Hub-Signature-256`)
- **Security Verification:**
```typescript
import crypto from 'crypto';

export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !signatureHeader) return false;
  
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
    
  if (signatureHeader.length !== expectedSignature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSignature));
}
```
- **Payload Handling & Monotonic State Transitions:**
  1. Logs raw payload into `webhook_events` with `event_id = entry.id + status.id` (idempotent deduplication via unique constraint).
  2. Extracts provider message ID (`wamid`) and resolves matching `notification_attempts` record.
  3. **Monotonic Status Progression:**
     - Prevents out-of-order webhook delivery from overwriting a higher state (State hierarchy: `read` > `delivered` > `sent` > `initiated`).
     - If status is `delivered`: Sets `delivered_at = NOW()` and marks parent job `completed`.
     - If status is `failed`: Evaluates permanent delivery error code (e.g. carrier undeliverable). If member has active `sms_consent = true`, schedules fallback SMS dispatch.
- **Response:** Must return HTTP `200 OK` within 3 seconds to avoid Meta retrying the webhook.

---

### 8. Import & Export Endpoints

#### `POST /api/members/import`
Accepts parsed member rows for bulk validation and transactional commit.
- **Auth:** Required (Admin JWT only)
- **Body:** `{ "dry_run": boolean, "members": [...] }`
- **Behavior:**
  - If `dry_run = true`: Returns validation report without committing.
  - If `dry_run = false`: Executes atomic batch insert inside a PostgreSQL transaction.
- **Response (200 OK):**
```json
{
  "dry_run": false,
  "total_records": 50,
  "imported_count": 48,
  "skipped_duplicates": 2,
  "errors": []
}
```

#### `GET /api/members/export`
Generates a sanitized CSV stream of the member directory.
- **Auth:** Required (Admin JWT only)
- **Security Sanitization:** Every text column cell beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` is prepended with a single quote (`'`) to neutralize CSV formula injection attacks before streaming.
- **Response Headers:**
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="gym_members_20261020.csv"`
