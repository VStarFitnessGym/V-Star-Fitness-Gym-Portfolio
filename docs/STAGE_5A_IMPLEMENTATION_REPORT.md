# Stage 5A Implementation Report: Database-Backed Reminder Engine

**System:** FITFUSION Gym Membership Management System  
**Stage:** Stage 5A — Database-Backed Membership Expiry Reminder Engine Foundation  
**Workspace:** `D:\PROJECT\GYM MANGEMENT SYSTEM`  
**Date:** 2026-10-20  
**Engineer:** Senior Backend Engineer, PostgreSQL Specialist, QA Lead  
**Verdict:** **CONDITIONAL PASS** (Local Engine Complete & Verified; Cloud & Live Provider Blocked by Design)

---

## 1. Executive Summary

Stage 5A delivers the complete, database-backed reminder engine foundation for membership expiry notifications. It implements deterministic scheduling across three calendar milestones (`EXPIRY_MINUS_3`, `EXPIRY_ZERO`, `EXPIRY_PLUS_3`), atomic transactional job claiming (`FOR UPDATE SKIP LOCKED`), immediate pre-dispatch eligibility re-checks, durable two-phase dispatch intent logging, exponential retry backoff, lease recovery, and ambiguous-outcome reconciliation.

In strict compliance with Stage 5A boundaries:
- **No external messaging providers** were connected; dispatches are executed through a typed, transparent `MockDeliveryAdapter` that explicitly marks results with `is_mock: true` and `provider: 'local_mock_adapter'`.
- **Zero remote Supabase calls** or external network requests were made; all database persistence and transaction isolation were validated locally using PGlite and PostgreSQL migrations.
- **Zero destructive operations** were performed on existing tables, preserving all Stage 2, 3, 4, and 4B functionality and existing test suites.

---

## 2. Actual Files Created and Modified

### A. New Database Migrations
- `supabase/migrations/20261020000004_reminder_engine_optimizations.sql`
  - Added additive compound indexes:
    - `idx_subscriptions_active_end_date`: Index on `(gym_id, status, end_date)` for fast scheduler queries.
    - `idx_jobs_sub_milestone`: Index on `(subscription_id, milestone)` for fast lookup of pending reminders during renewal/extension.
    - `idx_jobs_gym_target_date`: Index on `(gym_id, target_date, status)` for batch querying.
  - Added PostgreSQL helper function:
    - `public.safe_complete_notification_job(p_job_id UUID, p_claim_token TEXT)`: Atomic token-validated status transition to `completed`.

### B. Core Reminder Engine Services
- `server/services/reminders/types.ts`:
  - Strong TypeScript type definitions for milestones (`EXPIRY_MINUS_3`, `EXPIRY_ZERO`, `EXPIRY_PLUS_3`), job statuses (`pending`, `claimed`, `dispatching`, `completed`, `failed`, `cancelled`, `skipped`, `reconciling`), delivery adapters, worker parameters, and batch results.
- `server/services/reminders/dateMath.ts`:
  - Pure calendar-based arithmetic (`addCalendarDays`, `calculateMilestoneTargetDate`, `convertTargetDateToUtcSchedule`, `isSubscriptionActiveOnDate`, `isMilestoneStale`, `isLeapYear`). Deterministically handles leap years, month ends, year rollover, and `Asia/Kolkata` timezone conversions.
- `server/services/reminders/eligibilityService.ts`:
  - Subscription and member eligibility checks at scheduling time (`findEligibleSubscriptionsForReminders`) and immediately before dispatch (`validateJobPreDispatchEligibility`).
- `server/services/reminders/mockAdapter.ts`:
  - `MockDeliveryAdapter` implementing `IDeliveryAdapter`. Honest mock reporting (`is_mock: true`, provider `'local_mock_adapter'`), configurable behavior for testing successes, transient retries, permanent rejections, and ambiguous timeouts.
