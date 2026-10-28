# Product Requirements Document (PRD)

## Gym Membership Management and Automated Notification System

**Document Version:** 1.0.0  
**Status:** Approved for Technical Architecture  
**Target Organization:** Independent & Boutique Fitness Centers (~100 members initial, scaling to 1,000+)  
**Primary Business Timezone:** `Asia/Kolkata` (IST, UTC+05:30)  
**Security Classification:** Restricted (Contains Customer PII & Communication Consents)

---

### 1. Executive Summary & Problem Statement

Independent gym owners and fitness club managers in India frequently manage member registrations, renewals, and expiry alerts using ad-hoc tools such as manual notebooks, disparate spreadsheets (Google Sheets / Excel), or consumer messaging apps. This operational model leads to:
1. **Revenue Leakage:** Members continue working out past subscription expiry because manual follow-ups are inconsistent.
2. **Operational Overhead:** Staff spend 1–2 hours daily cross-referencing dates and sending manual WhatsApp messages.
3. **Data Loss & Concurrency Conflicts:** Simultaneous spreadsheet edits lead to overwritten notes, lost records, and accidental double-reminders.
4. **Compliance & Privacy Violations:** Unregulated mass messaging without recorded consent risks Meta WhatsApp phone number bans, TRAI DLT regulatory violations, and Indian Digital Personal Data Protection (DPDP) Act non-compliance.

This system provides a centralized, secure, web-based administrative dashboard for gym owners and staff to manage members, configure membership plans, manage continuous subscription lifecycles, and execute an automated, auditable notification engine utilizing the **Meta WhatsApp Cloud API** with **Indian DLT-compliant SMS fallback**.

---

### 2. Stakeholders & User Personas

| Role | Profile | Key Goals | Pain Points & Constraints |
| :--- | :--- | :--- | :--- |
| **Gym Owner / Admin** | Primary business owner managing financials, staff, and customer relationships. | Maximizing membership retention, minimizing churn, maintaining zero operational friction. | Non-technical; needs high reliability, clear dashboards, and zero recurring surprise costs. |
| **Gym Front-Desk Staff** | Operations staff handling member check-ins, new registrations, and cash/UPI renewals. | Quick member lookup by phone or name, one-click renewal recording, instant reminder previews. | High foot-traffic environment; cannot tolerate slow UI, confusing forms, or broken workflows. |
| **Gym Member (Passive)** | Customer working out at the gym; recipient of automated expiry notifications. | Timely, respectful reminder messages on WhatsApp with clear renewal instructions. | Annoyed by spam, duplicate alerts, or messages sent after already paying/renewing. |

---

### 3. Business Scope & Boundaries

#### In Scope (V1 MVP)
- Role-based administrative dashboard (Single-tenant gym operations).
- Member management with full PII lifecycle (Active, Expiring, Expired, Archived).
- Membership plan catalog (custom duration, pricing, descriptions).
- Subscription lifecycle tracking with non-destructive renewal history.
- Automatic invalidation of pending reminders upon subscription renewal or extension.
- Three-tier automated reminder schedule (-3 days, 0 days, +3 days).
- Official Meta WhatsApp Cloud API integration with template messaging.
- Resilient Indian SMS fallback adapter (DLT-compliant) triggered strictly on verified WhatsApp delivery failure.
- Configurable business hours (default 10:00 AM IST) preventing late-night messaging.
- Bidirectional WhatsApp webhook ingestion for real-time delivery receipts (Sent, Delivered, Read, Failed).
- CSV / Excel import and export with formula injection sanitization.
- Audit logging for administrative actions and outbound communications.

#### Explicitly Out of Scope for V1
- *Public customer-facing membership portal or mobile app* (Admin and staff only).
- *Integrated payment gateway checkout (e.g., Razorpay / Stripe)*: Renewals record payment method (Cash, UPI, Card, Transfer) as metadata, but do not process card authorizations.
- *Biometric turnstile / RFID gate hardware integration*.
- *Staff payroll, trainer commission tracking, and workout plan builders*.

---

### 4. Functional Requirements

#### Module A: Admin Dashboard & Operational Telemetry
1. **Core KPI Cards:**
   - **Total Members:** Total count of non-archived members.
   - **Active Memberships:** Count of members with a currently valid subscription.
   - **Expiring Soon:** Members whose subscription expires within the next 7 days.
   - **Expired Memberships:** Members whose subscription has lapsed without renewal.
