# Stage 2B Independent Database Security and Migration Audit

## Gym Membership Management and Automated Notification System

**Document Version:** 1.0.0  
**Audit Date:** 2026-10-20  
**Auditor:** Independent Senior PostgreSQL/Supabase Security Reviewer  
**Audit Target:** Stage 2 Database Foundation, Supabase Migrations, Constraints, and Row Level Security (RLS)  
**Status:** Complete Audit & Verification  
**Final Audit Verdict:** **CONDITIONAL PASS** (Architectural defects identified and remediated in migrations; live concurrency and Supabase Auth JWT verification demarcated for Stage 3 real environment integration)

---

### 1. Executive Summary & Review Scope

An independent security, architectural, and reliability audit of Stage 2 was performed on [`d:/PROJECT/GYM MANGEMENT SYSTEM`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM).

The audit inspected:
- Raw SQL migrations in [`supabase/migrations/`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/supabase/migrations):
  - `20261020000001_initial_schema.sql`
  - `20261020000002_functions_and_triggers.sql`
  - `20261020000003_row_level_security.sql`
- Supabase configuration in [`supabase/config.toml`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/supabase/config.toml)
- Seed fixtures in [`supabase/seed.sql`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/supabase/seed.sql)
- Automated test suite in [`tests/db/test_pglite_suite.mjs`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/tests/db/test_pglite_suite.mjs)
- Build configurations in [`package.json`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/package.json)

**Critical Caveat on Testing Environment:**
All automated database tests were executed locally using `@electric-sql/pglite` (an in-process PostgreSQL 18.6 WebAssembly engine). **PGlite tests are simulated in-process database unit/integration checks and must never be represented as real Supabase Cloud/Docker container integration tests.** Genuine cross-client concurrency races and PostgREST JWT authentication handshakes cannot be fully proven in PGlite.

---

### 2. Ranked Findings & Vulnerabilities

| Finding ID | Severity | Category | Target File | Status | Description |
| :--- | :---: | :---: | :--- | :---: | :--- |
| **SEC-02B-01** | **Critical** | RLS Recursion | [`20261020000003_row_level_security.sql`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/supabase/migrations/20261020000003_row_level_security.sql) | **Fixed** | Infinite recursion detected in RLS policy for `public.profiles` caused by direct self-referential subquery in `FOR ALL` policy. Blocked all staff profile reads and updates. |
| **SEC-02B-02** | **High** | Concurrency Test Gap | [`tests/db/test_pglite_suite.mjs`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/tests/db/test_pglite_suite.mjs) | **Unverified** | Tests executed sequentially in single-threaded Node.js. Genuine parallel transaction concurrency (simultaneous renewal requests) has not been tested against a concurrent database server. |
| **SEC-02B-03** | **Medium** | Authorization Bypass | [`20261020000003_row_level_security.sql`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/supabase/migrations/20261020000003_row_level_security.sql) | **Fixed** | Missing `WITH CHECK` clauses on `UPDATE` policies for `gym_settings`, `profiles`, and `membership_plans`. |
| **SEC-02B-04** | **Medium** | Database Portability | [`20261020000003_row_level_security.sql`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/supabase/migrations/20261020000003_row_level_security.sql) | **Fixed** | Missing explicit table `GRANT` statements for `authenticated` role. On standard PostgreSQL, queries failed with `42501 permission denied` before RLS could evaluate. |
| **SEC-02B-05** | **Low** | Trigger Boundary | [`20261020000002_functions_and_triggers.sql`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/supabase/migrations/20261020000002_functions_and_triggers.sql) | **Documented** | `cancel_stale_notification_jobs_on_renewal` cancels pending jobs where `subscription_id != NEW.id`. When updating an existing subscription's `end_date`, pending jobs targeting the old date are not automatically cancelled by this trigger. |

---

### 3. Detailed Audit by Dimension