- `server/services/reminders/schedulerService.ts`:
  - Idempotent scheduler service (`scheduleMembershipReminders`). Generates deterministic keys (`rem:${sub_id}:${milestone}:${target_date}`), suppresses obsolete reminders when subscriptions renew or change end dates, and implements zero-burst missed-run suppression.
- `server/services/reminders/workerService.ts`:
  - High-concurrency worker service (`processNotificationJobsBatch`). Handles atomic job claiming with randomized lease tokens, pre-dispatch eligibility re-check, two-phase dispatch intent logging, backoff computation (`60s`, `300s`, `900s`), and terminal failure enforcement (`max_attempts = 3`).
- `server/services/reminders/reconciliationService.ts`:
  - Lease recovery and ambiguous dispatch reconciliation (`sweepExpiredLeases`, `reconcileAmbiguousJob`).
- `server/services/reminders/index.ts`:
  - Unified barrel export for the reminder engine modules.

### C. Test Suite & Infrastructure Updates
- `tests/reminder/reminder_engine_test.ts`:
  - Focused, 32-test automated verification suite covering all 30 prompt requirements across date math, scheduling idempotency, pre-dispatch validation, worker concurrency, backoff, cancellation, and reconciliation.
- `server/db/database.ts`:
  - Updated migration loader to dynamically scan and execute all migration scripts (`20261020000001_...` through `20261020000004_...`) in strict lexical order.
- `tests/db/test_pglite_suite.mjs`:
  - Updated DB migration test suite to verify all 4 migrations apply cleanly to disposable databases.
- `package.json`:
  - Added npm script `"test:reminder": "tsx tests/reminder/reminder_engine_test.ts"`.
  - Updated `"test"` script to execute DB, API, frontend, and reminder suites in sequence.

### D. Documentation Deliverables
- `docs/STAGE_5A_REMINDER_ENGINE_DESIGN.md`: Complete architecture and design specification.
- `docs/STAGE_5A_IMPLEMENTATION_REPORT.md`: This comprehensive implementation report.
- `docs/STAGE_5A_TEST_RESULTS.md`: Detailed test matrix, pass/fail counts, and execution logs.

---

## 3. Date, Time, and Calendar Semantics

### Authoritative Expiry Date Definition
- In FITFUSION, `subscriptions.end_date` represents the **inclusive** final day of the subscription.
- A member whose subscription ends on `2026-10-25` is considered fully active until `2026-10-25T23:59:59.999` in the gym's local timezone. Expiration takes effect at `00:00:00` on `2026-10-26`.

### Milestone Calculation
Calculations are strictly calendar-date operations rather than floating hour offsets:
1. `EXPIRY_MINUS_3`: `end_date - 3 calendar days`
2. `EXPIRY_ZERO`: `end_date` (The exact calendar date of expiry)
3. `EXPIRY_PLUS_3`: `end_date + 3 calendar days`

### Edge-Case Handling
- **Leap Years:** Leap year calculations explicitly account for February 29 (e.g. `2024-03-01` minus 3 days yields `2024-02-27`).
- **Month Rollover:** Transitioning across month boundaries preserves accurate day-of-month (e.g. `2026-03-01` minus 3 days yields `2026-02-26`).
- **Year Rollover:** Rollovers across year boundaries correctly decrement/increment the year (e.g. `2027-01-02` minus 3 days yields `2026-12-30`).
- **Timezone Conversion:** All local target dates are mapped to UTC timestamps using the configured gym timezone (defaulting to `Asia/Kolkata`, UTC +05:30) and the gym's configured send hour (default `10:00 AM IST` -> `04:30:00 UTC`).

---

## 4. Idempotency & Scheduler Policies

### Idempotency Strategy
- **Key Formula:** `rem:${subscription_id}:${milestone}:${target_date}`
- **Database Enforcement:** Unique composite constraint `UNIQUE (idempotency_key)` on `notification_jobs`.
- **Re-run Safety:** Repeated scheduling runs execute `ON CONFLICT (idempotency_key) DO NOTHING`. If a subscription has already been scheduled for a milestone on that date, duplicate rows are prevented at the database level.

