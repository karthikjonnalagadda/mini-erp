/**
 * Authentication middleware.
 *
 * Design decision — we re-read the user from the database on every request
 * instead of trusting the JWT claims alone.
 *
 * The trade-off is one indexed primary-key lookup (sub-millisecond) against the
 * alternative: a deactivated or role-demoted employee keeping full access until
 * their 15-minute access token expires. In an ERP that controls stock and
 * pricing, "fired at 10:00, still confirming challans at 10:12" is not an
 * acceptable window. If this ever becomes a bottleneck the fix is a short-TTL
 * cache in front of the repository, not weaker semantics.
 */
import type { NextFunction, Request, Response } from 'express';

import { ErrorCode } from '../constants/http-status';
import { AuthMessages } from '../constants/messages';
import { userRepository } from '../repositories/user.repository';
import { UnauthorizedError } from '../utils/errors';
import { extractBearerToken, verifyAccessToken } from '../utils/jwt';
import { asyncHandler } from '../utils/async-handler';

/**
 * Requires a valid access token. Populates `req.user` on success.
 * Throws 401 with a specific `error.code` so the client can distinguish
 * "expired -> silently refresh" from "invalid -> force re-login".
 */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req.get('authorization'));

    if (!token) {
      throw new UnauthorizedError(AuthMessages.MISSING_TOKEN, ErrorCode.UNAUTHORIZED);
    }

    // Throws TOKEN_EXPIRED / TOKEN_INVALID — both mapped to 401 downstream.
    const payload = verifyAccessToken(token);

    const user = await userRepository.findActiveById(payload.sub);
    if (!user) {
      // Covers deleted, deactivated and suspended accounts alike. We do not
      // differentiate in the message — that would leak account state.
      throw new UnauthorizedError(AuthMessages.ACCOUNT_INACTIVE, ErrorCode.ACCOUNT_INACTIVE);
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role.name,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    next();
  },
);

/**
 * Attaches `req.user` when a valid token is present but never rejects.
 * Used by endpoints whose response is richer for signed-in callers (currently
 * only the health/meta endpoints).
 */
export const optionalAuthenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req.get('authorization'));
    if (!token) {
      next();
      return;
    }

    try {
      const payload = verifyAccessToken(token);
      const user = await userRepository.findActiveById(payload.sub);
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role.name,
          firstName: user.firstName,
          lastName: user.lastName,
        };
      }
    } catch {
      // Deliberately swallowed — this middleware is best-effort by contract.
    }

    next();
  },
);

/**
 * Narrowing helper for controllers.
 *
 * `req.user` is optional at the type level (correctly — the compiler cannot
 * know a middleware ran). Rather than `req.user!` in twenty controllers, we
 * assert once here and get a real error if a route is ever misconfigured.
 */
export const requireUser = (req: Request): NonNullable<Request['user']> => {
  if (!req.user) {
    throw new UnauthorizedError(AuthMessages.MISSING_TOKEN, ErrorCode.UNAUTHORIZED);
  }
  return req.user;
};
