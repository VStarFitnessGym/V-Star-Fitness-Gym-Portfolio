// ============================================================================
// Stage 5B Remediation: Webhook Express Routes (/api/webhooks/whatsapp)
// Handles Meta challenge handshake and cryptographic signature verification
// Public server-to-server endpoint separated from browser-authenticated admin routes
// ============================================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db/database';
import {
  verifyWhatsAppSignature,
  parseWhatsAppWebhookPayload,
  processDeliveryStatusEvent
} from '../services/reminders/webhooks/whatsappWebhook';
import { loadProviderConfig } from '../services/reminders/config';
import { sendProblem } from '../utils/problemDetails';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/webhooks/whatsapp
 * Meta Webhook Verification Handshake
 */
router.get('/whatsapp', (req: Request, res: Response) => {
  const config = loadProviderConfig();
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const configuredToken = config.whatsapp.verifyToken;

  // Fail-closed verification: token and configuredToken must be non-empty strings and match in constant time
  if (
    mode === 'subscribe' &&
    typeof token === 'string' &&
    typeof configuredToken === 'string' &&
    configuredToken.length > 0 &&
    token.length === configuredToken.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(configuredToken))
  ) {
    logger.info('Meta WhatsApp webhook subscription verified successfully');
    res.status(200).send(challenge);
    return;
  }

  logger.warn('Meta WhatsApp webhook handshake failed: invalid verify token or mode');
  sendProblem(res, {
    status: 403,
    code: 'WEBHOOK_VERIFY_TOKEN_MISMATCH',
    title: 'Forbidden',
    detail: 'Webhook verification token did not match configured secret.'
  });
});

/**
 * POST /api/webhooks/whatsapp
 * Inbound Webhook Event Processor
 */
router.post('/whatsapp', async (req: Request, res: Response) => {
  const config = loadProviderConfig();
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = (req as any).rawBody;

  // 1. Raw Request Body Guard (must use exact raw request bytes)
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    logger.warn('Meta WhatsApp webhook rejected: missing raw request body buffer');
    sendProblem(res, {
      status: 400,
      code: 'RAW_BODY_MISSING',
      title: 'Bad Request',
      detail: 'Webhook request requires unparsed raw buffer for cryptographic signature verification.'
    });
    return;
  }

  // 2. Cryptographic Signature Verification Guard
  if (!config.disableWebhookVerification) {
    const isValid = verifyWhatsAppSignature(rawBody, signature, config.whatsapp.appSecret);
    if (!isValid) {
      logger.warn('Meta WhatsApp webhook signature verification failed');
      sendProblem(res, {
        status: 401,
        code: 'WEBHOOK_SIGNATURE_INVALID',
        title: 'Unauthorized',
        detail: 'The X-Hub-Signature-256 HMAC signature was missing or invalid.'
      });
      return;
    }
  }

  // 3. Parse Payload into DeliveryStatusEvents
  const events = parseWhatsAppWebhookPayload(req.body);
  logger.info('Received Meta WhatsApp webhook payload', { eventCount: events.length });

  // 4. Process Events Idempotently
  for (const event of events) {
    try {
      await processDeliveryStatusEvent(db, event);
    } catch (err: any) {
      logger.error('Failed to process delivery status event', {
        providerMessageId: event.providerMessageId,
        status: event.status,
        error: err?.message
      });
    }
  }

  // 5. Acknowledge Receipt Immediately to Meta
  res.status(200).json({ status: 'received' });
});

export default router;