2. **Notification Telemetry Cards (Today's Window):**
   - **Scheduled / Pending:** Notifications queued for dispatch today.
   - **Successfully Delivered:** Messages confirmed delivered (WhatsApp/SMS receipts).
   - **Definitive Failures:** Messages that failed delivery across all channels.
3. **Operational Alert Banners:**
   - Unconfigured integration banners (e.g., "Meta WhatsApp API token missing", "SMS DLT credentials not set").
   - Actionable alert for dead-letter notification failures requiring staff attention.
4. **Recent Activity Feed:** Real-time stream of member additions, subscription renewals, and automated message dispatches.
5. **UI States:** Explicit visual representations for Loading (skeletons), Empty (first-time onboarding guidance), and Error states with retry capability.

#### Module B: Member Management & Contact Preferences
1. **Member Attributes:**
   - Unique Member Identifier (e.g., `GYM-2026-0001` or auto-incrementing gym sequence).
   - Full Legal Name.
   - Primary Mobile Number in standardized E.164 format (e.g., `+919876543210`).
   - Email Address (optional, RFC 5322 compliant).
   - Emergency Contact Name & Phone (optional).
   - Date of Birth & Gender (optional).
   - Administrative Notes (medical conditions, fitness goals).
   - Member Status: `Active`, `Expiring`, `Expired`, `Archived`.
2. **Consent & Regulatory Preferences:**
   - WhatsApp Communication Consent: Boolean flag, timestamp of opt-in, consent acquisition source (e.g., "Paper Registration Form", "Staff Portal Checkbox").
   - SMS Communication Consent: Boolean flag, timestamp of opt-in, consent acquisition source.
   - Opt-out Support: Instant revocation capability upon customer request or incoming WhatsApp "STOP" message.
3. **Data Integrity & Uniqueness:**
   - Strict database-enforced uniqueness on normalized mobile numbers per gym account.
   - Validation ensuring phone numbers match valid national numbering plans (10-digit Indian mobile numbers prefixed with country code `+91`).
4. **Bulk Import & Export:**
   - Downloadable CSV/Excel template with exact column constraints.
   - Client-side dry-run parsing showing valid rows, invalid formats, and duplicates before committing to the database.
   - Defensive CSV sanitization neutralizing spreadsheet formula execution attacks (stripping or quoting `=`, `+`, `-`, `@`, `\t`, `\r`).

#### Module C: Membership Plans & Subscription Lifecycle
1. **Membership Plan Catalog:**
   - Plan Name (e.g., "1 Month Standard", "3 Months Quarterly", "Annual Gold").
   - Duration value and unit (e.g., 30 Days, 90 Days, 365 Days).
   - Base Price in INR (`₹`).
   - Description and list of included gym perks.
   - Status (`Active`, `Archived`). Archived plans cannot be assigned to new subscriptions but retain historical references.
2. **Subscription Lifecycle & Renewal Rules:**
   - Every member has one active subscription at a given time, but maintains an immutable historical ledger of all prior subscriptions.
   - **Database-Enforced Non-Overlap Invariant (INV-SUB-01):** The database enforces an exclusion constraint (`no_overlapping_active_subscriptions` via `btree_gist`) ensuring that no two `active` subscriptions for the same member can have overlapping date ranges (`daterange(start_date, end_date, '[]')`).
   - **Renewal Process & Contiguous Coverage:**
     - Selecting "Renew Membership" requires a client-generated UUID `idempotency_key` and creates a new `subscriptions` record referencing the member, plan, payment method, and staff `created_by`.
     - If renewed *before* current expiry: New start date defaults automatically to `current_active_end_date + 1 day`.
     - If renewed *after* current expiry (lapsed): New start date defaults to `today` or a staff-designated non-overlapping start date.
   - **Non-Destructive Guarantee:** Updating or renewing a subscription *never* overwrites prior subscription dates, preserving full financial and attendance audit trails.
   - **Automated Queue Invalidation:** When a renewal or manual expiry extension is saved, a database trigger (`cancel_stale_notification_jobs_on_renewal`) immediately updates any existing `pending` notification jobs associated with prior subscriptions to `cancelled`.

#### Module D: Automated Expiry Reminder Engine
1. **Reminder Milestones & Timezone Semantics:**
   - **T-3 Days:** Friendly early reminder 3 days prior to expiration (`target_date = end_date - 3 days`).
   - **T-0 Days:** Action-oriented reminder on the day of expiration (`target_date = end_date`).
   - **T+3 Days:** Grace-period follow-up 3 days after expiration (`target_date = end_date + 3 days`).
   - **Business Timezone:** Configurable per gym (`gym_settings.timezone`), defaulting to `Asia/Kolkata` (IST, UTC+05:30). Note: India does not observe Daylight Saving Time (fixed UTC+05:30 offset).
   - **Daily Dispatch Window:** Evaluated daily during business hours (default 10:00 AM local time).
   - **Staleness & Overdue Policy (Missed Cron Recovery):** If a cron job fails or is delayed and a reminder job's `target_date` is more than 24 hours in the past, or if the member has already reached a subsequent milestone, the overdue job is marked `skipped` with reason `milestone_overdue_stale` to prevent sending confusing, obsolete alerts.
2. **Scheduling, Concurrency & Idempotency Rules:**
   - **No Exactly-Once Delivery Promise:** Across distributed networks, carriers, and third-party APIs, exactly-once delivery cannot be guaranteed (Two Generals' Problem). The system guarantees:
     1. *At-most-once job creation* in the database via deterministic idempotency keys (`UNIQUE(idempotency_key)`).
     2. *At-least-once dispatch attempt* from the queue worker using atomic row locking (`FOR UPDATE SKIP LOCKED`) and guarded lease recovery.
     3. *Upstream deduplication* via Meta message IDs and SMS provider client references. Note: Meta WhatsApp Cloud API does not accept client-supplied HTTP idempotency keys; duplicate prevention requires software-level intent guards.
   - **Idempotency Guarantee:** Every scheduled reminder job generates a deterministic idempotency key combining `subscription_id`, `milestone_code` (`EXPIRY_MINUS_3`, `EXPIRY_ZERO`, `EXPIRY_PLUS_3`), and `target_date`:
     `idempotency_key = sha256(subscription_id + milestone + target_date)`
   - **Two-Phase Dispatch Intent & Guarded Lease Recovery:**
     - Workers claim jobs and record durable dispatch intent (`status = 'dispatching'`) in `notification_attempts` BEFORE opening network sockets.
     - A lease expiration does NOT authorize resending a message if an attempt was recorded. Orphaned leases with active dispatch intent transition to `reconciling` and are never resent.
3. **Decoupled Lifecycle States:**
   - **Job Lifecycle (`notification_jobs`):**
     - `pending`: Scheduled and waiting for dispatch window.
     - `claimed`: Leased by a worker process performing pre-dispatch checks.
     - `dispatching`: Pre-dispatch checks passed, durable intent recorded, external call in flight.
     - `reconciling`: Ambiguous outcome (timeout or crash) awaiting asynchronous delivery webhook.
     - `completed`: Successfully acknowledged by provider or confirmed via delivery webhook.
     - `failed`: Terminal failure across primary and all fallback channels after max retries.
     - `skipped`: Discarded prior to dispatch due to opt-out, stale milestone, or prior renewal.
     - `cancelled`: Revoked because subscription was renewed or manually adjusted before dispatch.
   - **Attempt Lifecycle (`notification_attempts`):**
     - `initiated`: Outbound payload prepared.
     - `dispatching`: Durable intent persisted in database prior to TCP socket opening.
     - `sent`: Acknowledged by provider gateway (HTTP 200/202) with `wamid` captured.
     - `delivered`: Carrier delivery receipt confirmed via webhook.
     - `read`: Member opened/read receipt confirmed via webhook.
     - `failed_permanent`: Provider rejected message or carrier returned definitive failure (e.g. 131026).
     - `failed_transient`: Provider returned 429/503 rate limit with retry-after.
     - `unknown`: Network timeout or socket drop; strictly prohibits automated resend or SMS fallback.
     - `unconfirmed_stale`: 24-hour reconciliation sweeper finalized attempt without duplicate dispatch.
4. **Renewal Races & Stale Reminder Suppression:**
   - **Authoritative Subscription:** The active subscription with the furthest `end_date` is the single source of truth for membership status.
   - **Pre-Dispatch Verification:** Immediately before issuing an external API request, the worker re-queries the member's current active subscription. If renewed, extended, or cancelled after the job was claimed, dispatch is aborted and the job is marked `cancelled`.
   - **In-Flight Dispatches:** If a renewal occurs while an external provider request is in-flight across the wire, the message cannot be recalled. The worker records the attempt, but subsequent milestone jobs for the old subscription are suppressed.
   - **Concurrent Renewal Locks:** Staff renewals acquire an exclusive row lock on the member record (`SELECT ... FOR UPDATE`), serializing concurrent renewal attempts and preventing race conditions.
5. **Manual Trigger & Previews:**
   - Staff can preview the exact rendered template text and target phone number before sending.
   - Staff can trigger an authorized on-demand reminder with rate limiting (max 1 manual reminder per member per 24 hours).

#### Module E: Meta WhatsApp Cloud API Integration
1. **Architecture:** Direct integration with Meta Graph API (`v21.0+`) using business-initiated Template Messages in the `UTILITY` category.
2. **Template Management:**
   - Uses pre-approved Meta message templates.
   - Supports required dynamic template parameters: `{{1}}` = Member Name, `{{2}}` = Gym Name, `{{3}}` = Plan Name, `{{4}}` = Expiry Date.
3. **Webhook Ingestion & Delivery Receipts:**
   - HTTP GET endpoint for Meta Webhook Hub verification handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`).
   - HTTP POST endpoint validating payload integrity using HMAC-SHA256 signature (`X-Hub-Signature-256`) against Meta App Secret.
   - **Out-of-Order Webhook Protection:** Status transitions follow a strict monotonic state machine (`read` > `delivered` > `sent` > `initiated`). Out-of-order receipts cannot downgrade a delivered state.
   - **Reconciliation & Unconfirmed Receipts:** If no delivery receipt webhook arrives within 24 hours of dispatch, the attempt remains marked `sent` (delivery unconfirmed). The system does NOT blindly trigger fallback SMS on missing webhooks.

#### Module F: SMS Fallback Engine (Indian DLT-Compliant)
1. **Architecture:** Pluggable adapter interface (`SmsProviderAdapter`) supporting major Indian aggregators (e.g., Fast2SMS, MSG91).
2. **DLT Regulatory Compliance (TRAI Mandate):**
   - Registered Principal Entity ID (PE ID).
   - Registered 6-character Alpha Sender Header (e.g., `GYMREG`).
   - Registered DLT Content Template ID with variable mapping matching the telecommunication registry.
3. **Strict Fallback Policy Rules:**
   - SMS is **never** sent primarily or concurrently with WhatsApp.
   - SMS is dispatched **strictly** when:
     1. WhatsApp dispatch returned an immediate **permanent error code** (e.g., Meta Code `131026` "Message Undeliverable / Recipient not on WhatsApp", Code `131000` "Invalid Parameter", or Code `100` "Invalid Phone Number"), OR
     2. WhatsApp delivery receipt webhook explicitly returns terminal status `failed` with a permanent delivery failure reason.
     3. AND the member has active `sms_consent = true`.
   - **Network Timeout Prohibition:** If a WhatsApp API request times out or returns a transient 5xx server error, the state is classified as `unknown`. SMS fallback is **strictly prohibited** in this state to avoid duplicate messaging.

#### Module G: Settings, Integrations & Audit Logging
1. **Gym Business Profile:** Organization name, support phone, address, currency symbol (`₹`), and operational timezone.
2. **Integration Health Cards:** Visual dashboard showing status (Connected, Not Configured, Authentication Failed) for WhatsApp Cloud API and SMS Gateway.
3. **Comprehensive Audit Log:**
   - Tamper-evident record of all staff actions: login, member creation, subscription renewal, manual message dispatch, export generation.
   - Captures Actor User ID, IP address, timestamp, event type, and before/after JSON diff.

---

### 5. Non-Functional Requirements (NFRs)

| Category | Requirement | Target Metric |
| :--- | :--- | :--- |
| **Availability** | Web dashboard uptime during normal business hours (06:00 to 22:00 IST). | 99.5% availability |
| **Performance** | Dashboard and member list initial page load over standard 4G broadband. | First Contentful Paint < 1.2s; LCP < 2.0s |
| **Database Scalability** | Smooth query execution for member search and pagination. | < 100ms response time for up to 10,000 members |
| **Security & Privacy** | Protection of member PII (names, phone numbers, attendance notes). | RLS-enforced multi-tenant isolation, encrypted secrets |
| **Compliance** | Compliance with Indian DPDP Act 2023 and TRAI Telecom Commercial Communications Customer Preference Regulations (TCCCPR). | Explicit opt-in timestamping, DLT template mapping |
| **Idempotency** | Guarantee against sending duplicate reminder messages. | Exactly-one attempt per milestone per subscription |

---

### 6. User Acceptance Criteria (UAC) Matrix

- **UAC-01:** Adding a member with an existing phone number displays a clear validation error and prevents database insertion.
- **UAC-02:** When a membership plan is renewed, the previous subscription record remains intact and visible in the member's history tab.
- **UAC-03:** When an expired member is renewed, all existing `pending` reminder jobs for that member immediately transition to `cancelled`.
- **UAC-04:** Daily cron job execution triggers at 10:00 AM IST and generates reminder jobs matching the T-3, T-0, and T+3 rules without generating duplicate records upon rerun.
- **UAC-05:** Meta WhatsApp webhook updates internal job status to `delivered` within 5 seconds of receipt without throwing unhandled exceptions.
- **UAC-06:** SMS fallback is triggered exclusively if WhatsApp fails with a permanent error code and the member has SMS consent enabled.
- **UAC-07:** Exporting member data to CSV sanitizes any leading spreadsheet formula characters (`=`, `+`, `-`, `@`).
