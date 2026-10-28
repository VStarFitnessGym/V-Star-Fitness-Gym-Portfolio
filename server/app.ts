// ============================================================================
// Express Backend Application
// RFC 7807 problem details, request tracking, and routes
// ============================================================================

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { getHealth } from './controllers/healthController';
import { getMe } from './controllers/authController';
import { getMembers } from './controllers/membersController';
import { renewSubscription } from './controllers/subscriptionsController';
import webhookRoutes from './routes/webhookRoutes';
import cronRoutes from './routes/cronRoutes';
import reminderRoutes from './routes/reminderRoutes';
import { authenticate, requireRole } from './middleware/authMiddleware';
import { errorHandler } from './middleware/errorHandler';
import { sendProblem } from './utils/problemDetails';

const app = express();

// 1. Core Middleware with Hardened CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests without origin (curl, mobile apps, server-to-server)
      if (!origin) return callback(null, true);
      // In local development or test, allow local origins
      if (process.env.NODE_ENV !== 'production' || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS request blocked by origin security policy'));
    },
    credentials: true
  })
);
app.use(
  express.json({
    limit: '1mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// 2. Request Tracking ID
app.use((req: Request, res: Response, next: NextFunction) => {
  const reqId = (req.headers['x-request-id'] as string) || `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  (req as any).requestId = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
});

// 3. API Routes
// A. Health Endpoint (Public)
app.get('/api/health', getHealth);

// B. Identity Endpoint (Protected)
app.get('/api/me', authenticate, getMe);

// C. Members Endpoint (Protected, Staff / Admin / Owner)
app.get('/api/members', authenticate, requireRole('owner', 'admin', 'staff'), getMembers);

// D. Subscription Renewal Endpoint (Protected, Staff / Admin / Owner)
app.post('/api/subscriptions/renew', authenticate, requireRole('owner', 'admin', 'staff'), renewSubscription);

// E. Provider Webhooks (Public Server-to-Server, HMAC Protected)
app.use('/api/webhooks', webhookRoutes);

// F. Machine-to-Machine Cron Pipeline (Protected via CRON_SECRET)
app.use('/api/cron', cronRoutes);

// G. Reminders Operations & Telemetry (Protected, Staff / Admin / Owner)
app.use('/api/reminders', reminderRoutes);

// 4. 404 Route Handler (RFC 7807 Problem Details)
app.use((req: Request, res: Response) => {
  sendProblem(res, {
    status: 404,
    code: 'ROUTE_NOT_FOUND',
    title: 'Resource Not Found',
    detail: `The endpoint ${req.method} ${req.path} does not exist.`,
    instance: req.originalUrl,
    requestId: (req as any).requestId
  });
});

// 5. Global Error Handling Middleware
app.use(errorHandler);

export default app;
