/**
 * Auth HTTP layer.
 *
 * Controllers are deliberately thin. Their entire job is:
 *   HTTP request -> DTO -> service call -> HTTP response.
 *
 * No business rules, no Prisma, no conditionals beyond wiring. If a controller
 * method grows an `if` that encodes a policy, that policy belongs in the
 * service. Validation already happened in middleware, so `req.body` is trusted
 * and typed here.
 */
import type { Request, Response } from 'express';

import { env } from '../config/env';
import { REFRESH_TOKEN_COOKIE } from '../constants/app.constants';
import { AuthMessages, CommonMessages } from '../constants/messages';
import { requireUser } from '../middleware/auth.middleware';
import { getValidatedQuery } from '../middleware/validate.middleware';
import { authService } from '../services/auth.service';
import type { SessionContext } from '../services/auth.service';
import { ApiResponse } from '../utils/api-response';
import { asyncHandler } from '../utils/async-handler';
import { UnauthorizedError } from '../utils/errors';
import { durationToMs } from '../utils/jwt';
import { jwtConfig } from '../config/env';
import { buildPaginationMeta, resolvePagination } from '../utils/pagination';
import type { ActorContext } from '../types/common.types';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
  UserListQueryInput,
} from '../validators/auth.validators';

/** Collects the request metadata every session/audit write wants. */
const sessionContextOf = (req: Request): SessionContext => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
  requestId: req.requestId,
});

const actorOf = (req: Request): ActorContext => {
  const user = requireUser(req);
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.requestId,
  };
};

/**
 * Refresh-token cookie options.
 *
 * `httpOnly`  — unreadable from JavaScript, so an XSS payload cannot exfiltrate
 *               the long-lived credential.
 * `sameSite`  — 'none' in production because the SPA (Vercel) and API (Render)
 *               are on different registrable domains, which makes the cookie
 *               cross-site. 'none' REQUIRES `secure`, which we set in the same
 *               branch. In development both run on localhost, so 'lax' works
 *               and avoids needing HTTPS locally.
 * `path`      — scoped to the auth routes so it is not attached to every API
 *               call, shrinking its exposure.
 */
const refreshCookieOptions = (): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'none' | 'lax';
  maxAge: number;
  path: string;
} => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'none' : 'lax',
  maxAge: durationToMs(jwtConfig.refreshExpiresIn),
  path: '/',
});

/** Reads the refresh token from the cookie, falling back to the JSON body. */
const extractRefreshToken = (req: Request): string | undefined => {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE];
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  return fromCookie ?? fromBody;
};

export const authController = {
  /** POST /auth/login */
  login: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as LoginInput;
    const result = await authService.login(dto, sessionContextOf(req));

    res.cookie(REFRESH_TOKEN_COOKIE, result.tokens.refreshToken, refreshCookieOptions());

    return ApiResponse.ok(res, result, AuthMessages.LOGIN_SUCCESS);
  }),

  /** POST /auth/refresh */
  refresh: asyncHandler(async (req: Request, res: Response) => {
    const token = extractRefreshToken(req);
    if (!token) {
      throw new UnauthorizedError(AuthMessages.MISSING_TOKEN);
    }

    const result = await authService.refresh(token, sessionContextOf(req));

    res.cookie(REFRESH_TOKEN_COOKIE, result.tokens.refreshToken, refreshCookieOptions());

    return ApiResponse.ok(res, result, AuthMessages.TOKEN_REFRESHED);
  }),

  /**
   * POST /auth/logout
   *
   * Unauthenticated on purpose: a user whose access token has already expired
   * must still be able to invalidate their refresh session.
   */
  logout: asyncHandler(async (req: Request, res: Response) => {
    const token = extractRefreshToken(req);
    const actor = req.user
      ? {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          ipAddress: req.ip,
          requestId: req.requestId,
        }
      : undefined;

    await authService.logout(token, actor);

    res.clearCookie(REFRESH_TOKEN_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });

    return ApiResponse.ok(res, null, AuthMessages.LOGOUT_SUCCESS);
  }),

  /** POST /auth/logout-all */
  logoutAll: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const result = await authService.logoutAll(actor.id, actor);

    res.clearCookie(REFRESH_TOKEN_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });

    return ApiResponse.ok(res, result, AuthMessages.LOGOUT_SUCCESS);
  }),

  /** GET /auth/me */
  me: asyncHandler(async (req: Request, res: Response) => {
    const user = requireUser(req);
    const profile = await authService.getProfile(user.id);
    return ApiResponse.ok(res, profile);
  }),

  /** PATCH /auth/me */
  updateProfile: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const dto = req.body as UpdateProfileInput;
    const profile = await authService.updateProfile(actor.id, dto, actor);
    return ApiResponse.ok(res, profile, AuthMessages.PROFILE_UPDATED);
  }),

  /** POST /auth/change-password */
  changePassword: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const dto = req.body as ChangePasswordInput;
    const result = await authService.changePassword(actor.id, dto, actor);

    // Every session — including this one — was just revoked.
    res.clearCookie(REFRESH_TOKEN_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });

    return ApiResponse.ok(res, result, AuthMessages.PASSWORD_CHANGED);
  }),

  // ---------------------------------------------------------------------------
  // User administration (ADMIN only — enforced at the route level)
  // ---------------------------------------------------------------------------

  /** POST /auth/users */
  register: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const dto = req.body as RegisterInput;
    const user = await authService.register(dto, actor);
    return ApiResponse.created(res, user, AuthMessages.REGISTER_SUCCESS);
  }),

  /** GET /auth/users */
  listUsers: asyncHandler(async (_req: Request, res: Response) => {
    const query = getValidatedQuery<UserListQueryInput>(res);
    const { items, total } = await authService.listUsers(query);
    const { page, limit } = resolvePagination(query);
    return ApiResponse.paginated(res, items, buildPaginationMeta(total, { page, limit }));
  }),

  /** PATCH /auth/users/:id/status */
  updateUserStatus: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const { status } = req.body as { status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' };
    const user = await authService.updateStatus(req.params['id'] as string, status, actor);
    return ApiResponse.ok(res, user, CommonMessages.FETCHED);
  }),

  /** DELETE /auth/users/:id */
  deleteUser: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);
    await authService.deleteUser(req.params['id'] as string, actor);
    return ApiResponse.deleted(res, 'User account deleted successfully');
  }),

  /** GET /auth/roles */
  listRoles: asyncHandler(async (_req: Request, res: Response) => {
    const roles = await authService.listRoles();
    return ApiResponse.ok(res, roles);
  }),
};
