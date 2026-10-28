-- ============================================================================
-- Migration: 20261020000002_functions_and_triggers.sql
-- Description: Hardened Database Functions, Least-Privilege Execution Model,
--              Renewal Stale Reminder Invalidation, and Worker Queue Claiming RPC
-- Engine: PostgreSQL 15+ (Supabase)
-- ============================================================================

-- ============================================================================
-- 1. Helper Function: current_user_gym_id()
-- Hardened against search_path hijacking, object shadowing, and unauthorized RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_user_gym_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Strip search_path to pg_catalog only; prevents temp table & operator hijacking
SET search_path = pg_catalog
AS $$
    -- Explicitly qualify schema and system functions
    SELECT p.gym_id 
    FROM public.profiles p
    WHERE p.id = (auth.uid())
    LIMIT 1;
$$;

-- Revoke default public execution rights
REVOKE ALL ON FUNCTION public.current_user_gym_id() FROM PUBLIC;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.current_user_gym_id() FROM anon;
EXCEPTION WHEN OTHERS THEN null;
END $$;

-- Grant execution strictly to authenticated staff and backend service role
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.current_user_gym_id() TO authenticated;
EXCEPTION WHEN OTHERS THEN null;
END $$;

DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.current_user_gym_id() TO service_role;
EXCEPTION WHEN OTHERS THEN null;
END $$;


-- ============================================================================
-- 1B. Helper Function: current_user_role()
-- Hardened against search_path hijacking, object shadowing, and RLS recursion
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT p.role 
    FROM public.profiles p
    WHERE p.id = (auth.uid())
    LIMIT 1;
$$;

-- Revoke default public execution rights
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.current_user_role() FROM anon;
EXCEPTION WHEN OTHERS THEN null;
END $$;

DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
EXCEPTION WHEN OTHERS THEN null;
END $$;

DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.current_user_role() TO service_role;
EXCEPTION WHEN OTHERS THEN null;
END $$;


-- ============================================================================
-- 2. Trigger Function: cancel_stale_notification_jobs_on_renewal()
-- Automatically cancels pending reminder jobs for prior subscriptions upon renewal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_stale_notification_jobs_on_renewal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    -- Input boundary validation
    IF NEW.member_id IS NULL OR NEW.gym_id IS NULL THEN
        RAISE EXCEPTION 'Invalid subscription record: member_id and gym_id are required.';
    END IF;

    -- Cancel all pending jobs for prior subscriptions of this member
    UPDATE public.notification_jobs
    SET 
        status = 'cancelled'::public.notification_job_status_enum,
        cancellation_reason = 'subscription_renewed_or_extended',
        updated_at = pg_catalog.now()
    WHERE 
        member_id = NEW.member_id
        AND gym_id = NEW.gym_id
        AND subscription_id != NEW.id
        AND status = 'pending'::public.notification_job_status_enum;

    -- Ensure member status is active
    UPDATE public.members
    SET 
        status = 'active'::public.member_status_enum,
        updated_at = pg_catalog.now()
    WHERE id = NEW.member_id AND gym_id = NEW.gym_id;

    RETURN NEW;
END;
$$;

-- Restrict trigger function execution from being called via direct RPC
REVOKE ALL ON FUNCTION public.cancel_stale_notification_jobs_on_renewal() FROM PUBLIC;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.cancel_stale_notification_jobs_on_renewal() FROM anon;
EXCEPTION WHEN OTHERS THEN null;
END $$;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.cancel_stale_notification_jobs_on_renewal() FROM authenticated;
EXCEPTION WHEN OTHERS THEN null;
END $$;

-- Bind trigger to subscriptions table (AFTER INSERT OR UPDATE OF end_date)
DROP TRIGGER IF EXISTS trg_cancel_stale_jobs_after_subscription ON public.subscriptions;
CREATE TRIGGER trg_cancel_stale_jobs_after_subscription
AFTER INSERT OR UPDATE OF end_date ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.cancel_stale_notification_jobs_on_renewal();


-- ============================================================================
-- 3. Worker Queue Claim Function: claim_notification_jobs()
-- Atomically claims jobs with worker lease & Two-Phase Dispatch Intent Guard
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_notification_jobs(
    p_worker_id text,
    p_batch_size integer DEFAULT 25,
    p_lease_duration_seconds integer DEFAULT 300
)
RETURNS SETOF public.notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_lease_interval interval;
BEGIN
    -- Input sanitization
    IF p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = '' THEN
        RAISE EXCEPTION 'Worker ID must be provided to claim jobs.';
    END IF;
    
    v_lease_interval := (pg_catalog.concat(p_lease_duration_seconds::text, ' seconds'))::interval;

    RETURN QUERY
    WITH eligible_jobs AS (
        SELECT id
        FROM public.notification_jobs
        WHERE 
            -- Normal pending jobs scheduled on or before now
            (status = 'pending'::public.notification_job_status_enum AND scheduled_for <= pg_catalog.now())
            OR 
            -- Orphaned leases from crashed workers where dispatch intent was NEVER recorded
            (
                status = 'claimed'::public.notification_job_status_enum 
                AND lease_expires_at < pg_catalog.now() 
                AND attempt_count < max_attempts
                -- CRITICAL GUARD: Only reclaim if no dispatch attempt was ever initiated
                -- (Prevents duplicate message dispatch after provider socket timeouts)
                AND NOT EXISTS (
                    SELECT 1 FROM public.notification_attempts a 
                    WHERE a.job_id = public.notification_jobs.id 
                    AND a.status IN (
                        'dispatching'::public.notification_attempt_status_enum, 
                        'sent'::public.notification_attempt_status_enum, 
                        'unknown'::public.notification_attempt_status_enum
                    )
                )
            )
        ORDER BY scheduled_for ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.notification_jobs j
    SET 
        status = 'claimed'::public.notification_job_status_enum,
        claimed_at = pg_catalog.now(),
        lease_expires_at = pg_catalog.now() + v_lease_interval,
        worker_id = p_worker_id,
        attempt_count = j.attempt_count + 1,
        updated_at = pg_catalog.now()
    FROM eligible_jobs e
    WHERE j.id = e.id
    RETURNING j.*;
END;
$$;

-- Revoke public execution; grant strictly to backend service_role
REVOKE ALL ON FUNCTION public.claim_notification_jobs(text, integer, integer) FROM PUBLIC;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.claim_notification_jobs(text, integer, integer) FROM anon;
EXCEPTION WHEN OTHERS THEN null;
END $$;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.claim_notification_jobs(text, integer, integer) FROM authenticated;
EXCEPTION WHEN OTHERS THEN null;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.claim_notification_jobs(text, integer, integer) TO service_role;
EXCEPTION WHEN OTHERS THEN null;
END $$;
