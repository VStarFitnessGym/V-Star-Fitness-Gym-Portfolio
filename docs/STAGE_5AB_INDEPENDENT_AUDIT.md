# Stage 5A-B Independent Reminder Engine Audit Report

**System:** FITFUSION Gym Membership Management System  
**Stage:** Stage 5A-B — Independent Reminder Engine Audit & Remediation  
**Workspace:** `D:\PROJECT\GYM MANGEMENT SYSTEM`  
**Date:** 2026-10-20  
**Auditor:** Independent Senior PostgreSQL, Distributed Systems, Application Security & QA Engineer  
**Verdict:** **CONDITIONAL PASS**  
*(Local database, date math, claiming, race guards, retry backoff, and reconciliation are fully hardened and passing 165/165 tests; production cloud and external messaging integrations remain blocked pending Stage 5B).*

---

## 1. Executive Summary

This independent audit conducted a forensic, code-level and SQL-level inspection of the Stage 5A Membership Expiry Reminder Engine foundation. The engine was analyzed for:
- Database schema and state-machine transitions
- Calendar-based expiry calculations and timezone shifts
- Subscription renewal, extension, and cancellation lifecycle interactions
- Worker crash recovery, lease expiration, and ambiguous outcome reconciliation
- Missed scheduler run behavior and anti-burst guarantees
- Test quality, concurrency boundaries, and PGlite limitations

### Key Findings & Corrections Made:
1. **Timezone-Local Date Formatting in Scheduler:** The scheduler previously used UTC date formatting as a default for `todayStr`, which could cause a 1-day off-by-one difference between 18:30 UTC and 23:59 UTC (which is early morning 00:00 to 05:30 IST). Resolved by introducing `getGymLocalCalendarDate(date, timezone)`.
2. **Subscription End-Date Extension & Cancellation Trigger:** The previous trigger in migration 002 had `AND subscription_id != NEW.id` and did not fire on `UPDATE OF status`. Consequently, extending `end_date` on an existing subscription or setting its status to `'cancelled'` did not cancel its obsolete pending jobs in the database. Resolved via additive migration `20261020000005_cancel_stale_jobs_on_subscription_update.sql` and scheduler-level obsolete job cleanup.
3. **Pre-Dispatch Race Condition Guard:** Identified a window between pre-dispatch validation and adapter delivery where a concurrent subscription change could occur. Resolved by introducing an atomic subscription state guard in `workerService.ts` that verifies the subscription is still `active` and has the expected `end_date` before transitioning to `dispatching`. If the subscription changed, the job cancels and never invokes the adapter.
4. **Terminal State Preservation:** Verified that `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` guarantees that repeated scheduler runs never overwrite or revive cancelled or completed jobs.

---

## 2. Files and SQL Inspected

The following code and migration files were thoroughly reviewed:
- `server/services/reminders/types.ts`
- `server/services/reminders/dateMath.ts`
- `server/services/reminders/eligibilityService.ts`
- `server/services/reminders/mockAdapter.ts`
- `server/services/reminders/schedulerService.ts`
- `server/services/reminders/workerService.ts`
- `server/services/reminders/reconciliationService.ts`
- `server/services/reminders/index.ts`
- `server/db/database.ts`
- `server/controllers/subscriptionsController.ts`
- `supabase/migrations/20261020000001_initial_schema.sql`
- `supabase/migrations/20261020000002_functions_and_triggers.sql`
- `supabase/migrations/20261020000003_row_level_security.sql`
- `supabase/migrations/20261020000004_reminder_engine_optimizations.sql`
- `supabase/migrations/20261020000005_cancel_stale_jobs_on_subscription_update.sql`
- `tests/reminder/reminder_engine_test.ts`
- `tests/db/test_pglite_suite.mjs`

---

## 3. Database & Job State Machine Audit

### A. Idempotency Key Constraint
- **Structure:** `rem:${subscription_id}:${milestone}:${target_date}`
- **Database Enforcement:** Backed by PostgreSQL unique constraint on `public.notification_jobs(idempotency_key)`.
- **Finding:** Scheduling operations execute `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`. Even rapid parallel scheduling runs cannot generate duplicate reminder jobs.

### B. Worker Claiming and Mutual Exclusion
- **Mechanism:** `claim_notification_jobs(p_worker_id, p_batch_size, p_lease_seconds)` executes `FOR UPDATE SKIP LOCKED` on eligible rows in `notification_jobs`.
- **Finding:** Rows are locked and leased atomically. Two concurrent worker batches cannot claim or lock the same pending job.
- **Lock Boundaries:** Transaction locks are held only during the sub-millisecond claim operation; locks are released **before** delivery adapter invocation.

### C. Worker Ownership & Stale Token Protection
- **Mechanism:** `safe_complete_notification_job(p_job_id, p_worker_id)` and worker state updates check `WHERE id = $1 AND worker_id = $2`.
- **Finding:** A worker returning with an expired lease after another worker or the lease sweeper has reassigned `worker_id` will update 0 rows. A stale claim token cannot complete a job.

### D. SQL Hardening & Security
- Stored functions (`claim_notification_jobs`, `safe_complete_notification_job`, `cancel_stale_notification_jobs_on_renewal`) define `SECURITY DEFINER` with `SET search_path = pg_catalog;` and schema-qualified references.
- `REVOKE ALL ... FROM PUBLIC`, `anon`, and `authenticated` ensures browser clients cannot directly claim or manipulate jobs.

