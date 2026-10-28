-- ============================================================================
-- Migration: 20261020000004_reminder_engine_optimizations.sql
-- Description: Indexes and database functions for Stage 5A Reminder Engine
-- Adds:
--  1. Optimized compound indexes for scheduler and worker query lookup
--  2. Safe atomic job lease release and state transition function
-- ============================================================================

-- 1. Index supporting rapid lookup of active subscriptions by expiry date for scheduler
CREATE INDEX IF NOT EXISTS idx_subscriptions_active_end_date 
ON public.subscriptions(gym_id, status, end_date) 
WHERE status = 'active';

-- 2. Compound index supporting subscription milestone deduplication & lookup
CREATE INDEX IF NOT EXISTS idx_jobs_sub_milestone 
ON public.notification_jobs(subscription_id, milestone);

-- 3. Index for querying jobs by target date within a gym tenant
CREATE INDEX IF NOT EXISTS idx_jobs_gym_target_date 
ON public.notification_jobs(gym_id, target_date, status);

-- 4. Function: safe_complete_notification_job()
-- Atomic state transition for completed notification jobs verifying worker ownership
CREATE OR REPLACE FUNCTION public.safe_complete_notification_job(
    p_job_id UUID,
    p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_rows_affected INTEGER;
BEGIN
    UPDATE public.notification_jobs
    SET 
        status = 'completed'::public.notification_job_status_enum,
        processed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE 
        id = p_job_id 
        AND worker_id = p_worker_id 
        AND status IN ('claimed'::public.notification_job_status_enum, 'dispatching'::public.notification_job_status_enum);
        
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    RETURN v_rows_affected > 0;
END;
$$;

-- Revoke execute from public/anon/authenticated; grant strictly to service_role
REVOKE ALL ON FUNCTION public.safe_complete_notification_job(UUID, TEXT) FROM PUBLIC;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.safe_complete_notification_job(UUID, TEXT) FROM anon;
EXCEPTION WHEN OTHERS THEN null;
END $$;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.safe_complete_notification_job(UUID, TEXT) FROM authenticated;
EXCEPTION WHEN OTHERS THEN null;
END $$;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.safe_complete_notification_job(UUID, TEXT) TO service_role;
EXCEPTION WHEN OTHERS THEN null;
END $$;
