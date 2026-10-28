# FITFUSION GYM MANAGEMENT SYSTEM — STAGE 5C DEPLOYMENT CHECKLIST

**Document Version:** 1.0.0  
**Date:** 2026-10-21  
**Target Environment:** Production Node.js Server + Hosted Supabase (PostgreSQL 15+)  
**Scope:** Stage 5C Automated Cron Infrastructure, APIs, and Frontend Deployment

---

## 1. Overview & Pre-Requisites

This checklist outlines the exact sequence required to safely deploy the Stage 5C reminder automation, cron endpoints, and management interfaces to staging and production environments.

Stage 5C requires zero additional database schema migrations beyond `20261020000006_provider_audit_and_fallback_hardening.sql`. However, it introduces mandatory environment configuration and external scheduler integration.

---

## 2. Environment Variables & Secret Configuration

Ensure the following environment variables are securely populated in the production environment (e.g., AWS Secrets Manager, Doppler, Vault, or Railway/Render environment settings):

| Variable Name | Required | Example / Format | Purpose | Security Notes |
| :--- | :--- | :--- | :--- | :--- |
| `CRON_SECRET` | **YES** | `hex64` or `base64(32 bytes)` | Authenticates cron callers to `POST /api/cron/reminders` | High entropy (min 32 bytes). Never commit to source code. |
| `NODE_ENV` | **YES** | `production` | Enforces production security headers and error masking | Disables debug stack traces in RFC 7807 problem responses. |
| `PORT` | Optional | `3001` (Default: `3001`) | Server listening port | Managed by container orchestrator or process manager. |
| `DATABASE_URL` | **YES** | `postgresql://postgres:[PWD]@db.[REF].supabase.co:5432/postgres` | PostgreSQL connection pool | Use connection pooling port (6543) or direct port (5432) with SSL. |
| `JWT_SECRET` | **YES** | `hex64` | Verifies staff bearer tokens | Must match token issuance service. |
| `WHATSAPP_TOKEN` | Optional | `EAA...` | Meta Graph API access token | Required only when live WhatsApp dispatch is active. |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional | `1029384756` | Meta sender phone ID | Must be verified in Meta Business Manager. |
| `PINPOINT_APP_ID` | Optional | `abcdef123456...` | AWS Pinpoint Project ID | Required for SMS fallback in India/global. |
| `AWS_REGION` | Optional | `ap-south-1` | AWS region for Pinpoint SMS | Pinpoint project region (e.g., Mumbai `ap-south-1`). |

---

## 3. Database Verification & Sync Steps

Before booting the new application code:

1. **Verify Existing Migrations in Target Supabase Database:**
   ```sql
   -- Verify all 6 migrations exist in schema_migrations or applied history
   SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
   ```
   Ensure `20261020000006_provider_audit_and_fallback_hardening` is applied.
2. **Verify Required Indexes:**
   ```sql
   -- Verify index supporting reminder candidate queries
   SELECT indexname, indexdef FROM pg_indexes 
   WHERE tablename = 'reminder_jobs' 
     AND indexname IN ('idx_reminder_jobs_status_scheduled', 'idx_reminder_jobs_gym_status');
   ```
3. **Verify PostgreSQL Transaction Advisory Locks:**
   Ensure database user permissions grant execution of `pg_try_advisory_xact_lock()`. Standard Supabase `postgres` and `service_role` accounts have this privilege enabled by default.

---

## 4. External Cron Scheduler Setup

`POST /api/cron/reminders` must be invoked on a recurring schedule by an external scheduler.

### Recommended Schedule:
- **Frequency:** Every 10 minutes (`*/10 * * * *`) or Every 15 minutes (`*/15 * * * *`).

### Option A: Hosted Cloud Scheduler (AWS EventBridge / Google Cloud Scheduler)
- **Target URL:** `https://api.yourfitfusiondomain.com/api/cron/reminders`
- **HTTP Method:** `POST`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <PROD_CRON_SECRET>`
- **Payload:** `{}`
- **Retry Policy:** 0 retries on HTTP 4xx; max 1 retry on HTTP 5xx with exponential backoff.

### Option B: Supabase `pg_cron` with `pg_net` (Direct Database Scheduler)
If running directly inside Supabase without an external runner:
```sql
SELECT cron.schedule(
  'fitfusion-reminder-cron',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://api.yourfitfusiondomain.com/api/cron/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'YOUR_PROD_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

---

## 5. Reverse Proxy & Networking Configuration (Nginx / Cloudflare / ALB)

1. **TLS / HTTPS Enforced:**
   - All external incoming requests must terminate TLS 1.3 or 1.2 with strict transport security (`HSTS`). Plain HTTP calls to `/api/cron/*` or `/api/reminders/*` must be redirected to HTTPS.
2. **Header Preservation:**
   - Ensure the reverse proxy forwards the standard `Authorization` header intact.
   - Forward `X-Forwarded-For` and `X-Real-IP` so audit log records capture true client IPs.
3. **Request Timeout:**
   - Set proxy read timeout to at least 60 seconds (default batch run typically completes in 500ms–2000ms, but bounded batch claiming up to 50 jobs with provider latency requires headroom).

---

## 6. Pre-Flight Verification & Health Check

After deployment, perform these sequential checks:

1. **Server Health Probe:**
   ```bash
   curl -I https://api.yourfitfusiondomain.com/health
   # Expected: HTTP 200 OK
   ```
2. **Cron Authentication Denial Check:**
   ```bash
   curl -X POST https://api.yourfitfusiondomain.com/api/cron/reminders
   # Expected: HTTP 401 Unauthorized, problem details "UNAUTHORIZED_CRON"
   ```
3. **Cron Authentication Invalid Secret Check:**
   ```bash
   curl -X POST https://api.yourfitfusiondomain.com/api/cron/reminders \
     -H "Authorization: Bearer invalid-secret-token"
   # Expected: HTTP 401 Unauthorized
   ```
4. **Authorized Cron Probe:**
   ```bash
   curl -X POST https://api.yourfitfusiondomain.com/api/cron/reminders \
     -H "Authorization: Bearer $PROD_CRON_SECRET"
   # Expected: HTTP 200 OK
   # Payload: { "status": "success", "scheduler": { ... }, "worker": { ... } }
   ```
5. **Staff Reminders API Probe:**
   - Log into the dashboard as a staff member.
   - Navigate to `/dashboard/reminders`.
   - Verify telemetry KPI cards populate with live counts.
   - Verify pagination and status filters load without browser console errors.

---

## 7. Rollback Procedure

If unexpected runtime anomalies occur after deployment:

1. **Immediate Scheduler Pause:**
   Disable the external scheduler (pause Cloud Scheduler / comment out `pg_cron` schedule) to halt automated worker runs immediately.
2. **Application Reversion:**
   Roll back container / deployment image to the previous build tag (Stage 5B-B).
3. **Database Compatibility:**
   Because Stage 5C introduced no schema alterations, rolling back application code does not require any database rollback or column removals. All tables (`reminder_jobs`, `notification_attempts`, `audit_logs`) remain 100% backward-compatible.
