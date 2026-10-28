// ============================================================================
// Reminder API Zod Validation Schemas (Stage 5C)
// Validates query parameters, filters, and manual retry payloads
// ============================================================================

import { z } from 'zod';

export const GetRemindersQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .refine((val) => !isNaN(val) && val >= 1, {
      message: 'page must be a positive integer >= 1'
    }),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 25))
    .refine((val) => !isNaN(val) && val >= 1 && val <= 100, {
      message: 'limit must be between 1 and 100'
    }),
  status: z
    .enum([
      'pending',
      'claimed',
      'dispatching',
      'reconciling',
      'completed',
      'failed',
      'skipped',
      'cancelled'
    ])
    .optional(),
  milestone: z
    .enum(['EXPIRY_MINUS_3', 'EXPIRY_ZERO', 'EXPIRY_PLUS_3', 'MANUAL_TRIGGER'])
    .optional(),
  channel: z.enum(['whatsapp', 'sms']).optional(),
  search: z
    .string()
    .max(100, 'Search term too long')
    .optional()
    .transform((val) => (val ? val.trim() : undefined)),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date_from must be in YYYY-MM-DD format')
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date_to must be in YYYY-MM-DD format')
    .optional()
});

export const RetryReminderBodySchema = z.object({
  reason: z
    .string()
    .max(255, 'Reason must be <= 255 characters')
    .optional()
    .transform((val) => (val ? val.trim() : 'Staff initiated manual retry'))
});

export type GetRemindersQuery = z.infer<typeof GetRemindersQuerySchema>;
export type RetryReminderBody = z.infer<typeof RetryReminderBodySchema>;