---

## 4. Expiry Date & Timezone Semantics Audit

1. **Calendar Arithmetic:**
   - Evaluated `addCalendarDays` across month boundaries (`2026-03-01` minus 3 days = `2026-02-26`), leap-year boundaries (`2024-03-01` minus 3 days = `2024-02-27`), and year rollovers (`2027-01-02` minus 3 days = `2026-12-30`).
   - Verified that integer calendar days are strictly added without floating 72-hour drift.
2. **Inclusive Expiry Rule:**
   - Verified that `subscriptions.end_date` is inclusive: the member is active through 23:59:59.999 local time.
3. **Timezone Conversion:**
   - Local scheduled time (default 10:00 AM IST) maps to `04:30:00.000Z` UTC.
   - Introduced `getGymLocalCalendarDate(date, timezone)` to prevent server UTC time from causing 1-day calendar offsets during late-evening UTC runs.

---

## 5. Subscription Renewal, Extension & Cancellation Audit

1. **Renewal (Contiguous Future Subscription):**
   - When a new subscription is inserted with `renewed_from_subscription_id`, `cancel_stale_notification_jobs_on_renewal` cancels pending jobs for the prior subscription with `subscription_renewed_or_extended`.
2. **Extension (End-Date Modification):**
   - When `subscriptions.end_date` is updated, migration 005 triggers automatic cancellation of pending jobs for that subscription with `subscription_end_date_changed`.
   - `schedulerService.ts` cleans up any existing pending jobs whose target date does not match the new valid milestones.
3. **Cancellation:**
   - When `subscriptions.status` is set to `'cancelled'`, migration 005 cancels all pending jobs with `subscription_cancelled`.
4. **Pre-Dispatch Atomic Guard:**
   - In `workerService.ts`, the transition to `dispatching` validates that the subscription remains `active` with the expected `end_date`. If modified concurrently, dispatch is aborted, the job is cancelled, and the adapter is never called.

---

## 6. Worker Crash & Ambiguous Outcome Audit

1. **Crash with Zero Dispatch Intent:**
   - If a worker crashes before creating a row in `notification_attempts`, `sweepExpiredLeases` safely resets the job to `status = 'pending'`, clearing `worker_id` and `lease_expires_at`.
2. **Crash After Dispatch Intent:**
   - If a dispatch attempt was recorded (`status = 'dispatching'`), `sweepExpiredLeases` marks the job as `status = 'reconciling'`. It is **never** automatically reset to `pending`, preventing double-sends.
3. **Ambiguous Outcome (Socket Drop / Gateway Timeout):**
   - The adapter returns `outcome = 'ambiguous_timeout'`. The job transitions to `reconciling`.
4. **Reconciliation Service:**
   - `reconcileAmbiguousJob` resolves ambiguous jobs to `completed`, `failed`, or `pending` based on verified provider receipts without fabricating delivery data.

---

## 7. Missed Scheduler Run Policy Audit

- Milestones whose target date is older than `currentDate - 1 day` are marked `status = 'skipped'` with `cancellation_reason = 'scheduler_missed_milestone_stale'`.
- The anti-burst invariant is preserved: an overdue member never receives a simultaneous flood of "expires in 3 days", "expires today", and "expired 3 days ago".
- The unique index on `idempotency_key` guarantees that subsequent scheduler runs do not recreate skipped milestones as pending.

---

## 8. Verification Commands & Observed Results

| Command | Suite | Total Assertions | Status | Exit Code |
| :--- | :--- | :--- | :--- | :--- |
| `npm run test:reminder` | Reminder Engine Suite (Tests 1-37) | **39 / 39 Passed** | **PASS** | `0` |
| `npm run test:db` | Database Migrations (001-005) & RLS | **26 / 26 Passed** | **PASS** | `0` |
| `npm run test:api` | Backend Express & Subscriptions | **63 / 63 Passed** | **PASS** | `0` |
| `npm run test:frontend` | React Frontend Client & Error Handling | **37 / 37 Passed** | **PASS** | `0` |
| `npm test` | Unified Full Test Suite | **165 / 165 Passed** | **PASS** | `0` |
| `npm run typecheck:server` | TypeScript Server Compilation | **0 Errors** | **PASS** | `0` |
| `npm run build` | Vite Production Bundle Build | **Success (6.07s)** | **PASS** | `0` |

---

## 9. Local Development vs. Production Boundaries

- **Local Execution:** Tested on PostgreSQL 18.6 WebAssembly engine (PGlite). PGlite faithfully tests table schemas, exclusion constraints, GiST indexes, triggers, and `FOR UPDATE SKIP LOCKED`.
- **Known PGlite Limitation:** Single-process WASM cannot simulate true multi-container distributed worker contention across high-latency network hops.
- **Provider Readiness for Stage 5B:** The reminder engine's two-phase dispatch architecture, mock honesty (`is_mock: true`), atomic guards, and reconciliation primitives are architecturally ready for Stage 5B provider integration (Meta WhatsApp Cloud API / Twilio SMS).

---

## 10. Audit Verdict

**VERDICT: CONDITIONAL PASS**

- **Why PASS:** All 5 audit areas, date semantics, state transitions, race conditions, and missed-run policies are verified and passing 165/165 tests with zero regressions.
- **Why CONDITIONAL:** Hosted Supabase synchronization, production worker pool orchestration, and real messaging credentials remain blocked by design until Stage 5B.
