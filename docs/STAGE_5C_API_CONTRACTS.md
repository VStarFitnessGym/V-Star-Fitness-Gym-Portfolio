# Stage 5C: REST API Contracts & Endpoint Specifications

**System:** FITFUSION Gym Membership Management System  
**Workspace:** `D:\PROJECT\GYM MANGEMENT SYSTEM`  
**Date:** 2026-10-21  
**Author:** Principal Software Architect & API Designer  

---

## 1. Overview & Error Standard

All Stage 5C endpoints return standard JSON responses on success (`200 OK`) and conform to **RFC 7807 (Problem Details for HTTP APIs)** on errors with `Content-Type: application/problem+json`.

### RFC 7807 Standard Error Schema
```json
{
  "type": "https://fitfusion.local/errors/{code_in_lowercase}",
  "title": "Short Human-Readable Error Summary",
  "status": 400,
  "detail": "Specific explanation of the failure without exposing server internals.",
  "instance": "/api/reminders?limit=101",
  "code": "ERROR_CODE_UPPERCASE",
  "invalid_params": [
    {
      "field": "limit",
      "message": "limit must be between 1 and 100"
    }
  ],
  "request_id": "req_f5c30419d72c4df4",
  "timestamp": "2026-10-21T05:20:42.863Z"
}
```

---

## 2. Endpoint Specifications

### A. Machine-to-Machine Cron Pipeline

`POST /api/cron/reminders`

Executes the automated reminder workflow across all gym tenants:
1. Idempotent milestone schedule generation (`scheduleRemindersForGym`).
2. Bounded queue claiming and worker dispatch (`processWorkerBatch`).
3. Expired lease reset and ambiguous outcome sweep (`sweepExpiredLeases`).

- **Authentication:** Dedicated Machine Authentication via `CRON_SECRET`.
  - Canonical Header Contract: `Authorization: Bearer <CRON_SECRET>` (RFC 6750 standard). Custom headers are strictly rejected.
  - Constant-time SHA-256 digest comparison prevents timing attacks and buffer length leaks.
- **Query Parameters (Optional):**
  - `batch_size`: integer between 1 and 50 (default: 25).
- **Concurrency Protection:** PostgreSQL cluster-wide advisory lock (`pg_try_advisory_lock(hashtext('fitfusion_cron_reminders'))`) held across the entire pipeline and released in `finally` via `pg_advisory_unlock`.
- **Success Response (`200 OK`):**
  ```json
  {
    "status": "success",
    "timestamp": "2026-10-21T05:21:30.433Z",
    "scheduler": {
      "gymsProcessed": 2,
      "jobsCreated": 9,
      "jobsSkipped": 0
    },
    "worker": {
      "workerId": "cron_worker_1729488090_ab12cd34",
      "claimedCount": 9,
      "processedCount": 9,
      "successCount": 9,
      "retryableFailCount": 0,
      "permanentFailCount": 0,
      "ambiguousCount": 0,
      "cancelledCount": 0
    },
    "reconciliation": {
      "orphanedLeasesReset": 0,
      "ambiguousJobsFlagged": 0
    }
  }
  ```
- **Concurrency Skip Response (`200 OK`):**
  ```json
  {
    "status": "skipped",
    "message": "Concurrent cron execution in progress. Operation skipped.",
    "timestamp": "2026-10-21T05:21:30.480Z"
  }
  ```
- **Error Responses:**
  - `401 UNAUTHORIZED_CRON`: Missing, empty, or mismatched secret token.

---

### B. Tenant-Scoped Reminder Queue Listing

`GET /api/reminders`

Returns a paginated list of notification jobs strictly scoped to the authenticated user's gym tenant, complete with attempt history.

- **Authentication:** Staff JWT (`Authorization: Bearer <JWT>`).
- **Authorization:** Roles: `owner`, `admin`, `staff`.
- **Query Parameters (Zod Validated):**
  - `page`: integer $\ge 1$ (default: 1).
  - `limit`: integer between 1 and 100 (default: 25).
  - `status`: enum (`pending`, `claimed`, `dispatching`, `reconciling`, `completed`, `failed`, `skipped`, `cancelled`).
  - `milestone`: enum (`EXPIRY_MINUS_3`, `EXPIRY_ZERO`, `EXPIRY_PLUS_3`, `MANUAL_TRIGGER`).
  - `channel`: enum (`whatsapp`, `sms`).
  - `search`: string (max 100 chars, searches member name or phone number).
  - `date_from`: ISO date `YYYY-MM-DD`.
  - `date_to`: ISO date `YYYY-MM-DD`.
