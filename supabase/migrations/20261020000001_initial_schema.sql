-- ============================================================================
-- Migration: 20261020000001_initial_schema.sql
-- Description: Core Schema, Extensions, Enums, Tables, Constraints & Indexes
-- Engine: PostgreSQL 15+ (Supabase)
-- Timezone Standard: UTC (presented in Asia/Kolkata)
-- ============================================================================

-- 1. Required PostgreSQL Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Ensure auth schema exists (standard in Supabase)
CREATE SCHEMA IF NOT EXISTS auth;

-- Stub auth.users & auth.uid() if running in bare PostgreSQL / test harness where Supabase Auth is not pre-installed
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users'
    ) THEN
        CREATE TABLE auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT UNIQUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    END IF;
END $$;

-- Ensure standard Supabase roles exist (pre-created in Supabase Cloud, created here for standalone/test portability)
DO $$ BEGIN
    CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

-- 2. Custom Domain Enums
DO $$ BEGIN
    CREATE TYPE member_status_enum AS ENUM ('active', 'expiring', 'expired', 'archived');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE subscription_status_enum AS ENUM ('active', 'expired', 'cancelled', 'superseded');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_milestone_enum AS ENUM ('EXPIRY_MINUS_3', 'EXPIRY_ZERO', 'EXPIRY_PLUS_3', 'MANUAL_TRIGGER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_job_status_enum AS ENUM (
        'pending',
        'claimed',
        'dispatching',
        'reconciling',
        'completed',
        'failed',
        'skipped',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_attempt_status_enum AS ENUM (
        'initiated',
        'dispatching',
        'sent',
        'delivered',
        'read',
        'failed_permanent',
        'failed_transient',
        'unknown',
        'unconfirmed_stale'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_channel_enum AS ENUM ('whatsapp', 'sms');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Utility Function: Auto-updating updated_at timestamp (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. Table: gym_settings (Tenant / Gym Business Profile)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gym_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_name TEXT NOT NULL CHECK (char_length(trim(gym_name)) >= 2),
    phone_number TEXT NOT NULL CHECK (phone_number ~ '^\+91[6-9][0-9]{9}$'),
    address TEXT,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    currency TEXT NOT NULL DEFAULT 'INR',
    reminder_send_hour INTEGER NOT NULL DEFAULT 10 CHECK (reminder_send_hour BETWEEN 7 AND 21),
    communication_settings JSONB NOT NULL DEFAULT '{
        "whatsapp_enabled": false,
        "whatsapp_phone_number_id": null,
        "sms_fallback_enabled": false,
        "sms_provider": "fast2sms",
        "dlt_principal_entity_id": null,
        "dlt_sender_header": null
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_gym_settings_updated_at ON public.gym_settings;
CREATE TRIGGER trg_gym_settings_updated_at
BEFORE UPDATE ON public.gym_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 5. Table: profiles (Staff & Admin Accounts mapped to auth.users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    gym_id UUID NOT NULL REFERENCES public.gym_settings(id) ON DELETE RESTRICT,
    full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) >= 2),
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'admin', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_gym_id ON public.profiles(gym_id);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 6. Table: members (Customer Directory & Consent Tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gym_settings(id) ON DELETE RESTRICT,
    member_code TEXT NOT NULL,
    full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) >= 2),
    phone TEXT NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
    email CITEXT CHECK (email IS NULL OR email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
    date_of_birth DATE CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE),
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT CHECK (emergency_contact_phone IS NULL OR emergency_contact_phone ~ '^\+91[6-9][0-9]{9}$'),
    notes TEXT,
    status member_status_enum NOT NULL DEFAULT 'active',
    
    -- Regulatory Consent Columns (DPDP Act Compliance)
    whatsapp_consent BOOLEAN NOT NULL DEFAULT true,
    whatsapp_consent_at TIMESTAMPTZ DEFAULT NOW(),
    whatsapp_consent_source TEXT DEFAULT 'front_desk_registration',
    
    sms_consent BOOLEAN NOT NULL DEFAULT true,
    sms_consent_at TIMESTAMPTZ DEFAULT NOW(),
    sms_consent_source TEXT DEFAULT 'front_desk_registration',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_members_gym_code UNIQUE (gym_id, member_code)
);

-- Partial unique index: Allows re-registration if prior membership was permanently archived
CREATE UNIQUE INDEX IF NOT EXISTS uq_members_gym_phone_active 
ON public.members(gym_id, phone) 
WHERE status != 'archived';

CREATE INDEX IF NOT EXISTS idx_members_gym_status ON public.members(gym_id, status);
CREATE INDEX IF NOT EXISTS idx_members_phone ON public.members(phone);
CREATE INDEX IF NOT EXISTS idx_members_search 
ON public.members USING gin(to_tsvector('english', full_name || ' ' || member_code || ' ' || phone));

