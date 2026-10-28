// ============================================================================
// Health & Liveness Controller
// Returns safe health telemetry without disclosing internal configuration or secrets
// ============================================================================

import { Request, Response } from 'express';
import { db } from '../db/database';

const startTime = Date.now();

export async function getHealth(_req: Request, res: Response): Promise<void> {
  const isDbReady = await db.isReady();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const payload = {
    status: isDbReady ? 'healthy' : 'degraded',
    database: isDbReady ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    uptime_seconds: uptimeSeconds,
    version: '1.0.0'
  };

  const statusCode = isDbReady ? 200 : 503;
  res.status(statusCode).json(payload);
}