### Missed-Run Policy (Zero-Burst Guarantee)
If the scheduler fails to run on time (e.g., due to system downtime) and runs days later:
- The system **never releases a burst of overdue notifications**.
- Any milestone whose target date is older than `current_date - 1 calendar day` is inserted or updated with `status = 'skipped'` and `cancellation_reason = 'scheduler_missed_milestone_stale'`.
- Only milestones whose target dates fall within the current active window are marked `pending` for dispatch.

---

## 5. Job Lifecycle & Concurrency Strategy

### State Machine Transitions

| Current State | Event / Trigger | Target State | Action / Side Effect |
| :--- | :--- | :--- | :--- |
| `[none]` | Scheduler run | `pending` | Row inserted with deterministic key & `scheduled_for` timestamp. |
| `[none]` | Scheduler run (overdue) | `skipped` | Marked stale; `cancellation_reason = 'scheduler_missed_milestone_stale'`. |
| `pending` | Worker claim | `claimed` | Transaction locks row (`FOR UPDATE SKIP LOCKED`), assigns claim token and 5-min lease. |
| `claimed` | Pre-check failed | `cancelled` | Subscription renewed/cancelled; `cancellation_reason` logged. |
| `claimed` | Pre-check passed | `dispatching` | Two-phase dispatch intent recorded in `notification_attempts`. |
| `claimed` | Lease timeout (no attempt) | `pending` | Lease expired; claim cleared by `sweepExpiredLeases`. |
| `dispatching` | Adapter success | `completed` | Marked completed, processed timestamp set, token validated. |
| `dispatching` | Transient failure | `pending` | Attempt incremented, backoff scheduled (`60s`, `300s`, `900s`). |
| `dispatching` | Permanent / Max attempts | `failed` | Terminal failure recorded with error code and message. |
| `dispatching` | Ambiguous timeout | `reconciling` | Leased orphaned during dispatch; marked for provider reconciliation. |
| `reconciling` | Reconciliation check | `completed`/`failed` | Resolved once provider status is verified. |

### Concurrency & Locking
- **Claim Transaction:** Jobs are claimed via `claim_notification_jobs(p_worker_id, p_batch_size, p_lease_seconds)`. This uses `FOR UPDATE SKIP LOCKED` on `notification_jobs`, guaranteeing that two concurrent workers cannot lock or acquire the same job.
- **Lock Isolation:** Database locks are held strictly during the microsecond claim transaction. The lock is released **before** the delivery adapter is invoked.
- **Stale Token Protection:** Updates to `notification_jobs` validate both `job_id` and `claim_token`. If a worker loses its lease due to delay and another worker claims it, the late-returning worker's completion is rejected.

---

## 6. Pre-Dispatch Eligibility Re-Check

A job scheduled days in advance may become obsolete before its execution time arrives. Immediately before claiming and again before adapter invocation, `validateJobPreDispatchEligibility` verifies:
1. The referenced subscription still exists in `subscriptions`.
2. The subscription status is still `active` (not `cancelled`, `expired`, or superseded).
3. The job's recorded `intended_end_date` matches the subscription's current `end_date`.
4. The member's status is `active`.
5. The member has not opted out of SMS/WhatsApp reminders.
6. The target milestone remains valid for the subscription's current lifecycle state.

If any check fails, the job transitions immediately to `cancelled` with a structured reason (e.g., `subscription_end_date_changed`, `subscription_cancelled`), ensuring that stale reminders are never sent.

---

## 7. Ambiguous Outcomes and Reconciliation

### Two-Phase Dispatch Intent
1. **Phase 1 (Intent):** Before calling `adapter.sendMessage()`, a row is inserted into `notification_attempts` with `status = 'dispatching'` and `claim_token`.
2. **Phase 2 (Resolution):** After the adapter returns, the attempt is updated to `delivered` or `failed`.

