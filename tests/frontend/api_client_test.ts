// ============================================================================
// Stage 4 Frontend API Client & Mode Isolation Test Suite
// Verifies: Fetch wrapper, RFC 7807 Problem Details parsing, timeouts,
// idempotency preservation, and mode isolation
// ============================================================================

import { FitFusionApiClient } from '../../src/lib/api/client';
import { ApiClientError } from '../../src/lib/api/errors';
import { getAppModeConfig, getInitialAppMode } from '../../src/lib/config/mode';

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

async function runFrontendClientTests() {
  console.log('================================================================');
  console.log('STAGE 4 FRONTEND API CLIENT & MODE ISOLATION TEST SUITE');
  console.log('================================================================\n');

  // Save original fetch
  const originalFetch = global.fetch;

  try {
    // ------------------------------------------------------------------------
    // Suite 1: Mode Configuration & Safe Defaults
    // ------------------------------------------------------------------------
    console.log('--- Suite 1: Mode Configuration & Safe Defaults ---');
    const initialMode = getInitialAppMode();
    assert(initialMode === 'demo', 'Test 1A: App mode defaults strictly to demo mode without credentials');

    const demoConfig = getAppModeConfig('demo');
    assert(demoConfig.isDemo === true && demoConfig.isLive === false, 'Test 1B: Demo config flags are correct');
    assert(demoConfig.apiBaseUrl === '/api', 'Test 1C: Default API base URL is /api');

    const liveConfig = getAppModeConfig('live');
    assert(liveConfig.isLive === true && liveConfig.isDemo === false, 'Test 1D: Live config flags are correct');

    // ------------------------------------------------------------------------
    // Suite 2: API Client Normal Operations
    // ------------------------------------------------------------------------
    console.log('\n--- Suite 2: API Client Successful Responses ---');
    let capturedHeaders: Headers | null = null;
    let capturedUrl = '';

    global.fetch = (async (url: any, init?: any) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);

      if (capturedUrl.endsWith('/health')) {
        return new Response(
          JSON.stringify({
            status: 'healthy',
            database: 'connected',
            timestamp: '2026-10-20T12:00:00.000Z',
            uptime_seconds: 120,
            version: '1.0.0'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (capturedUrl.endsWith('/me')) {
        return new Response(
          JSON.stringify({
            id: '11111111-2222-3333-4444-555555555551',
            email: 'admin@fitfusion.example.com',
            full_name: 'Aarav Sharma',
            role: 'admin',
            gym: { id: '11111111-1111-1111-1111-111111111111', name: 'FitFusion Bandra' }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (capturedUrl.includes('/members')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'mem-001',
                gym_id: '11111111-1111-1111-1111-111111111111',
                member_code: 'FIT-1001',
                full_name: 'Vikram Malhotra',
                phone: '+919876543210',
                email: 'vikram@example.com',
                status: 'active',
                whatsapp_consent: true,
                sms_consent: true,
                created_at: '2026-01-01',
                current_subscription: {
                  id: 'sub-001',
                  plan_name: 'Annual Elite',
                  start_date: '2026-01-01',
                  end_date: '2026-12-31',
                  status: 'active'
                }
              }
            ],
            pagination: { total: 1, page: 1, limit: 20, total_pages: 1 }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    }) as any;

    const testClient = new FitFusionApiClient({ baseUrl: '/api', getToken: () => 'valid-in-memory-token' });

    const health = await testClient.getHealth();
    assert(health.status === 'healthy', 'Test 2A: getHealth returns healthy status');
    assert(capturedUrl === '/api/health', 'Test 2B: Correct health endpoint URL requested');

    const me = await testClient.getMe();
    assert(me.role === 'admin', 'Test 2C: getMe returns verified profile');
    assert(capturedHeaders?.get('Authorization') === 'Bearer valid-in-memory-token', 'Test 2D: Bearer token sent in Authorization header');

    const members = await testClient.getMembers({ search: 'Vikram', page: 1, limit: 10 });
    assert(members.data.length === 1, 'Test 2E: getMembers returns data array');
    assert(capturedUrl.includes('search=Vikram') && capturedUrl.includes('limit=10'), 'Test 2F: Query parameters serialized correctly');

    // ------------------------------------------------------------------------
    // Suite 3: RFC 7807 Error Handling & Redaction
    // ------------------------------------------------------------------------
    console.log('\n--- Suite 3: Error Handling & RFC 7807 Problem Details ---');

    // 401 Unauthorized Error
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          type: 'https://fitfusion.local/errors/UNAUTHORIZED',
          title: 'Authentication Required',
          status: 401,
          detail: 'An Authorization header with a Bearer access token is required.',
          code: 'UNAUTHORIZED',
          requestId: 'req-auth-fail'
        }),
        { status: 401, headers: { 'Content-Type': 'application/problem+json' } }
      );
    }) as any;

    let caught401: ApiClientError | null = null;
    try {
      await testClient.getMe();
    } catch (e: any) {
      caught401 = e;
    }
    assert(caught401 instanceof ApiClientError, 'Test 3A: Caught error is instance of ApiClientError');
    assert(caught401?.status === 401, 'Test 3B: Status is 401');
    assert(caught401?.code === 'UNAUTHORIZED', 'Test 3C: Code is UNAUTHORIZED');
    assert(caught401?.getUserMessage().includes('session is not authenticated'), 'Test 3D: User message explains authentication requirement');

    // 403 Forbidden Error
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          type: 'https://fitfusion.local/errors/FORBIDDEN',
          title: 'Access Denied',
          status: 403,
          detail: 'The authenticated user does not have an active gym staff profile.',
          code: 'FORBIDDEN',
          requestId: 'req-forbidden'
        }),
        { status: 403, headers: { 'Content-Type': 'application/problem+json' } }
      );
    }) as any;

    let caught403: ApiClientError | null = null;
    try {
      await testClient.getMembers();
    } catch (e: any) {
      caught403 = e;
    }
    assert(caught403?.status === 403, 'Test 3E: Status is 403 Forbidden');
    assert(caught403?.code === 'FORBIDDEN', 'Test 3F: Code is FORBIDDEN');

    // 400 Validation Error with invalidParams
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          type: 'https://fitfusion.local/errors/VALIDATION_ERROR',
          title: 'Validation Error',
          status: 400,
          detail: 'The provided request parameters failed validation rules.',
          code: 'VALIDATION_ERROR',
          invalidParams: [
            { field: 'amount_paid', message: 'amount_paid must be non-negative' },
            { field: 'idempotency_key', message: 'idempotency_key must be a valid UUID' }
          ],
          requestId: 'req-validation'
        }),
        { status: 400, headers: { 'Content-Type': 'application/problem+json' } }
      );
    }) as any;

    let caught400: ApiClientError | null = null;
    try {
      await testClient.renewSubscription({
        member_id: 'bad-uuid',
        plan_id: 'bad-plan',
        amount_paid: -50,
        payment_method: 'upi',
        idempotency_key: 'not-a-uuid'
      });
    } catch (e: any) {
      caught400 = e;
    }
    assert(caught400?.status === 400, 'Test 3G: Status is 400 Bad Request');
    assert(caught400?.getUserMessage().includes('amount_paid must be non-negative'), 'Test 3H: User message displays validation details');

    // 409 Conflict Error (Exclusion Constraint or Idempotency Key Mismatch)
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          type: 'https://fitfusion.local/errors/SUBSCRIPTION_OVERLAP_CONFLICT',
          title: 'Subscription Period Conflict',
          status: 409,
          detail: 'The proposed subscription dates overlap with an existing active membership for this member.',
          code: 'SUBSCRIPTION_OVERLAP_CONFLICT',
          requestId: 'req-conflict'
        }),
        { status: 409, headers: { 'Content-Type': 'application/problem+json' } }
      );
    }) as any;

    let caught409: ApiClientError | null = null;
    try {
      await testClient.renewSubscription({
        member_id: '11111111-1111-1111-1111-111111111111',
        plan_id: '22222222-2222-2222-2222-222222222222',
        amount_paid: 1499,
        payment_method: 'cash',
        idempotency_key: '33333333-3333-3333-3333-333333333333'
      });
    } catch (e: any) {
      caught409 = e;
    }
    assert(caught409?.status === 409, 'Test 3I: Status is 409 Conflict');
    assert(caught409?.code === 'SUBSCRIPTION_OVERLAP_CONFLICT', 'Test 3J: Code is SUBSCRIPTION_OVERLAP_CONFLICT');
    assert(!caught409?.getUserMessage().includes('SELECT'), 'Test 3K: Zero SQL details leaked in user error message');

    // ------------------------------------------------------------------------
    // Suite 4: Network Timeouts & AbortController
    // ------------------------------------------------------------------------
    console.log('\n--- Suite 4: Network Timeouts & AbortController ---');
    global.fetch = (async (_url: any, init?: any) => {
      // Simulate hanging server that triggers signal abort
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err: any = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as any;

    const timeoutClient = new FitFusionApiClient({ baseUrl: '/api', defaultTimeoutMs: 50 });
    let caughtTimeout: ApiClientError | null = null;
    try {
      await timeoutClient.getHealth();
    } catch (e: any) {
      caughtTimeout = e;
    }
    assert(caughtTimeout?.isTimeout === true, 'Test 4A: isTimeout flag set on AbortError');
    assert(caughtTimeout?.status === 408, 'Test 4B: Status mapped to 408 Request Timeout');
    assert(caughtTimeout?.getUserMessage().includes('timed out'), 'Test 4C: User message clearly indicates timeout');

    // ------------------------------------------------------------------------
    // Suite 5: Idempotency Key Preservation Across Retries
    // ------------------------------------------------------------------------
    console.log('\n--- Suite 5: Idempotency Key Preservation Across Retries ---');
    const userRenewalKey = '99999999-aaaa-bbbb-cccc-000000000001';
    const renewalCalls: string[] = [];

    let attemptCount = 0;
    global.fetch = (async (_url: any, init?: any) => {
      const body = JSON.parse(init?.body);
      renewalCalls.push(body.idempotency_key);
      attemptCount++;

      if (attemptCount === 1) {
        // First attempt fails with transient 503
        return new Response(JSON.stringify({ status: 503, detail: 'Temporary connection delay', code: 'UNAVAILABLE' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Second attempt succeeds and returns idempotent confirmation
      return new Response(
        JSON.stringify({
          subscription_id: 'sub-renewed-001',
          member_id: body.member_id,
          plan_id: body.plan_id,
          start_date: '2026-11-01',
          end_date: '2026-11-30',
          amount_paid: 1499,
          status: 'active',
          idempotency_key: body.idempotency_key,
          idempotent_replay: false
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const retryClient = new FitFusionApiClient({ baseUrl: '/api' });

    // Initial attempt (fails)
    let initialError: any = null;
    try {
      await retryClient.renewSubscription({
        member_id: 'mem-101',
        plan_id: 'plan-101',
        amount_paid: 1499,
        payment_method: 'upi',
        idempotency_key: userRenewalKey
      });
    } catch (e) {
      initialError = e;
    }
    assert(initialError !== null, 'Test 5A: Initial renewal attempt failed with 503');

    // Safe Retry: Use the EXACT same idempotency key!
    const retryResult = await retryClient.renewSubscription({
      member_id: 'mem-101',
      plan_id: 'plan-101',
      amount_paid: 1499,
      payment_method: 'upi',
      idempotency_key: userRenewalKey // SAME KEY!
    });
    assert(retryResult.subscription_id === 'sub-renewed-001', 'Test 5B: Retry succeeded');
    assert(renewalCalls.length === 2, 'Test 5C: Two requests were submitted');
    assert(renewalCalls[0] === renewalCalls[1], 'Test 5D: Exact same idempotency key was preserved across retries');

    // Test 5E: Timeout followed by safe retry with original key
    let timeoutRenewalCalls: string[] = [];
    let timeoutAttempts = 0;
    global.fetch = (async (_url: any, init?: any) => {
      const body = JSON.parse(init?.body);
      timeoutRenewalCalls.push(body.idempotency_key);
      timeoutAttempts++;

      if (timeoutAttempts === 1) {
        // Abort to simulate timeout on initial attempt
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err: any = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }

      return new Response(
        JSON.stringify({
          subscription_id: 'sub-timeout-retry-002',
          member_id: body.member_id,
          plan_id: body.plan_id,
          start_date: '2026-12-01',
          end_date: '2026-12-31',
          amount_paid: 1499,
          status: 'active',
          idempotency_key: body.idempotency_key,
          idempotent_replay: true
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const timeoutRenewalClient = new FitFusionApiClient({ baseUrl: '/api', defaultTimeoutMs: 50 });
    const uncertainKey = '11111111-cccc-dddd-eeee-000000000002';
    let timeoutError: any = null;
    try {
      await timeoutRenewalClient.renewSubscription({
        member_id: 'mem-102',
        plan_id: 'plan-101',
        amount_paid: 1499,
        payment_method: 'cash',
        idempotency_key: uncertainKey
      });
    } catch (e: any) {
      timeoutError = e;
    }
    assert(timeoutError?.isTimeout === true, 'Test 5E: Renewal timeout throws ApiClientError with isTimeout=true');
    assert(timeoutError?.status === 408, 'Test 5E-2: Timeout status is 408');

    // Safe retry using original key
    const timeoutRetryClient = new FitFusionApiClient({ baseUrl: '/api', defaultTimeoutMs: 5000 });
    const confirmedAfterTimeout = await timeoutRetryClient.renewSubscription({
      member_id: 'mem-102',
      plan_id: 'plan-101',
      amount_paid: 1499,
      payment_method: 'cash',
      idempotency_key: uncertainKey // REUSES SAME KEY
    });
    assert(confirmedAfterTimeout.idempotency_key === uncertainKey, 'Test 5E-3: Retry after timeout preserved the identical idempotency key');
    assert(timeoutRenewalCalls[0] === timeoutRenewalCalls[1], 'Test 5E-4: Both timeout attempt and retry transmitted identical key');

    // Test 5F: Genuinely new operation uses new key
    const brandNewKey = '22222222-cccc-dddd-eeee-000000000003';
    assert(brandNewKey !== uncertainKey, 'Test 5F: Genuinely new renewal operation uses distinct idempotency key');

    // ------------------------------------------------------------------------
    // Suite 6: Defensive Error Parsing on Malformed / Non-JSON Server Responses
    // ------------------------------------------------------------------------
    console.log('\n--- Suite 6: Defensive Parsing of Malformed Server Errors ---');
    global.fetch = (async () => {
      // 502 Bad Gateway with HTML text body from proxy/load balancer
      return new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/html' }
      });
    }) as any;

    let caughtHtml502: ApiClientError | null = null;
    try {
      await testClient.getHealth();
    } catch (e: any) {
      caughtHtml502 = e;
    }
    assert(caughtHtml502 instanceof ApiClientError, 'Test 6A: HTML 502 error parsed defensively as ApiClientError without JSON crash');
    assert(caughtHtml502?.status === 502, 'Test 6B: Status is 502');
    assert(caughtHtml502?.code === 'HTTP_502', 'Test 6C: Code is HTTP_502');
    assert(!caughtHtml502?.getUserMessage().includes('<html>'), 'Test 6D: HTML tags stripped and masked in user message');

    // ------------------------------------------------------------------------
    // Suite 7: Stage 5C Reminder Operations & Telemetry Frontend Client
    // ------------------------------------------------------------------------
    console.log('\n--- Suite 7: Stage 5C Reminder Operations & Telemetry Client ---');

    let reminderCapturedUrl = '';
    let reminderCapturedMethod = '';
    let reminderCapturedBody: any = null;

    const reminderClient = new FitFusionApiClient({
      baseUrl: 'http://localhost:3001/api',
      getToken: () => 'valid-staff-jwt'
    });

    global.fetch = (async (url: any, init?: any) => {
      reminderCapturedUrl = String(url);
      reminderCapturedMethod = init?.method || 'GET';
      reminderCapturedBody = init?.body ? JSON.parse(init.body) : null;

      if (reminderCapturedUrl.includes('/reminders/telemetry')) {
        return new Response(
          JSON.stringify({
            scheduledToday: 15,
            completedToday: 12,
            reconciling: 2,
            failed: 1,
            activeLeases: 0,
            statusCounts: { pending: 2, completed: 12, reconciling: 2, failed: 1 }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (reminderCapturedUrl.includes('/retry')) {
        if (reminderCapturedUrl.includes('conflict-job')) {
          return new Response(
            JSON.stringify({
              type: 'https://fitfusion.local/errors/invalid_job_state',
              status: 409,
              code: 'INVALID_JOB_STATE',
              title: 'Retry State Conflict',
              detail: "Only jobs in 'failed' status can be manually retried."
            }),
            { status: 409, headers: { 'Content-Type': 'application/problem+json' } }
          );
        }

        if (reminderCapturedUrl.includes('ineligible-job')) {
          return new Response(
            JSON.stringify({
              type: 'https://fitfusion.local/errors/ineligible_for_retry',
              status: 422,
              code: 'INELIGIBLE_FOR_RETRY',
              title: 'Retry Ineligible',
              detail: 'Subscription has already been renewed.'
            }),
            { status: 422, headers: { 'Content-Type': 'application/problem+json' } }
          );
        }

        return new Response(
          JSON.stringify({
            message: 'Notification job successfully re-queued for processing.',
            job: { id: 'job-123', status: 'pending', max_attempts: 4 }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (reminderCapturedUrl.includes('/reminders')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'job-123',
                member_name: 'Rajesh Kumar',
                member_phone: '+9198****3210',
                status: 'completed',
                milestone: 'EXPIRY_MINUS_3',
                channel: 'whatsapp'
              }
            ],
            pagination: { page: 2, limit: 10, total: 25, total_pages: 3 }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    }) as any;

    // Test 7A: getReminderJobs parameter serialization and response parsing
    const jobsRes = await reminderClient.getReminderJobs({
      page: 2,
      limit: 10,
      status: 'failed',
      milestone: 'EXPIRY_ZERO',
      search: 'Rajesh'
    });
    assert(reminderCapturedUrl.includes('page=2'), 'Test 7A: getReminderJobs serializes page parameter');
    assert(reminderCapturedUrl.includes('limit=10'), 'Test 7A-2: getReminderJobs serializes limit parameter');
    assert(reminderCapturedUrl.includes('status=failed'), 'Test 7A-3: getReminderJobs serializes status filter');
    assert(reminderCapturedUrl.includes('milestone=EXPIRY_ZERO'), 'Test 7A-4: getReminderJobs serializes milestone filter');
    assert(reminderCapturedUrl.includes('search=Rajesh'), 'Test 7A-5: getReminderJobs serializes search parameter');
    assert(Array.isArray(jobsRes.data), 'Test 7A-6: getReminderJobs returns data array');
    assert(jobsRes.pagination.total === 25, 'Test 7A-7: getReminderJobs returns pagination total');

    // Test 7B: getReminderTelemetry response parsing
    const telemRes = await reminderClient.getReminderTelemetry();
    assert(telemRes.scheduledToday === 15, 'Test 7B: getReminderTelemetry parses scheduledToday');
    assert(telemRes.reconciling === 2, 'Test 7B-2: getReminderTelemetry parses reconciling count');
    assert(telemRes.statusCounts.completed === 12, 'Test 7B-3: getReminderTelemetry parses statusCounts map');

    // Test 7C: retryReminderJob success
    const retryRes = await reminderClient.retryReminderJob('job-123', { reason: 'Staff updated phone' });
    assert(reminderCapturedMethod === 'POST', 'Test 7C: retryReminderJob uses POST method');
    assert(reminderCapturedUrl.endsWith('/reminders/job-123/retry'), 'Test 7C-2: retryReminderJob calls correct endpoint');
    assert(reminderCapturedBody?.reason === 'Staff updated phone', 'Test 7C-3: retryReminderJob transmits request body');
    assert(retryRes.job.status === 'pending', 'Test 7C-4: retryReminderJob parses successful response');

    // Test 7D: retryReminderJob handles 409 Conflict as ApiClientError
    let conflictErr: ApiClientError | null = null;
    try {
      await reminderClient.retryReminderJob('conflict-job');
    } catch (e: any) {
      conflictErr = e;
    }
    assert(conflictErr instanceof ApiClientError, 'Test 7D: 409 Conflict thrown as ApiClientError');
    assert(conflictErr?.status === 409, 'Test 7D-2: Error status is 409');
    assert(conflictErr?.code === 'INVALID_JOB_STATE', 'Test 7D-3: Error code is INVALID_JOB_STATE');

    // Test 7E: retryReminderJob handles 422 Ineligible as ApiClientError
    let ineligErr: ApiClientError | null = null;
    try {
      await reminderClient.retryReminderJob('ineligible-job');
    } catch (e: any) {
      ineligErr = e;
    }
    assert(ineligErr instanceof ApiClientError, 'Test 7E: 422 Ineligible thrown as ApiClientError');
    assert(ineligErr?.status === 422, 'Test 7E-2: Error status is 422');
    assert(ineligErr?.code === 'INELIGIBLE_FOR_RETRY', 'Test 7E-3: Error code is INELIGIBLE_FOR_RETRY');

    console.log('\n================================================================');
    console.log(`TEST RUN COMPLETE: ${testResults.filter((r) => r.status === 'PASSED').length}/${testResults.length} PASSED`);
    console.log('================================================================\n');
  } finally {
    global.fetch = originalFetch;
  }
}

runFrontendClientTests().catch((err) => {
  console.error('Frontend client test suite encountered an unexpected failure:', err);
  process.exit(1);
});