DROP TRIGGER IF EXISTS trg_members_updated_at ON public.members;
CREATE TRIGGER trg_members_updated_at
BEFORE UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 7. Table: membership_plans (Plan Catalog)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.membership_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gym_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (char_length(trim(name)) >= 2),
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_plans_gym_name UNIQUE (gym_id, name)
);

CREATE INDEX IF NOT EXISTS idx_plans_gym_active ON public.membership_plans(gym_id, is_active);

DROP TRIGGER IF EXISTS trg_plans_updated_at ON public.membership_plans;
CREATE TRIGGER trg_plans_updated_at
BEFORE UPDATE ON public.membership_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 8. Table: subscriptions (Membership Periods & Renewal History)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gym_settings(id) ON DELETE RESTRICT,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    plan_id UUID NOT NULL REFERENCES public.membership_plans(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status subscription_status_enum NOT NULL DEFAULT 'active',
    amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid >= 0),
    payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'upi', 'card', 'bank_transfer', 'other')),
    notes TEXT,
    
    -- Client Renewal Request Idempotency Key (prevents duplicate submissions on network retry)
    idempotency_key TEXT,
    
    -- Staff attribution for audit accountability
    created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    
    -- Optimistic Concurrency Control Version Counter
    version INTEGER NOT NULL DEFAULT 1,
    
    -- Self-referential FK preserving renewal lineage (A subscription can only be renewed once)
    renewed_from_subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_subscription_dates CHECK (end_date >= start_date),
    
    -- Exclusion Constraint: Guarantees zero overlapping active coverage periods for the same member
    CONSTRAINT no_overlapping_active_subscriptions 
    EXCLUDE USING gist (
        member_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status = 'active')
);

-- Client renewal idempotency index
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_gym_idempotency 
ON public.subscriptions(gym_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- Linear renewal lineage constraint: Exactly one successor per subscription
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_renewed_from 
ON public.subscriptions(renewed_from_subscription_id) 
WHERE renewed_from_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_member_dates ON public.subscriptions(member_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry_lookup ON public.subscriptions(end_date, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_gym_status ON public.subscriptions(gym_id, status);

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 9. Table: notification_jobs (Queue, Leases & Scheduled Reminders)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gym_settings(id) ON DELETE RESTRICT,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    milestone notification_milestone_enum NOT NULL,
    target_date DATE NOT NULL,
    channel notification_channel_enum NOT NULL DEFAULT 'whatsapp',
    status notification_job_status_enum NOT NULL DEFAULT 'pending',
    
    -- Deterministic uniqueness preventing duplicate jobs per subscription milestone
    idempotency_key TEXT NOT NULL UNIQUE,
    
    scheduled_for TIMESTAMPTZ NOT NULL,
    
    -- Distributed Worker Lease Management
    claimed_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    worker_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    
    processed_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index supporting fast queue claiming and expired lease recovery
CREATE INDEX IF NOT EXISTS idx_jobs_claim_recovery 
ON public.notification_jobs(status, scheduled_for, lease_expires_at) 
WHERE status IN ('pending', 'claimed');

-- Index supporting periodic reconciliation sweeper for ambiguous timeouts
CREATE INDEX IF NOT EXISTS idx_jobs_reconciliation 
ON public.notification_jobs(status, updated_at) 
WHERE status = 'reconciling';

CREATE INDEX IF NOT EXISTS idx_jobs_member_sub ON public.notification_jobs(member_id, subscription_id);

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON public.notification_jobs;
CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON public.notification_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 10. Table: notification_attempts (Individual Dispatches & Provider Receipts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.notification_jobs(id) ON DELETE CASCADE,
    channel notification_channel_enum NOT NULL,
    provider TEXT NOT NULL, -- 'meta_whatsapp', 'fast2sms', 'gupshup'
    provider_message_id TEXT, -- e.g. wamid.HBgL... or SMS gateway reference ID
    status notification_attempt_status_enum NOT NULL DEFAULT 'initiated',
    request_payload JSONB,
    response_payload JSONB,
    error_code TEXT,
    error_message TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attempts_job_id ON public.notification_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_attempts_provider_msg ON public.notification_attempts(provider_message_id);

-- ============================================================================
-- 11. Table: webhook_events (Inbound Webhook Audit & Deduplication)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL UNIQUE, -- Provider unique ID or hash(payload)
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT false,
    processing_error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed 
ON public.webhook_events(processed) 
WHERE processed = false;

-- ============================================================================
-- 12. Table: audit_logs (Administrative Activity Trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gym_settings(id) ON DELETE RESTRICT,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- e.g. 'member.create', 'subscription.renew', 'job.retry'
    entity_type TEXT NOT NULL,
    entity_id UUID,
    changes JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_gym_created 
ON public.audit_logs(gym_id, created_at DESC);
