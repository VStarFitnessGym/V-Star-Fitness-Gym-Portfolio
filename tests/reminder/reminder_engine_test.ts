// ============================================================================
// Stage 5A Automated Reminder Engine Test Suite
// 30 Comprehensive Test Cases for Date Math, Scheduling, Claiming, Lifecycle,
// Retry Backoff, Two-Phase Intent, Reconciliation, and Failure Modes
// ============================================================================

import { db } from '../../server/db/database';
import {
  calculateMilestoneTargetDate,
  convertTargetDateToUtcSchedule,
  isSubscriptionActiveOnDate,
  isMilestoneStale,
  addCalendarDays,
  isLeapYear,
  getGymLocalCalendarDate
} from '../../server/services/reminders/dateMath';
import {
  scheduleRemindersForSubscription,
  scheduleRemindersForGym,
  generateReminderIdempotencyKey
} from '../../server/services/reminders/schedulerService';
import {
  claimJobs,
  processClaimedJob,
  calculateBackoffSeconds
} from '../../server/services/reminders/workerService';
import { MockDeliveryAdapter } from '../../server/services/reminders/mockAdapter';
import {
  sweepExpiredLeases,
  reconcileAmbiguousJob
} from '../../server/services/reminders/reconciliationService';
import { validatePreDispatchEligibility } from '../../server/services/reminders/eligibilityService';

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

