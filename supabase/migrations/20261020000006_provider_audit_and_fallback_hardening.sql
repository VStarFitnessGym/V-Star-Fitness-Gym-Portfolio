-- ============================================================================
-- Stage 5B Remediation: Provider Audit & Fallback Hardening Migration
-- Enforces:
--  1. Unique SMS dispatch per job (strictly prevents duplicate SMS fallback)
--  2. Indexes for attempt status and webhook deduplication audit
-- ============================================================================

-- 1. Ensure at most ONE SMS attempt per notification job (fallback or direct)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_attempts_sms_unique 
ON public.notification_attempts (job_id) 
WHERE channel = 'sms';

-- 2. Index attempt status for fast query filtering during lease sweeps and webhook lookups
CREATE INDEX IF NOT EXISTS idx_notification_attempts_status 
ON public.notification_attempts (status);

-- 3. Document webhook_events verification and index sanity
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_received 
ON public.webhook_events (provider, received_at);
