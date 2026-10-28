# Stage 4B Remediation Log

## Gym Membership Management and Automated Notification System

**Document Version:** 1.0.0  
**Date:** 2026-10-20  
**Scope:** Corrections applied during Stage 4B Independent Audit  

---

### Remediation Item 1: Dynamic Health Verification for Top Operational Banner

- **File Modified:** `src/components/dashboard/DashboardLayout.tsx`
- **Component:** `DashboardLayout`
- **Confirmed Defect:** The top operational indicator bar previously rendered `'LIVE API MODE • Connected to /api (Stage 3 Backend)'` simply because `appMode === 'live'`, without confirming that the API was actually reachable.
- **Correction Applied:**
  1. Added `checkLiveApiHealth` using `apiClient.getHealth()` to dynamically query the health endpoint when in Live Mode.
  2. Implemented dynamic states:
     - `checking`: `'LIVE API MODE • Probing /api connection...'` (amber spinning indicator).
     - `connected`: `'LIVE API MODE • Connected to /api (Backend Ready)'` (emerald pulsing indicator).
     - `disconnected`: `'LIVE API MODE • Disconnected from /api (Server Unreachable)'` (rose indicator with a "Retry Connection" button).
  3. Added accessible switch semantics to the mode toggle button: `role="switch"`, `aria-checked={appMode === 'live'}`, and descriptive `aria-label`.

---

### Remediation Item 2: Explicit Uncertain Outcome Presentation for Renewal Flow

- **File Modified:** `src/components/dashboard/RenewalModal.tsx`
- **Component:** `RenewalModal`
- **Confirmed Defect:** When a renewal request timed out (`error.isTimeout`) or experienced network interruption (`error.isNetworkError`), the UI rendered a standard red "Renewal Error" banner. This misleadingly implied the renewal had failed on the server, when in fact the server might have committed the record.
- **Correction Applied:**
  1. Differentiated between definitive errors (400, 401, 403, 404, 409) and uncertain outcomes (`isTimeout || isNetworkError`).
  2. For uncertain outcomes, displayed an amber status card titled **"Renewal Status Uncertain (Ambiguous Outcome)"**, explaining that the request may have already completed on the backend and that retrying is safe.
  3. Renamed the submission button during an uncertain outcome to **"Retry (Verify / Complete)"**, while preserving the original RFC 4122 v4 idempotency key.

---

### Remediation Item 3: Atomic Concurrent Idempotency & Full Payload Mismatch Verification

- **File Modified:** `server/controllers/subscriptionsController.ts`
- **Function:** `renewSubscription`
- **Confirmed Defect:**
  1. If two concurrent renewal requests with the identical idempotency key arrived simultaneously, both could pass the pre-transaction check; the second would hit the PostgreSQL unique constraint `uq_subscriptions_gym_idempotency` (`23505`) and return a `409 Resource Conflict`, failing to return the idempotent replay.
  2. The pre-check only compared `member_id` and `plan_id`, ignoring `amount_paid` and `start_date`, which could allow mismatched payloads with the same key to slip past payload collision checks.
- **Correction Applied:**
  1. Added strict validation checking `amount_paid` and `start_date` against existing records, returning `409 IDEMPOTENCY_KEY_MISMATCH` if either differs.
  2. Wrapped `db.transaction()` to catch PostgreSQL error `23505` on `uq_subscriptions_gym_idempotency`. If a concurrent request committed first, it queries the committed record and returns `200 OK` with `idempotent_replay: true` if the payload matches, or `409 Conflict` if the payload mismatches.

---

### Remediation Item 4: Race Condition Protection on In-Flight Member Directory Queries

- **File Modified:** `src/components/dashboard/MemberManagement.tsx`
- **Component:** `MemberManagement`
- **Confirmed Defect:** If the user toggled from Live Mode to Demo Mode while `fetchLiveMembers` was in flight, the resolving promise could update state or set error state for Demo Mode, or out-of-order search responses could overwrite newer inputs.
- **Correction Applied:**
  1. Introduced `requestCounterRef` and `activeModeRef` via `useRef`.
  2. Discarded any API response or error if `activeModeRef.current !== 'live'` or if `thisRequestId !== requestCounterRef.current`.
  3. Reset loading states and cleared live errors immediately upon transitioning to Demo Mode.

---

### Remediation Item 5: Comprehensive Regression Test Coverage

- **Files Modified:**
  - `tests/api/api_test_suite.ts`
  - `tests/frontend/api_client_test.ts`
- **Tests Added:**
  - `Test 13C`: Idempotency key reused with mismatched amount rejected with 409 `IDEMPOTENCY_KEY_MISMATCH`.
  - `Test 13D`: Two concurrent requests with the identical key return 201 and 200 without collision crash.
  - `Test 13E`: Genuinely new renewal operation receives a new distinct UUID key and new subscription ID.
  - `Test 13F`: Failed operation (invalid plan) followed by safe retry with same key succeeds on correction.
  - `Test 5E`: Timeout followed by safe retry with original key.
  - `Test 5F`: New operation key generation isolation.
  - `Test 6A-D`: Defensive parsing of proxy 502 HTML error responses without JSON syntax crashes.
