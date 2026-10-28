// ============================================================================
// Subscriptions Controller (POST /api/subscriptions/renew)
// Atomic, serialized renewal with exclusion constraints & idempotency
// ============================================================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, RenewalResponse } from '../types';
import { RenewSubscriptionSchema } from '../validators/subscriptionValidators';
import { db, IDatabaseClient } from '../db/database';
import { sendProblem } from '../utils/problemDetails';
import { logger } from '../utils/logger';

// Helper to format Date to YYYY-MM-DD
function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Convert any date-like representation to YYYY-MM-DD string
function toDateString(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') {
    return val.substring(0, 10);
  }
  if (val instanceof Date) {
    return formatDate(val);
  }
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    return formatDate(d);
  }
  return String(val);
}

// Add days to a YYYY-MM-DD string
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

export async function renewSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendProblem(res, {
        status: 401,
        code: 'UNAUTHORIZED',
        title: 'Authentication Required',
        detail: 'Authentication is required to renew memberships.',
        instance: req.originalUrl,
        requestId: req.requestId
      });
      return;
    }

    // 1. Validate request body with Zod
    const input = RenewSubscriptionSchema.parse(req.body);
    const gymId = req.user.gym_id;
    const staffId = req.user.id;

    // 2. Pre-transaction Idempotency Check
    const existingKeyRes = await db.query(
      `SELECT id, member_id, plan_id, start_date, end_date, amount_paid, status, idempotency_key, renewed_from_subscription_id
       FROM public.subscriptions
       WHERE gym_id = $1 AND idempotency_key = $2
       LIMIT 1;`,
      [gymId, input.idempotency_key]
    );

    if (existingKeyRes.rows.length > 0) {
      const existing = existingKeyRes.rows[0];
      // Check if reused with materially different request (member, plan, amount, or start_date)
      const amountDiffers = Math.abs(parseFloat(existing.amount_paid) - input.amount_paid) > 0.01;
      const startDateDiffers = input.start_date && toDateString(existing.start_date) !== input.start_date;

      if (existing.member_id !== input.member_id || existing.plan_id !== input.plan_id || amountDiffers || startDateDiffers) {
        logger.warn('Idempotency key reused with mismatched payload', {
          idempotencyKey: input.idempotency_key,
          memberId: input.member_id
        });
        sendProblem(res, {
          status: 409,
          code: 'IDEMPOTENCY_KEY_MISMATCH',
          title: 'Idempotency Key Collision',
          detail: 'This idempotency key was previously used for a different member, plan, amount, or start date.',
          instance: req.originalUrl,
          requestId: req.requestId
        });
        return;
      }

      // Legitimate idempotent replay
      logger.info('Returning existing subscription for idempotent replay', {
        subscriptionId: existing.id,
        idempotencyKey: input.idempotency_key
      });
      const response: RenewalResponse = {
        subscription_id: existing.id,
        member_id: existing.member_id,
        plan_id: existing.plan_id,
        start_date: toDateString(existing.start_date),
        end_date: toDateString(existing.end_date),
        amount_paid: parseFloat(existing.amount_paid),
        status: existing.status,
        idempotency_key: existing.idempotency_key,
        renewed_from_subscription_id: existing.renewed_from_subscription_id,
        idempotent_replay: true
      };
      res.status(200).json(response);
      return;
    }

    // 3. Execute renewal inside atomic transaction with row locking
    let newSubscription: any;
    try {
      newSubscription = await db.transaction(async (tx: IDatabaseClient) => {
      // Step A: Row-Level Mutual Exclusion Lock on member
      const memberRes = await tx.query(
        `SELECT id, status, full_name, phone
         FROM public.members
         WHERE id = $1 AND gym_id = $2
         FOR UPDATE;`,
        [input.member_id, gymId]
      );

      if (memberRes.rows.length === 0) {
        const err: any = new Error('Member not found in this gym.');
        err.statusCode = 404;
        err.code = 'MEMBER_NOT_FOUND';
        err.title = 'Member Not Found';
        throw err;
      }

      const member = memberRes.rows[0];
      if (member.status === 'archived') {
        const err: any = new Error('Cannot renew an archived member record.');
        err.statusCode = 422;
        err.code = 'MEMBER_ARCHIVED';
        err.title = 'Member Archived';
        throw err;
      }

      // Step B: Verify Plan exists and is active
      const planRes = await tx.query(
        `SELECT id, name, duration_days, price, is_active
         FROM public.membership_plans
         WHERE id = $1 AND gym_id = $2
         LIMIT 1;`,
        [input.plan_id, gymId]
      );

      if (planRes.rows.length === 0) {
        const err: any = new Error('Selected membership plan was not found in this gym.');
        err.statusCode = 404;
        err.code = 'PLAN_NOT_FOUND';
        err.title = 'Plan Not Found';
        throw err;
      }

      const plan = planRes.rows[0];
      if (!plan.is_active) {
        const err: any = new Error('The selected membership plan is inactive and cannot be assigned.');
        err.statusCode = 422;
        err.code = 'PLAN_INACTIVE';
        err.title = 'Plan Inactive';
        throw err;
      }

      // Step C: Query latest active subscription for contiguous date calculation
      const latestSubRes = await tx.query(
        `SELECT id, start_date, end_date, status
         FROM public.subscriptions
         WHERE member_id = $1 AND gym_id = $2 AND status = 'active'
         ORDER BY end_date DESC
         LIMIT 1;`,
        [input.member_id, gymId]
      );

      const todayStr = formatDate(new Date());
      let computedStartDate: string;
      let renewedFromId: string | null = null;

      if (input.start_date) {
        computedStartDate = input.start_date;
        renewedFromId = latestSubRes.rows.length > 0 ? latestSubRes.rows[0].id : null;
      } else if (latestSubRes.rows.length > 0 && latestSubRes.rows[0].end_date >= todayStr) {
        // Contiguous extension from previous subscription end_date
        computedStartDate = addDays(latestSubRes.rows[0].end_date, 1);
        renewedFromId = latestSubRes.rows[0].id;
      } else {
        // Expired or no prior active subscription: start today
        computedStartDate = todayStr;
        renewedFromId = latestSubRes.rows.length > 0 ? latestSubRes.rows[0].id : null;
      }

      // Calculate end date (inclusive)
      const computedEndDate = addDays(computedStartDate, plan.duration_days - 1);

      // Step D: Insert new subscription
      // Note: Exclusion constraint `no_overlapping_active_subscriptions` will enforce non-overlap
      const insertSubRes = await tx.query(
        `INSERT INTO public.subscriptions (
          gym_id,
          member_id,
          plan_id,
          start_date,
          end_date,
          amount_paid,
          payment_method,
          notes,
          idempotency_key,
          created_by,
          renewed_from_subscription_id,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
        RETURNING id, member_id, plan_id, start_date, end_date, amount_paid, status, idempotency_key, renewed_from_subscription_id;`,
        [
          gymId,
          input.member_id,
          input.plan_id,
          computedStartDate,
          computedEndDate,
          input.amount_paid,
          input.payment_method,
          input.notes || null,
          input.idempotency_key,
          staffId,
          renewedFromId
        ]
      );

      const createdSub = insertSubRes.rows[0];

      // Step E: Insert Audit Log entry
      await tx.query(
        `INSERT INTO public.audit_logs (
          gym_id,
          actor_id,
          action,
          entity_type,
          entity_id,
          changes
        ) VALUES ($1, $2, 'subscription.renew', 'subscription', $3, $4);`,
        [
          gymId,
          staffId,
          createdSub.id,
          JSON.stringify({
            member_id: input.member_id,
            plan_id: input.plan_id,
            start_date: createdSub.start_date,
            end_date: createdSub.end_date,
            amount_paid: createdSub.amount_paid,
            idempotency_key: input.idempotency_key
          })
        ]
      );

      return createdSub;
    });
    } catch (err: any) {
      if (
        (err.code === '23505' || err.pgCode === '23505') &&
        (err.message?.includes('uq_subscriptions_gym_idempotency') || err.constraint === 'uq_subscriptions_gym_idempotency')
      ) {
        // Race condition: another concurrent request with the same idempotency key committed just now!
        const raceRes = await db.query(
          `SELECT id, member_id, plan_id, start_date, end_date, amount_paid, status, idempotency_key, renewed_from_subscription_id
           FROM public.subscriptions
           WHERE gym_id = $1 AND idempotency_key = $2
           LIMIT 1;`,
          [gymId, input.idempotency_key]
        );
        if (raceRes.rows.length > 0) {
          const existing = raceRes.rows[0];
          const amountDiffers = Math.abs(parseFloat(existing.amount_paid) - input.amount_paid) > 0.01;
          const startDateDiffers = input.start_date && toDateString(existing.start_date) !== input.start_date;
          if (existing.member_id === input.member_id && existing.plan_id === input.plan_id && !amountDiffers && !startDateDiffers) {
            logger.info('Returning existing subscription for concurrent idempotent replay', {
              subscriptionId: existing.id,
              idempotencyKey: input.idempotency_key
            });
            const response: RenewalResponse = {
              subscription_id: existing.id,
              member_id: existing.member_id,
              plan_id: existing.plan_id,
              start_date: toDateString(existing.start_date),
              end_date: toDateString(existing.end_date),
              amount_paid: parseFloat(existing.amount_paid),
              status: existing.status,
              idempotency_key: existing.idempotency_key,
              renewed_from_subscription_id: existing.renewed_from_subscription_id,
              idempotent_replay: true
            };
            res.status(200).json(response);
            return;
          } else {
            sendProblem(res, {
              status: 409,
              code: 'IDEMPOTENCY_KEY_MISMATCH',
              title: 'Idempotency Key Collision',
              detail: 'This idempotency key was previously used for a different member, plan, amount, or start date.',
              instance: req.originalUrl,
              requestId: req.requestId
            });
            return;
          }
        }
      }
      throw err;
    }

    const response: RenewalResponse = {
      subscription_id: newSubscription.id,
      member_id: newSubscription.member_id,
      plan_id: newSubscription.plan_id,
      start_date: toDateString(newSubscription.start_date),
      end_date: toDateString(newSubscription.end_date),
      amount_paid: parseFloat(newSubscription.amount_paid),
      status: newSubscription.status,
      idempotency_key: newSubscription.idempotency_key,
      renewed_from_subscription_id: newSubscription.renewed_from_subscription_id,
      idempotent_replay: false
    };

    logger.info('Subscription successfully renewed', {
      subscriptionId: newSubscription.id,
      memberId: newSubscription.member_id,
      startDate: response.start_date,
      endDate: response.end_date
    });

    res.status(201).json(response);
  } catch (err) {
    next(err);
  }
}
