-- ============================================================================
-- Seed File: supabase/seed.sql
-- Description: Synthetic test fixtures for local development and test verification.
-- NOTICE: Uses purely fictional data with dummy phone numbers. No real PII.
-- ============================================================================

-- 1. Test Gyms
INSERT INTO public.gym_settings (id, gym_name, phone_number, address, timezone, currency)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'FITFUSION Downtown (Test Gym A)', '+919876500001', '123 Test Street, Bengaluru, Karnataka', 'Asia/Kolkata', 'INR'),
    ('22222222-2222-2222-2222-222222222222', 'FITFUSION Uptown (Test Gym B)', '+919876500002', '456 Sample Avenue, Mumbai, Maharashtra', 'Asia/Kolkata', 'INR')
ON CONFLICT (id) DO NOTHING;

-- 2. Mock Auth Users & Staff Profiles
INSERT INTO auth.users (id, email)
VALUES 
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'staff_a@fitfusion.test'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'staff_b@fitfusion.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, gym_id, full_name, role)
VALUES 
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Test Staff Gym A', 'admin'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Test Staff Gym B', 'admin')
ON CONFLICT (id) DO NOTHING;

-- 3. Membership Plans
INSERT INTO public.membership_plans (id, gym_id, name, duration_days, price, description)
VALUES 
    ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111', '1 Month Monthly (Gym A)', 30, 1499.00, 'Standard 30 days gym access'),
    ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111111', '3 Months Quarterly (Gym A)', 90, 3999.00, 'Quarterly access with fitness assessment'),
    ('44444444-4444-4444-4444-444444444441', '22222222-2222-2222-2222-222222222222', '1 Month Monthly (Gym B)', 30, 1599.00, 'Gym B Monthly Plan')
ON CONFLICT (id) DO NOTHING;

-- 4. Synthetic Members
INSERT INTO public.members (id, gym_id, member_code, full_name, phone, email, status, whatsapp_consent, sms_consent)
VALUES 
    ('55555555-5555-5555-5555-555555555551', '11111111-1111-1111-1111-111111111111', 'FF-1001', 'Synthetic Member A1', '+919876510001', 'member_a1@test.local', 'active', true, true),
    ('55555555-5555-5555-5555-555555555552', '11111111-1111-1111-1111-111111111111', 'FF-1002', 'Synthetic Member A2', '+919876510002', 'member_a2@test.local', 'active', true, false),
    ('66666666-6666-6666-6666-666666666661', '22222222-2222-2222-2222-222222222222', 'FF-2001', 'Synthetic Member B1', '+919876520001', 'member_b1@test.local', 'active', true, true)
ON CONFLICT (id) DO NOTHING;