#### Audit 1: Migrations and Reproducibility
- **Application Order:** The migrations apply in strict lexical timestamp order (`001` $\rightarrow$ `002` $\rightarrow$ `003`).
- **Extensions:**
  - `uuid-ossp`, `citext`, `pgcrypto`, and `btree_gist` are standard Supabase-supported extensions.
  - Verified: `btree_gist` is mandatory for scalar + range GiST exclusion constraints.
- **Relational Integrity:**
  - Foreign keys enforce `ON DELETE RESTRICT` on business entities (`gym_settings`, `members`, `membership_plans`, `subscriptions`) preventing cascading financial data loss.
  - Cascade delete is restricted strictly to `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE` and `notification_attempts.job_id REFERENCES notification_jobs(id) ON DELETE CASCADE`.
- **Reproducibility:** Confirmed that migrations can be applied repeatedly to fresh instances without syntax errors or unhandled object collisions.

#### Audit 2: Row Level Security (RLS) & Authorization
- **RLS Enforcement:** Enabled on all 9 application tables (`gym_settings`, `profiles`, `members`, `membership_plans`, `subscriptions`, `notification_jobs`, `notification_attempts`, `webhook_events`, `audit_logs`).
- **Critical Finding SEC-02B-01 (Infinite Recursion on Profiles):**
  - *Defect:* Original migration 003 defined:
    ```sql
    CREATE POLICY "Owners can manage staff profiles"
    ON public.profiles FOR ALL
    TO authenticated
    USING (
        gym_id = public.current_user_gym_id() 
        AND EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = (auth.uid()) AND role IN ('owner', 'admin')
        )
    );
    ```
  - *Mechanism:* When an authenticated user queried `SELECT * FROM public.profiles`, PostgreSQL evaluated the policy, which ran the subquery on `public.profiles`, re-triggering RLS evaluation recursively until throwing `infinite recursion detected in policy for relation "profiles"`.
  - *Remediation:*
    1. Added `SECURITY DEFINER` function `public.current_user_role()` in migration 002 with `SET search_path = pg_catalog`.
    2. Replaced the recursive subquery with `public.current_user_role() IN ('owner', 'admin')`.
    3. Separated the `FOR ALL` policy into explicit `INSERT`, `UPDATE`, and `DELETE` policies, each with dedicated `WITH CHECK` conditions.
- **Anonymous Role Access:**
  - Verified: `anon` role has zero SELECT, INSERT, UPDATE, or DELETE policies.
  - Added defense-in-depth: Explicit `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` in migration 003.
- **Cross-Gym Tenant Boundary:**
  - Tested: Staff belonging to Gym A cannot read or mutate members belonging to Gym B. Verified via `SET ROLE gym_staff_role` with simulated `auth.uid()`.

#### Audit 3: Privileged Functions & Grants
- **Search Path Hardening:**
  - `current_user_gym_id()`: `SET search_path = pg_catalog`.
  - `current_user_role()`: `SET search_path = pg_catalog`.
  - `cancel_stale_notification_jobs_on_renewal()`: `SET search_path = pg_catalog`.
  - `claim_notification_jobs()`: `SET search_path = pg_catalog`.
  - `update_updated_at_column()`: `SET search_path = pg_catalog` (`SECURITY INVOKER`).
- **Object Qualification:** All table and system calls explicitly qualify schemas (`public.profiles`, `public.notification_jobs`, `pg_catalog.now()`, `pg_catalog.btrim()`).
- **Execution Grants:**
  - `current_user_gym_id()` & `current_user_role()`: Execution revoked from `PUBLIC` and `anon`; granted to `authenticated` and `service_role`.
  - `cancel_stale_notification_jobs_on_renewal()`: Trigger execution only. Revoked from `PUBLIC`, `anon`, and `authenticated`.
  - `claim_notification_jobs()`: Revoked from `PUBLIC`, `anon`, and `authenticated`. Granted exclusively to `service_role`.

