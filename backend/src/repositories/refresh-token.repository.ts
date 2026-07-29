/**
 * Refresh-token session store.
 *
 * The security model implemented here is ROTATION WITH REUSE DETECTION:
 *
 *  - Every successful refresh revokes the presented token and issues a new one,
 *    recording the successor in `replacedByTokenHash`.
 *  - If a token that has ALREADY been revoked is presented again, that means two
 *    parties hold the same token — i.e. one of them stole it. We cannot tell
 *    which, so we revoke the user's entire token family and force a fresh login.
 *
 * Only SHA-256 hashes are stored; the plaintext token never touches the
 * database, so a dump is not directly replayable.
 */
import type { RefreshToken } from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';

export interface CreateRefreshTokenInput {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

class RefreshTokenRepository {
  private db(tx?: DbClient): DbClient {
    return tx ?? prisma;
  }

  async create(data: CreateRefreshTokenInput, tx?: DbClient): Promise<RefreshToken> {
    return this.db(tx).refreshToken.create({
      data: {
        tokenHash: data.tokenHash,
        userId: data.userId,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent?.slice(0, 255) ?? null,
        ipAddress: data.ipAddress?.slice(0, 64) ?? null,
      },
    });
  }

  /** Looks a session up by hash. Returns revoked/expired rows too — the service
   *  needs to *see* a revoked row to detect reuse. */
  async findByHash(tokenHash: string, tx?: DbClient): Promise<RefreshToken | null> {
    return this.db(tx).refreshToken.findUnique({ where: { tokenHash } });
  }

  /** Marks a token revoked and links it to its successor (the rotation chain). */
  async revoke(tokenHash: string, replacedByTokenHash?: string, tx?: DbClient): Promise<void> {
    await this.db(tx).refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), replacedByTokenHash: replacedByTokenHash ?? null },
    });
  }

  /** Panic button: used on logout-everywhere and on refresh-token reuse. */
  async revokeAllForUser(userId: string, tx?: DbClient): Promise<number> {
    const result = await this.db(tx).refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async countActiveSessions(userId: string, tx?: DbClient): Promise<number> {
    return this.db(tx).refreshToken.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  /**
   * Housekeeping — deletes rows that are expired or long revoked.
   * Called on a timer from the server bootstrap; without it this table grows
   * unbounded at roughly one row per login per week.
   */
  async pruneExpired(olderThan: Date = new Date(), tx?: DbClient): Promise<number> {
    const result = await this.db(tx).refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: olderThan } },
          { revokedAt: { lt: new Date(olderThan.getTime() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      },
    });
    return result.count;
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
export { RefreshTokenRepository };
