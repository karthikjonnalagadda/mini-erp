/**
 * Rate limiting.
 *
 * Two tiers, because the threat models differ:
 *
 *   `apiLimiter`   — broad abuse / runaway-client protection. Generous.
 *   `authLimiter`  — credential stuffing protection on /auth/login. Strict, and
 *                    keyed on (IP + email) so one attacker cannot lock out a
 *                    legitimate user by hammering their address from elsewhere,
 *                    while still throttling a single source enumerating many
 *                    accounts.
 *
 * Successful logins do not count toward the auth limit (`skipSuccessfulRequests`)
 * — a busy shared office NAT should not lock itself out.
 *
 * Production note: the default store is in-memory, which means limits are
 * per-instance. On Render's single-instance free tier that is correct; behind a
 * multi-instance deployment this must be swapped for the Redis store (one-line
 * change, flagged in the README's Known Limitations).
 */
import rateLimit from 'express-rate-limit';
import type { Options } from 'express-rate-limit';
import type { Request, Response } from 'express';

import { env } from '../config/env';
import { ErrorCode, HttpStatus } from '../constants/http-status';
import { CommonMessages } from '../constants/messages';
import { ApiResponse } from '../utils/api-response';
import { logger } from '../utils/logger';

/** Shared 429 responder so limiter output matches the global error envelope. */
const rateLimitHandler = (req: Request, res: Response): void => {
  logger.warn('Rate limit exceeded', {
    requestId: req.requestId,
    ip: req.ip,
    path: req.originalUrl,
  });

  ApiResponse.error(
    res,
    HttpStatus.TOO_MANY_REQUESTS,
    CommonMessages.RATE_LIMITED,
    ErrorCode.RATE_LIMIT_EXCEEDED,
  );
};

const baseOptions: Partial<Options> = {
  standardHeaders: 'draft-7', // RateLimit-* headers
  legacyHeaders: false,
  handler: rateLimitHandler,
};

/** Applied to the whole API surface. */
export const apiLimiter = rateLimit({
  ...baseOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  // Health checks must never be throttled — a 429 would mark the service down.
  skip: (req) => req.path.startsWith('/health'),
});

/** Applied to credential-accepting endpoints only. */
export const authLimiter = rateLimit({
  ...baseOptions,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request): string => {
    const email =
      typeof (req.body as { email?: unknown } | undefined)?.email === 'string'
        ? (req.body as { email: string }).email.toLowerCase()
        : 'anonymous';
    return `${req.ip ?? 'unknown'}:${email}`;
  },
});

/**
 * Applied to expensive report/export endpoints (PDF generation, dashboards).
 * These hit the database hard, so they get their own, much smaller budget.
 */
export const heavyOperationLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60_000,
  limit: 20,
});
