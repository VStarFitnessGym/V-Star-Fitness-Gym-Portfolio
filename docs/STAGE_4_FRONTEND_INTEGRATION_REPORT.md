# Stage 4 Frontend API Client & Safe Demo/Live Modes Report

## Gym Membership Management and Automated Notification System

**Document Version:** 1.0.0  
**Status:** Implemented & Verified across Frontend and Backend  
**Architecture:** Typed React 18 / TypeScript Frontend + RFC 7807 Problem Details Client Layer  
**Mode Strategy:** Default Offline Demo Mode with Explicit Opt-In Live API Mode  
**Test Suite Status:** 28/28 Frontend Client Tests PASSED | 53/53 API Tests PASSED | 24/24 DB Tests PASSED (Total: 105/105, 100% Pass Rate)  
**Bundle Compilation:** Clean Production Bundle (`tsc && vite build`: 0 errors)

---

### 1. Executive Summary

Stage 4 integrates the FITFUSION React/TypeScript dashboard with the Stage 3 backend API through a typed, security-hardened client layer (`src/lib/api/`).

#### Key Achievements:
1. **Preserved Visual Identity & Design System:** The existing high-impact visual design, color tokens (`gym-yellow`, `#FFE500`, charcoal backgrounds), navigation, and component structure remain 100% intact.
2. **Explicit Demo vs. Live Mode Separation:** The application strictly defaults to **Demo Mode**, operating completely offline with synthetic data. An administrator can toggle into **Live API Mode** via an unobtrusive operational indicator bar in the dashboard.
3. **No Silent Fallback to Simulated Data:** If a live API call fails (network partition, 401 Unauthorized, 409 Conflict, or 500 error), the UI surfaces the specific error message with a retry option. It **never silently substitutes mock data**, avoiding any false impression that records were saved.
4. **RFC 7807 Problem Details Parsing & Zero Information Leakage:** Errors returned in `application/problem+json` format are cleanly transformed into user-friendly messages. Stack traces, raw SQL queries, and internal server paths are never displayed to the user.
5. **UUID Idempotency Key Preservation Across Retries:** When renewing a membership, a fresh RFC 4122 v4 UUID idempotency key is generated. If network uncertainty, a timeout, or a transient failure occurs, retrying the operation **reuses the exact same idempotency key**, guaranteeing zero duplicate renewal lineage or multiple charges.
6. **Zero Browser Credential Storage:** Tokens are held strictly in memory; bearer tokens are never written to `localStorage` or `sessionStorage`.

---

### 2. Frontend API Client Architecture (`src/lib/api/`)

The API layer is organized into modular, typed files matching repository conventions:

```
src/lib/
├── api/
│   ├── client.ts       # Typed FitFusionApiClient with abort timeout & fetch wrapper
│   ├── errors.ts       # ApiClientError class with RFC 7807 problem details parsing
│   └── types.ts        # TypeScript contracts for all Stage 3 endpoints & RFC 7807 responses
└── config/
    └── mode.ts         # Mode selector (demo vs. live) and environment configuration
```

#### Endpoints Covered:
- `GET /api/health` -> `apiClient.getHealth()`
- `GET /api/me` -> `apiClient.getMe()`
- `GET /api/members` -> `apiClient.getMembers({ page, limit, status, search, sort_by, sort_order })`
- `POST /api/subscriptions/renew` -> `apiClient.renewSubscription({ member_id, plan_id, amount_paid, payment_method, idempotency_key, start_date, notes })`

#### Timeout & Error Handling:
- **Default Timeout:** 10,000ms using `AbortController`.
- **Timeout Handling:** Maps abort signals to HTTP 408 with actionable user messaging explaining that the outcome is uncertain and offering a safe retry using the preserved idempotency key.
- **Validation Errors:** Extracts and displays field-level issues from RFC 7807 `invalidParams`.

---

### 3. Demo Mode vs. Live Mode Strategy

| Dimension | Demo Mode (Default) | Live API Mode (Explicit Opt-In) |
| :--- | :--- | :--- |
| **Data Source** | In-memory synthetic dataset (`INITIAL_MEMBERS`, `INITIAL_STATS`). | Real-time REST endpoints (`/api/members`, `/api/subscriptions/renew`). |
| **Authentication** | Offline simulated access for evaluation. | Requires valid staff JWT Bearer token in memory. |
| **Failure Behavior** | N/A (all operations succeed in local memory). | Displays specific error banner with code, request ID, and retry button; **never falls back to mock data**. |
| **Top Banner Indicator** | Yellow bar: `DEMO MODE • Simulated DB & Offline Synthetic Data`. | Dark charcoal & emerald bar: `LIVE API MODE • Connected to /api (Stage 3 Backend Active)`. |
| **Mode Switcher** | Button: `Switch to Live API Mode`. | Button: `Switch to Demo Mode`. |
| **Safe Initialization** | Defaults to `demo` unless `VITE_APP_MODE=live` is explicitly set in `.env`. | Enabled by administrator toggle or explicit configuration. |

