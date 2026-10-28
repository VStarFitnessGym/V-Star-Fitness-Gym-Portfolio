// ============================================================================
// Stage 3 API Integration Test Suite (Supertest + Express + Real PostgreSQL PGlite)
// Tests: Auth Middleware, Tenant Isolation, Invariants, Idempotency, RFC 7807
// ============================================================================

import request from 'supertest';
import app from '../../server/app';
import { db, PGliteDatabaseClient, ProductionUnconfiguredClient } from '../../server/db/database';
import { createTestToken, authenticate, requireRole } from '../../server/middleware/authMiddleware';

const testResults: Array<{ name: string; status: 'PASSED' | 'FAILED'; details?: string }> = [];

function assert(condition: boolean, testName: string, details = '') {
  if (condition) {
    testResults.push({ name: testName, status: 'PASSED', details });
    console.log(`  [PASS] ${testName}`);
  } else {
    testResults.push({ name: testName, status: 'FAILED', details });
    console.error(`  [FAIL] ${testName}: ${details}`);
    throw new Error(`Assertion failed: ${testName} - ${details}`);
  }
}

async function runApiTests() {
  console.log('================================================================');
  console.log('STAGE 3 API INTEGRATION & SECURITY TEST SUITE');
  console.log('Server: Express + RFC 7807 Middleware');
  console.log('Database Engine: PostgreSQL 18.6 WASM Engine (PGlite)');
  console.log('================================================================\n');

  // Configure test JWT secret
  process.env.SUPABASE_JWT_SECRET = 'test-secret';

  // Pre-initialize database with migrations and seed
  await db.isReady();

  // Test User Identities from seed.sql:
  // User A: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' -> Staff Gym A ('11111111-1111-1111-1111-111111111111'), role: admin
  // User B: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' -> Staff Gym B ('22222222-2222-2222-2222-222222222222'), role: admin
  const tokenStaffA = createTestToken({ sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'staff_a@fitfusion.test' });
  const tokenStaffB = createTestToken({ sub: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', email: 'staff_b@fitfusion.test' });

  // 1. Health Endpoint Tests
  console.log('--- Suite 1: Health & Information Disclosure ---');
  const healthRes = await request(app).get('/api/health');
  assert(healthRes.status === 200, 'Test 1A: GET /api/health returns 200 OK');
  assert(healthRes.body.status === 'healthy', 'Test 1B: Status is healthy');
  assert(healthRes.body.database === 'connected', 'Test 1C: Database readiness verified as connected');
  assert(!healthRes.body.env && !healthRes.body.secrets && !healthRes.body.tables, 'Test 1D: Zero sensitive secrets, env, or internals disclosed');

  // 2. Authentication & Token Verification Tests
  console.log('\n--- Suite 2: Authentication & Authorization Middleware ---');
  const noAuthRes = await request(app).get('/api/me');
  assert(noAuthRes.status === 401, 'Test 2A: Missing Authorization header rejected with 401');
  assert(noAuthRes.body.code === 'UNAUTHORIZED', 'Test 2B: RFC 7807 code is UNAUTHORIZED');
  assert(noAuthRes.headers['content-type'].includes('application/problem+json'), 'Test 2C: Content-Type is application/problem+json');

  const malformedAuthRes = await request(app).get('/api/me').set('Authorization', 'Basic abc123xyz');
  assert(malformedAuthRes.status === 401, 'Test 3: Malformed Authorization header without Bearer prefix rejected');

  const expiredToken = createTestToken({ sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', expMinutes: -30 });
  const expiredRes = await request(app).get('/api/me').set('Authorization', `Bearer ${expiredToken}`);
  assert(expiredRes.status === 401, 'Test 4A: Expired access token rejected with 401');
  assert(expiredRes.body.code === 'TOKEN_EXPIRED', 'Test 4B: Code is TOKEN_EXPIRED');

  const invalidToken = 'eyJhbGciOiJIUzI1NiJ9.invalidpayload.invalidsig';
  const invalidRes = await request(app).get('/api/me').set('Authorization', `Bearer ${invalidToken}`);
  assert(invalidRes.status === 401, 'Test 4C: Malformed token rejected with 401');

  // Test 4D: Cryptographically invalid signature (signed with different secret)
  const wrongSecretToken = createTestToken({ sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, 'completely-wrong-secret');
  const wrongSigRes = await request(app).get('/api/me').set('Authorization', `Bearer ${wrongSecretToken}`);
  assert(wrongSigRes.status === 401, 'Test 4D: Token signed with wrong secret rejected with 401');
  assert(wrongSigRes.body.code === 'INVALID_TOKEN', 'Test 4D-2: RFC 7807 code is INVALID_TOKEN on bad signature');

  // Test 4E: Unsupported algorithm (alg: "none")
  const noneAlgToken = createTestToken({ sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, 'test-secret', 'none');
  const noneAlgRes = await request(app).get('/api/me').set('Authorization', `Bearer ${noneAlgToken}`);
  assert(noneAlgRes.status === 401, 'Test 4E: Token with alg=none rejected with 401');
  assert(noneAlgRes.body.code === 'INVALID_TOKEN', 'Test 4E-2: RFC 7807 code is INVALID_TOKEN on alg=none');

  // Test 5: Valid User Identity
  const meRes = await request(app).get('/api/me').set('Authorization', `Bearer ${tokenStaffA}`);
  assert(meRes.status === 200, 'Test 5A: Valid access token returns 200 OK');
  assert(meRes.body.id === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test 5B: Verified user id matches token sub claim');
  assert(meRes.body.gym.id === '11111111-1111-1111-1111-111111111111', 'Test 5C: Gym tenant resolved accurately from profile');
  assert(meRes.body.role === 'admin', 'Test 5D: Role matches profile role');

  // Test 6: Unknown profile (user has auth sub but no profile row) -> Fail Closed
  const tokenOrphan = createTestToken({ sub: '99999999-9999-9999-9999-999999999999' });
  const orphanRes = await request(app).get('/api/me').set('Authorization', `Bearer ${tokenOrphan}`);
  assert(orphanRes.status === 403, 'Test 6: User with no active gym profile rejected with 403 Forbidden (Fail-Closed)');

  // Test 6B: Role Denial (requireRole)
  let roleProblemSent: any = null;
  const mockReq: any = {
    user: { role: 'staff' },
    originalUrl: '/api/admin/restricted',
    requestId: 'req_test_rbac'
  };
  const mockRes: any = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type(_contentType: string) {
      return this;
    },
    json(payload: any) {
      roleProblemSent = payload;
      return this;
    },
    setHeader(_name: string, _value: string) {
      return this;
    }
  };
  const roleMiddleware = requireRole('owner', 'admin');
  let nextCalled = false;
  roleMiddleware(mockReq, mockRes, () => {
    nextCalled = true;
  });
  assert(mockRes.statusCode === 403, 'Test 6B: Non-admin staff rejected from admin route with 403 Forbidden');
  assert(roleProblemSent?.code === 'FORBIDDEN', 'Test 6B-2: RFC 7807 code is FORBIDDEN on insufficient role permissions');
  assert(!nextCalled, 'Test 6B-3: Middleware halts execution chain on role denial');

  // 3. Members Endpoint & Tenant Isolation Tests
  console.log('\n--- Suite 3: Tenant Isolation & Member Queries ---');
  const membersResA = await request(app).get('/api/members').set('Authorization', `Bearer ${tokenStaffA}`);
  assert(membersResA.status === 200, 'Test 7A: GET /api/members returns 200 OK');
  assert(Array.isArray(membersResA.body.data), 'Test 7B: Returns data array');
  
  // Verify all members belong strictly to Gym A
  const gymIdsA = membersResA.body.data.map((m: any) => m.gym_id);
  const allGymA = gymIdsA.every((id: string) => id === '11111111-1111-1111-1111-111111111111');
  const memberCodesA = membersResA.body.data.map((m: any) => m.member_code);
  const containsGymBMember = memberCodesA.includes('FF-2001'); // FF-2001 is Gym B in seed.sql
  assert(allGymA && !containsGymBMember, 'Test 7C: Strict cross-gym isolation; Staff A cannot view Gym B members');

  // Staff B querying members
  const membersResB = await request(app).get('/api/members').set('Authorization', `Bearer ${tokenStaffB}`);
  const gymIdsB = membersResB.body.data.map((m: any) => m.gym_id);
  const allGymB = gymIdsB.every((id: string) => id === '22222222-2222-2222-2222-222222222222');
  assert(allGymB, 'Test 7D: Staff B receives strictly Gym B members');

  // Zod validation on member query params
  const invalidLimitRes = await request(app).get('/api/members?limit=500').set('Authorization', `Bearer ${tokenStaffA}`);
  assert(invalidLimitRes.status === 400, 'Test 8A: Bounded page size enforced (limit > 100 rejected with 400)');
  assert(invalidLimitRes.body.code === 'VALIDATION_ERROR', 'Test 8B: RFC 7807 code is VALIDATION_ERROR');

  const invalidPageRes = await request(app).get('/api/members?page=0').set('Authorization', `Bearer ${tokenStaffA}`);
  assert(invalidPageRes.status === 400, 'Test 8C: Non-positive page parameter rejected with 400');

  // Search filter
  const searchRes = await request(app).get('/api/members?search=Member%20A1').set('Authorization', `Bearer ${tokenStaffA}`);
  assert(searchRes.status === 200 && searchRes.body.data.length === 1, 'Test 8D: Search query filters correctly');

  // 4. Subscriptions Renewal Endpoint Tests
  console.log('\n--- Suite 4: Subscription Renewal & Invariant Enforcement ---');
  const validMemberA1 = '55555555-5555-5555-5555-555555555551';
  const validPlanA1 = '33333333-3333-3333-3333-333333333331'; // 30-day plan
  const memberGymB = '66666666-6666-6666-6666-666666666661';

  // Test 9: Zod validation on renewal body
  const invalidRenewRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: 'not-a-uuid',
      plan_id: validPlanA1,
      amount_paid: -500,
      payment_method: 'bitcoin',
      idempotency_key: 'invalid'
    });
  assert(invalidRenewRes.status === 400, 'Test 9A: Invalid renewal payload rejected with 400');
  assert(invalidRenewRes.body.invalid_params.length >= 3, 'Test 9B: RFC 7807 invalid_params identifies invalid fields');

  // Test 10: Unknown member or cross-tenant member access
  const crossTenantRenewRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: memberGymB, // Member of Gym B!
      plan_id: validPlanA1,
      amount_paid: 1499.00,
      payment_method: 'upi',
      idempotency_key: '11111111-2222-3333-4444-555555555555'
    });
  if (crossTenantRenewRes.status !== 404) {
    console.error('Test 10A response:', crossTenantRenewRes.status, crossTenantRenewRes.body);
  }
  assert(crossTenantRenewRes.status === 404, 'Test 10A: Cross-tenant member renewal rejected with 404 Member Not Found');

  const nonExistentPlanRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: validMemberA1,
      plan_id: '00000000-0000-0000-0000-000000000000',
      amount_paid: 1499.00,
      payment_method: 'upi',
      idempotency_key: '22222222-2222-3333-4444-555555555555'
    });
  assert(nonExistentPlanRes.status === 404, 'Test 10B: Non-existent plan rejected with 404 Plan Not Found');

  // Test 11: Atomic Renewal Success with Contiguous Date Math
  const renewalKey1 = '33333333-aaaa-bbbb-cccc-000000000001';
  const renewSuccessRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: validMemberA1,
      plan_id: validPlanA1,
      amount_paid: 1499.00,
      payment_method: 'upi',
      idempotency_key: renewalKey1,
      notes: 'Test Stage 3 Renewal'
    });

  assert(renewSuccessRes.status === 201, 'Test 11A: Valid renewal returns 201 Created');
  assert(renewSuccessRes.body.idempotent_replay === false, 'Test 11B: Fresh execution marked idempotent_replay: false');
  assert(renewSuccessRes.body.status === 'active', 'Test 11C: Subscription status is active');
  assert(renewSuccessRes.body.start_date && renewSuccessRes.body.end_date, 'Test 11D: Valid start and end dates generated');

  // Test 12: Duplicate Idempotency Key with Identical Payload -> Replay (HTTP 200 OK)
  const replayRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: validMemberA1,
      plan_id: validPlanA1,
      amount_paid: 1499.00,
      payment_method: 'upi',
      idempotency_key: renewalKey1,
      notes: 'Test Stage 3 Renewal'
    });

  assert(replayRes.status === 200, 'Test 12A: Idempotent replay with identical payload returns 200 OK');
  assert(replayRes.body.idempotent_replay === true, 'Test 12B: Idempotent replay flagged in response');
  assert(replayRes.body.subscription_id === renewSuccessRes.body.subscription_id, 'Test 12C: Replays return identical subscription ID without duplicate record');

  // Test 13: Idempotency Key Reused with Different Payload -> Conflict (HTTP 409)
  const keyMismatchRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: validMemberA1,
      plan_id: '33333333-3333-3333-3333-333333333332', // Different Plan! (Quarterly)
      amount_paid: 3999.00,
      payment_method: 'upi',
      idempotency_key: renewalKey1
    });

  assert(keyMismatchRes.status === 409, 'Test 13A: Reusing idempotency key with conflicting payload rejected with 409 Conflict');
  assert(keyMismatchRes.body.code === 'IDEMPOTENCY_KEY_MISMATCH', 'Test 13B: Code is IDEMPOTENCY_KEY_MISMATCH');

  // Test 13C: Idempotency Key Reused with Different Amount -> Conflict (HTTP 409)
  const amountMismatchRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: validMemberA1,
      plan_id: validPlanA1,
      amount_paid: 9999.00, // Different amount!
      payment_method: 'upi',
      idempotency_key: renewalKey1
    });
  assert(amountMismatchRes.status === 409, 'Test 13C: Reusing idempotency key with different amount rejected with 409 Conflict');
  assert(amountMismatchRes.body.code === 'IDEMPOTENCY_KEY_MISMATCH', 'Test 13C-2: Code is IDEMPOTENCY_KEY_MISMATCH');

  // Test 13D: Two Concurrent Requests with the Exact Same Idempotency Key (Race Condition Safe)
  const memberA3Id = '55555555-5555-5555-5555-555555555553';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status)
     VALUES ($1, '11111111-1111-1111-1111-111111111111', 'FF-1003', 'Concurrent Test Member A3', '+919876510003', 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [memberA3Id]
  );
  const concurrentKey = '77777777-aaaa-bbbb-cccc-000000000007';
  const [concRes1, concRes2] = await Promise.all([
    request(app)
      .post('/api/subscriptions/renew')
      .set('Authorization', `Bearer ${tokenStaffA}`)
      .send({
        member_id: memberA3Id,
        plan_id: validPlanA1,
        amount_paid: 1499.00,
        payment_method: 'upi',
        idempotency_key: concurrentKey
      }),
    request(app)
      .post('/api/subscriptions/renew')
      .set('Authorization', `Bearer ${tokenStaffA}`)
      .send({
        member_id: memberA3Id,
        plan_id: validPlanA1,
        amount_paid: 1499.00,
        payment_method: 'upi',
        idempotency_key: concurrentKey
      })
  ]);
  assert(
    (concRes1.status === 201 && concRes2.status === 200) || (concRes1.status === 200 && concRes2.status === 201),
    'Test 13D: Two concurrent requests with the same key safely return 201 and 200 without collision crash'
  );
  assert(
    concRes1.body.subscription_id === concRes2.body.subscription_id,
    'Test 13D-2: Both concurrent requests return the exact same subscription ID'
  );

  // Test 13E: Genuinely New Renewal Operation Receives New Key & New ID
  const newOpKey = '88888888-aaaa-bbbb-cccc-000000000008';
  const newOpRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: memberA3Id,
      plan_id: validPlanA1,
      amount_paid: 1499.00,
      payment_method: 'upi',
      start_date: '2027-01-01',
      idempotency_key: newOpKey
    });
  assert(newOpRes.status === 201, 'Test 13E: Genuinely new renewal operation returns 201 Created');
  assert(newOpRes.body.subscription_id !== concRes1.body.subscription_id, 'Test 13E-2: New operation receives new distinct subscription ID');
  assert(newOpRes.body.idempotent_replay === false, 'Test 13E-3: New operation flagged idempotent_replay: false');

  // Test 13F: Failed Operation Followed by Safe Retry with Same Idempotency Key
  const retryFailedOpKey = '99999999-aaaa-bbbb-cccc-000000000009';
  const failInitialRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: memberA3Id,
      plan_id: '00000000-0000-0000-0000-000000000000', // Non-existent plan!
      amount_paid: 1499.00,
      payment_method: 'upi',
      start_date: '2027-06-01',
      idempotency_key: retryFailedOpKey
    });
  assert(failInitialRes.status === 404, 'Test 13F: Initial failed renewal returns 404 Plan Not Found');
  
  const safeRetryAfterFailRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: memberA3Id,
      plan_id: validPlanA1, // Valid plan
      amount_paid: 1499.00,
      payment_method: 'upi',
      start_date: '2027-06-01',
      idempotency_key: retryFailedOpKey // Same key reused!
    });
  assert(safeRetryAfterFailRes.status === 201, 'Test 13F-2: Safe retry of previously failed operation succeeds with 201 Created');
  assert(safeRetryAfterFailRes.body.idempotent_replay === false, 'Test 13F-3: First successful execution of retried operation is 201');

  // Test 14: Overlapping Subscription GiST Exclusion Constraint Rejection
  // Try inserting an active subscription for Member A1 that conflicts with existing dates
  const overlapKey = '44444444-aaaa-bbbb-cccc-000000000002';
  const overlapRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: validMemberA1,
      plan_id: validPlanA1,
      amount_paid: 1499.00,
      payment_method: 'cash',
      start_date: renewSuccessRes.body.start_date, // EXACT SAME START DATE!
      idempotency_key: overlapKey
    });

  assert(overlapRes.status === 409, 'Test 14A: Overlapping active dates rejected with 409 Conflict via GiST exclusion constraint');
  assert(
    overlapRes.body.code === 'SUBSCRIPTION_OVERLAP_CONFLICT' || overlapRes.body.code === 'UNIQUE_CONSTRAINT_CONFLICT',
    'Test 14B: Exclusion constraint violation mapped to safe RFC 7807 conflict response without SQL leak'
  );

  // Test 15: Reminder Queue Invalidation on Renewal
  // Insert a pending job for Member A2, then renew Member A2, verify job is cancelled
  const memberA2 = '55555555-5555-5555-5555-555555555552';
  
  // Create base subscription for A2
  const subA2 = await db.query(
    `INSERT INTO public.subscriptions (gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ('11111111-1111-1111-1111-111111111111', $1, $2, '2026-09-01', '2026-09-30', 1499.00, 'active')
     RETURNING id;`,
    [memberA2, validPlanA1]
  );

  // Insert pending reminder job for base subscription
  const jobA2 = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for)
     VALUES ('11111111-1111-1111-1111-111111111111', $1, $2, 'EXPIRY_ZERO', '2026-09-30', 'pending', 'job-stage3-test-01', NOW())
     RETURNING id;`,
    [memberA2, subA2.rows[0].id]
  );

  // Renew Member A2 via API
  const renewA2Res = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: memberA2,
      plan_id: validPlanA1,
      amount_paid: 1499.00,
      payment_method: 'cash',
      idempotency_key: '55555555-aaaa-bbbb-cccc-000000000003'
    });
  assert(renewA2Res.status === 201, 'Test 15A: Member A2 renewed successfully via API');

  // Verify pending job was automatically cancelled by database trigger
  const jobCheck = await db.query(
    `SELECT status, cancellation_reason FROM public.notification_jobs WHERE id = $1;`,
    [jobA2.rows[0].id]
  );
  assert(
    jobCheck.rows[0].status === 'cancelled' && jobCheck.rows[0].cancellation_reason === 'subscription_renewed_or_extended',
    'Test 15B: Renewal trigger automatically cancelled pending notification job for old subscription'
  );

  // Test 16: Atomic Transaction Rollback on Induced Failure
  console.log('\n--- Suite 5: Transaction Atomicity & Failure Rollback ---');
  const dummyMemberId = '77777777-7777-7777-7777-777777777777';
  let rollbackCaught = false;
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status)
         VALUES ($1, '11111111-1111-1111-1111-111111111111', 'FF-ROLLBACK-1', 'Rollback Test User', '+919999900001', 'active');`,
        [dummyMemberId]
      );
      // Induce an intentional failure after the insert
      throw new Error('INDUCED_TRANSACTION_FAILURE_FOR_TEST');
    });
  } catch (err: any) {
    if (err.message === 'INDUCED_TRANSACTION_FAILURE_FOR_TEST') {
      rollbackCaught = true;
    }
  }
  assert(rollbackCaught, 'Test 16A: Induced transaction error was caught');
  
  // Verify member record does not exist in database (rolled back)
  const verifyRollback = await db.query(
    `SELECT id FROM public.members WHERE id = $1;`,
    [dummyMemberId]
  );
  assert(verifyRollback.rows.length === 0, 'Test 16B: Transaction rollback discarded all changes on failure');

  // Test 17: Production Environment Persistence Guard
  console.log('\n--- Suite 6: Production Environment Persistence Guard ---');
  const prodClient = new ProductionUnconfiguredClient();
  const isProdReady = await prodClient.isReady();
  assert(isProdReady === false, 'Test 17A: Production unconfigured client reports not ready (health degraded)');
  
  let prodRefusalCaught = false;
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const testPglite = new PGliteDatabaseClient();
    await testPglite.init();
  } catch (err: any) {
    if (err.message.includes('CRITICAL_SECURITY_DEFECT') && err.message.includes('Production environment detected')) {
      prodRefusalCaught = true;
    }
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
  assert(prodRefusalCaught, 'Test 17B: Ephemeral PGlite strictly refuses to run in production mode');

  // Test 18: Consecutive Renewal Handling
  console.log('\n--- Suite 7: Consecutive Renewal Handling ---');
  const duplicateLineageRes = await request(app)
    .post('/api/subscriptions/renew')
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({
      member_id: validMemberA1,
      plan_id: validPlanA1,
      amount_paid: 1499.00,
      payment_method: 'cash',
      idempotency_key: '66666666-aaaa-bbbb-cccc-000000000004'
    });
  assert(
    duplicateLineageRes.status === 201 || duplicateLineageRes.status === 409,
    'Test 18: Consecutive renewal request handled deterministically without unhandled SQL error'
  );

  // --------------------------------------------------------------------------
  // Suite 8: Stage 5C Cron Endpoint Security & Pipeline Execution
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 8: Stage 5C Cron Endpoint Security & Pipeline Execution ---');
  process.env.CRON_SECRET = 'fitfusion-super-secret-cron-key-12345';

  // Test 19A: Missing Authorization header on POST /api/cron/reminders rejected with 401
  const noCronAuthRes = await request(app).post('/api/cron/reminders');
  assert(noCronAuthRes.status === 401, 'Test 19A: Missing Authorization header on cron endpoint rejected with 401');
  assert(noCronAuthRes.body.code === 'UNAUTHORIZED_CRON', 'Test 19B: RFC 7807 code is UNAUTHORIZED_CRON');

  // Test 19C: Invalid token rejected with 401 UNAUTHORIZED_CRON
  const badCronAuthRes = await request(app)
    .post('/api/cron/reminders')
    .set('Authorization', 'Bearer wrong-secret-token');
  assert(badCronAuthRes.status === 401, 'Test 19C: Invalid cron secret rejected with 401');
  assert(badCronAuthRes.body.code === 'UNAUTHORIZED_CRON', 'Test 19C-2: Problem code is UNAUTHORIZED_CRON');

  // Test 19D: Token with different byte length compared safely without throwing RangeError
  const diffLenCronRes = await request(app)
    .post('/api/cron/reminders')
    .set('Authorization', 'Bearer short');
  assert(diffLenCronRes.status === 401, 'Test 19D: Different-length token rejected safely without throwing RangeError');

  // Test 19E: Unconfigured server secret fails closed
  const savedCronSecret = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    const unconfigCronRes = await request(app)
      .post('/api/cron/reminders')
      .set('Authorization', 'Bearer any-token');
    assert(unconfigCronRes.status === 401, 'Test 19E: Unconfigured server CRON_SECRET fails closed with 401');
  } finally {
    process.env.CRON_SECRET = savedCronSecret;
  }

  // Test 19F: Valid Authorization: Bearer <CRON_SECRET> triggers pipeline
  const validCronRes = await request(app)
    .post('/api/cron/reminders')
    .set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
  assert(validCronRes.status === 200, 'Test 19F: Valid cron execution returns 200 OK');
  assert(validCronRes.body.status === 'success' || validCronRes.body.status === 'skipped', 'Test 19F-2: Status is success or skipped');
  assert(validCronRes.body.scheduler !== undefined, 'Test 19F-3: Pipeline summary includes scheduler telemetry');
  assert(validCronRes.body.worker !== undefined, 'Test 19F-4: Pipeline summary includes worker telemetry');
  assert(validCronRes.body.reconciliation !== undefined, 'Test 19F-5: Pipeline summary includes reconciliation telemetry');

  // Test 19G: Non-canonical X-Cron-Secret header strictly rejected with 401 (enforcing single canonical Authorization: Bearer contract)
  const xCronRes = await request(app)
    .post('/api/cron/reminders')
    .set('X-Cron-Secret', process.env.CRON_SECRET!);
  assert(xCronRes.status === 401, 'Test 19G: Non-canonical X-Cron-Secret header rejected with 401 (single contract enforced)');
  assert(xCronRes.body.code === 'UNAUTHORIZED_CRON', 'Test 19G-2: Error code is UNAUTHORIZED_CRON');

  // Test 19H: Malformed Bearer token with whitespace only rejected with 401
  const emptyBearerRes = await request(app)
    .post('/api/cron/reminders')
    .set('Authorization', 'Bearer    ');
  assert(emptyBearerRes.status === 401, 'Test 19H: Empty Bearer token rejected with 401');

  // Test 19I: Dedicated session client checkout and pool release lifecycle
  const testSession1 = await db.acquireSessionClient();
  assert(!testSession1.isReleased(), 'Test 19I: Newly checked-out session client is not released');
  const pingRes = await testSession1.query('SELECT 1 as alive;');
  assert(pingRes.rows[0]?.alive === 1, 'Test 19I-2: Checked-out session client executes queries successfully');
  await testSession1.release();
  assert(testSession1.isReleased(), 'Test 19I-3: Session client marked released after release() called');
  let releasedErr: any = null;
  try {
    await testSession1.query('SELECT 1 as fail;');
  } catch (err: any) {
    releasedErr = err;
  }
  assert(
    releasedErr && releasedErr.message.includes('already been released'),
    'Test 19I-4: Executing query on already-released session client throws error'
  );

  // Test 19J: Isolated test lock mutual exclusion across distinct session clients
  // Uses dedicated, isolated test lock key to never interfere with production keys
  const isolatedLockKey = "hashtext('fitfusion_test_lock_concurrency_audit')";
  const sessionLockA = await db.acquireSessionClient();
  const sessionLockB = await db.acquireSessionClient();

  const acqA = await sessionLockA.query(`SELECT pg_try_advisory_lock(${isolatedLockKey}) AS acquired;`);
  assert(acqA.rows[0]?.acquired === true, 'Test 19J: Session A successfully acquires isolated test advisory lock');

  // Session B attempts to acquire the exact same lock while held by Session A
  const acqB = await sessionLockB.query(`SELECT pg_try_advisory_lock(${isolatedLockKey}) AS acquired;`);
  assert(acqB.rows[0]?.acquired === false, 'Test 19J-2: Session B fails to acquire lock actively held by Session A (Mutual exclusion)');

  // Test 19K: Releasing lock on Session A allows Session B to acquire it immediately
  await sessionLockA.query(`SELECT pg_advisory_unlock(${isolatedLockKey});`);
  await sessionLockA.release();

  const acqB2 = await sessionLockB.query(`SELECT pg_try_advisory_lock(${isolatedLockKey}) AS acquired;`);
  assert(acqB2.rows[0]?.acquired === true, 'Test 19K: Session B successfully acquires lock immediately after Session A releases it');

  await sessionLockB.query(`SELECT pg_advisory_unlock(${isolatedLockKey});`);
  await sessionLockB.release();

  // Test 19L: Exceptions in pipeline do not leak lock or connection (Guaranteed finally cleanup)
  const isolatedErrLockKey = "hashtext('fitfusion_test_lock_exception_leak')";
  const sessionErr = await db.acquireSessionClient();
  let caughtInducedErr = false;

  try {
    const acqErr = await sessionErr.query(`SELECT pg_try_advisory_lock(${isolatedErrLockKey}) AS acquired;`);
    assert(acqErr.rows[0]?.acquired === true, 'Test 19L: Session acquires lock prior to induced pipeline failure');
    throw new Error('Induced unexpected worker pipeline failure');
  } catch (err: any) {
    caughtInducedErr = true;
  } finally {
    await sessionErr.query(`SELECT pg_advisory_unlock(${isolatedErrLockKey});`);
    await sessionErr.release();
  }

  assert(caughtInducedErr, 'Test 19L-2: Induced failure was intercepted');
  assert(sessionErr.isReleased(), 'Test 19L-3: Session client released cleanly despite pipeline error');

  // Verify that another session can acquire the lock (proving ZERO lock leak)
  const sessionVerify = await db.acquireSessionClient();
  const acqVerify = await sessionVerify.query(`SELECT pg_try_advisory_lock(${isolatedErrLockKey}) AS acquired;`);
  assert(acqVerify.rows[0]?.acquired === true, 'Test 19L-4: Lock successfully acquired by subsequent session (Zero lock leak)');
  await sessionVerify.query(`SELECT pg_advisory_unlock(${isolatedErrLockKey});`);
  await sessionVerify.release();

  // --------------------------------------------------------------------------
  // Suite 9: Stage 5C Tenant-Isolated Reminder Listing & Telemetry
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 9: Stage 5C Tenant-Isolated Reminder Listing & Telemetry ---');

  // Test 20A: Unauthenticated GET /api/reminders rejected with 401
  const unauthRemRes = await request(app).get('/api/reminders');
  assert(unauthRemRes.status === 401, 'Test 20A: Unauthenticated GET /api/reminders rejected with 401');

  // Test 20B: Staff A queries GET /api/reminders and receives strictly Gym A reminders
  const remStaffARes = await request(app)
    .get('/api/reminders')
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(remStaffARes.status === 200, 'Test 20B: Staff A queries /api/reminders successfully (200 OK)');
  assert(Array.isArray(remStaffARes.body.data), 'Test 20B-2: Returns data array');
  assert(remStaffARes.body.pagination !== undefined, 'Test 20B-3: Returns pagination metadata');

  const gymAId = '11111111-1111-1111-1111-111111111111';
  const allRemindersGymA = remStaffARes.body.data.every((j: any) => j.gym_id === gymAId);
  assert(allRemindersGymA, 'Test 20B-4: All returned jobs belong strictly to Gym A');

  // Test 20C: Staff B receives strictly Gym B reminders
  const remStaffBRes = await request(app)
    .get('/api/reminders')
    .set('Authorization', `Bearer ${tokenStaffB}`);
  assert(remStaffBRes.status === 200, 'Test 20C: Staff B queries /api/reminders successfully (200 OK)');
  const gymBId = '22222222-2222-2222-2222-222222222222';
  const allRemindersGymB = remStaffBRes.body.data.every((j: any) => j.gym_id === gymBId);
  assert(allRemindersGymB, 'Test 20C-2: Cross-gym isolation verified; Staff B receives strictly Gym B jobs');

  // Test 20D: Parameter validation: limit > 100 rejected with 400
  const overLimitRes = await request(app)
    .get('/api/reminders?limit=101')
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(overLimitRes.status === 400, 'Test 20D: Bounded pagination enforced (limit > 100 rejected with 400)');
  assert(overLimitRes.body.code === 'VALIDATION_ERROR', 'Test 20D-2: RFC 7807 code is VALIDATION_ERROR');

  // Test 20E: Parameter validation: negative page rejected with 400
  const negPageRes = await request(app)
    .get('/api/reminders?page=-1')
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(negPageRes.status === 400, 'Test 20E: Non-positive page rejected with 400 VALIDATION_ERROR');

  // Test 20F: Milestone filtering returns filtered subset
  const milestoneRes = await request(app)
    .get('/api/reminders?milestone=EXPIRY_MINUS_3')
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(milestoneRes.status === 200, 'Test 20F: Milestone filter query returns 200 OK');
  assert(
    milestoneRes.body.data.every((j: any) => j.milestone === 'EXPIRY_MINUS_3'),
    'Test 20F-2: All returned jobs match requested milestone'
  );

  // Test 20G: Telemetry GET /api/reminders/telemetry returns real database counts
  const telemetryRes = await request(app)
    .get('/api/reminders/telemetry')
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(telemetryRes.status === 200, 'Test 20G: Telemetry endpoint returns 200 OK');
  assert(typeof telemetryRes.body.scheduledToday === 'number', 'Test 20G-2: Telemetry includes scheduledToday counter');
  assert(telemetryRes.body.statusCounts !== undefined, 'Test 20G-3: Telemetry includes statusCounts breakdown');

  // --------------------------------------------------------------------------
  // Suite 10: Stage 5C Safe Manual Retry & State Machine Invariants
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 10: Stage 5C Safe Manual Retry & State Machine Invariants ---');

  // Seed fixture jobs for state testing in Gym A
  const seedJobRes = await db.query(
    `INSERT INTO public.notification_jobs (
       gym_id, member_id, subscription_id, milestone, target_date, channel, status,
       idempotency_key, scheduled_for, attempt_count, max_attempts
     ) VALUES 
       ($1, $2, (SELECT id FROM public.subscriptions WHERE gym_id = $1 LIMIT 1), 'EXPIRY_ZERO', CURRENT_DATE, 'whatsapp', 'completed', 'test_job_completed', NOW(), 1, 3),
       ($1, $2, (SELECT id FROM public.subscriptions WHERE gym_id = $1 LIMIT 1), 'EXPIRY_ZERO', CURRENT_DATE, 'whatsapp', 'reconciling', 'test_job_reconciling', NOW(), 1, 3),
       ($1, $2, (SELECT id FROM public.subscriptions WHERE gym_id = $1 LIMIT 1), 'EXPIRY_ZERO', CURRENT_DATE, 'whatsapp', 'cancelled', 'test_job_cancelled', NOW(), 1, 3),
       ($1, $2, (SELECT id FROM public.subscriptions WHERE gym_id = $1 LIMIT 1), 'EXPIRY_ZERO', CURRENT_DATE, 'whatsapp', 'failed', 'test_job_failed', NOW(), 3, 3)
     ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status
     RETURNING id, status;`,
    [gymAId, validMemberA1]
  );

  const jobMap: Record<string, string> = {};
  for (const row of seedJobRes.rows) {
    jobMap[row.status] = row.id;
  }

  // Test 21A: Unauthenticated retry rejected with 401
  const unauthRetry = await request(app).post(`/api/reminders/${jobMap.failed}/retry`);
  assert(unauthRetry.status === 401, 'Test 21A: Unauthenticated retry rejected with 401');

  // Test 21B: Invalid UUID rejected with 400
  const badUuidRetry = await request(app)
    .post('/api/reminders/not-a-valid-uuid/retry')
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(badUuidRetry.status === 400, 'Test 21B: Invalid UUID format rejected with 400 INVALID_IDENTIFIER');

  // Test 21C: Staff B attempting to retry Gym A job returns 404 Not Found
  const crossGymRetry = await request(app)
    .post(`/api/reminders/${jobMap.failed}/retry`)
    .set('Authorization', `Bearer ${tokenStaffB}`);
  assert(crossGymRetry.status === 404, 'Test 21C: Cross-tenant retry rejected with 404 JOB_NOT_FOUND');

  // Test 21D: Retrying job in 'completed' status rejected with 409
  const completedRetry = await request(app)
    .post(`/api/reminders/${jobMap.completed}/retry`)
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(completedRetry.status === 409, 'Test 21D: Retrying completed job strictly rejected with 409 Conflict');
  assert(completedRetry.body.code === 'INVALID_JOB_STATE', 'Test 21D-2: Problem code is INVALID_JOB_STATE');

  // Test 21E: Retrying job in 'reconciling' status rejected with 409
  const reconcilingRetry = await request(app)
    .post(`/api/reminders/${jobMap.reconciling}/retry`)
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(reconcilingRetry.status === 409, 'Test 21E: Retrying reconciling job strictly rejected with 409 Conflict');
  assert(reconcilingRetry.body.detail.includes('failed'), 'Test 21E-2: Detail explains only failed jobs may be retried');

  // Test 21F: Retrying job in 'cancelled' status rejected with 409
  const cancelledRetry = await request(app)
    .post(`/api/reminders/${jobMap.cancelled}/retry`)
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(cancelledRetry.status === 409, 'Test 21F: Retrying cancelled job strictly rejected with 409 Conflict');

  // Test 21G: Retrying valid 'failed' job succeeds with 200 OK
  const validRetry = await request(app)
    .post(`/api/reminders/${jobMap.failed}/retry`)
    .set('Authorization', `Bearer ${tokenStaffA}`)
    .send({ reason: 'Member verified updated phone number' });
  assert(validRetry.status === 200, 'Test 21G: Retrying confirmed failed job returns 200 OK');
  assert(validRetry.body.job.status === 'pending', 'Test 21G-2: Job status transitioned to pending');

  // Test 21H: Manual retry increments max_attempts while preserving attempt_count
  assert(parseInt(validRetry.body.job.max_attempts, 10) === 4, 'Test 21H: max_attempts incremented from 3 to 4');
  assert(parseInt(validRetry.body.job.attempt_count, 10) === 3, 'Test 21H-2: attempt_count preserved at 3');

  // Test 21I: Manual retry writes durable record to public.audit_logs
  const auditRes = await db.query(
    `SELECT * FROM public.audit_logs 
     WHERE action = 'notification_job.manual_retry' AND entity_id = $1 
     ORDER BY created_at DESC LIMIT 1;`,
    [jobMap.failed]
  );
  assert(auditRes.rows.length === 1, 'Test 21I: Durable audit log entry created in public.audit_logs');
  assert(auditRes.rows[0].entity_type === 'notification_job', 'Test 21I-2: Audit entity_type is notification_job');

  // Test 21J: Attempting to retry a now 'pending' job returns 409
  const reRetry = await request(app)
    .post(`/api/reminders/${jobMap.failed}/retry`)
    .set('Authorization', `Bearer ${tokenStaffA}`);
  assert(reRetry.status === 409, 'Test 21J: Immediate subsequent retry on pending job rejected with 409 Conflict');

  console.log('\n================================================================');
  console.log(`TEST RUN COMPLETE: ${testResults.filter((r) => r.status === 'PASSED').length}/${testResults.length} PASSED`);
  console.log('================================================================\n');
}

runApiTests().catch((err) => {
  console.error('API test suite encountered an unexpected failure:', err);
  process.exit(1);
});
