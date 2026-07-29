/**
 * Authentication domain service.
 *
 * Holds every rule about *who may sign in and how sessions behave*. It knows
 * nothing about Express — no `req`, no `res`, no cookies. That is the
 * controller's job. The payoff is that this file is testable with plain objects
 * and reusable from a CLI, a queue worker or a GraphQL layer without change.
 *
 * Session model: short-lived access JWT + rotating refresh token with reuse
 * detection. See refresh-token.repository.ts for the rotation invariants.
 */
import crypto from 'node:crypto';

import type { RoleName } from '@prisma/client';

import { jwtConfig } from '../config/env';
import { AUDIT_ENTITY } from '../constants/app.constants';
import { ErrorCode } from '../constants/http-status';
import { AuthMessages } from '../constants/messages';
import { refreshTokenRepository } from '../repositories/refresh-token.repository';
import { roleRepository } from '../repositories/role.repository';
import { userRepository } from '../repositories/user.repository';
import type { UserWithRole } from '../repositories/user.repository';
import { auditService } from './audit.service';
import { toUserResponse } from '../dto/auth.dto';
import type {
  AuthResponseDto,
  AuthTokensDto,
  ChangePasswordDto,
  LoginDto,
  RegisterUserDto,
  UpdateProfileDto,
  UserResponseDto,
} from '../dto/auth.dto';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/errors';
import {
  durationToMs,
  refreshTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
} from '../utils/jwt';
import {
  hashPassword,
  hashToken,
  simulatePasswordVerification,
  verifyPassword,
} from '../utils/password';
import { logger } from '../utils/logger';
import type { ActorContext } from '../types/common.types';

/** Client metadata captured with each session for the audit trail. */
export interface SessionContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

