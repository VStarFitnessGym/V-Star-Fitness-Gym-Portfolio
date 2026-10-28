# Security Policy & Operational Security Baseline

## Gym Membership Management and Automated Notification System

**Document Version:** 1.0.0  
**Effective Date:** 2026-10-20  
**Security Lead:** Application Security Engineer & Cybersecurity Lead

---

### 1. Security Principles & Architecture Baseline

This project processes and stores customer personally identifiable information (PII) including legal names, mobile phone numbers, contact preferences, and membership payment records. All engineering work must adhere strictly to the following non-negotiable security baselines:

1. **Zero Client Trust:** The client browser is considered an untrusted execution environment. All business rules, date calculations, authorization boundaries, and data validations must be enforced at the serverless API layer and database engine.
2. **Multi-Tenant Row Level Security (RLS) & Function Privilege Hardening:** 
   - All database tables must have PostgreSQL Row Level Security enabled, enforcing tenant boundaries based on authenticated session claims (`auth.uid() = profiles.id`).
   - Every `SECURITY DEFINER` function (such as `current_user_gym_id()`, `cancel_stale_notification_jobs_on_renewal()`, and `claim_notification_jobs()`) must explicitly enforce `SET search_path = pg_catalog`, fully schema-qualify all referenced tables and types (`public.profiles`, `auth.uid()`), and explicitly revoke default `EXECUTE` privileges from `PUBLIC` and `anon`. Setting `search_path = public, pg_temp` alone is strictly prohibited as insufficient.
3. **Strict Secret Isolation:** 
   - Never prefix sensitive tokens (`SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN`, `SMS_API_KEY`, `CRON_SECRET`) with `VITE_`.
   - Never commit `.env` or configuration files containing real keys to version control.
   - All server-side secrets reside exclusively in encrypted hosting environment variables (Vercel).
4. **Cryptographic Ingress Verification:**
   - All inbound webhooks (Meta WhatsApp delivery receipts) must verify payload authenticity via HMAC-SHA256 signatures (`X-Hub-Signature-256`) against the application secret before processing. Buffer lengths must be verified identical before executing `crypto.timingSafeEqual()` to avoid uncaught exceptions.
   - All scheduled cron triggers must require an `Authorization: Bearer <CRON_SECRET>` header evaluated with constant-time string comparison (`crypto.timingSafeEqual`).
5. **Idempotency, Two-Phase Dispatch Intent & Concurrency Defenses:**
   - Scheduled reminder generation must utilize deterministic idempotency keys (`sha256(subscription_id + milestone + target_date)`) backed by a database unique constraint.
   - Queue workers must record durable dispatch intent (`status = 'dispatching'`) in `notification_attempts` BEFORE opening network sockets to messaging providers.
   - Worker lease reclaiming RPC (`claim_notification_jobs`) strictly excludes jobs with active dispatch intent to prevent duplicate external messaging upon worker timeouts.
   - Network timeouts on WhatsApp requests strictly prohibit SMS fallback and automated resends; attempts enter `unknown` awaiting asynchronous webhook reconciliation.
   - Subscription renewals must require client-generated UUID `idempotency_key` tokens and enforce database-level exclusion constraints (`no_overlapping_active_subscriptions`) using `btree_gist` to eliminate concurrent active coverage overlaps.
   - Workers must execute pre-dispatch verification immediately before invoking external APIs to ensure in-flight renewals or cancellations suppress stale alerts.
6. **Defensive CSV / Excel Sanitization:**
   - To prevent Spreadsheet Formula Injection attacks, any text exported to CSV starting with `=`, `+`, `-`, `@`, `\t`, or `\r` must be escaped by prefixing a single quote (`'`).
7. **Privacy & Regulatory Compliance (DPDP Act):**
   - Application runtime logs must never output customer phone numbers, emails, or personal notes in plaintext. Sensitive values must be masked (e.g., `+9198****3210`).
   - Customer communication preferences (`whatsapp_consent`, `sms_consent`) must be verified before initiating any outbound message dispatch.
   - Technical controls do not replace legal obligations; gym management must establish formal data retention schedules and grievance redressal contacts.

---

### 2. Known Open Security Risks & Operational Questions

The following risks and unresolved operational dependencies require external administrative action before production deployment:

| Risk / Dependency | Impact | Mitigation Strategy | Owner |
| :--- | :--- | :--- | :--- |
| **Meta Business Verification Delay** | WhatsApp Cloud API limits unverified businesses to 250 business-initiated conversations/24h and unverified phone numbers. | Initiate Meta Business Verification with legal registration docs (GST/PAN/MSME) immediately. | Gym Owner |
| **TRAI DLT Registration Lag** | In India, DLT Principal Entity and Template approval can take 7–14 business days. | Complete DLT registration early; fallback SMS cannot operate legally without approved DLT Template IDs. | Gym Owner / Admin |
| **Vercel Hobby Commercial Constraint** | Vercel terms of service restrict Hobby tier to non-commercial personal projects. Hobby tier also limits crons to 1/day. | Upgrade to Vercel Pro ($20/month) for commercial compliance and flexible scheduling, or utilize an external cron worker. | CTO / DevOps |
| **Supabase Free Tier Inactivity Pause** | Supabase free projects pause after 7 consecutive days of inactivity. | Automated daily reminder cron job guarantees database traffic, preventing idle project pausing. Upgrading to Pro ($25/mo) eliminates this risk. | DevOps Lead |
| **Emergency Turn-Off Switch** | High volume of erroneous messages could exhaust API credits or trigger Meta spam bans if a bug occurs. | Provide an immediate master kill-switch in `gym_settings.communication_settings.whatsapp_enabled = false` that halts all queue dispatches immediately. | Backend Lead |

---

### 3. Vulnerability Reporting & Responsible Disclosure

If you discover a security vulnerability in this project:
1. **Do not create a public GitHub issue.**
2. Report the vulnerability privately to the project technical lead or security contact.
3. Include:
   - Detailed description of the vulnerability and attack vector.
   - Step-by-step reproduction instructions or proof-of-concept payload.
   - Affected endpoints, tables, or components.
   - Potential impact on customer PII or system operations.
4. The engineering team will acknowledge receipt within 24 hours and provide an estimated remediation timeline.
