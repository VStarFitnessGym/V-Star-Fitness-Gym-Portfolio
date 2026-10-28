# Stage 5B: Official Provider Documentation & Architecture Decisions

**System:** FITFUSION Gym Membership Management System  
**Stage:** Stage 5B — Messaging Provider Integration (Safe, Testable, No Live Sends)  
**Workspace:** `D:\PROJECT\GYM MANGEMENT SYSTEM`  
**Date Verified:** 2026-10-20  
**Author:** Senior Backend & Messaging Infrastructure Engineer  

---

## 1. Verified Official Provider Documentation

All adapter request bodies, headers, status mapping, and webhook cryptographic validation logic in Stage 5B were built directly from current official technical documentation accessed on **2026-10-20**.

### 1.1 Meta WhatsApp Business Platform Cloud API (Graph API v21.0)

| Area | Official Documentation URL | Date Verified | Verified Technical Invariants |
| :--- | :--- | :--- | :--- |
| **API Overview & Versioning** | [Meta Cloud API Overview](https://developers.facebook.com/docs/whatsapp/cloud-api/overview) | 2026-10-20 | Graph API v21.0 endpoint: `https://graph.facebook.com/v21.0/{phone-number-id}/messages`. Standard REST POST over TLS 1.3. |
| **Authentication** | [Meta Business System User & Access Tokens](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started) | 2026-10-20 | System User Permanent Token passed via `Authorization: Bearer <TOKEN>`. Never logged or printed. |
| **Outbound Template Message Format** | [Sending Template Messages Guide](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates) | 2026-10-20 | Outside the 24-hour service conversation window, messages must be pre-approved templates (`messaging_product: "whatsapp"`, `type: "template"`, `template: { name, language: { code }, components: [...] }`). |
| **Phone Number Formats** | [Phone Numbers Formatting](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers) | 2026-10-20 | Recipient `to` field requires country code + subscriber digits with **no leading plus sign, hyphens, or brackets** (e.g. `919876543210` for India `+91 98765 43210`). |
| **Error Codes & Classifications** | [WhatsApp Cloud API Error Codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes) | 2026-10-20 | - `131030` / `131026`: Recipient not on WhatsApp or invalid phone number (Permanent Rejection).<br>- `132000` / `132001`: Template does not exist or parameter mismatch (Permanent Rejection).<br>- `130429` / `80007`: Rate limit hit / Throughput limit reached (Retryable Transient Rejection).<br>- `190` / `100`: Invalid access token or permission denied (Permanent Rejection / Alert). |
| **Delivery Status Webhooks** | [Webhooks Components & Fields](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components) | 2026-10-20 | Webhook statuses: `sent` (carrier received), `delivered` (device received), `read` (device opened), `failed` (delivery error). Includes error subcode object on failure. |
| **Webhook Cryptographic Verification** | [Meta Graph API Webhook Validation](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) | 2026-10-20 | Signature passed in `X-Hub-Signature-256: sha256=<hex_hmac>`. HMAC-SHA256 computed over raw body buffer using App Secret. Handshake requires `hub.mode=subscribe` and `hub.verify_token`. |

---

### 1.2 SMS Provider (Twilio REST API Reference as Primary Concrete Implementation)

| Area | Official Documentation URL | Date Verified | Verified Technical Invariants |
| :--- | :--- | :--- | :--- |
| **SMS Messages API** | [Twilio Messages Resource API](https://www.twilio.com/docs/sms/api/message-resource) | 2026-10-20 | Endpoint: `https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`. Content-Type: `application/x-www-form-urlencoded`. Parameters: `To`, `From`, `Body`. |
| **Authentication** | [Twilio HTTP Basic Authentication](https://www.twilio.com/docs/usage/api#http-authentication) | 2026-10-20 | HTTP Basic Auth header: `Authorization: Basic base64(AccountSid:AuthToken)`. |
| **Error Code Reference** | [Twilio SMS Error Code Catalog](https://www.twilio.com/docs/api/errors) | 2026-10-20 | - `21211`: Invalid 'To' Phone Number (Permanent Rejection).<br>- `21614`: Recipient cannot receive SMS / Landline (Permanent Rejection).<br>- `21408`: Permission to send an SMS has not been enabled for the region (Permanent Rejection).<br>- `20429`: Too Many Requests (Retryable Rejection).<br>- `30008`: Unknown error (Ambiguous/Reconciliation). |
| **Status Callback Lifecycle** | [Twilio Status Callbacks](https://www.twilio.com/docs/sms/outbound-message-status-callbacks) | 2026-10-20 | Lifecycle transitions: `queued` -> `sending` -> `sent` -> `delivered` / `undelivered` / `failed`. |

---

## 2. Key Architecture & Engineering Decisions

### Decision 1: Replacement and Abstraction of SMS Vendor (No Presumed Free SMS)
- **Problem:** Many marketing claims suggest SMS gateways are "free" or without restrictions. In reality, SMS in India (where the system timezone is Asia/Kolkata) is strictly regulated by the Telecom Regulatory Authority of India (TRAI) under Distributed Ledger Technology (DLT) regulations. Furthermore, commercial gateways (Twilio, AWS SNS, Gupshup, Fast2SMS) charge per 160-character segment and require registered sender IDs and approved template IDs (PE ID and Template ID).
- **Decision:** 
  1. We do not tie the codebase irreversibly to a single SMS vendor. We define the neutral interface `ISmsProviderAdapter` (in `server/services/reminders/providerTypes.ts`).
  2. The initial concrete adapter is `TwilioSmsAdapter` due to standard REST formatting and published deterministic status codes, but can be swapped for an Indian DLT-compliant gateway (e.g. Gupshup / ValueFirst) without modifying the reminder engine or dispatch orchestrator.
  3. No live account was provisioned or requested. All tests run against injected HTTP mock fakes.

### Decision 2: Zero Ambient-Credential Activation in Test Environments
- **Problem:** Ambient environment variables (e.g., from developer machines or CI environments) might accidentally activate live provider adapters and trigger real network calls or cost accrual.
- **Decision:**
  - `server/services/reminders/config.ts` enforces that if `NODE_ENV === 'test'` or `NODE_ENV === 'development'`, the default adapter mode is explicitly locked to `'mock'`.
  - To activate live adapters, `REMINDER_PROVIDER` must be explicitly set to `'whatsapp'` or `'sms'`, AND the environment must satisfy strict credential validations.
  - In unit and integration tests, adapters receive an injected mock `IHttpClient` that intercepts all calls in memory; zero outbound network sockets are ever created.

### Decision 3: E.164 Phone Number Formatting and Meta Discrepancy
- **Problem:** E.164 standard format includes a leading plus sign (e.g. `+919876543210`). However, Meta WhatsApp Business Cloud API requires `to` to contain country code digits without any `+`, spaces, or punctuation (e.g. `919876543210`), while SMS providers (like Twilio) expect the standard E.164 format with `+` (`+919876543210`).
- **Decision:**
  - Implemented `normalizeE164Phone(rawPhone, defaultCountryCode)` utility in `server/services/reminders/providerTypes.ts`.
  - `WhatsAppCloudApiAdapter` strips the leading `+` for Meta's payload: `to: normalizedPhone.replace(/^\+/, '')`.
  - `TwilioSmsAdapter` retains the standard `+` prefix: `To: normalizedPhone`.
  - Numbers failing 10-to-15 digit E.164 validation are rejected immediately with `permanent_rejection` prior to any HTTP attempt, saving network latency and avoiding unnecessary gateway charges.

### Decision 4: Idempotency, Out-of-Order Webhook Protection, and Terminal Status Monotonicity
- **Problem:** Network packet reordering, cellular retries, and asynchronous webhook delivery can cause status events to arrive out of order (e.g. a `delivered` event arriving before a `sent` event, or a delayed `sent` event arriving after handset `read`).
- **Decision:**
  - Established a strict status hierarchy integer in `whatsappWebhook.ts`:
    - `initiated (10)` < `dispatching (20)` < `sent (30)` < `delivered (40)` < `read (50)`.
  - Terminal failure states (`failed`, `undeliverable`) have a weight of `99`.
  - If an incoming webhook event has a lower rank than the attempt's current status in the database (e.g. an incoming `sent` event for an attempt already marked `delivered`), the update is safely ignored, maintaining monotonicity.
  - Every incoming webhook event ID is recorded in the `webhook_events` table with a unique constraint on `(provider, event_id)` for idempotent duplicate elimination.

### Decision 5: DPDP / Regulatory SMS Fallback Invariant
- **Problem:** WhatsApp delivery may fail due to cellular dead zones, uninstalled WhatsApp clients, or carrier blocks. Sending an SMS without consent violates the Digital Personal Data Protection Act (DPDP) and incurs commercial SMS billing.
- **Decision:**
  - SMS fallback is **strictly gated** in `DispatchOrchestrator`:
    1. Primary WhatsApp attempt must have a confirmed permanent failure (`failed_permanent` with `isPermanentFailure: true` or webhook `failed`).
    2. Member record must have `sms_consent === true`.
    3. The subscription must remain valid and unexpired/uncancelled at the moment of fallback.
  - If a WhatsApp request experiences an ambiguous timeout (`ambiguous_timeout`) or transient rate-limiting (`retryable_rejection`), SMS fallback is **strictly prohibited**. The job transitions to `reconciling` or `pending` with exponential backoff.

### Decision 6: Raw Request Buffer Retention for Cryptographic Signatures
- **Problem:** Meta sends an HMAC-SHA256 signature calculated over the exact raw bytes of the incoming webhook body in the `X-Hub-Signature-256` header. If Express parses the JSON body into an object and subsequently stringifies it, minor whitespace or key ordering changes invalidate the HMAC.
- **Decision:**
  - Configured `express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } })` in `server/app.ts`.
  - In `whatsappWebhook.ts`, `verifyWhatsAppWebhookSignature` computes `crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')` and compares it using `crypto.timingSafeEqual` to prevent timing attacks.

---

## 3. Provider Cost & Regulatory Matrix

| Factor | WhatsApp Business Cloud API | SMS (Indian DLT / Global Gateway) |
| :--- | :--- | :--- |
| **Pricing Model** | Utility Conversation Fee (per 24-hr session initiated by template). | Per 160-character segment (GSM-7) or 70-character segment (UCS-2). |
| **Regulatory Prerequisite** | Meta Business Verification + WhatsApp Business Account (WABA). | TRAI DLT Registration: Entity registration, Principal Entity ID (PE ID), Sender Header registration, Template registration. |
| **Template Approval** | Pre-approval required in Meta Business Manager for Utility category. | Pre-approval required on DLT portal before telecom operators permit transmission. |
| **Consent Requirement** | Explicit opt-in for transactional utility reminders. | Explicit consent under Indian DPDP Act & TRAI National Customer Preference Register (NCPR). |

---

## 4. Summary

All provider integrations are verified against real official specifications, locked behind secure interfaces, completely mocked in local tests, and strictly protected against ambient credential leakage or accidental live transmissions.
