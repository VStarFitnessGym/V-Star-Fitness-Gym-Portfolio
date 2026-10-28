-- ============================================================================
-- Migration: 20261020000003_row_level_security.sql
-- Description: Row Level Security (RLS) Policies across all tables
-- Engine: PostgreSQL 15+ (Supabase)
-- Security Model: Multi-tenant tenant boundary isolation, role-based controls,
--                 zero public/anonymous exposure, service-role isolation.
-- ============================================================================

-- 1. Enable RLS on all exposed tables
ALTER TABLE public.gym_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Defense in depth: Explicit schema and table grants
DO $$ BEGIN
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
EXCEPTION WHEN OTHERS THEN null;
END $$;

-- ============================================================================
-- 2. gym_settings Policies
-- ============================================================================
DROP POLICY IF EXISTS "Staff can view their gym settings" ON public.gym_settings;
CREATE POLICY "Staff can view their gym settings"
ON public.gym_settings FOR SELECT
TO authenticated
USING (id = public.current_user_gym_id());

DROP POLICY IF EXISTS "Owners can update their gym settings" ON public.gym_settings;
CREATE POLICY "Owners can update their gym settings"
ON public.gym_settings FOR UPDATE
TO authenticated
USING (
    id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
)
WITH CHECK (
    id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
);

-- ============================================================================
-- 3. profiles Policies (Hardened against self-referential RLS recursion)
-- ============================================================================
DROP POLICY IF EXISTS "Staff can view profiles in their gym" ON public.profiles;
CREATE POLICY "Staff can view profiles in their gym"
ON public.profiles FOR SELECT
TO authenticated
USING (gym_id = public.current_user_gym_id());

DROP POLICY IF EXISTS "Owners can manage staff profiles" ON public.profiles;
DROP POLICY IF EXISTS "Owners can insert staff profiles" ON public.profiles;
CREATE POLICY "Owners can insert staff profiles"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (
    gym_id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
);

DROP POLICY IF EXISTS "Owners can update staff profiles" ON public.profiles;
CREATE POLICY "Owners can update staff profiles"
ON public.profiles FOR UPDATE
TO authenticated
USING (
    gym_id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
)
WITH CHECK (
    gym_id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
);

DROP POLICY IF EXISTS "Owners can delete staff profiles" ON public.profiles;
CREATE POLICY "Owners can delete staff profiles"
ON public.profiles FOR DELETE
TO authenticated
USING (
    gym_id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
);

-- ============================================================================
-- 4. membership_plans Policies
-- ============================================================================
DROP POLICY IF EXISTS "Staff can view plans in their gym" ON public.membership_plans;
CREATE POLICY "Staff can view plans in their gym"
ON public.membership_plans FOR SELECT
TO authenticated
USING (gym_id = public.current_user_gym_id());

DROP POLICY IF EXISTS "Admins can manage plans in their gym" ON public.membership_plans;
DROP POLICY IF EXISTS "Admins can insert plans in their gym" ON public.membership_plans;
CREATE POLICY "Admins can insert plans in their gym"
ON public.membership_plans FOR INSERT
TO authenticated
WITH CHECK (
    gym_id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
);

DROP POLICY IF EXISTS "Admins can update plans in their gym" ON public.membership_plans;
CREATE POLICY "Admins can update plans in their gym"
ON public.membership_plans FOR UPDATE
TO authenticated
USING (
    gym_id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
)
WITH CHECK (
    gym_id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
);

DROP POLICY IF EXISTS "Admins can delete plans in their gym" ON public.membership_plans;
CREATE POLICY "Admins can delete plans in their gym"
ON public.membership_plans FOR DELETE
TO authenticated
USING (
    gym_id = public.current_user_gym_id() 
    AND public.current_user_role() IN ('owner', 'admin')
);

-- ============================================================================
-- 5. members Policies
-- ============================================================================
DROP POLICY IF EXISTS "Staff can view members in their gym" ON public.members;
CREATE POLICY "Staff can view members in their gym"
ON public.members FOR SELECT
TO authenticated
USING (gym_id = public.current_user_gym_id());

DROP POLICY IF EXISTS "Staff can insert members in their gym" ON public.members;
CREATE POLICY "Staff can insert members in their gym"
ON public.members FOR INSERT
TO authenticated
WITH CHECK (gym_id = public.current_user_gym_id());

DROP POLICY IF EXISTS "Staff can update members in their gym" ON public.members;
CREATE POLICY "Staff can update members in their gym"
ON public.members FOR UPDATE
TO authenticated
USING (gym_id = public.current_user_gym_id())
WITH CHECK (gym_id = public.current_user_gym_id());

-- ============================================================================
-- 6. subscriptions Policies
-- ============================================================================
DROP POLICY IF EXISTS "Staff can view subscriptions in their gym" ON public.subscriptions;
CREATE POLICY "Staff can view subscriptions in their gym"
ON public.subscriptions FOR SELECT
TO authenticated
USING (gym_id = public.current_user_gym_id());

DROP POLICY IF EXISTS "Staff can insert subscriptions in their gym" ON public.subscriptions;
CREATE POLICY "Staff can insert subscriptions in their gym"
ON public.subscriptions FOR INSERT
TO authenticated
WITH CHECK (gym_id = public.current_user_gym_id());

DROP POLICY IF EXISTS "Staff can update subscriptions in their gym" ON public.subscriptions;
CREATE POLICY "Staff can update subscriptions in their gym"
ON public.subscriptions FOR UPDATE
TO authenticated
USING (gym_id = public.current_user_gym_id())
WITH CHECK (gym_id = public.current_user_gym_id());

-- ============================================================================
-- 7. notification_jobs & notification_attempts Policies
-- ============================================================================
DROP POLICY IF EXISTS "Staff can view notification jobs in their gym" ON public.notification_jobs;
CREATE POLICY "Staff can view notification jobs in their gym"
ON public.notification_jobs FOR SELECT
TO authenticated
USING (gym_id = public.current_user_gym_id());

DROP POLICY IF EXISTS "Staff can view notification attempts in their gym" ON public.notification_attempts;
CREATE POLICY "Staff can view notification attempts in their gym"
ON public.notification_attempts FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.notification_jobs j 
        WHERE j.id = notification_attempts.job_id 
        AND j.gym_id = public.current_user_gym_id()
    )
);

-- ============================================================================
-- 8. audit_logs Policies
-- ============================================================================
DROP POLICY IF EXISTS "Staff can view audit logs in their gym" ON public.audit_logs;
CREATE POLICY "Staff can view audit logs in their gym"
ON public.audit_logs FOR SELECT
TO authenticated
USING (gym_id = public.current_user_gym_id());

DROP POLICY IF EXISTS "Staff can record audit logs in their gym" ON public.audit_logs;
CREATE POLICY "Staff can record audit logs in their gym"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (gym_id = public.current_user_gym_id());

-- ============================================================================
-- 9. webhook_events & Service Role Policies
-- ============================================================================
-- Webhook events and worker job processing are restricted strictly to backend service_role
DROP POLICY IF EXISTS "Service role full access to webhook_events" ON public.webhook_events;
CREATE POLICY "Service role full access to webhook_events"
ON public.webhook_events FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to notification_jobs" ON public.notification_jobs;
CREATE POLICY "Service role full access to notification_jobs"
ON public.notification_jobs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to notification_attempts" ON public.notification_attempts;
CREATE POLICY "Service role full access to notification_attempts"
ON public.notification_attempts FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
