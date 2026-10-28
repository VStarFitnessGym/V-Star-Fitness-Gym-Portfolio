// ============================================================================
// Auth & Identity Controller (GET /api/me)
// Returns verified user identity, gym tenant, and role
// ============================================================================

import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { sendProblem } from '../utils/problemDetails';

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    sendProblem(res, {
      status: 401,
      code: 'UNAUTHORIZED',
      title: 'Authentication Required',
      detail: 'No verified identity context found on request.',
      instance: req.originalUrl,
      requestId: req.requestId
    });
    return;
  }

  res.status(200).json({
    id: req.user.id,
    email: req.user.email || null,
    full_name: req.user.full_name,
    role: req.user.role,
    gym: {
      id: req.user.gym_id,
      name: req.user.gym_name || null
    }
  });
}
