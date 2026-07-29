/**
 * JWT signing and verification.
 *
 * Token strategy:
 *  - Access token  : short-lived (15m), carries identity + role, sent as a
 *                    Bearer header. Never persisted server-side.
 *  - Refresh token : long-lived (7d), opaque to the client's business logic,
 *                    stored *hashed* in `refresh_tokens` and rotated on every
 *                    use so a stolen token is single-use and detectable.
 *
 * Access and refresh use different secrets so that compromise of one does not
 * grant the ability to mint the other.
 */
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';

import { jwtConfig } from '../config/env';
import { ErrorCode } from '../constants/http-status';
import { AuthMessages } from '../constants/messages';
import { UnauthorizedError } from './errors';

/** Claims embedded in an access token. Kept minimal — it travels on every call. */
export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  role: string; // RoleName
  tokenType: 'access';
}

/** Refresh tokens carry only what is needed to look the session up. */
export interface RefreshTokenPayload {
  sub: string;
  jti: string; // matches the hashed row in refresh_tokens
  tokenType: 'refresh';
}

const baseSignOptions: Pick<SignOptions, 'issuer' | 'audience' | 'algorithm'> = {
  issuer: jwtConfig.issuer,
  audience: jwtConfig.audience,
  algorithm: 'HS256',
};

export const signAccessToken = (payload: Omit<AccessTokenPayload, 'tokenType'>): string =>
  jwt.sign({ ...payload, tokenType: 'access' }, jwtConfig.accessSecret, {
    ...baseSignOptions,
    expiresIn: jwtConfig.accessExpiresIn,
  } as SignOptions);

export const signRefreshToken = (payload: Omit<RefreshTokenPayload, 'tokenType'>): string =>
  jwt.sign({ ...payload, tokenType: 'refresh' }, jwtConfig.refreshSecret, {
    ...baseSignOptions,
    expiresIn: jwtConfig.refreshExpiresIn,
  } as SignOptions);

/**
 * Translates jsonwebtoken's error classes into our own so that the API returns
 * a stable `error.code` the frontend can act on — specifically TOKEN_EXPIRED,
 * which triggers the silent-refresh flow in the Axios interceptor.
 */
const toAuthError = (error: unknown): UnauthorizedError => {
  if (error instanceof jwt.TokenExpiredError) {
    return new UnauthorizedError(AuthMessages.EXPIRED_TOKEN, ErrorCode.TOKEN_EXPIRED);
  }
  return new UnauthorizedError(AuthMessages.INVALID_TOKEN, ErrorCode.TOKEN_INVALID);
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  try {
    const decoded = jwt.verify(token, jwtConfig.accessSecret, {
      ...baseSignOptions,
      algorithms: ['HS256'],
    }) as AccessTokenPayload;

    // Defence in depth: reject a refresh token presented as a Bearer credential
    // even in the (impossible) case that both secrets were identical.
    if (decoded.tokenType !== 'access') {
      throw new UnauthorizedError(AuthMessages.INVALID_TOKEN, ErrorCode.TOKEN_INVALID);
    }
    return decoded;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw toAuthError(error);
  }
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    const decoded = jwt.verify(token, jwtConfig.refreshSecret, {
      ...baseSignOptions,
      algorithms: ['HS256'],
    }) as RefreshTokenPayload;

    if (decoded.tokenType !== 'refresh') {
      throw new UnauthorizedError(AuthMessages.INVALID_TOKEN, ErrorCode.TOKEN_INVALID);
    }
    return decoded;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw toAuthError(error);
  }
};

/** Extracts the credential from an `Authorization: Bearer <token>` header. */
export const extractBearerToken = (header: string | undefined): string | null => {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
};

/** Duration string ("15m", "7d") -> milliseconds. Used for cookie maxAge. */
export const durationToMs = (duration: string): number => {
  const match = /^(\d+)(ms|s|m|h|d|w|y)?$/.exec(duration);
  if (!match?.[1]) throw new TypeError(`Invalid duration: ${duration}`);

  const value = Number(match[1]);
  const unitMultipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  };
  return value * (unitMultipliers[match[2] ?? 'ms'] ?? 1);
};

/** Absolute expiry timestamp for persisting alongside a refresh token row. */
export const refreshTokenExpiryDate = (): Date =>
  new Date(Date.now() + durationToMs(jwtConfig.refreshExpiresIn));