- **Sorting:** Deterministic stable sorting `ORDER BY j.scheduled_for DESC, j.id DESC`.
- **Privacy Enforcement:** Member phone numbers masked (`+9198****3210`).
- **Success Response (`200 OK`):**
  ```json
  {
    "data": [
      {
        "id": "f213925f-cf29-45a6-a86a-673d5eb62415",
        "gym_id": "11111111-1111-1111-1111-111111111111",
        "member_id": "55555555-5555-5555-5555-555555555551",
        "member_name": "Rajesh Kumar",
        "member_phone": "+9198****3210",
        "subscription_id": "sub_101",
        "plan_name": "Annual VIP",
        "subscription_start_date": "2026-01-01",
        "subscription_end_date": "2026-10-25",
        "milestone": "EXPIRY_MINUS_3",
        "target_date": "2026-10-22",
        "channel": "whatsapp",
        "status": "completed",
        "idempotency_key": "rem:sub_101:EXPIRY_MINUS_3:2026-10-22",
        "scheduled_for": "2026-10-22T04:30:00.000Z",
        "claimed_at": "2026-10-22T04:30:05.000Z",
        "lease_expires_at": null,
        "worker_id": null,
        "attempt_count": 1,
        "max_attempts": 3,
        "processed_at": "2026-10-22T04:30:10.000Z",
        "cancellation_reason": null,
        "created_at": "2026-10-21T05:21:30.000Z",
        "updated_at": "2026-10-22T04:30:10.000Z",
        "attempts": [
          {
            "id": "att_001",
            "channel": "whatsapp",
            "provider": "meta_whatsapp",
            "provider_message_id": "wamid.HBgL...",
            "status": "delivered",
            "error_code": null,
            "error_message": null,
            "sent_at": "2026-10-22T04:30:06.000Z",
            "delivered_at": "2026-10-22T04:30:10.000Z",
            "created_at": "2026-10-22T04:30:06.000Z"
          }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 1,
      "total_pages": 1
    }
  }
  ```
- **Error Responses:**
  - `400 VALIDATION_ERROR`: `limit > 100`, negative page, or invalid date format.
  - `401 UNAUTHORIZED`: Missing or invalid Bearer JWT.
  - `403 FORBIDDEN`: Insufficient role permissions or missing gym profile.

---

### C. Live Queue Telemetry Counters

`GET /api/reminders/telemetry`

Returns aggregated real database counters strictly scoped to the user's gym tenant.

- **Authentication:** Staff JWT (`Authorization: Bearer <JWT>`).
- **Authorization:** Roles: `owner`, `admin`, `staff`.
- **Success Response (`200 OK`):**
  ```json
  {
    "scheduledToday": 9,
    "completedToday": 8,
    "reconciling": 0,
    "failed": 1,
    "activeLeases": 0,
    "statusCounts": {
      "pending": 0,
      "claimed": 0,
      "dispatching": 0,
      "reconciling": 0,
      "completed": 8,
      "failed": 1,
      "cancelled": 0,
      "skipped": 0
    }
  }
  ```
- **Error Responses:**
  - `401 UNAUTHORIZED`: Missing or invalid Bearer JWT.
  - `403 FORBIDDEN`: Missing staff gym profile.

---

### D. Safe Manual Staff Retry

`POST /api/reminders/:jobId/retry`

Atomically re-queues an eligible failed reminder job for processing. Strictly enforces state machine monotonicity and tenant ownership.

- **Authentication:** Staff JWT (`Authorization: Bearer <JWT>`).
- **Authorization:** Roles: `owner`, `admin`, `staff`.
- **Path Parameter:**
  - `jobId`: UUID string.
- **Request Body (Optional):**
  ```json
  {
    "reason": "Member verified updated phone number with front desk"
  }
  ```
- **Eligibility Invariants:**
  1. Job must belong to caller's gym (`job.gym_id === req.user.gym_id`).
  2. Job must currently be in `failed` status (`status === 'failed'`).
  3. Subscription must still be `active` and not superseded by renewal.
  4. Member must have active notification consent.
- **State Transition:**
  - `status` $\rightarrow$ `pending`.
  - `max_attempts` $\rightarrow$ `attempt_count + 1`.
  - `scheduled_for` $\rightarrow$ `NOW()`.
  - `cancellation_reason` $\rightarrow$ `null`.
- **Audit Logging:** Inserts durable record into `public.audit_logs`.
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Notification job successfully re-queued for processing.",
    "job": {
      "id": "f213925f-cf29-45a6-a86a-673d5eb62415",
      "status": "pending",
      "attempt_count": 3,
      "max_attempts": 4,
      "scheduled_for": "2026-10-21T05:21:30.652Z"
    }
  }
  ```
- **Error Responses:**
  - `400 INVALID_IDENTIFIER`: Malformed non-UUID `jobId`.
  - `401 UNAUTHORIZED`: Missing or invalid Bearer JWT.
  - `404 JOB_NOT_FOUND`: Job does not exist or belongs to another gym.
  - `409 INVALID_JOB_STATE`: Job is not in `failed` status (e.g. `completed`, `reconciling`, `cancelled`).
  - `422 INELIGIBLE_FOR_RETRY`: Subscription is inactive, superseded, or member consent was revoked.
