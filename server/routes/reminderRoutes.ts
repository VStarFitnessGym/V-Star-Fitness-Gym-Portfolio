// ============================================================================
// Reminder Management Routes (Stage 5C)
// Mounted at /api/reminders
// Protected by staff JWT authentication and role authorization
// ============================================================================

import { Router } from 'express';
import {
  getReminders,
  getReminderTelemetry,
  retryReminderJob
} from '../controllers/remindersController';
import { authenticate, requireRole } from '../middleware/authMiddleware';

const router = Router();

// All reminder endpoints require authenticated gym staff (owner, admin, or staff)
router.use(authenticate, requireRole('owner', 'admin', 'staff'));

// GET /api/reminders
// Tenant-scoped paginated list of reminder jobs with attempts
router.get('/', getReminders);

// GET /api/reminders/telemetry
// Live database-backed telemetry counts for dashboard KPI cards
router.get('/telemetry', getReminderTelemetry);

// POST /api/reminders/:jobId/retry
// Atomic manual retry of a failed reminder job with eligibility verification and audit logging
router.post('/:jobId/retry', retryReminderJob);

export default router;
