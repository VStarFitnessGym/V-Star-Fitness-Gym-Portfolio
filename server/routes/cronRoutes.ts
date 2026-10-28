// ============================================================================
// Cron Routes (Stage 5C)
// Mounted at /api/cron
// Protected by dedicated machine-to-machine authenticateCronSecret middleware
// ============================================================================

import { Router } from 'express';
import { triggerReminderCron } from '../controllers/cronController';
import { authenticateCronSecret } from '../middleware/cronMiddleware';

const router = Router();

// POST /api/cron/reminders
// Machine-to-machine cron pipeline executing scheduling, worker batch, and reconciliation
router.post('/reminders', authenticateCronSecret, triggerReminderCron);

export default router;
