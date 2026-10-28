// ============================================================================
// Member Endpoint Zod Validators
// ============================================================================

import { z } from 'zod';

export const GetMembersQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive('Page must be a positive integer')
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),

  status: z
    .enum(['active', 'expiring', 'expired', 'archived'])
    .optional(),

  search: z
    .string()
    .trim()
    .max(100, 'Search term cannot exceed 100 characters')
    .optional(),

  sort_by: z
    .enum(['full_name', 'created_at', 'member_code'])
    .default('created_at'),

  sort_order: z
    .enum(['asc', 'desc'])
    .default('desc')
});

export type GetMembersQuery = z.infer<typeof GetMembersQuerySchema>;
