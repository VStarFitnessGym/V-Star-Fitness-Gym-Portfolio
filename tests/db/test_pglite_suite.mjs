// ============================================================================
// Automated Database Integration Test Suite (PostgreSQL 15+ via PGlite WASM)
// Tests: Schema, Extensions, Invariants, Exclusion Constraints, Triggers, RLS
// ============================================================================

import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

// Read migration files
const migration1 = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/20261020000001_initial_schema.sql'), 'utf-8');
const migration2 = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/20261020000002_functions_and_triggers.sql'), 'utf-8');
const migration3 = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/20261020000003_row_level_security.sql'), 'utf-8');
const migration4 = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/20261020000004_reminder_engine_optimizations.sql'), 'utf-8');
const migration5 = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/20261020000005_cancel_stale_jobs_on_subscription_update.sql'), 'utf-8');
const migration6 = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/20261020000006_provider_audit_and_fallback_hardening.sql'), 'utf-8');
const seedSql = fs.readFileSync(path.join(projectRoot, 'supabase/seed.sql'), 'utf-8');

async function createFreshDb() {
  const db = new PGlite({
    extensions: { btree_gist, pgcrypto, citext, uuid_ossp }
  });
  return db;
}

const testResults = [];

function assert(condition, testName, details = '') {
  if (condition) {
    testResults.push({ name: testName, status: 'PASSED', details });
    console.log(`  [PASS] ${testName}`);
  } else {
    testResults.push({ name: testName, status: 'FAILED', details });
    console.error(`  [FAIL] ${testName}: ${details}`);
    throw new Error(`Assertion failed: ${testName} - ${details}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('STAGE 2 AUTOMATED DATABASE & RLS VERIFICATION TEST SUITE');
  console.log('Engine: PostgreSQL 18.6 WASM Engine (PGlite)');
  console.log('Extensions: btree_gist, pgcrypto, citext, uuid_ossp');
  console.log('================================================================\n');

  const db = await createFreshDb();

  // Test 1: Migrations apply cleanly to disposable database
  console.log('--- Suite 1: Migration Execution ---');
  try {
    await db.exec(migration1);
    assert(true, 'Test 1: Migration 001 (Initial Schema) applies cleanly');

    await db.exec(migration2);
    assert(true, 'Test 1: Migration 002 (Functions & Triggers) applies cleanly');

    await db.exec(migration3);
    assert(true, 'Test 1: Migration 003 (Row Level Security) applies cleanly');

    await db.exec(migration4);
    assert(true, 'Test 1: Migration 004 (Reminder Optimizations) applies cleanly');

    await db.exec(migration5);
    assert(true, 'Test 1: Migration 005 (Subscription Update Stale Job Trigger) applies cleanly');

    await db.exec(migration6);
    assert(true, 'Test 1: Migration 006 (Provider Audit & Fallback Hardening) applies cleanly');
  } catch (err) {
    assert(false, 'Test 1: Migrations apply cleanly', err.message);
  }

  // Test 2: Migrations are reproducible / reapplication workflow
  try {
    const db2 = await createFreshDb();
    await db2.exec(migration1);
    await db2.exec(migration2);
    await db2.exec(migration3);
    await db2.exec(migration4);
    await db2.exec(migration5);
    await db2.exec(migration6);
    assert(true, 'Test 2: Migrations can be applied to fresh instance reproducibly');
  } catch (err) {
    assert(false, 'Test 2: Migration reapplication', err.message);
  }

  // Apply seed data
  await db.exec(seedSql);
  assert(true, 'Seed fixtures loaded successfully');

  // Test 3: Constraints reject invalid data
  console.log('\n--- Suite 2: Domain Constraints & Validation ---');
  try {
    let failedAsExpected = false;
    try {
      // Invalid phone format (not +91...)
      await db.query(`
        INSERT INTO public.members (gym_id, member_code, full_name, phone)
        VALUES ('11111111-1111-1111-1111-111111111111', 'FF-ERR1', 'Invalid Phone', '9876543210');
      `);
    } catch (e) {
      failedAsExpected = true;
    }
    assert(failedAsExpected, 'Test 3A: Member phone regex check rejects non-+91 number');

    failedAsExpected = false;
    try {
      // Inverted subscription dates
      await db.query(`
        INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid)
        VALUES (
          '11111111-1111-1111-1111-111111111111', 
          '55555555-5555-5555-5555-555555555551',
          '33333333-3333-3333-3333-333333333331',
          '2026-11-30', '2026-11-01', 1499.00
        );
      `);
    } catch (e) {
      failedAsExpected = true;
    }
    assert(failedAsExpected, 'Test 3B: Subscription chk_subscription_dates rejects end_date < start_date');

    failedAsExpected = false;
    try {
      // Duplicate member phone per gym while active
      await db.query(`
        INSERT INTO public.members (gym_id, member_code, full_name, phone, status)
        VALUES ('11111111-1111-1111-1111-111111111111', 'FF-DUP', 'Duplicate Phone', '+919876510001', 'active');
      `);
    } catch (e) {
      failedAsExpected = true;
    }
    assert(failedAsExpected, 'Test 3C: Partial unique index uq_members_gym_phone_active rejects duplicate active phone');
  } catch (err) {
    assert(false, 'Test 3: Constraints validation', err.message);
  }

  // Test 8 & 9: Subscription Exclusion Constraint (btree_gist)
  console.log('\n--- Suite 3: Subscription Invariants & Exclusion Constraints ---');
  const memberId = '55555555-5555-5555-5555-555555555551';
  const gymId = '11111111-1111-1111-1111-111111111111';
  const planId = '33333333-3333-3333-3333-333333333331';

  let initialSubId;
  try {
    // 1. Insert primary active subscription: 2026-11-01 to 2026-11-30
    const res = await db.query(`
      INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
      VALUES ($1, $2, $3, '2026-11-01', '2026-11-30', 1499.00, 'active')
      RETURNING id;
    `, [gymId, memberId, planId]);
    initialSubId = res.rows[0].id;
    assert(true, 'Test 8A: Primary active subscription created');

    // 2. Overlapping active subscription: 2026-11-15 to 2026-12-14 (Must fail with exclusion violation)
    let overlapFailed = false;
    try {
      await db.query(`
        INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
        VALUES ($1, $2, $3, '2026-11-15', '2026-12-14', 1499.00, 'active');
      `, [gymId, memberId, planId]);
    } catch (e) {
      overlapFailed = e.message.includes('conflicting key value violates exclusion constraint') || 
                      e.message.includes('exclusion') || e.message.includes('23P01');
    }
    assert(overlapFailed, 'Test 8: Exclusion constraint no_overlapping_active_subscriptions rejects overlapping active dates');

    // Test 9: Legitimate contiguous future-dated subscription (2026-12-01 to 2026-12-31)
    const futureRes = await db.query(`
      INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status, renewed_from_subscription_id)
      VALUES ($1, $2, $3, '2026-12-01', '2026-12-31', 1499.00, 'active', $4)
      RETURNING id;
    `, [gymId, memberId, planId, initialSubId]);
    assert(futureRes.rows.length === 1, 'Test 9: Legitimate contiguous future-dated renewal subscription successfully accepted');

    // Test 10: Renewal lineage constraint (uq_subscriptions_renewed_from)
    let duplicateLineageFailed = false;
    try {
      await db.query(`
        INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status, renewed_from_subscription_id)
        VALUES ($1, $2, $3, '2027-01-01', '2027-01-31', 1499.00, 'active', $4);
      `, [gymId, memberId, planId, initialSubId]);
    } catch (e) {
      duplicateLineageFailed = true;
    }
    assert(duplicateLineageFailed, 'Test 10: Linear renewal lineage enforced; single renewal per parent subscription');

    // Test 11: Client renewal request idempotency
    const idempotencyKey = 'req-renew-test-uuid-001';
    await db.query(`
      INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status, idempotency_key)
      VALUES ($1, $2, $3, '2027-02-01', '2027-02-28', 1499.00, 'active', $4);
    `, [gymId, memberId, planId, idempotencyKey]);

    let duplicateIdempotencyFailed = false;
    try {
      await db.query(`
        INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status, idempotency_key)
        VALUES ($1, $2, $3, '2027-02-01', '2027-02-28', 1499.00, 'active', $4);
      `, [gymId, memberId, planId, idempotencyKey]);
    } catch (e) {
      duplicateIdempotencyFailed = true;
    }
    assert(duplicateIdempotencyFailed, 'Test 11: Idempotent renewal key rejection prevents duplicate subscription creation');

    // Test 12: Rollback when renewal fails
    let rollbackVerified = false;
    try {
      await db.query('BEGIN;');
      await db.query(`
        INSERT INTO public.audit_logs (gym_id, action, entity_type)
        VALUES ($1, 'subscription.renew.attempt', 'subscription');
      `, [gymId]);
      // Trigger error deliberately
      await db.query(`
        INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
        VALUES ($1, $2, $3, '2026-11-10', '2026-11-20', 1499.00, 'active');
      `, [gymId, memberId, planId]);
      await db.query('COMMIT;');
    } catch (e) {
      await db.query('ROLLBACK;');
      const auditCheck = await db.query(`
        SELECT COUNT(*) as c FROM public.audit_logs WHERE action = 'subscription.renew.attempt';
      `);
      rollbackVerified = parseInt(auditCheck.rows[0].c) === 0;
    }
    assert(rollbackVerified, 'Test 12: Transactional rollback on renewal failure releases locks and discards partial changes');
  } catch (err) {
    assert(false, 'Suite 3: Subscription Invariants', err.message);
  }

  // Test 13: Renewal Invalidation Trigger on notification_jobs
  console.log('\n--- Suite 4: Notification Queue, Lease & Trigger Tests ---');
  try {
    const member2Id = '55555555-5555-5555-5555-555555555552';
    // 1. Create first subscription for Member 2
    const subRes = await db.query(`
      INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
      VALUES ($1, $2, $3, '2026-10-01', '2026-10-31', 1499.00, 'active')
      RETURNING id;
    `, [gymId, member2Id, planId]);
    const oldSubId = subRes.rows[0].id;

    // 2. Insert pending notification job for old subscription
    const jobRes = await db.query(`
      INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for)
      VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'pending', 'job-key-test-001', '2026-10-31 04:30:00+00')
      RETURNING id;
    `, [gymId, member2Id, oldSubId]);
    const jobId = jobRes.rows[0].id;

    // 3. Member 2 renews! New subscription starting 2026-11-01
    await db.query(`
      INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status, renewed_from_subscription_id)
      VALUES ($1, $2, $3, '2026-11-01', '2026-11-30', 1499.00, 'active', $4);
    `, [gymId, member2Id, planId, oldSubId]);

    // 4. Verify trigger trg_cancel_stale_jobs_after_subscription cancelled the job
    const jobCheck = await db.query(`
      SELECT status, cancellation_reason FROM public.notification_jobs WHERE id = $1;
    `, [jobId]);

    assert(
      jobCheck.rows[0].status === 'cancelled' && 
      jobCheck.rows[0].cancellation_reason === 'subscription_renewed_or_extended',
      'Test 13: Renewal trigger automatically cancelled pending notification job for old subscription'
    );

    // Test 14: Worker Queue Claim RPC & Two-Phase Dispatch Intent Guard
    // A. Clean job claim
    const freshJobRes = await db.query(`
      INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for)
      VALUES ($1, $2, $3, 'EXPIRY_PLUS_3', '2026-11-03', 'pending', 'job-key-test-002', NOW() - INTERVAL '5 minutes')
      RETURNING id;
    `, [gymId, member2Id, oldSubId]);
    const freshJobId = freshJobRes.rows[0].id;

    const claimedJobs = await db.query(`
      SELECT id, status, worker_id FROM public.claim_notification_jobs('worker_alpha', 10, 300);
    `);
    const claimedMatch = claimedJobs.rows.find(r => r.id === freshJobId);
    assert(
      claimedMatch && claimedMatch.status === 'claimed' && claimedMatch.worker_id === 'worker_alpha',
      'Test 14A: claim_notification_jobs() atomically claims pending jobs and sets lease'
    );

    // B. Worker records Two-Phase Dispatch Intent into notification_attempts
    await db.query(`
      INSERT INTO public.notification_attempts (job_id, channel, provider, status)
      VALUES ($1, 'whatsapp', 'meta_whatsapp', 'dispatching');
    `, [freshJobId]);

    await db.query(`
      UPDATE public.notification_jobs
      SET status = 'dispatching', lease_expires_at = NOW() - INTERVAL '10 minutes'
      WHERE id = $1;
    `, [freshJobId]);

    // Worker Beta tries to claim expired leases
    const betaClaims = await db.query(`
      SELECT id FROM public.claim_notification_jobs('worker_beta', 10, 300);
    `);
    const duplicateDispatchAttempted = betaClaims.rows.some(r => r.id === freshJobId);
    assert(
      !duplicateDispatchAttempted,
      'Test 14B: Two-Phase Dispatch Guard blocks worker reclamation after dispatch intent recorded (Zero double-sends)'
    );

    // Test 15: Notification-attempt history preservation
    const attemptsCount = await db.query(`
      SELECT COUNT(*) as c FROM public.notification_attempts WHERE job_id = $1;
    `, [freshJobId]);
    assert(parseInt(attemptsCount.rows[0].c) === 1, 'Test 15: Notification attempt history is preserved in database');
  } catch (err) {
    assert(false, 'Suite 4: Notification Queue & Leases', err.message);
  }

  // Suite 5: Row Level Security & Privileged Function Access Control
  console.log('\n--- Suite 5: RLS Policies & Function Hardening ---');
  try {
    // Test 7: Unauthorized execution of privileged functions by unauthenticated / anon role
    // Test current_user_gym_id() without auth.uid()
    const gymIdUnauth = await db.query(`
      SELECT public.current_user_gym_id() as g;
    `);
    assert(gymIdUnauth.rows[0].g === null, 'Test 7A: current_user_gym_id() returns NULL when unauthenticated');

    // Test 4, 5, 6: Cross-Gym RLS Isolation
    // Setup simulated Supabase auth context for Staff Gym A
    // In Supabase, auth.uid() returns the JWT sub claim.
    // We create a mock auth.uid() function returning Gym A user ID:
    await db.exec(`
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
      $$;
    `);

    const staffAGymId = await db.query(`SELECT public.current_user_gym_id() as g;`);
    assert(
      staffAGymId.rows[0].g === '11111111-1111-1111-1111-111111111111',
      'Test 4: current_user_gym_id() accurately resolves staff gym ID from profile'
    );

    // Enable RLS enforcement for current session
    // In PostgreSQL, table owners bypass RLS by default. We create an application role 'gym_staff_role' that respects RLS:
    await db.exec(`
      DO $$ BEGIN
        CREATE ROLE gym_staff_role;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
      GRANT authenticated TO gym_staff_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO gym_staff_role;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO gym_staff_role;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO gym_staff_role;
    `);

    // Run query under gym_staff_role to test RLS evaluation
    await db.exec('SET ROLE gym_staff_role;');
    const rlsQueryResult = await db.query('SELECT id, gym_id, full_name FROM public.members;');
    await db.exec('RESET ROLE;');

    // Assert that Staff A can only see Gym A members (2 members), and zero members from Gym B (which has member 6666...)
    const returnedGymIds = new Set(rlsQueryResult.rows.map(r => r.gym_id));
    const containsGymB = returnedGymIds.has('22222222-2222-2222-2222-222222222222');
    assert(
      returnedGymIds.has('11111111-1111-1111-1111-111111111111') && !containsGymB,
      'Test 6A: Cross-gym RLS isolation prevents Staff A from reading members belonging to Gym B'
    );

    // Test 6B: Profiles RLS non-recursion test
    await db.exec('SET ROLE gym_staff_role;');
    const profilesRes = await db.query('SELECT id, gym_id, full_name, role FROM public.profiles;');
    await db.exec('RESET ROLE;');
    const returnedProfileGymIds = new Set(profilesRes.rows.map(r => r.gym_id));
    assert(
      profilesRes.rows.length === 1 && 
      returnedProfileGymIds.has('11111111-1111-1111-1111-111111111111') &&
      !returnedProfileGymIds.has('22222222-2222-2222-2222-222222222222'),
      'Test 6B: Profiles RLS non-recursion verified; Staff A reads strictly their gym staff'
    );

    // Test 6C: Profiles UPDATE under admin role
    await db.exec('SET ROLE gym_staff_role;');
    const profileUpdateRes = await db.query(`
      UPDATE public.profiles 
      SET full_name = 'Verified Admin Name' 
      WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    `);
    await db.exec('RESET ROLE;');
    assert(
      (profileUpdateRes.affectedRows || profileUpdateRes.rowCount) === 1,
      'Test 6C: Admin profile update with WITH CHECK passes under RLS'
    );

    // Test 6D: Anonymous role denied access (defense in depth: table permission denied or 0 rows via RLS)
    await db.exec(`
      DO $$ BEGIN
        CREATE ROLE gym_anon_role;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
      GRANT anon TO gym_anon_role;
    `);
    let anonAccessDenied = false;
    try {
      await db.exec('SET ROLE gym_anon_role;');
      const anonRes = await db.query('SELECT * FROM public.members;');
      await db.exec('RESET ROLE;');
      anonAccessDenied = (anonRes.rows.length === 0);
    } catch (e) {
      await db.exec('RESET ROLE;');
      anonAccessDenied = e.message.includes('permission denied') || e.message.includes('42501');
    }
    assert(
      anonAccessDenied,
      'Test 6D: Anonymous role strictly denied access to protected members table (permission denied / 0 rows via RLS)'
    );
  } catch (err) {
    assert(false, 'Suite 5: RLS Policies', err.message);
  }

  // Suite 6: Webhook Audit Table & SMS Fallback Constraint Invariants
  console.log('\n--- Suite 6: Webhook Events & Fallback Uniqueness Invariants ---');
  try {
    // Test 8A: webhook_events table exists and enforces event_id uniqueness
    await db.query(`
      INSERT INTO public.webhook_events (provider, event_id, event_type, payload, processed)
      VALUES ('meta_whatsapp', 'evt_uniq_test_1', 'message.delivered', '{"test": 1}', false);
    `);
    assert(true, 'Test 8A: webhook_events table exists and accepts valid audit record');

    let duplicateEventBlocked = false;
    try {
      await db.query(`
        INSERT INTO public.webhook_events (provider, event_id, event_type, payload, processed)
        VALUES ('meta_whatsapp', 'evt_uniq_test_1', 'message.delivered', '{"test": 2}', false);
      `);
    } catch (e) {
      duplicateEventBlocked = e.message.includes('unique') || e.message.includes('duplicate');
    }
    assert(duplicateEventBlocked, 'Test 8B: webhook_events enforces unique constraint on event_id');

    // Test 8C: idx_notification_attempts_sms_unique prevents duplicate SMS attempts for same job
    const subRes = await db.query(`SELECT id, gym_id, member_id FROM public.subscriptions LIMIT 1;`);
    const subRow = subRes.rows[0];
    const testJobId = '77777777-7777-7777-7777-777777777771';
    await db.query(`
      INSERT INTO public.notification_jobs (
        id, gym_id, member_id, subscription_id, milestone, target_date, channel, status, idempotency_key, scheduled_for
      ) VALUES (
        $1, $2, $3, $4, 'EXPIRY_MINUS_3', '2026-10-22', 'whatsapp', 'pending',
        'sub_job_sms_uniq_test', NOW()
      );
    `, [testJobId, subRow.gym_id, subRow.member_id, subRow.id]);

    await db.query(`
      INSERT INTO public.notification_attempts (job_id, channel, provider, status, sent_at)
      VALUES ($1, 'sms', 'twilio_sms', 'sent', NOW());
    `, [testJobId]);

    let duplicateSmsBlocked = false;
    try {
      await db.query(`
        INSERT INTO public.notification_attempts (job_id, channel, provider, status, sent_at)
        VALUES ($1, 'sms', 'twilio_sms', 'dispatching', NOW());
      `, [testJobId]);
    } catch (e) {
      duplicateSmsBlocked = e.message.includes('unique') || e.message.includes('duplicate') || e.message.includes('idx_notification_attempts_sms_unique');
    }
    assert(duplicateSmsBlocked, 'Test 8C: Unique partial index strictly prevents duplicate SMS attempts for the same job');
  } catch (err) {
    assert(false, 'Suite 6: Webhook & SMS Invariants', err.message);
  }

  console.log('\n================================================================');
  console.log(`TEST RUN COMPLETE: ${testResults.filter(r => r.status === 'PASSED').length}/${testResults.length} PASSED`);
  console.log('================================================================\n');

  return testResults;
}

runTestSuite().catch(err => {
  console.error('Test suite failed unexpectedly:', err);
  process.exit(1);
});
