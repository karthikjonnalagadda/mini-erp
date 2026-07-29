/**
 * Request correlation + access logging.
 *
 * Runs first in the chain so that every subsequent log line, audit row and
 * error envelope can be tied back to a single request id. In production the id
 * is echoed in the `X-Request-Id` response header — when a user reports "it
 * failed at 14:32", that id is the entire investigation.
 *
 * Timing is measured with `process.hrtime.bigint()` rather than `Date.now()`
 * because the latter is subject to NTP adjustments and has ~15ms resolution on
 * Windows, which is the same order of magnitude as the requests we're timing.
 */
import crypto from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { REQUEST_ID_HEADER } from '../constants/app.constants';
import { logger } from '../utils/logger';

/** Requests slower than this are logged at WARN for easy grepping. */
const SLOW_REQUEST_THRESHOLD_MS = 1_000;

/** Noise we do not want a log line for on every single page load. */
const SKIPPED_PATHS = new Set(['/health', '/health/live', '/health/ready', '/favicon.ico']);

export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  // Honour an upstream id (load balancer / frontend) so traces span services.
  const incomingId = req.get(REQUEST_ID_HEADER);
  const requestId = incomingId && incomingId.length <= 64 ? incomingId : crypto.randomUUID();

  req.requestId = requestId;
  req.startTime = Number(process.hrtime.bigint() / 1_000_000n);
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const startedAt = process.hrtime.bigint();

  // `finish` fires once the response has been flushed to the socket, which is
  // the only point at which the true duration and status code are known.
  res.on('finish', () => {
    if (SKIPPED_PATHS.has(req.path)) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const meta = {
      requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      userId: req.user?.id,
      ip: req.ip,
    };

    const line = `${req.method} ${meta.path} ${res.statusCode} ${meta.durationMs}ms`;

    if (res.statusCode >= 500) {
      logger.error(line, undefined, meta);
    } else if (res.statusCode >= 400 || durationMs > SLOW_REQUEST_THRESHOLD_MS) {
      logger.warn(line, meta);
    } else {
      logger.http(line, meta);
    }
  });

  next();
};