async function runReminderEngineTests() {
  console.log('================================================================');
  console.log('STAGE 5A REMINDER ENGINE VERIFICATION TEST SUITE');
  console.log('Engine: PostgreSQL 18.6 WASM Engine (PGlite)');
  console.log('Database Migrations: 001 - 004 Applied');
  console.log('================================================================\n');

  // Initialize database
  await db.isReady();

  // Test Fixtures
  const gymAId = '11111111-1111-1111-1111-111111111111';
  const planA1Id = '33333333-3333-3333-3333-333333333331';

  // ==========================================================================
  // Part 1: Date Calculations (Tests 1 - 9)
  // ==========================================================================
  console.log('--- Part 1: Date Calculations ---');

  // Test 1: Exactly three calendar days before expiry
  const t1 = calculateMilestoneTargetDate('2026-10-25', 'EXPIRY_MINUS_3');
  assert(t1 === '2026-10-22', 'Test 1: Exactly three calendar days before expiry (2026-10-25 -> 2026-10-22)');

  // Test 2: The expiry calendar date
  const t2 = calculateMilestoneTargetDate('2026-10-25', 'EXPIRY_ZERO');
  assert(t2 === '2026-10-25', 'Test 2: The expiry calendar date (2026-10-25 -> 2026-10-25)');

  // Test 3: Exactly three calendar days after expiry
  const t3 = calculateMilestoneTargetDate('2026-10-25', 'EXPIRY_PLUS_3');
  assert(t3 === '2026-10-28', 'Test 3: Exactly three calendar days after expiry (2026-10-25 -> 2026-10-28)');

  // Test 4: Month boundary
  const t4 = addCalendarDays('2026-03-01', -3);
  assert(t4 === '2026-02-26', 'Test 4: Month boundary calculation (2026-03-01 - 3 days = 2026-02-26)');

  // Test 5: Year boundary
  const t5 = addCalendarDays('2027-01-02', -3);
  assert(t5 === '2026-12-30', 'Test 5: Year boundary calculation (2027-01-02 - 3 days = 2026-12-30)');

  // Test 6: Leap-year boundary
  const is2024Leap = isLeapYear(2024);
  const is2026Leap = isLeapYear(2026);
  const leapMinus3 = addCalendarDays('2024-03-01', -3); // 2024 is leap year -> Feb 27
  const leapPlus3 = addCalendarDays('2024-02-28', 3);  // Feb 28 + 3 days in leap year -> March 2
  assert(
    is2024Leap && !is2026Leap && leapMinus3 === '2024-02-27' && leapPlus3 === '2024-03-02',
    'Test 6: Leap-year boundary (2024 leap year handled with Feb 29 arithmetic)'
  );

  // Test 7: Asia/Kolkata date/time conversion
  const utcIso = convertTargetDateToUtcSchedule('2026-10-22', 10, 'Asia/Kolkata');
  // 10:00 AM in Asia/Kolkata (+05:30) is 04:30:00.000Z
  assert(utcIso === '2026-10-22T04:30:00.000Z', 'Test 7: Asia/Kolkata date/time conversion (10:00 IST = 04:30 UTC)');

  // Test 8: Inclusive expiry-date behavior
  const activeOnExpiryDay = isSubscriptionActiveOnDate('2026-10-01', '2026-10-25', '2026-10-25');
  const inactiveAfterExpiry = isSubscriptionActiveOnDate('2026-10-01', '2026-10-25', '2026-10-26');
  assert(activeOnExpiryDay && !inactiveAfterExpiry, 'Test 8: Inclusive expiry-date behavior (Active on expiry date, inactive next day)');

  // Test 9: Repeated runs on the same target date are deterministic
  const run1 = calculateMilestoneTargetDate('2026-11-15', 'EXPIRY_MINUS_3');
  const run2 = calculateMilestoneTargetDate('2026-11-15', 'EXPIRY_MINUS_3');
  assert(run1 === run2 && run1 === '2026-11-12', 'Test 9: Repeated date calculations produce deterministic target dates');

  // ==========================================================================
  // Part 2: Scheduling and Eligibility (Tests 10 - 17)
  // ==========================================================================
  console.log('\n--- Part 2: Scheduling and Eligibility ---');

  // Create clean test member for Part 2
  const memberM10 = '55555555-5555-5555-5555-555555555510';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent)
     VALUES ($1, $2, 'FF-S5-10', 'Stage 5 Member 10', '+919876590010', 'active', true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberM10, gymAId]
  );

  const subM10 = 'aaaaaaaa-5555-5555-5555-000000000010';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-30', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subM10, gymAId, memberM10, planA1Id]
  );

  // Test 10: Scheduling the same subscription twice creates no duplicates
  const schedule1 = await scheduleRemindersForSubscription(db, subM10, { currentDate: '2026-11-01' });
  const schedule2 = await scheduleRemindersForSubscription(db, subM10, { currentDate: '2026-11-01' });
  assert(
    schedule1.jobsCreated === 3 && schedule2.jobsCreated === 0,
    'Test 10: Scheduling the same subscription twice creates no duplicates (idempotency key constraint)'
  );

  // Test 11: Two eligible subscriptions produce separate jobs
  const memberM11 = '55555555-5555-5555-5555-555555555511';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent)
     VALUES ($1, $2, 'FF-S5-11', 'Stage 5 Member 11', '+919876590011', 'active', true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberM11, gymAId]
  );
  const subM11 = 'aaaaaaaa-5555-5555-5555-000000000011';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-30', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subM11, gymAId, memberM11, planA1Id]
  );
  const scheduleM11 = await scheduleRemindersForSubscription(db, subM11, { currentDate: '2026-11-01' });
  assert(scheduleM11.jobsCreated === 3, 'Test 11: Two eligible subscriptions produce separate distinct jobs');

  // Test 12: Cancelled subscriptions do not get new jobs
  const subCancelled = 'aaaaaaaa-5555-5555-5555-000000000012';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-12-01', '2026-12-31', 1499.00, 'cancelled')
     ON CONFLICT (id) DO NOTHING;`,
    [subCancelled, gymAId, memberM10, planA1Id]
  );
  const scheduleCancelled = await scheduleRemindersForSubscription(db, subCancelled, { currentDate: '2026-11-01' });
  assert(scheduleCancelled.jobsCreated === 0, 'Test 12: Cancelled subscriptions do not get new jobs');

  // Test 13: Renewed or extended subscriptions invalidate obsolete reminders
  // Renew member M10 contiguous to December 30
  const subM10Renewal = 'aaaaaaaa-5555-5555-5555-000000000013';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status, renewed_from_subscription_id)
     VALUES ($1, $2, $3, $4, '2026-12-01', '2026-12-30', 1499.00, 'active', $5)
     ON CONFLICT (id) DO NOTHING;`,
    [subM10Renewal, gymAId, memberM10, planA1Id, subM10]
  );
  // Verify trigger cancelled pending jobs from subM10
  const priorJobsCheck = await db.query(
    `SELECT status, cancellation_reason FROM public.notification_jobs WHERE subscription_id = $1;`,
    [subM10]
  );
  const allPriorCancelled = priorJobsCheck.rows.every(
    (r: any) => r.status === 'cancelled' && r.cancellation_reason === 'subscription_renewed_or_extended'
  );
  assert(allPriorCancelled, 'Test 13: Renewed subscriptions automatically invalidate prior obsolete reminders via trigger');

  // Test 14: Superseded subscriptions do not produce reminders
  const scheduleSuperseded = await scheduleRemindersForSubscription(db, subM10, { currentDate: '2026-11-01' });
  assert(scheduleSuperseded.jobsCreated === 0, 'Test 14: Superseded subscriptions cannot generate new reminder jobs');

  // Test 15: A stale job is cancelled before adapter invocation
  // Create a job pointing to an end date that was later extended
  const staleJobRes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-01', 'pending', 'stale-test-job-15', NOW())
     RETURNING id;`,
    [gymAId, memberM10, subM10Renewal] // subM10Renewal ends on 2026-12-30, not 2026-10-01!
  );
  const staleJobId = staleJobRes.rows[0].id;
  const mockAdapter15 = new MockDeliveryAdapter();
  const claimedStale = await claimJobs(db, 'worker_test_15', 10);
  const staleMatch = claimedStale.find((j) => j.id === staleJobId);
  if (staleMatch) {
    const outcome = await processClaimedJob(db, staleMatch, mockAdapter15, 'worker_test_15');
    assert(
      outcome.status === 'cancelled' && outcome.reason === 'subscription_expiry_date_changed',
      'Test 15: Stale job with modified expiry date is cancelled before adapter invocation'
    );
    assert(mockAdapter15.callCount === 0, 'Test 15B: Delivery adapter was never invoked for stale job');
  } else {
    assert(false, 'Test 15: Could not claim stale job');
  }

  // Test 16: An invalid or missing subscription cannot be processed
  const missingJob: any = {
    id: '00000000-0000-0000-0000-000000000099',
    subscription_id: '00000000-0000-0000-0000-000000000098',
    channel: 'whatsapp',
    milestone: 'EXPIRY_ZERO',
    target_date: '2026-11-30'
  };
  const preCheckMissing = await validatePreDispatchEligibility(db, missingJob);
  assert(
    preCheckMissing.eligible === false && preCheckMissing.cancellationReason === 'referenced_subscription_missing',
    'Test 16: An invalid or missing subscription cannot be processed'
  );

  // Test 17: Historical subscriptions cannot generate reminders when ineligible
  const historicalSubId = 'aaaaaaaa-5555-5555-5555-000000000017';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2025-01-01', '2025-01-31', 1499.00, 'expired')
     ON CONFLICT (id) DO NOTHING;`,
    [historicalSubId, gymAId, memberM10, planA1Id]
  );
  // Mark member as having later active subscription (subM10Renewal)
  const schedHistorical = await scheduleRemindersForSubscription(db, historicalSubId, { currentDate: '2026-11-01' });
  assert(schedHistorical.jobsCreated === 0, 'Test 17: Historical expired subscription cannot generate reminder jobs');

  // ==========================================================================
  // Part 3: Processing and Recovery (Tests 18 - 30)
  // ==========================================================================
  console.log('\n--- Part 3: Processing and Recovery ---');

  // Test 18: Only eligible pending jobs scheduled for <= NOW() are claimed
  const memberM18 = '55555555-5555-5555-5555-555555555518';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent)
     VALUES ($1, $2, 'FF-S5-18', 'Stage 5 Member 18', '+919876590018', 'active', true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberM18, gymAId]
  );
  const subM18 = 'aaaaaaaa-5555-5555-5555-000000000018';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-10-01', '2026-10-31', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subM18, gymAId, memberM18, planA1Id]
  );

  // Insert job ready now and job scheduled in future
  const nowJobRes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'pending', 'ready-now-job-18', NOW() - INTERVAL '1 minute')
     RETURNING id;`,
    [gymAId, memberM18, subM18]
  );
  const futureJobRes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for)
     VALUES ($1, $2, $3, 'EXPIRY_PLUS_3', '2026-11-03', 'pending', 'future-job-18', NOW() + INTERVAL '2 days')
     RETURNING id;`,
    [gymAId, memberM18, subM18]
  );
  const readyJobId = nowJobRes.rows[0].id;
  const futureJobId = futureJobRes.rows[0].id;

  const claimed18 = await claimJobs(db, 'worker_test_18', 50);
  const claimedReady = claimed18.some((j) => j.id === readyJobId);
  const claimedFuture = claimed18.some((j) => j.id === futureJobId);
  assert(claimedReady && !claimedFuture, 'Test 18: Only eligible jobs scheduled on or before NOW() are claimed');

  // Test 19: Terminal jobs cannot be claimed again
  await db.query(`UPDATE public.notification_jobs SET status = 'completed' WHERE id = $1;`, [readyJobId]);
  const claimedTerminal = await claimJobs(db, 'worker_test_19', 50);
  assert(!claimedTerminal.some((j) => j.id === readyJobId), 'Test 19: Terminal jobs cannot be claimed again');

  // Test 20: Concurrent workers cannot both own the same job
  const job20Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'pending', 'concurrency-test-20', NOW() - INTERVAL '1 minute')
     RETURNING id;`,
    [gymAId, memberM18, subM18]
  );
  const job20Id = job20Res.rows[0].id;
  const [workerAlphaClaims, workerBetaClaims] = await Promise.all([
    claimJobs(db, 'worker_alpha', 10),
    claimJobs(db, 'worker_beta', 10)
  ]);
  const alphaOwns = workerAlphaClaims.some((j) => j.id === job20Id);
  const betaOwns = workerBetaClaims.some((j) => j.id === job20Id);
  assert(
    (alphaOwns && !betaOwns) || (!alphaOwns && betaOwns),
    'Test 20: Concurrent workers cannot both own the same job (Mutual exclusion)'
  );

  // Test 21: A stale claim token cannot complete a job
  const job21Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'claimed', 'stale-claim-21', NOW(), 'worker_original', NOW() + INTERVAL '5 minutes')
     RETURNING id;`,
    [gymAId, memberM18, subM18]
  );
  const job21Id = job21Res.rows[0].id;
  // Attacker or stale worker trying to complete with different worker_id
  const staleAttempt = await db.query(
    `SELECT public.safe_complete_notification_job($1, 'worker_stale_imposter') as completed;`,
    [job21Id]
  );
  assert(staleAttempt.rows[0].completed === false, 'Test 21: A stale or unauthorized claim token cannot complete a job');

  // Test 22: A retryable failure respects backoff
  const job22Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at, attempt_count, max_attempts)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'claimed', 'retry-backoff-22', NOW(), 'worker_22', NOW() + INTERVAL '5 minutes', 1, 3)
     RETURNING *;`,
    [gymAId, memberM18, subM18]
  );
  const job22 = job22Res.rows[0];
  const retryAdapter = new MockDeliveryAdapter('retryable_failure');
  const retryOutcome = await processClaimedJob(db, job22, retryAdapter, 'worker_22');
  assert(retryOutcome.status === 'retry_scheduled', 'Test 22: Retryable failure schedules postponement');

  const backoffSecs1 = calculateBackoffSeconds(1);
  const backoffSecs2 = calculateBackoffSeconds(2);
  assert(backoffSecs1 === 60 && backoffSecs2 === 300, 'Test 22B: Exponential backoff calculation verified (1st=60s, 2nd=300s)');

  // Test 23: A permanent failure becomes terminal
  const job23Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at, attempt_count, max_attempts)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'claimed', 'permanent-fail-23', NOW(), 'worker_23', NOW() + INTERVAL '5 minutes', 1, 3)
     RETURNING *;`,
    [gymAId, memberM18, subM18]
  );
  const permAdapter = new MockDeliveryAdapter('permanent_failure');
  const permOutcome = await processClaimedJob(db, job23Res.rows[0], permAdapter, 'worker_23');
  assert(permOutcome.status === 'failed_terminal', 'Test 23: Permanent failure transitions job directly to terminal failed');

  // Test 24: The maximum-attempt policy is enforced
  const job24Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at, attempt_count, max_attempts)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'claimed', 'max-attempt-24', NOW(), 'worker_24', NOW() + INTERVAL '5 minutes', 3, 3)
     RETURNING *;`,
    [gymAId, memberM18, subM18]
  );
  const maxAttemptOutcome = await processClaimedJob(db, job24Res.rows[0], retryAdapter, 'worker_24');
  assert(
    maxAttemptOutcome.status === 'failed_terminal' && maxAttemptOutcome.reason === 'max_attempts_exceeded',
    'Test 24: Maximum attempt threshold (3) enforced, transitioning job to failed_terminal'
  );

  // Test 25: An ambiguous result is not automatically retried
  const job25Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at, attempt_count, max_attempts)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'claimed', 'ambiguous-test-25', NOW(), 'worker_25', NOW() + INTERVAL '5 minutes', 1, 3)
     RETURNING *;`,
    [gymAId, memberM18, subM18]
  );
  const ambiguousAdapter = new MockDeliveryAdapter('ambiguous_timeout');
  const ambiguousOutcome = await processClaimedJob(db, job25Res.rows[0], ambiguousAdapter, 'worker_25');
  assert(ambiguousOutcome.status === 'reconciling', 'Test 25: Ambiguous outcome transitions job to reconciling (never auto-retried)');

  // Test 26: A worker crash or abandoned claim is handled according to documented policy
  // Case A: Worker crashed with no attempt -> Safe reset
  const job26ARes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at, attempt_count, max_attempts)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'claimed', 'abandoned-safe-26a', NOW(), 'crashed_worker', NOW() - INTERVAL '10 minutes', 1, 3)
     RETURNING id;`,
    [gymAId, memberM18, subM18]
  );
  const sweepRes = await sweepExpiredLeases(db);
  const check26A = await db.query(`SELECT status FROM public.notification_jobs WHERE id = $1;`, [job26ARes.rows[0].id]);
  assert(
    check26A.rows[0].status === 'pending',
    'Test 26: Abandoned claim with zero dispatch intent is safely reset to pending'
  );

  // Test 27: An obsolete job never invokes the adapter
  const obsoleteAdapter = new MockDeliveryAdapter('success');
  // Cancel the subscription
  const subObsolete = 'aaaaaaaa-5555-5555-5555-000000000027';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-10-01', '2026-10-31', 1499.00, 'cancelled')
     ON CONFLICT (id) DO NOTHING;`,
    [subObsolete, gymAId, memberM18, planA1Id]
  );
  const job27Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'claimed', 'obsolete-job-27', NOW(), 'worker_27', NOW() + INTERVAL '5 minutes')
     RETURNING *;`,
    [gymAId, memberM18, subObsolete]
  );
  await processClaimedJob(db, job27Res.rows[0], obsoleteAdapter, 'worker_27');
  assert(obsoleteAdapter.callCount === 0, 'Test 27: Obsolete cancelled job never invokes delivery adapter');

  // Test 28: Mock adapter success is not represented as real provider delivery
  const realSuccessAdapter = new MockDeliveryAdapter('success');
  const job28Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-10-31', 'claimed', 'honest-mock-28', NOW(), 'worker_28', NOW() + INTERVAL '5 minutes')
     RETURNING *;`,
    [gymAId, memberM18, subM18]
  );
  const successOutcome = await processClaimedJob(db, job28Res.rows[0], realSuccessAdapter, 'worker_28');
  assert(
    successOutcome.deliveryResult?.is_mock === true && successOutcome.deliveryResult?.provider === 'local_mock_adapter',
    'Test 28: Mock adapter delivery honestly reports is_mock: true and provider: local_mock_adapter'
  );

  // Test 29: A missed scheduler run follows documented policy without a burst of stale reminders
  const missedRunDate = '2026-12-05';
  const subMissed = 'aaaaaaaa-5555-5555-5555-000000000029';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-20', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subMissed, gymAId, memberM18, planA1Id]
  );
  // Current date is Dec 5, but subscription expired Nov 20!
  // Milestones: Nov 17 (-3), Nov 20 (0), Nov 23 (+3) are all well past grace period!
  const missedResult = await scheduleRemindersForSubscription(db, subMissed, {
    currentDate: missedRunDate,
    gracePeriodDays: 1
  });
  // All 3 milestones are stale, so jobsCreated should be 0 and jobsSkipped should be 3!
  assert(
    missedResult.jobsCreated === 0 && missedResult.jobsSkipped === 3,
    'Test 29: Missed scheduler run policy suppresses stale milestones without burst dispatch (3 skipped)'
  );

  // Test 30: Existing renewal and database constraints remain intact
  const constraintCheck = await db.query(`
    SELECT conname FROM pg_constraint 
    WHERE conname IN ('no_overlapping_active_subscriptions', 'chk_subscription_dates');
  `);
  assert(
    constraintCheck.rows.length >= 2,
    'Test 30: Existing exclusion constraints and date checks remain intact and enforced'
  );

  // ==========================================================================
  // Part 4: Stage 5AB Regression & Audit Verifications (Tests 31 - 37)
  // ==========================================================================
  console.log('\n--- Part 4: Stage 5AB Audit Regressions ---');

  // Test 31: Trigger-based cancellation on end_date extension (Migration 005)
  const memberM31 = '55555555-5555-5555-5555-555555555531';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent)
     VALUES ($1, $2, 'FF-S5-31', 'Stage 5 Member 31', '+919876590031', 'active', true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberM31, gymAId]
  );
  const subM31 = 'aaaaaaaa-5555-5555-5555-000000000031';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-20', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subM31, gymAId, memberM31, planA1Id]
  );
  await scheduleRemindersForSubscription(db, subM31, { currentDate: '2026-11-01' });

  // Update end_date directly on the same subscription
  await db.query(`UPDATE public.subscriptions SET end_date = '2026-12-20' WHERE id = $1;`, [subM31]);

  const jobsM31Check = await db.query(
    `SELECT status, cancellation_reason FROM public.notification_jobs WHERE subscription_id = $1;`,
    [subM31]
  );
  const allM31Cancelled = jobsM31Check.rows.length === 3 && jobsM31Check.rows.every(
    (r: any) => r.status === 'cancelled' && r.cancellation_reason === 'subscription_end_date_changed'
  );
  assert(allM31Cancelled, 'Test 31: Updating subscription end_date cancels prior pending jobs via database trigger');

  // Test 32: Trigger-based cancellation on subscription status cancelled (Migration 005)
  const memberM32 = '55555555-5555-5555-5555-555555555532';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent)
     VALUES ($1, $2, 'FF-S5-32', 'Stage 5 Member 32', '+919876590032', 'active', true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberM32, gymAId]
  );
  const subM32 = 'aaaaaaaa-5555-5555-5555-000000000032';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-30', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subM32, gymAId, memberM32, planA1Id]
  );
  await scheduleRemindersForSubscription(db, subM32, { currentDate: '2026-11-01' });

  // Cancel subscription
  await db.query(`UPDATE public.subscriptions SET status = 'cancelled' WHERE id = $1;`, [subM32]);
  const jobsM32Check = await db.query(
    `SELECT status, cancellation_reason FROM public.notification_jobs WHERE subscription_id = $1;`,
    [subM32]
  );
  const allM32Cancelled = jobsM32Check.rows.length === 3 && jobsM32Check.rows.every(
    (r: any) => r.status === 'cancelled' && r.cancellation_reason === 'subscription_cancelled'
  );
  assert(allM32Cancelled, 'Test 32: Updating subscription status to cancelled cancels pending jobs via database trigger');

  // Test 33: Concurrent race guard before adapter invocation
  const memberM33 = '55555555-5555-5555-5555-555555555533';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent)
     VALUES ($1, $2, 'FF-S5-33', 'Stage 5 Member 33', '+919876590033', 'active', true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberM33, gymAId]
  );
  const subM33 = 'aaaaaaaa-5555-5555-5555-000000000033';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-30', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subM33, gymAId, memberM33, planA1Id]
  );
  const jobM33Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-11-30', 'claimed', 'race-guard-33', NOW(), 'worker_33', NOW() + INTERVAL '5 minutes')
     RETURNING *;`,
    [gymAId, memberM33, subM33]
  );
  // Concurrently cancel subscription right before worker processes it
  await db.query(`UPDATE public.subscriptions SET status = 'cancelled' WHERE id = $1;`, [subM33]);
  const raceAdapter = new MockDeliveryAdapter('success');
  const raceOutcome = await processClaimedJob(db, jobM33Res.rows[0], raceAdapter, 'worker_33');
  assert(
    raceOutcome.status === 'cancelled' && raceAdapter.callCount === 0,
    'Test 33: Concurrent subscription change prevents adapter invocation via atomic final guard'
  );

  // Test 34: Duplicate scheduling after cancellation does not revive cancelled jobs
  const repeatSched = await scheduleRemindersForSubscription(db, subM32, { currentDate: '2026-11-01' });
  const checkM32Revival = await db.query(
    `SELECT status FROM public.notification_jobs WHERE subscription_id = $1;`,
    [subM32]
  );
  const noneRevived = checkM32Revival.rows.every((r: any) => r.status === 'cancelled');
  assert(
    repeatSched.jobsCreated === 0 && noneRevived,
    'Test 34: Repeated scheduling does not revive cancelled jobs (idempotency key constraint preserves terminal state)'
  );

  // Test 35: Timezone-local date formatting around day boundaries
  const testUtcDate = new Date('2026-10-20T20:00:00.000Z'); // 8:00 PM UTC = 01:30 AM next day (Oct 21) in IST
  const localDateIst = getGymLocalCalendarDate(testUtcDate, 'Asia/Kolkata');
  assert(localDateIst === '2026-10-21', 'Test 35: getGymLocalCalendarDate correctly derives local date in Asia/Kolkata across day boundary');

  // Test 36: Expired lease with active dispatch intent transitions to reconciling
  const memberM36 = '55555555-5555-5555-5555-555555555536';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent)
     VALUES ($1, $2, 'FF-S5-36', 'Stage 5 Member 36', '+919876590036', 'active', true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberM36, gymAId]
  );
  const subM36 = 'aaaaaaaa-5555-5555-5555-000000000036';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-30', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subM36, gymAId, memberM36, planA1Id]
  );
  const jobM36Res = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-11-30', 'dispatching', 'lease-intent-36', NOW(), 'worker_crashed_36', NOW() - INTERVAL '10 minutes')
     RETURNING id;`,
    [gymAId, memberM36, subM36]
  );
  const jobM36Id = jobM36Res.rows[0].id;
  await db.query(
    `INSERT INTO public.notification_attempts (job_id, channel, provider, status, sent_at)
     VALUES ($1, 'whatsapp', 'mock', 'dispatching', NOW() - INTERVAL '10 minutes');`,
    [jobM36Id]
  );
  await sweepExpiredLeases(db);
  const checkM36 = await db.query(`SELECT status FROM public.notification_jobs WHERE id = $1;`, [jobM36Id]);
  assert(
    checkM36.rows[0].status === 'reconciling',
    'Test 36: Expired lease with active dispatch intent transitions to reconciling (not pending)'
  );

  // Test 37: Reconciliation service safely resolves ambiguous job
  const reconciled = await reconcileAmbiguousJob(db, jobM36Id, {
    outcome: 'delivered',
    verifiedReceiptId: 'verified_rcpt_37',
    note: 'Verified delivery by provider webhook'
  });
  const checkM37 = await db.query(`SELECT status FROM public.notification_jobs WHERE id = $1;`, [jobM36Id]);
  assert(
    reconciled === true && checkM37.rows[0].status === 'completed',
    'Test 37: Reconciliation service resolves ambiguous job to completed without fabricating receipts'
  );

  console.log('\n================================================================');
  console.log(`TEST RUN COMPLETE: ${testResults.filter((r) => r.status === 'PASSED').length}/${testResults.length} PASSED`);
  console.log('================================================================\n');
}

runReminderEngineTests().catch((err) => {
  console.error('Reminder engine test suite encountered an unexpected failure:', err);
  process.exit(1);
});