### Worker Crash & Abandoned Lease Recovery
When `sweepExpiredLeases()` detects an expired lease:
- If **zero dispatch attempts** were recorded, it is safe to retry; the job is reset to `status = 'pending'`.
- If **a dispatch attempt was initiated** (`status = 'dispatching'`), the outcome with the external carrier is unknown. To prevent duplicate messages, the job transitions to `status = 'reconciling'`.
- `reconcileAmbiguousJob()` checks the carrier status (or mock registry) and reconciles the job to `completed` or `failed` without triggering an unverified retry.

---

## 8. Database Security & Migration Hardening

1. **Schema Qualification:** All table references in migrations (`20261020000004_reminder_engine_optimizations.sql`) are strictly schema-qualified (`public.notification_jobs`, `public.subscriptions`).
2. **Safe Search Path:** Stored functions specify `SET search_path = public, pg_temp;`.
3. **Execution Privileges:** Stored worker functions execute with `SECURITY DEFINER` and revoke default execution rights from `PUBLIC` (`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC`), granting execution only to `service_role` and `authenticated`.
4. **Row-Level Security:** Browser clients cannot arbitrarily claim, process, or complete reminder jobs. Worker endpoints and functions remain strictly server-side.

---

## 9. Verification Summary

All verification commands executed cleanly with zero errors:

| Test Command | Scope | Result | Exit Code |
| :--- | :--- | :--- | :--- |
| `npm run test:reminder` | Reminder Engine Test Suite (32 tests) | **32 / 32 Passed** | `0` |
| `npm run test:db` | Database Migrations & RLS Suite (25 tests) | **25 / 25 Passed** | `0` |
| `npm run test:api` | Backend Express & PGlite Suite (63 tests) | **63 / 63 Passed** | `0` |
| `npm run test:frontend` | React Frontend Unit & Mock Suite (37 tests) | **37 / 37 Passed** | `0` |
| `npm test` | Complete Project Test Suite (157 tests) | **157 / 157 Passed** | `0` |
| `npm run typecheck:server` | TypeScript Server Compilation | **0 Errors** | `0` |
| `npm run build` | Vite Production Bundle Build | **Success (5.33s)** | `0` |

---

## 10. Local Development vs. Production Limitations

| Feature / Capability | Local Implementation (Stage 5A) | Production Requirement (Stage 5B+) | Status / Restriction |
| :--- | :--- | :--- | :--- |
| **Database Engine** | PGlite (In-memory WebAssembly PostgreSQL) | Hosted Supabase PostgreSQL Instance | Local only; no cloud connection made. |
| **Claim Concurrency** | Single-node in-memory transactions & skip locked | Multi-pod / serverless worker pool | PGlite tests verify logic; distributed cross-process locking requires remote DB. |
| **Delivery Adapter** | `MockDeliveryAdapter` (`is_mock: true`) | Twilio / Meta WhatsApp Cloud API | Mock only; zero real messages sent. |
| **Scheduler Trigger** | Programmatic test call & local interval | Supabase `pg_cron` or Cloudflare Worker Cron | Cloud scheduler trigger not yet wired. |
| **Secrets & Keys** | Mock configuration | Hosted API keys & Webhook signature secrets | No live credentials requested or stored. |

---

## 11. Verdict and Next Steps

### Official Verdict: **CONDITIONAL PASS**
- **Condition:** All Stage 5A architecture, database migrations, date math, idempotent scheduling, atomic worker claiming, pre-dispatch eligibility, retry backoff, lease sweeping, and reconciliation requirements are **100% implemented, passing, and verified locally**.
- **Blocker:** Remote deployment, live WhatsApp/SMS credentials, and hosted Supabase synchronization remain strictly blocked pending independent review and the start of Stage 5B.

**STOP CONDITION MET:** Stage 5A is complete. Do not proceed to Stage 5B until directed.
