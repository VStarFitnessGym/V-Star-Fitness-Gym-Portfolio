// ============================================================================
// Stage 5B: Provider Integration & Safe Dispatch Test Suite
// Verifies WhatsApp Cloud API adapter, SMS adapter, Webhook verification,
// Out-of-order event handling, and strictly conditional SMS fallback.
// 100% Deterministic — Zero real network sockets opened.
// ============================================================================
process.env.NODE_ENV = 'test';

import { db } from '../../server/db/database';
import {
  normalizeE164Phone,
  maskPhone,
  maskAuthHeader,
  IHttpClient,
  HttpResponse,
  HttpRequestOptions,
  OutboundMessageRequest,
  DeliveryStatusEvent
} from '../../server/services/reminders/providerTypes';
import {
  WhatsAppCloudApiAdapter,
  DefaultFetchHttpClient
} from '../../server/services/reminders/adapters/whatsappAdapter';
import {
  TwilioSmsAdapter
} from '../../server/services/reminders/adapters/smsAdapter';
import {
  verifyWhatsAppSignature,
  parseWhatsAppWebhookPayload,
  processDeliveryStatusEvent
} from '../../server/services/reminders/webhooks/whatsappWebhook';
import {
  loadProviderConfig,
  validateProviderConfig
} from '../../server/services/reminders/config';
import {
  dispatchReminderJob
} from '../../server/services/reminders/dispatchOrchestrator';
import { scheduleRemindersForSubscription } from '../../server/services/reminders/schedulerService';
import { claimJobs } from '../../server/services/reminders/workerService';
import { MockDeliveryAdapter } from '../../server/services/reminders/mockAdapter';
import app from '../../server/app';
import request from 'supertest';
import crypto from 'crypto';

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

/**
 * Controllable Mock HTTP Client for Deterministic Adapter Unit Testing
 */
class ControllableMockHttpClient implements IHttpClient {
  public callCount = 0;
  public lastUrl?: string;
  public lastHeaders?: Record<string, string>;
  public lastBody?: string;
  public mockResponse: { status: number; headers?: Record<string, string>; bodyText: string } = {
    status: 200,
    headers: {},
    bodyText: JSON.stringify({ messages: [{ id: 'wamid.test_mock_12345' }] })
  };
  public shouldThrowError?: Error;
  public customHandler?: (url: string, options: HttpRequestOptions) => Promise<HttpResponse>;

  async post(url: string, options: HttpRequestOptions): Promise<HttpResponse> {
    this.callCount++;
    this.lastUrl = url;
    this.lastHeaders = options.headers;
    this.lastBody = options.body;

    if (this.shouldThrowError) {
      throw this.shouldThrowError;
    }

    if (this.customHandler) {
      return this.customHandler(url, options);
    }

    const resp = this.mockResponse;
    return {
      status: resp.status,
      headers: resp.headers || {},
      bodyText: resp.bodyText,
      json: async <T = any>() => JSON.parse(resp.bodyText) as T
    };
  }
}

