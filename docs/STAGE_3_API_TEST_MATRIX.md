# Stage 3 API Test Matrix & Verification Evidence

## Gym Membership Management and Automated Notification System

**Document Version:** 1.0.0  
**Status:** All Test Suites Executed & Passing  
**Engine:** Express API + In-Process PostgreSQL 18.6 Engine (`@electric-sql/pglite`)  
**Pass Rate:** 41/41 API Tests (100%) | 24/24 DB Tests (100%)  

---

### 1. API Verification Test Matrix

| ID | Test Suite & Objective | Method & Endpoint | Payload / Parameters | Expected Behavior | Actual Outcome | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1A** | Health Probe Status | `GET /api/health` | None | HTTP 200 OK | HTTP 200 OK returned | **PASS** |
| **1B** | Liveness Verification | `GET /api/health` | None | `"status": "healthy"` | Verified `"healthy"` | **PASS** |
| **1C** | Database Readiness | `GET /api/health` | None | `"database": "connected"` | Verified `"connected"` | **PASS** |
| **1D** | Zero Information Leak | `GET /api/health` | None | No env, tokens, or internal details | Zero sensitive fields leaked | **PASS** |
| **2A** | Missing Auth Header | `GET /api/me` | None | HTTP 401 Unauthorized | HTTP 401 Unauthorized | **PASS** |
| **2B** | RFC 7807 Error Code | `GET /api/me` | None | `"code": "UNAUTHORIZED"` | Verified `"UNAUTHORIZED"` | **PASS** |
| **2C** | Problem JSON Content-Type | `GET /api/me` | None | `application/problem+json` | Verified `application/problem+json` | **PASS** |
| **3** | Malformed Auth Header | `GET /api/me` | `Authorization: InvalidFormat` | HTTP 401 Unauthorized | HTTP 401 Unauthorized | **PASS** |
| **4A** | Expired Token Handling | `GET /api/me` | `Bearer <expired_token>` | HTTP 401 Unauthorized | HTTP 401 Unauthorized | **PASS** |
| **4B** | Expired Token Code | `GET /api/me` | `Bearer <expired_token>` | `"code": "TOKEN_EXPIRED"` | Verified `"TOKEN_EXPIRED"` | **PASS** |
| **4C** | Malformed Token Signature | `GET /api/me` | `Bearer <tampered_token>` | HTTP 401 Unauthorized | HTTP 401 Unauthorized | **PASS** |
| **5A** | Valid Token Status | `GET /api/me` | `Bearer <valid_token_staff_a>` | HTTP 200 OK | HTTP 200 OK | **PASS** |
| **5B** | Verified User Identity | `GET /api/me` | `Bearer <valid_token_staff_a>` | Matches token `sub` claim | Verified match | **PASS** |
| **5C** | Profile Tenant Resolution | `GET /api/me` | `Bearer <valid_token_staff_a>` | `gym_id` matches profile | Verified match | **PASS** |
| **5D** | Role Resolution | `GET /api/me` | `Bearer <valid_token_staff_a>` | `role` matches profile | Verified `staff` | **PASS** |
| **6** | Fail-Closed Orphan Token | `GET /api/me` | `Bearer <valid_jwt_no_profile>` | HTTP 403 Forbidden | HTTP 403 Forbidden | **PASS** |
| **7A** | Members Query Status | `GET /api/members` | `Bearer <staff_a>` | HTTP 200 OK | HTTP 200 OK | **PASS** |
| **7B** | Members Query Array | `GET /api/members` | `Bearer <staff_a>` | Array of member items | Array returned | **PASS** |
| **7C** | Cross-Gym Isolation (Staff A) | `GET /api/members` | `Bearer <staff_a>` | Only Gym A members returned | Zero Gym B members returned | **PASS** |
| **7D** | Cross-Gym Isolation (Staff B) | `GET /api/members` | `Bearer <staff_b>` | Only Gym B members returned | Zero Gym A members returned | **PASS** |
| **8A** | Bounded Limit Validation | `GET /api/members?limit=101` | `Bearer <staff_a>` | HTTP 400 Bad Request | HTTP 400 Bad Request | **PASS** |
| **8B** | Validation Error Code | `GET /api/members?limit=101` | `Bearer <staff_a>` | `"code": "VALIDATION_ERROR"` | Verified `"VALIDATION_ERROR"` | **PASS** |
| **8C** | Bounded Page Validation | `GET /api/members?page=0` | `Bearer <staff_a>` | HTTP 400 Bad Request | HTTP 400 Bad Request | **PASS** |
| **8D** | Search Parameter Query | `GET /api/members?search=Vikram`| `Bearer <staff_a>` | Filtered member results | Verified match | **PASS** |
| **9A** | Renewal Zod Body Validation | `POST /api/subscriptions/renew`| Malformed empty JSON `{}` | HTTP 400 Bad Request | HTTP 400 Bad Request | **PASS** |
| **9B** | RFC 7807 Invalid Params | `POST /api/subscriptions/renew`| Malformed empty JSON `{}` | Lists invalid parameters | Field issues populated | **PASS** |
| **10A** | Cross-Tenant Member Renewal | `POST /api/subscriptions/renew`| Staff A renewing Gym B member | HTTP 404 Member Not Found | HTTP 404 Member Not Found | **PASS** |
| **10B** | Non-Existent Plan Renewal | `POST /api/subscriptions/renew`| Staff A renewing fake plan | HTTP 404 Plan Not Found | HTTP 404 Plan Not Found | **PASS** |
| **11A** | Valid Renewal Creation | `POST /api/subscriptions/renew`| Member A1, 1 Month Plan | HTTP 201 Created | HTTP 201 Created | **PASS** |
| **11B** | Fresh Execution Flag | `POST /api/subscriptions/renew`| Member A1, 1 Month Plan | `"idempotent_replay": false` | Verified `false` | **PASS** |
| **11C** | Subscription Status | `POST /api/subscriptions/renew`| Member A1, 1 Month Plan | `"status": "active"` | Verified `"active"` | **PASS** |
| **11D** | Date Calculation Invariant | `POST /api/subscriptions/renew`| Member A1, 1 Month Plan | Contiguous YYYY-MM-DD dates | Verified YYYY-MM-DD format | **PASS** |
| **12A** | Idempotent Replay Status | `POST /api/subscriptions/renew`| Identical payload & key | HTTP 200 OK | HTTP 200 OK | **PASS** |
| **12B** | Idempotent Replay Flag | `POST /api/subscriptions/renew`| Identical payload & key | `"idempotent_replay": true` | Verified `true` | **PASS** |
| **12C** | Idempotent Deduplication | `POST /api/subscriptions/renew`| Identical payload & key | Returns same subscription ID | Verified identical ID | **PASS** |
| **13A** | Key Mismatch Rejection | `POST /api/subscriptions/renew`| Same key, different plan | HTTP 409 Conflict | HTTP 409 Conflict | **PASS** |
| **13B** | Key Mismatch Code | `POST /api/subscriptions/renew`| Same key, different plan | `"IDEMPOTENCY_KEY_MISMATCH"` | Verified code | **PASS** |
| **14A** | Exclusion Constraint Conflict | `POST /api/subscriptions/renew`| Overlapping active date range | HTTP 409 Conflict via `23P01` | HTTP 409 Conflict | **PASS** |
| **14B** | Safe Conflict Error Mapping | `POST /api/subscriptions/renew`| Overlapping active date range | `"SUBSCRIPTION_OVERLAP_CONFLICT"` | Redacted SQL, safe RFC 7807 | **PASS** |
| **15A** | Renewal Execution | `POST /api/subscriptions/renew`| Member A2 with pending job | HTTP 201 Created | HTTP 201 Created | **PASS** |
| **15B** | Reminder Queue Invalidation | Internal Database Trigger | Member A2 renewed | Job status transitions to `cancelled` | Verified in database | **PASS** |