#### Audit 4: Subscription Invariants
- **Mathematical Exclusion Constraint:**
  ```sql
  CONSTRAINT no_overlapping_active_subscriptions 
  EXCLUDE USING gist (
      member_id WITH =,
      daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'active')
  ```
  - Validated: Inclusive end-date semantics (`'[]'`).
  - Active subscription 2026-11-01 to 2026-11-30 conflicts with 2026-11-15 to 2026-12-14 $\rightarrow$ Rejected (`23P01`).
  - Contiguous future subscription starting 2026-12-01 $\rightarrow$ Accepted cleanly without collision.
- **Client Request Idempotency:**
  - `uq_subscriptions_gym_idempotency` on `(gym_id, idempotency_key)` successfully rejects duplicate client network submissions.
- **Renewal Lineage:**
  - `uq_subscriptions_renewed_from` enforces linear parent-child subscription chains.
- **Transactional Rollback:**
  - Failed renewal transaction cleanly aborts and rolls back partial insertions.
- **Finding SEC-02B-02 (Concurrency Limitation):**
  - Concurrency safety was proven *structurally* through exclusion constraints and lineage indexes.
  - However, true multi-connection parallel race conditions (simultaneous `/api/subscriptions/renew` API calls contending for member row locks) cannot be executed in single-threaded PGlite. This must be marked **Unverified** until Stage 3 integration testing.

#### Audit 5: Notification Worker Safety
- **Queue Lease & Atomic Claim:**
  - `claim_notification_jobs()` atomically selects eligible rows using `FOR UPDATE SKIP LOCKED`.
- **Two-Phase Dispatch Intent Guard:**
  - The function explicitly verifies that no attempt row exists with status `'dispatching'`, `'sent'`, or `'unknown'`.
  - Verified: If a worker claims a job, logs intent (`dispatching`), and crashes, subsequent workers **skip** the job. This eliminates duplicate message dispatching across ambiguous provider socket timeouts.
- **Renewal Invalidation Trigger:**
  - Inserting a new subscription for a member automatically cancels `pending` jobs tied to earlier subscriptions of that member.
  - Attempt history in `notification_attempts` is preserved and never deleted.

#### Audit 6: Test Validity
- **Test Framework:** Node.js script using `@electric-sql/pglite` (PGlite v0.5.10 / PostgreSQL 18.6 WASM).
- **Test Execution:**
  - Executed command: `npm test` (`node tests/db/test_pglite_suite.mjs`).
  - Total assertions: 24.
  - Passed: 24.
  - Failed: 0.
- **What the Tests Actually Prove:**
  - Validates DDL compilation, extension initialization, and syntax compatibility.
  - Validates GiST range exclusion logic, partial unique indexes, check constraints, and trigger execution.
  - Validates RLS policy evaluation and tenant separation when PostgreSQL roles and `auth.uid()` are simulated.
- **What the Tests Do NOT Prove:**
  - Does NOT prove Supabase Auth GoTrue JWT signing or header extraction.
  - Does NOT prove multi-threaded connection pooler (PgBouncer/Supavisor) behavior.
  - Does NOT prove real-world network latency or multi-worker concurrency races.

---

### 4. Confirmed Issues vs. Unverified Assumptions

| Item | Status | Justification / Notes |
| :--- | :---: | :--- |
| **Schema DDL & Constraint Invariants** | **Confirmed** | Verified against running PostgreSQL engine; exclusion constraints reject overlapping dates. |
| **Renewal Trigger Invalidation** | **Confirmed** | Verified: Stale reminder jobs transition to `'cancelled'` upon renewal. |
| **Two-Phase Dispatch Protection** | **Confirmed** | Verified: Jobs with attempts in `dispatching` are skipped by queue reclaims. |
| **RLS Non-Recursion Fix** | **Confirmed** | Verified: `current_user_role()` eliminates infinite recursion on `profiles`. |
| **Anonymous Access Denial** | **Confirmed** | Verified: `anon` role is blocked by table permissions and RLS. |
| **True Parallel Concurrency Locking** | **Unverified Assumption** | PGlite is single-threaded. Parallel database connection races require disposable PostgreSQL. |
| **Supabase PostgREST JWT Auth Integration** | **Unverified Assumption** | `auth.uid()` was simulated via SQL stub; real Supabase JWT header extraction requires live Supabase. |