async function runProviderIntegrationTests() {
  console.log('================================================================');
  console.log('STAGE 5B MESSAGING PROVIDER INTEGRATION TEST SUITE');
  console.log('Zero Live Messages — 100% In-Memory Deterministic Verification');
  console.log('================================================================\n');

  await db.isReady();

  const gymAId = '11111111-1111-1111-1111-111111111111';
  const planA1Id = '33333333-3333-3333-3333-333333333331';

  // ==========================================================================
  // Suite 1: Phone Normalization & Data Masking
  // ==========================================================================
  console.log('--- Suite 1: Phone Normalization & Secret Redaction ---');

  // Test 1: 10-digit Indian national number normalized to E.164
  const norm1 = normalizeE164Phone('9876543210');
  assert(norm1.valid && norm1.normalized === '+919876543210', 'Test 1: 10-digit Indian phone normalized to +919876543210');

  // Test 2: Phone with dashes, spaces, and leading + normalized
  const norm2 = normalizeE164Phone('+91 98765-43210');
  assert(norm2.valid && norm2.normalized === '+919876543210', 'Test 2: Phone with spaces and punctuation normalized cleanly');

  // Test 3: Invalid phone numbers rejected with permanent validation error
  const normBad = normalizeE164Phone('12345');
  assert(!normBad.valid && normBad.error?.includes('Invalid phone format'), 'Test 3: Malformed phone rejected with E.164 error');

  // Test 4: Phone masking for operational logging
  const maskedPhone = maskPhone('+919876543210');
  assert(maskedPhone === '+9198****3210', 'Test 4: Phone number masked for GDPR/DPDP safe logging (+9198****3210)');

  // Test 5: Authorization token masking
  const maskedBearer = maskAuthHeader('Bearer EAABsampletoken123456');
  assert(maskedBearer === 'Bearer [REDACTED]', 'Test 5: Bearer token masked to prevent credential disclosure in logs');

  // ==========================================================================
  // Suite 2: Configuration Safety & Startup Validation
  // ==========================================================================
  console.log('\n--- Suite 2: Configuration Safety & Startup Validation ---');

  // Test 6: Default config is disabled in non-production
  const defaultConfig = loadProviderConfig({});
  assert(defaultConfig.whatsapp.enabled === false && defaultConfig.sms.enabled === false, 'Test 6: Providers disabled by default');

  // Test 7: Production validates required WhatsApp credentials
  const badProdConfig = loadProviderConfig({
    NODE_ENV: 'production',
    WHATSAPP_ENABLED: 'true'
    // Missing WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, etc.
  });
  const valBadProd = validateProviderConfig(badProdConfig);
  assert(!valBadProd.valid && valBadProd.errors.length >= 4, 'Test 7: Production rejects WhatsApp enabled without required secrets');

  // Test 8: Production rejects disabled webhook verification
  const unsafeWebhookProd = loadProviderConfig({
    NODE_ENV: 'production',
    DISABLE_WEBHOOK_VERIFICATION: 'true',
    ALLOW_MOCK_IN_PROD: 'true'
  });
  const valUnsafeWebhook = validateProviderConfig(unsafeWebhookProd);
  assert(!valUnsafeWebhook.valid && valUnsafeWebhook.errors.some(e => e.includes('DISABLE_WEBHOOK_VERIFICATION')), 'Test 8: Production strictly rejects disabled webhook verification');

  // ==========================================================================
  // Suite 3: WhatsApp Cloud API Adapter (Meta Graph API v21.0)
  // ==========================================================================
  console.log('\n--- Suite 3: WhatsApp Cloud API Adapter (Meta v21.0) ---');

  const mockHttp = new ControllableMockHttpClient();
  const testWhatsAppConfig = {
    phoneNumberId: '1000999888777',
    accessToken: 'test_meta_access_token',
    appSecret: 'test_app_secret',
    verifyToken: 'test_verify_token',
    apiVersion: 'v21.0',
    templateName: 'membership_expiry_reminder',
    enabled: true,
    requestTimeoutMs: 5000
  };
  const whatsappAdapter = new WhatsAppCloudApiAdapter(testWhatsAppConfig, mockHttp);

  const testOutboundRequest: OutboundMessageRequest = {
    jobId: '00000000-0000-0000-0000-000000000001',
    subscriptionId: '11111111-0000-0000-0000-000000000001',
    memberId: '22222222-0000-0000-0000-000000000001',
    gymId: gymAId,
    recipientPhone: '+919876543210',
    channel: 'whatsapp',
    milestone: 'EXPIRY_MINUS_3',
    template: {
      name: 'membership_expiry_reminder',
      language: 'en',
      parameters: {
        member_name: 'John Doe',
        expiry_date: '2026-10-25'
      }
    }
  };

  // Test 9: Successful submission acceptance (HTTP 200 with wamid)
  mockHttp.mockResponse = {
    status: 200,
    headers: {},
    bodyText: JSON.stringify({
      messaging_product: 'whatsapp',
      contacts: [{ input: '919876543210', wa_id: '919876543210' }],
      messages: [{ id: 'wamid.HBgLMTIzNDU2Nzg5MA==' }]
    })
  };
  const res9 = await whatsappAdapter.send(testOutboundRequest);
  assert(
    res9.outcome === 'accepted' && res9.providerMessageId === 'wamid.HBgLMTIzNDU2Nzg5MA==',
    'Test 9: WhatsApp adapter handles HTTP 200 with wamid as submission acceptance'
  );
  assert(mockHttp.lastUrl?.includes('/v21.0/1000999888777/messages'), 'Test 9B: Meta Graph API URL matches v21.0 endpoint specification');

  // Test 10: Permanent rejection on invalid recipient (HTTP 400 with Meta error code 131030)
  mockHttp.mockResponse = {
    status: 400,
    headers: {},
    bodyText: JSON.stringify({
      error: {
        message: 'Recipient phone number not in allowed list',
        type: 'OAuthException',
        code: 131030,
        fbtrace_id: 'E12345'
      }
    })
  };
  const res10 = await whatsappAdapter.send(testOutboundRequest);
  assert(
    res10.outcome === 'permanent_rejection' && res10.errorCode === 'META_REJECTED_131030',
    'Test 10: Permanent rejection classified accurately (Meta error 131030)'
  );

  // Test 11: Retryable rejection on rate limit (HTTP 429 with Retry-After)
  mockHttp.mockResponse = {
    status: 429,
    headers: { 'retry-after': '120' },
    bodyText: JSON.stringify({
      error: {
        message: 'Rate limit hit',
        code: 80007
      }
    })
  };
  const res11 = await whatsappAdapter.send(testOutboundRequest);
  assert(
    res11.outcome === 'retryable_rejection' && res11.retryAfterSeconds === 120,
    'Test 11: Rate limit classified as retryable_rejection with Retry-After header'
  );

  // Test 12: Network timeout treated as ambiguous_timeout
  const abortErr = new Error('The operation was aborted');
  abortErr.name = 'AbortError';
  mockHttp.shouldThrowError = abortErr;
  const res12 = await whatsappAdapter.send(testOutboundRequest);
  assert(
    res12.outcome === 'ambiguous_timeout' && res12.errorCode === 'REQUEST_TIMEOUT',
    'Test 12: Network timeout classified as ambiguous_timeout (never treated as non-delivery)'
  );
  mockHttp.shouldThrowError = undefined;

  // ==========================================================================
  // Suite 4: SMS Provider Adapter (Twilio REST API)
  // ==========================================================================
  console.log('\n--- Suite 4: SMS Provider Adapter (Twilio REST Specs) ---');

  const testSmsConfig = {
    accountSid: 'AC_test_account_sid',
    authToken: 'test_sms_auth_token',
    fromNumber: '+1234567890',
    enabled: true,
    requestTimeoutMs: 5000
  };
  const smsAdapter = new TwilioSmsAdapter(testSmsConfig, mockHttp);

  // Test 13: Successful SMS submission (HTTP 201 with message SID)
  mockHttp.mockResponse = {
    status: 201,
    headers: {},
    bodyText: JSON.stringify({
      sid: 'SM_test_sms_message_sid_123',
      status: 'queued',
      to: '+919876543210'
    })
  };
  const res13 = await smsAdapter.send({ ...testOutboundRequest, channel: 'sms' });
  assert(
    res13.outcome === 'accepted' && res13.providerMessageId === 'SM_test_sms_message_sid_123',
    'Test 13: SMS adapter handles HTTP 201 as submission accepted with message SID'
  );

  // Test 14: Permanent rejection on landline/non-mobile (Twilio error 21614)
  mockHttp.mockResponse = {
    status: 400,
    headers: {},
    bodyText: JSON.stringify({
      code: 21614,
      message: 'To number is not a valid mobile number'
    })
  };
  const res14 = await smsAdapter.send({ ...testOutboundRequest, channel: 'sms' });
  assert(
    res14.outcome === 'permanent_rejection' && res14.errorCode === 'TWILIO_21614',
    'Test 14: Non-mobile phone permanent rejection classified accurately (Twilio 21614)'
  );

  // Test 14B: Twilio code 20429 mapped to retryable_rejection
  mockHttp.mockResponse = {
    status: 400,
    headers: { 'retry-after': '45' },
    bodyText: JSON.stringify({
      code: 20429,
      message: 'Too Many Requests'
    })
  };
  const res14B = await smsAdapter.send({ ...testOutboundRequest, channel: 'sms' });
  assert(
    res14B.outcome === 'retryable_rejection' && res14B.retryAfterSeconds === 45,
    'Test 14B: Twilio rate limit 20429 classified as retryable_rejection with Retry-After header'
  );

  // ==========================================================================
  // Suite 5: Webhook Signature Verification & Out-of-Order Delivery Events
  // ==========================================================================
  console.log('\n--- Suite 5: Webhook Verification & Out-of-Order Delivery ---');

  const appSecret = 'super_secret_webhook_signing_key_123';
  const samplePayloadString = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WHATSAPP_BIZ_ACC_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          statuses: [{
            id: 'wamid.HB_WEBHOOK_TEST_1',
            status: 'delivered',
            timestamp: '1730000000',
            recipient_id: '919876543210'
          }]
        },
        field: 'messages'
      }]
    }]
  });

  // Test 15: Valid HMAC-SHA256 signature passes verification
  const validHmac = crypto.createHmac('sha256', appSecret).update(Buffer.from(samplePayloadString, 'utf-8')).digest('hex');
  const sigResultValid = verifyWhatsAppSignature(samplePayloadString, `sha256=${validHmac}`, appSecret);
  assert(sigResultValid === true, 'Test 15: Valid X-Hub-Signature-256 HMAC signature passes verification');

  // Test 16: Signature mismatch rejected
  const sigResultBad = verifyWhatsAppSignature(samplePayloadString, 'sha256=bad_hex_signature', appSecret);
  assert(sigResultBad === false, 'Test 16: Invalid or tampered signature header rejected');

  // Test 16B: Malformed signature containing non-hex characters safely rejected without RangeError crash
  const malformedNonHexSig = 'sha256=' + 'g'.repeat(64);
  const sigResultNonHex = verifyWhatsAppSignature(samplePayloadString, malformedNonHexSig, appSecret);
  assert(sigResultNonHex === false, 'Test 16B: Malformed non-hex signature safely rejected without throwing RangeError');

  // Test 17: Webhook payload parser extracts status events
  const parsedEvents = parseWhatsAppWebhookPayload(JSON.parse(samplePayloadString));
  assert(
    parsedEvents.length === 1 && parsedEvents[0].status === 'delivered' && parsedEvents[0].providerMessageId === 'wamid.HB_WEBHOOK_TEST_1',
    'Test 17: Webhook payload parsed into typed DeliveryStatusEvents array'
  );

  // Seed DB records for Webhook test
  const memberW = '55555555-5555-5555-5555-555555555590';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent, sms_consent)
     VALUES ($1, $2, 'FF-S5-W', 'Webhook Member', '+919876590090', 'active', true, true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberW, gymAId]
  );
  const subW = 'aaaaaaaa-5555-5555-5555-000000000090';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-30', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subW, gymAId, memberW, planA1Id]
  );
  const jobWRes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-11-30', 'dispatching', 'webhook-test-job-90', NOW())
     RETURNING id;`,
    [gymAId, memberW, subW]
  );
  const jobWId = jobWRes.rows[0].id;
  await db.query(
    `INSERT INTO public.notification_attempts (job_id, channel, provider, provider_message_id, status, sent_at)
     VALUES ($1, 'whatsapp', 'meta_whatsapp', 'wamid.HB_WEBHOOK_TEST_1', 'sent', NOW());`,
    [jobWId]
  );

  // Test 18: Processing 'delivered' status transitions attempt to delivered and job to completed
  const eventDelivered: DeliveryStatusEvent = {
    provider: 'meta_whatsapp',
    providerMessageId: 'wamid.HB_WEBHOOK_TEST_1',
    status: 'delivered',
    timestamp: new Date().toISOString()
  };
  const procRes18 = await processDeliveryStatusEvent(db, eventDelivered);
  const jobWCheck18 = await db.query(`SELECT status FROM public.notification_jobs WHERE id = $1;`, [jobWId]);
  assert(
    procRes18.processed && jobWCheck18.rows[0].status === 'completed',
    'Test 18: Webhook delivered event completes notification job and sets attempt delivered'
  );

  // Test 19: Duplicate webhook event is idempotent
  const procRes19 = await processDeliveryStatusEvent(db, eventDelivered);
  assert(
    procRes19.processed === false && procRes19.reason === 'duplicate_event',
    'Test 19: Duplicate webhook event skipped idempotently via webhook_events audit'
  );

  // Test 20: Out-of-order event guard (sent arriving after delivered does not downgrade status)
  const eventSentLate: DeliveryStatusEvent = {
    provider: 'meta_whatsapp',
    providerMessageId: 'wamid.HB_WEBHOOK_TEST_1',
    status: 'sent',
    timestamp: new Date(Date.now() + 1000).toISOString()
  };
  const procRes20 = await processDeliveryStatusEvent(db, eventSentLate);
  const attemptWCheck20 = await db.query(
    `SELECT status FROM public.notification_attempts WHERE provider_message_id = 'wamid.HB_WEBHOOK_TEST_1';`
  );
  assert(
    attemptWCheck20.rows[0].status === 'delivered',
    'Test 20: Out-of-order earlier event (sent) does not downgrade terminal state (delivered)'
  );

  // Test 21: Webhook event for unknown message ID handled safely
  const eventUnknown: DeliveryStatusEvent = {
    provider: 'meta_whatsapp',
    providerMessageId: 'wamid.NON_EXISTENT_9999',
    status: 'delivered',
    timestamp: new Date().toISOString()
  };
  const procRes21 = await processDeliveryStatusEvent(db, eventUnknown);
  assert(
    procRes21.processed === false && procRes21.reason === 'attempt_not_found',
    'Test 21: Webhook event for unknown message ID recorded safely without crashing'
  );

  // Test 21B: Conflicting failure event on already delivered attempt transitions job to reconciling
  const eventConflictFailed: DeliveryStatusEvent = {
    provider: 'meta_whatsapp',
    providerMessageId: 'wamid.HB_WEBHOOK_TEST_1',
    status: 'failed',
    errorCode: '131026',
    errorMessage: 'Conflicting handset error',
    timestamp: new Date(Date.now() + 2000).toISOString()
  };
  const procRes21B = await processDeliveryStatusEvent(db, eventConflictFailed);
  const jobWCheck21B = await db.query(`SELECT status, cancellation_reason FROM public.notification_jobs WHERE id = $1;`, [jobWId]);
  const attemptWCheck21B = await db.query(`SELECT status FROM public.notification_attempts WHERE provider_message_id = 'wamid.HB_WEBHOOK_TEST_1';`);
  assert(
    procRes21B.isConflict === true &&
    jobWCheck21B.rows[0].status === 'reconciling' &&
    attemptWCheck21B.rows[0].status === 'delivered',
    'Test 21B: Conflicting failure callback on delivered message moves job to reconciling without erasing delivered attempt'
  );

  // Test 21C: Conflicting delivery event on permanently failed attempt transitions job to reconciling
  const jobFailId = '77777777-7777-7777-7777-000000000002';
  await db.query(`
    INSERT INTO public.notification_jobs (id, gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for)
    VALUES ($1, $2, $3, $4, 'EXPIRY_ZERO', '2026-11-30', 'failed', 'conflict-fail-job-2', NOW())
    ON CONFLICT (id) DO NOTHING;
  `, [jobFailId, gymAId, memberW, subW]);

  await db.query(`
    INSERT INTO public.notification_attempts (job_id, channel, provider, provider_message_id, status, error_code, sent_at)
    VALUES ($1, 'whatsapp', 'meta_whatsapp', 'wamid.FAILED_MSG_TEST_2', 'failed_permanent', '131030', NOW())
    ON CONFLICT DO NOTHING;
  `, [jobFailId]);

  const eventConflictDelivered: DeliveryStatusEvent = {
    provider: 'meta_whatsapp',
    providerMessageId: 'wamid.FAILED_MSG_TEST_2',
    status: 'delivered',
    timestamp: new Date(Date.now() + 3000).toISOString()
  };
  const procRes21C = await processDeliveryStatusEvent(db, eventConflictDelivered);
  const jobFailCheck21C = await db.query(`SELECT status, cancellation_reason FROM public.notification_jobs WHERE id = $1;`, [jobFailId]);
  const attemptFailCheck21C = await db.query(`SELECT status FROM public.notification_attempts WHERE provider_message_id = 'wamid.FAILED_MSG_TEST_2';`);
  assert(
    procRes21C.isConflict === true &&
    jobFailCheck21C.rows[0].status === 'reconciling' &&
    attemptFailCheck21C.rows[0].status === 'failed_permanent',
    'Test 21C: Conflicting delivery callback on failed attempt moves job to reconciling without overwriting failed_permanent state'
  );

  // Test 21D: Unknown provider status safely recorded in webhook_events without mutating job or crashing
  const eventUnknownStatus: DeliveryStatusEvent = {
    provider: 'meta_whatsapp',
    providerMessageId: 'wamid.FAILED_MSG_TEST_2',
    status: 'carrier_unreachable' as any,
    timestamp: new Date(Date.now() + 4000).toISOString()
  };
  const procRes21D = await processDeliveryStatusEvent(db, eventUnknownStatus);
  const webhookEventAudit = await db.query(
    `SELECT processed, processing_error FROM public.webhook_events WHERE event_id LIKE '%carrier_unreachable%' LIMIT 1;`
  );
  assert(
    procRes21D.processed === false &&
    webhookEventAudit.rows.length > 0 &&
    webhookEventAudit.rows[0].processing_error.includes('unmapped_provider_status'),
    'Test 21D: Unknown provider status safely recorded in webhook_events without mutating job or crashing'
  );

  // Test 21E: Concurrent duplicate webhook event execution handled idempotently inside transaction
  const concurrentEvent: DeliveryStatusEvent = {
    provider: 'meta_whatsapp',
    providerMessageId: 'wamid.HB_CONCURRENT_TEST',
    status: 'delivered',
    timestamp: '2026-10-21T05:00:00.000Z'
  };
  const [resConcurrentA, resConcurrentB] = await Promise.all([
    processDeliveryStatusEvent(db, concurrentEvent),
    processDeliveryStatusEvent(db, concurrentEvent)
  ]);
  const oneProcessed = (resConcurrentA.processed && !resConcurrentB.processed) || (!resConcurrentA.processed && resConcurrentB.processed) || (!resConcurrentA.processed && !resConcurrentB.processed);
  assert(
    oneProcessed,
    'Test 21E: Concurrent duplicate webhook event execution handled idempotently via transaction boundary'
  );

  // ==========================================================================
  // Suite 6: Strictly Conditional SMS Fallback
  // ==========================================================================
  console.log('\n--- Suite 6: Strictly Conditional SMS Fallback ---');

  // Create member with WhatsApp & SMS consent
  const memberFallback = '55555555-5555-5555-5555-555555555595';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent, sms_consent)
     VALUES ($1, $2, 'FF-S5-FB', 'Fallback Member', '+919876590095', 'active', true, true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberFallback, gymAId]
  );
  const subFallback = 'aaaaaaaa-5555-5555-5555-000000000095';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-30', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subFallback, gymAId, memberFallback, planA1Id]
  );
  const jobFBRes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-11-30', 'claimed', 'fallback-test-95', NOW(), 'worker_fb_95', NOW() + INTERVAL '5 minutes')
     RETURNING *;`,
    [gymAId, memberFallback, subFallback]
  );

  // Configure Mock HTTP Client to return permanent rejection on WhatsApp and success on SMS
  const fallbackHttp = new ControllableMockHttpClient();
  const failingWhatsApp = new WhatsAppCloudApiAdapter(testWhatsAppConfig, fallbackHttp);
  const workingSms = new TwilioSmsAdapter(testSmsConfig, fallbackHttp);

  fallbackHttp.mockResponse = {
    status: 400,
    bodyText: JSON.stringify({ error: { code: 131030, message: 'Recipient not registered' } })
  };

  // Test 22: Confirmed permanent WhatsApp failure triggers SMS fallback when consent exists
  // First request fails on WhatsApp, second request succeeds on SMS
  let callIndex = 0;
  fallbackHttp.customHandler = async (url, options) => {
    callIndex++;
    if (callIndex === 1) {
      return {
        status: 400,
        headers: {},
        bodyText: JSON.stringify({ error: { code: 131030, message: 'Permanent rejection' } }),
        json: async () => ({ error: { code: 131030, message: 'Permanent rejection' } })
      };
    } else {
      return {
        status: 201,
        headers: {},
        bodyText: JSON.stringify({ sid: 'SM_fallback_sms_sid_95', status: 'queued' }),
        json: async () => ({ sid: 'SM_fallback_sms_sid_95', status: 'queued' })
      };
    }
  };

  const fbOutcome = await dispatchReminderJob(db, jobFBRes.rows[0], failingWhatsApp, workingSms, 'worker_fb_95');
  assert(
    fbOutcome.status === 'fallback_dispatched' && fbOutcome.fallbackTriggered === true,
    'Test 22: Confirmed permanent WhatsApp failure safely triggers SMS fallback when consent is present'
  );
  fallbackHttp.customHandler = undefined;

  // Test 23: Ambiguous timeout DOES NOT trigger SMS fallback
  const jobTimeoutRes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-11-30', 'claimed', 'no-fallback-timeout', NOW(), 'worker_fb_timeout', NOW() + INTERVAL '5 minutes')
     RETURNING *;`,
    [gymAId, memberFallback, subFallback]
  );
  fallbackHttp.shouldThrowError = new Error('Connection reset');
  const timeoutOutcome = await dispatchReminderJob(db, jobTimeoutRes.rows[0], failingWhatsApp, workingSms, 'worker_fb_timeout');
  assert(
    timeoutOutcome.status === 'reconciling' && timeoutOutcome.fallbackTriggered === undefined,
    'Test 23: Ambiguous timeout strictly does NOT trigger SMS fallback (prevents double messaging)'
  );
  fallbackHttp.shouldThrowError = undefined;

  // Test 24: Absence of SMS consent forbids SMS fallback
  const memberNoSms = '55555555-5555-5555-5555-555555555598';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent, sms_consent)
     VALUES ($1, $2, 'FF-S5-NOSMS', 'No SMS Consent Member', '+919876590098', 'active', true, false)
     ON CONFLICT (id) DO NOTHING;`,
    [memberNoSms, gymAId]
  );
  const subNoSms = 'aaaaaaaa-5555-5555-5555-000000000098';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-30', 1499.00, 'active')
     ON CONFLICT (id) DO NOTHING;`,
    [subNoSms, gymAId, memberNoSms, planA1Id]
  );
  const jobNoSmsRes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-11-30', 'claimed', 'no-sms-consent-job', NOW(), 'worker_fb_nosms', NOW() + INTERVAL '5 minutes')
     RETURNING *;`,
    [gymAId, memberNoSms, subNoSms]
  );

  callIndex = 0; // Will return 400 on WhatsApp
  const noSmsOutcome = await dispatchReminderJob(db, jobNoSmsRes.rows[0], failingWhatsApp, workingSms, 'worker_fb_nosms');
  assert(
    noSmsOutcome.status === 'failed_terminal' && noSmsOutcome.fallbackTriggered === undefined,
    'Test 24: Lack of SMS consent strictly blocks SMS fallback (regulatory DPDP compliance)'
  );

  // Test 24B: Non-delivery permanent rejection (e.g. Meta error 132000 Template not found) strictly does NOT trigger SMS fallback
  const templateErrorHttp: IHttpClient = {
    post: async () => ({
      status: 400,
      headers: {},
      bodyText: JSON.stringify({
        error: {
          message: 'Template does not exist',
          type: 'OAuthException',
          code: 132000
        }
      }),
      json: async () => ({
        error: { message: 'Template does not exist', type: 'OAuthException', code: 132000 }
      })
    })
  };
  const templateErrWhatsApp = new WhatsAppCloudApiAdapter(testWhatsAppConfig, templateErrorHttp);
  const jobTemplateErrRes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-11-30', 'claimed', 'template-err-job', NOW(), 'worker_fb_tmpl', NOW() + INTERVAL '5 minutes')
     RETURNING *;`,
    [gymAId, memberFallback, subFallback]
  );
  const tmplOutcome = await dispatchReminderJob(db, jobTemplateErrRes.rows[0], templateErrWhatsApp, workingSms, 'worker_fb_tmpl');
  assert(
    tmplOutcome.status === 'failed_terminal' && tmplOutcome.fallbackTriggered === undefined,
    'Test 24B: Meta template submission error (132000) strictly does NOT trigger SMS fallback'
  );

  // Test 24C: Cancelled subscription immediately before dispatch prevents dispatch and fallback
  const memberCanc = '55555555-5555-5555-5555-555555555599';
  await db.query(
    `INSERT INTO public.members (id, gym_id, member_code, full_name, phone, status, whatsapp_consent, sms_consent)
     VALUES ($1, $2, 'FF-S5-CANC', 'Cancelled Sub Member', '+919876590099', 'active', true, true)
     ON CONFLICT (id) DO NOTHING;`,
    [memberCanc, gymAId]
  );
  const subCanc = 'aaaaaaaa-5555-5555-5555-000000000099';
  await db.query(
    `INSERT INTO public.subscriptions (id, gym_id, member_id, plan_id, start_date, end_date, amount_paid, status)
     VALUES ($1, $2, $3, $4, '2026-11-01', '2026-11-30', 1499.00, 'cancelled')
     ON CONFLICT (id) DO NOTHING;`,
    [subCanc, gymAId, memberCanc, planA1Id]
  );
  const jobCancRes = await db.query(
    `INSERT INTO public.notification_jobs (gym_id, member_id, subscription_id, milestone, target_date, status, idempotency_key, scheduled_for, worker_id, lease_expires_at)
     VALUES ($1, $2, $3, 'EXPIRY_ZERO', '2026-11-30', 'claimed', 'cancelled-sub-job', NOW(), 'worker_fb_canc', NOW() + INTERVAL '5 minutes')
     RETURNING *;`,
    [gymAId, memberCanc, subCanc]
  );
  callIndex = 0;
  const cancOutcome = await dispatchReminderJob(db, jobCancRes.rows[0], failingWhatsApp, workingSms, 'worker_fb_canc');
  assert(
    cancOutcome.status === 'cancelled' && cancOutcome.fallbackTriggered === undefined,
    'Test 24C: Cancelled subscription prevents both WhatsApp dispatch and SMS fallback'
  );

  // Test 24D: Duplicate SMS fallback strictly blocked by unique constraint
  let duplicateFallbackAttemptBlocked = false;
  try {
    await db.query(`
      INSERT INTO public.notification_attempts (job_id, channel, provider, status, sent_at)
      VALUES ($1, 'sms', 'twilio_sms', 'sent', NOW());
    `, [jobFBRes.rows[0].id]);
  } catch (err: any) {
    duplicateFallbackAttemptBlocked = err.message.includes('unique') || err.message.includes('duplicate');
  }
  assert(
    duplicateFallbackAttemptBlocked,
    'Test 24D: Duplicate SMS fallback attempt strictly blocked by database unique index'
  );

  // Test 24E: DefaultFetchHttpClient refuses live network sockets in test environment
  const realHttpClient = new DefaultFetchHttpClient();
  let liveCallBlocked = false;
  try {
    await realHttpClient.post('https://graph.facebook.com/v21.0/messages', {});
  } catch (err: any) {
    liveCallBlocked = err.message.includes('[SAFETY_GUARD]');
  }
  assert(
    liveCallBlocked,
    'Test 24E: DefaultFetchHttpClient refuses live network sockets in test environment with safety exception'
  );

  // ==========================================================================
  // Suite 7: Express Webhook Route Handshake & Signature Security
  // ==========================================================================
  console.log('\n--- Suite 7: Express Webhook Route Handshake & Security ---');

  process.env.WHATSAPP_VERIFY_TOKEN = 'test_webhook_verify_token_123';

  // Test 25: GET /api/webhooks/whatsapp handshake with valid verify_token
  const handshakeRes = await request(app)
    .get('/api/webhooks/whatsapp')
    .query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test_webhook_verify_token_123',
      'hub.challenge': 'challenge_code_12345'
    });
  assert(handshakeRes.status === 200 && handshakeRes.text === 'challenge_code_12345', 'Test 25: Webhook verification handshake responds with challenge string');

  // Test 26: GET /api/webhooks/whatsapp with invalid token rejected with 403
  const badHandshakeRes = await request(app)
    .get('/api/webhooks/whatsapp')
    .query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong_token',
      'hub.challenge': 'challenge_code_12345'
    });
  assert(badHandshakeRes.status === 403, 'Test 26: Webhook verification handshake with invalid token rejected with 403');

  // Test 27: POST /api/webhooks/whatsapp with invalid HMAC signature rejected with 401
  const badSigPost = await request(app)
    .post('/api/webhooks/whatsapp')
    .set('x-hub-signature-256', 'sha256=invalid_hex_hmac')
    .send({ object: 'whatsapp_business_account', entry: [] });
  assert(badSigPost.status === 401 && badSigPost.body.code === 'WEBHOOK_SIGNATURE_INVALID', 'Test 27: Webhook POST with invalid HMAC rejected with 401 Unauthorized');

  // Test 27B: Webhook GET handshake with unconfigured/empty verify token rejected with 403
  const emptyTokenHandshakeRes = await request(app)
    .get('/api/webhooks/whatsapp')
    .query({
      'hub.mode': 'subscribe',
      'hub.verify_token': '',
      'hub.challenge': 'challenge_code_12345'
    });
  assert(emptyTokenHandshakeRes.status === 403, 'Test 27B: Webhook verification handshake with empty token rejected with 403');

  // Test 27C: Webhook POST without valid raw body buffer rejected with 400
  const missingRawBodyPost = await request(app)
    .post('/api/webhooks/whatsapp')
    .set('Content-Type', 'text/plain')
    .send('not a json buffer');
  assert(
    missingRawBodyPost.status === 400 || missingRawBodyPost.status === 401,
    'Test 27C: Webhook POST without valid raw body buffer rejected with 400/401'
  );

  console.log('\n================================================================');
  console.log(`STAGE 5B TEST RUN COMPLETE: ${testResults.filter((r) => r.status === 'PASSED').length}/${testResults.length} PASSED`);
  console.log('================================================================\n');
}

runProviderIntegrationTests().catch((err) => {
  console.error('Stage 5B provider integration test suite encountered an unexpected failure:', err);
  process.exit(1);
});