---

### 2. Database Invariant Test Matrix (Stage 2 Baseline Preservation)

| ID | Suite | Objective | Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **1-2** | Migrations | Reproducible application of migrations 001, 002, 003 | Clean execution | **PASS** |
| **3A** | Domain Constraints | Reject non-+91 Indian phone numbers | Rejected | **PASS** |
| **3B** | Domain Constraints | Reject subscriptions where `end_date < start_date` | Rejected | **PASS** |
| **3C** | Domain Constraints | Partial unique index rejects duplicate active phone | Rejected | **PASS** |
| **8** | Invariants | Exclusion constraint `no_overlapping_active_subscriptions` | Rejected overlap | **PASS** |
| **9** | Invariants | Legitimate contiguous future-dated renewal | Accepted | **PASS** |
| **10** | Invariants | Linear renewal lineage (`uq_subscriptions_renewed_from`) | Enforced | **PASS** |
| **11** | Invariants | Unique idempotency key constraint (`uq_subscriptions_gym_idempotency`) | Enforced | **PASS** |
| **12** | Transactions | Atomic rollback on renewal failure releases locks | Rollback verified | **PASS** |
| **13** | Notification Queue | Trigger invalidates pending reminder on renewal | Cancelled | **PASS** |
| **14A** | Notification Queue | `claim_notification_jobs()` atomic claim & lease | Claimed | **PASS** |
| **14B** | Dispatch Guard | Two-Phase Dispatch Guard blocks worker reclamation | Blocked double-send | **PASS** |
| **15** | Notification Queue | Notification attempt history preserved | Preserved | **PASS** |
| **4, 6, 7** | RLS Policies | `current_user_gym_id()`, cross-gym isolation, profiles non-recursion | 0 rows / denied | **PASS** |

---

### 3. Build & Compilation Verification

| Command | Target | Expected Result | Actual Result |
| :--- | :--- | :--- | :--- |
| `npm run typecheck:server` | `tsconfig.server.json` | 0 type errors | **0 errors (Exit code 0)** |
| `npm run build` | Frontend Vite Bundle | 0 syntax or type errors | **Built cleanly in 2.25s (Exit code 0)** |
| `npm test` | DB + API Suite | 65 tests passing | **65/65 tests PASSED (Exit code 0)** |