---

### 4. Integration Points in Existing Components

#### A. Member Directory (`src/components/dashboard/MemberManagement.tsx`)
- **Live Mode Fetching:** When in live mode, queries `GET /api/members` with debounced search, status filter pills, and server-side pagination.
- **Loading Skeleton:** Displays animated spinner with `aria-live="polite"` during live network round-trips.
- **Error States:** Shows an alert banner with `error.getUserMessage()`, request ID, and a "Retry" button if live querying fails. If HTTP 401 Unauthorized occurs, explains that staff credentials are required.
- **Pagination:** Renders previous/next pagination controls dynamically based on server pagination metadata (`total`, `page`, `total_pages`).

#### B. Subscription Renewal Modal (`src/components/dashboard/RenewalModal.tsx`)
- **Idempotency Lifecycle:** Generates a fresh RFC 4122 v4 UUID (`crypto.randomUUID()`) when the modal opens.
- **Duplicate Protection:** Disables all inputs and submit button during in-flight submission (`isSubmitting = true`).
- **Retry Invariant:** If a network timeout or error occurs, the modal retains the **exact same idempotency key** so the retry request is recognized by the server as an idempotent replay rather than a new duplicate charge.
- **Server Confirmation Display:** On 200/201 success, displays confirmed `subscription_id`, active date ranges (`start_date` to `end_date`), and flags whether the response was an idempotent replay (`idempotent_replay: true`).
- **Ledger Notice:** States clearly: *"Membership term successfully updated in system ledger. (Note: No external payment gateway was charged)."*

#### C. Dashboard Layout (`src/components/dashboard/DashboardLayout.tsx`)
- Contains the interactive mode selector banner at the top of the administrative view.
- Passes the active mode into `MemberManagement` and `RenewalModal`.

---

### 5. Verification & Test Commands

All test suites and build scripts execute cleanly:

```powershell
# 1. Frontend API Client & Mode Isolation Test Suite
npm run test:frontend
# Result: 28/28 PASSED (Exit code 0)

# 2. Database Integration & RLS Test Suite
npm run test:db
# Result: 24/24 PASSED (Exit code 0)

# 3. Server API Integration & Security Test Suite
npm run test:api
# Result: 53/53 PASSED (Exit code 0)

# 4. Comprehensive Test Suite (DB + API + Frontend)
npm test
# Result: 105/105 PASSED (Exit code 0)

# 5. Server TypeScript Check
npm run typecheck:server
# Result: 0 errors (Exit code 0)

# 6. Production Frontend Bundle Build
npm run build
# Result: 1602 modules transformed, 0 errors, built in 2.26s (Exit code 0)
```

---

### 6. Created & Modified Files

| File Path | Description |
| :--- | :--- |
| `src/lib/api/types.ts` | TypeScript response and request contracts matching Stage 3 controllers and RFC 7807 errors. |
| `src/lib/api/errors.ts` | `ApiClientError` class with safe error parsing and user message formatting. |
| `src/lib/api/client.ts` | `FitFusionApiClient` with timeout abort controllers, in-memory token provider, and endpoint methods. |
| `src/lib/config/mode.ts` | Safe environment mode detector (`demo` vs. `live`). |
| `src/components/dashboard/RenewalModal.tsx` | Updated renewal modal with UUID idempotency, retry preservation, and server confirmation display. |
| `src/components/dashboard/MemberManagement.tsx` | Updated member table with live API queries, loading skeletons, error banners, and pagination. |
| `src/components/dashboard/DashboardLayout.tsx` | Added operational mode banner and mode toggle button. |
| `src/App.tsx` | Centralized `appMode` state and passed toggle handler to `DashboardLayout`. |
| `tests/frontend/api_client_test.ts` | 28-assertion automated frontend client and mode isolation test suite. |
| `package.json` | Added `test:frontend` and updated `test` command to run all suites. |

---

### 7. Explicit Authentication Limitations & Supabase Dependencies

In strict compliance with safety boundaries:
1. **Live Hosted Supabase Authentication:** Because credentials for a remote Supabase project are not configured and live connection is prohibited in this stage, the frontend does not pretend that an authenticated session exists in live mode. Calling protected live endpoints without providing an in-memory token produces an explicit HTTP 401 Unauthorized error explaining that staff authentication is required.
2. **Third-Party Messaging Gateways:** Meta WhatsApp Cloud API and Indian SMS gateway integrations remain uncalled placeholders, scheduled for Stage 5.
3. **No Browser Storage of Credentials:** Tokens are strictly forbidden from being stored in `localStorage` or cookies without a secure auth provider, adhering to the project's zero-trust threat model.
