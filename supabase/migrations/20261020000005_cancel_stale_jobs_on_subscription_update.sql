-- ============================================================================
-- Migration: 20261020000005_cancel_stale_jobs_on_subscription_update.sql
-- Description: Hardened subscription lifecycle trigger to cancel stale reminder jobs
-- Adds:
--  1. Automatic cancellation of pending jobs when subscription end_date is updated
--  2. Automatic cancellation of pending jobs when subscription status is set to 'cancelled'
--  3. Preserves existing prior-subscription cancellation on renewal
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

    -- Case 1: Subscription renewal or extension creates new subscription record
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

    -- Case 2: Subscription is cancelled
    -- Cancel all pending jobs for this subscription immediately
    IF (NEW.status = 'cancelled'::public.subscription_status_enum) THEN
        UPDATE public.notification_jobs
        SET 
            status = 'cancelled'::public.notification_job_status_enum,
            cancellation_reason = 'subscription_cancelled',
            updated_at = pg_catalog.now()
        WHERE 
            subscription_id = NEW.id
            AND status = 'pending'::public.notification_job_status_enum;
    END IF;

    -- Case 3: Same subscription has its end_date updated (extended or shortened)
    -- Obsolete pending jobs scheduled for the old end date must be cancelled immediately
    IF (TG_OP = 'UPDATE' AND OLD.end_date IS DISTINCT FROM NEW.end_date) THEN
        UPDATE public.notification_jobs
        SET 
            status = 'cancelled'::public.notification_job_status_enum,
            cancellation_reason = 'subscription_end_date_changed',
            updated_at = pg_catalog.now()
        WHERE 
            subscription_id = NEW.id
            AND status = 'pending'::public.notification_job_status_enum;
    END IF;

    -- Ensure member status is active if the subscription is active
    IF NEW.status = 'active'::public.subscription_status_enum THEN
        UPDATE public.members
        SET 
            status = 'active'::public.member_status_enum,
            updated_at = pg_catalog.now()
        WHERE id = NEW.member_id AND gym_id = NEW.gym_id;
    END IF;

    RETURN NEW;
END;
$$;

-- Restrict trigger function execution from direct RPC calls
REVOKE ALL ON FUNCTION public.cancel_stale_notification_jobs_on_renewal() FROM PUBLIC;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.cancel_stale_notification_jobs_on_renewal() FROM anon;
EXCEPTION WHEN OTHERS THEN null;
END $$;
DO $$ BEGIN
    REVOKE ALL ON FUNCTION public.cancel_stale_notification_jobs_on_renewal() FROM authenticated;
EXCEPTION WHEN OTHERS THEN null;
END $$;

-- Drop and recreate trigger to ensure it fires on UPDATE of status as well as end_date
DROP TRIGGER IF EXISTS trg_cancel_stale_jobs_after_subscription ON public.subscriptions;
CREATE TRIGGER trg_cancel_stale_jobs_after_subscription
AFTER INSERT OR UPDATE OF end_date, status ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.cancel_stale_notification_jobs_on_renewal();
