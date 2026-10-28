// ============================================================================
// Subscription Endpoint Zod Validators
// Validates UUIDs, amounts, payment methods, and dates
// ============================================================================

import { z } from 'zod';

const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const RenewSubscriptionSchema = z.object({
  member_id: z.string().regex(uuidPattern, { message: 'member_id must be a valid UUID' }),
  plan_id: z.string().regex(uuidPattern, { message: 'plan_id must be a valid UUID' }),
  idempotency_key: z.string().regex(uuidPattern, {
    message: 'A client-generated UUID idempotency key is required to prevent duplicate renewals.'
  }),
  amount_paid: z
    .number()
    .nonnegative({ message: 'amount_paid must be non-negative' }),
  payment_method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'other']),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'start_date must be formatted as YYYY-MM-DD' })
    .optional(),
  notes: z.string().max(500, { message: 'notes cannot exceed 500 characters' }).optional()
});

export type RenewSubscriptionInput = z.infer<typeof RenewSubscriptionSchema>;