class AuthService {
  /**
   * Mints an access/refresh pair and persists the refresh session.
   *
   * The refresh token embeds a random `jti` which is also what we hash into the
   * `refresh_tokens` row — so the JWT is self-describing while the server keeps
   * the authoritative revocation state.
   */
  private async issueTokens(user: UserWithRole, context: SessionContext): Promise<AuthTokensDto> {
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role.name,
    });

    const jti = crypto.randomUUID();
    const refreshToken = signRefreshToken({ sub: user.id, jti });

    await refreshTokenRepository.create({
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: refreshTokenExpiryDate(),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Math.floor(durationToMs(jwtConfig.accessExpiresIn) / 1000),
    };
  }

  private toActor(user: UserWithRole, context: SessionContext): ActorContext {
    return {
      id: user.id,
      email: user.email,
      role: user.role.name,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    };
  }

  /**
   * Credential exchange.
   *
   * Anti-enumeration measures, all deliberate:
   *  - The same message and status are returned for "no such user" and "wrong
   *    password".
   *  - When the user does not exist we still burn a bcrypt comparison, so the
   *    response time does not distinguish the two cases.
   *  - Failed attempts are audited (with the attempted email) for detection,
   *    but never echoed back to the caller.
   */
  async login(dto: LoginDto, context: SessionContext): Promise<AuthResponseDto> {
    const user = await userRepository.findByEmail(dto.email);

    if (!user) {
      await simulatePasswordVerification();
      void auditService.record({
        action: 'LOGIN_FAILED',
        entityType: AUDIT_ENTITY.AUTH,
        summary: `Failed sign-in attempt for unknown account ${dto.email}`,
        actorEmail: dto.email,
      });
      throw new UnauthorizedError(AuthMessages.INVALID_CREDENTIALS, ErrorCode.INVALID_CREDENTIALS);
    }

    const passwordMatches = await verifyPassword(dto.password, user.passwordHash);
    if (!passwordMatches) {
      void auditService.record({
        action: 'LOGIN_FAILED',
        entityType: AUDIT_ENTITY.AUTH,
        entityId: user.id,
        summary: `Failed sign-in attempt for ${user.email}`,
        actorEmail: user.email,
      });
      throw new UnauthorizedError(AuthMessages.INVALID_CREDENTIALS, ErrorCode.INVALID_CREDENTIALS);
    }

    // Status is checked only after the password is verified, so an attacker
    // cannot use the "account disabled" response to confirm a valid address.
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError(AuthMessages.ACCOUNT_INACTIVE, { status: user.status });
    }

    const tokens = await this.issueTokens(user, context);
    await userRepository.recordLogin(user.id);

    void auditService.record({
      action: 'LOGIN',
      entityType: AUDIT_ENTITY.AUTH,
      entityId: user.id,
      summary: `${user.firstName} ${user.lastName} signed in`,
      actor: this.toActor(user, context),
    });

    logger.info('User signed in', { userId: user.id, role: user.role.name });

    return { user: toUserResponse(user), tokens };
  }

  /**
   * Rotates a refresh token.
   *
   * Reuse detection: presenting an already-revoked token means the token was
   * captured. Since we cannot tell the thief from the victim, every session for
   * that user is revoked and both parties must sign in again.
   */
  async refresh(
    refreshToken: string,
    context: SessionContext,
  ): Promise<{ user: UserResponseDto; tokens: AuthTokensDto }> {
    const tokenHash = hashToken(refreshToken);
    const stored = await refreshTokenRepository.findByHash(tokenHash);

    if (!stored) {
      throw new UnauthorizedError(AuthMessages.INVALID_TOKEN, ErrorCode.TOKEN_INVALID);
    }

    if (stored.revokedAt) {
      await refreshTokenRepository.revokeAllForUser(stored.userId);
      logger.warn('Refresh token reuse detected — all sessions revoked', {
        userId: stored.userId,
        ip: context.ipAddress,
      });
      void auditService.record({
        action: 'LOGOUT',
        entityType: AUDIT_ENTITY.AUTH,
        entityId: stored.userId,
        summary: 'Refresh token reuse detected; all sessions revoked',
      });
      throw new UnauthorizedError(AuthMessages.REUSED_REFRESH_TOKEN, ErrorCode.TOKEN_INVALID);
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError(AuthMessages.EXPIRED_TOKEN, ErrorCode.TOKEN_EXPIRED);
    }

    const user = await userRepository.findActiveById(stored.userId);
    if (!user) {
      await refreshTokenRepository.revokeAllForUser(stored.userId);
      throw new UnauthorizedError(AuthMessages.ACCOUNT_INACTIVE, ErrorCode.ACCOUNT_INACTIVE);
    }

    const tokens = await this.issueTokens(user, context);
    // Link old -> new so the rotation chain is auditable.
    await refreshTokenRepository.revoke(tokenHash, hashToken(tokens.refreshToken));

    return { user: toUserResponse(user), tokens };
  }

  /** Revokes the presented session only. Idempotent by design. */
  async logout(refreshToken: string | undefined, actor?: ActorContext): Promise<void> {
    if (refreshToken) {
      await refreshTokenRepository.revoke(hashToken(refreshToken));
    }

    if (actor) {
      void auditService.record({
        action: 'LOGOUT',
        entityType: AUDIT_ENTITY.AUTH,
        entityId: actor.id,
        summary: `${actor.email} signed out`,
        actor,
      });
    }
  }

  /** Revokes every session for the user (the "sign out everywhere" control). */
  async logoutAll(userId: string, actor: ActorContext): Promise<{ revokedSessions: number }> {
    const revokedSessions = await refreshTokenRepository.revokeAllForUser(userId);

    void auditService.record({
      action: 'LOGOUT',
      entityType: AUDIT_ENTITY.AUTH,
      entityId: userId,
      summary: `All sessions revoked (${revokedSessions})`,
      actor,
    });

    return { revokedSessions };
  }

  /**
   * Creates a user. Admin-only at the route level — there is no public
   * self-registration in an internal ERP, and pretending otherwise would be a
   * privilege-escalation vector (anyone could mint an ADMIN).
   */
  async register(dto: RegisterUserDto, actor: ActorContext): Promise<UserResponseDto> {
    if (await userRepository.emailExists(dto.email)) {
      throw new ConflictError(AuthMessages.EMAIL_TAKEN, ErrorCode.DUPLICATE_RESOURCE, {
        field: 'email',
      });
    }

    const role = await roleRepository.findByName(dto.role);
    if (!role) {
      throw new BadRequestError(`Role '${dto.role}' does not exist`, { field: 'role' });
    }

    const created = await userRepository.create({
      email: dto.email,
      passwordHash: await hashPassword(dto.password),
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone ?? null,
      role: { connect: { id: role.id } },
    });

    void auditService.record({
      action: 'CREATE',
      entityType: AUDIT_ENTITY.USER,
      entityId: created.id,
      summary: `Created ${dto.role} account for ${created.email}`,
      after: { email: created.email, role: dto.role, status: created.status },
      actor,
    });

    return toUserResponse(created);
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User', userId);
    return toUserResponse(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    actor: ActorContext,
  ): Promise<UserResponseDto> {
    const existing = await userRepository.findById(userId);
    if (!existing) throw new NotFoundError('User', userId);

    const updated = await userRepository.update(userId, {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
    });

    const changes = auditService.diff(
      { firstName: existing.firstName, lastName: existing.lastName, phone: existing.phone },
      dto as Record<string, unknown>,
    );

    if (changes) {
      void auditService.record({
        action: 'UPDATE',
        entityType: AUDIT_ENTITY.USER,
        entityId: userId,
        summary: `Updated own profile`,
        before: changes.before,
        after: changes.after,
        actor,
      });
    }

    return toUserResponse(updated);
  }

  /**
   * Password change.
   *
   * Revoking every other session afterwards is intentional: the usual reason a
   * user changes their password is that they believe it was compromised, and
   * leaving the attacker's refresh token valid for another week would defeat
   * the entire exercise.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    actor: ActorContext,
  ): Promise<{ revokedSessions: number }> {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User', userId);

    const currentMatches = await verifyPassword(dto.currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new UnauthorizedError(
        AuthMessages.CURRENT_PASSWORD_INCORRECT,
        ErrorCode.INVALID_CREDENTIALS,
      );
    }

    await userRepository.updatePassword(userId, await hashPassword(dto.newPassword));
    const revokedSessions = await refreshTokenRepository.revokeAllForUser(userId);

    void auditService.record({
      action: 'UPDATE',
      entityType: AUDIT_ENTITY.USER,
      entityId: userId,
      summary: 'Password changed; all sessions revoked',
      actor,
    });

    logger.info('Password changed', { userId, revokedSessions });
    return { revokedSessions };
  }

  /** Admin action: activate/deactivate/suspend an account. */
  async updateStatus(
    userId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
    actor: ActorContext,
  ): Promise<UserResponseDto> {
    if (userId === actor.id) {
      throw new BadRequestError('You cannot change the status of your own account');
    }

    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User', userId);

    const updated = await userRepository.update(userId, { status });

    // Losing ACTIVE means losing access immediately, not in 15 minutes.
    if (status !== 'ACTIVE') {
      await refreshTokenRepository.revokeAllForUser(userId);
    }

    void auditService.record({
      action: 'STATUS_CHANGE',
      entityType: AUDIT_ENTITY.USER,
      entityId: userId,
      summary: `Account status changed from ${user.status} to ${status}`,
      before: { status: user.status },
      after: { status },
      actor,
    });

    return toUserResponse(updated);
  }

  async listUsers(query: Parameters<typeof userRepository.findMany>[0]): Promise<{
    items: UserResponseDto[];
    total: number;
  }> {
    const { items, total } = await userRepository.findMany(query);
    return { items: items.map(toUserResponse), total };
  }

  /**
   * Soft-deletes a user.
   *
   * Two guards: an admin cannot delete themselves (locking the org out of its
   * own system), and the final ADMIN cannot be removed.
   */
  async deleteUser(userId: string, actor: ActorContext): Promise<void> {
    if (userId === actor.id) {
      throw new BadRequestError('You cannot delete your own account');
    }

    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User', userId);

    if (user.role.name === 'ADMIN') {
      const counts = await userRepository.countByRole();
      const adminCount = counts.find((entry) => entry.role === 'ADMIN')?.count ?? 0;
      if (adminCount <= 1) {
        throw new ConflictError('The last administrator account cannot be deleted');
      }
    }

    await userRepository.softDelete(userId);
    await refreshTokenRepository.revokeAllForUser(userId);

    void auditService.record({
      action: 'DELETE',
      entityType: AUDIT_ENTITY.USER,
      entityId: userId,
      summary: `Deleted user account ${user.email}`,
      before: { email: user.email, role: user.role.name },
      actor,
    });
  }

  async listRoles(): Promise<Array<{ id: string; name: RoleName; description: string; userCount: number }>> {
    const roles = await roleRepository.findAll();
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      userCount: role._count.users,
    }));
  }
}

export const authService = new AuthService();
export { AuthService };