---

### 5. Targeted Modifications Made

1. **[`supabase/migrations/20261020000002_functions_and_triggers.sql`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/supabase/migrations/20261020000002_functions_and_triggers.sql):**
   - Added `public.current_user_role()` helper function with `SECURITY DEFINER` and `SET search_path = pg_catalog`.
   - Granted execute permissions strictly to `authenticated` and `service_role`; revoked from `PUBLIC` and `anon`.
2. **[`supabase/migrations/20261020000003_row_level_security.sql`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/supabase/migrations/20261020000003_row_level_security.sql):**
   - Replaced recursive `SELECT ... FROM public.profiles` subqueries with `public.current_user_role() IN ('owner', 'admin')` across `gym_settings`, `profiles`, and `membership_plans`.
   - Replaced `FOR ALL` on `profiles` and `membership_plans` with distinct `INSERT`, `UPDATE`, and `DELETE` policies enforcing explicit `WITH CHECK` clauses.
   - Added explicit table privilege grants (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated; GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;`).
3. **[`tests/db/test_pglite_suite.mjs`](file:///d:/PROJECT/GYM%20MANGEMENT%20SYSTEM/tests/db/test_pglite_suite.mjs):**
   - Added test assertions for `public.profiles` RLS non-recursion (SELECT and UPDATE).
   - Added test assertion for anonymous access denial.
   - Updated suite to reflect 24 automated assertions.

---

### 6. Tests Requiring a Real Disposable Supabase/PostgreSQL Environment

The following tests are classified as **blocked for local single-process execution** and must be executed in Stage 3 using a real disposable PostgreSQL / Supabase test instance:

1. **TEST-ENV-01 (Multi-Client Concurrency Race):** Spawning 10 simultaneous parallel worker connections attempting to renew the same member to prove `SELECT ... FOR UPDATE` row locking and exclusion constraint behavior under concurrent load.
2. **TEST-ENV-02 (PostgREST JWT Auth Handshake):** Authenticating against Supabase Auth (`/auth/v1/token`) and verifying that real Supabase JWT claims correctly populate `auth.uid()` and execute RLS without role switching.
3. **TEST-ENV-03 (PgBouncer Transaction Pooling Compatibility):** Verifying that prepared statements and session-level locks behave correctly through Supavisor/PgBouncer in transaction pooling mode.

---

### 7. Final Verdict & Blockers for Stage 3

#### Verdict: **CONDITIONAL PASS**

The database schema, constraints, hardened functions, and RLS policies are structurally sound, version-controlled, and verified against real PostgreSQL engine logic. All identified defects (notably the critical RLS recursion bug) have been remediated and tested.

#### Required Exit Criteria / Blockers Before Stage 3 Backend Release:
1. **Docker / Disposable Database Setup for Concurrency Testing:** To verify multi-client transaction serialization, a live disposable PostgreSQL instance (via Docker or Supabase CLI) must be provisioned before Stage 3 concurrency sign-off.
2. **Subscription End-Date Extension Handler:** In Stage 3 API design, when a subscription's `end_date` is extended via `PATCH /api/subscriptions/:id`, the API layer must explicitly cancel and recalculate pending notification jobs tied to that subscription, supplementing the trigger which handles new renewal rows.
3. **Maintain Frontend Boundaries:** The frontend continues in mock mode (`http://127.0.0.1:3000/`, `npm run build` passing). Do not connect the frontend or expose service-role credentials during Stage 3 API implementation.

---

### 8. Recommended Next Step

Proceed to **Stage 3: Core Backend APIs & Subscription Business Logic** following the Implementation Roadmap:
1. Establish backend serverless API scaffolding (Vite/Node or Supabase Edge Functions).
2. Implement centralized JWT authentication middleware and tenant extraction.
3. Implement transactional renewal endpoints (`POST /api/subscriptions/renew`) with client request idempotency and row-level locking.
