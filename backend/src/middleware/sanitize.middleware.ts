/**
 * Applies the recursive sanitiser to every mutable part of the request.
 *
 * Placed *before* validation so Zod sees already-normalised input: a name of
 * `"  Acme  "` passes a `min(2)` check for the right reason, and a stored value
 * never carries stray whitespace or zero-width characters.
 *
 * Note on `req.query`: in Express 4 it is a getter-backed object. We mutate its
 * properties in place rather than reassigning, because reassignment is silently
 * ignored on some Express/Node combinations.
 */
import type { NextFunction, Request, Response } from 'express';

import { sanitizeValue } from '../utils/sanitize';

export const sanitizeRequest = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body) as Record<string, unknown>;
  }

  if (req.query && typeof req.query === 'object') {
    const sanitized = sanitizeValue(req.query) as Record<string, unknown>;
    for (const key of Object.keys(sanitized)) {
      (req.query as Record<string, unknown>)[key] = sanitized[key];
    }
  }

  if (req.params && typeof req.params === 'object') {
    const sanitized = sanitizeValue(req.params) as Record<string, string>;
    for (const key of Object.keys(sanitized)) {
      (req.params as Record<string, unknown>)[key] = sanitized[key];
    }
  }

  next();
};
