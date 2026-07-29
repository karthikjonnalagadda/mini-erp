/**
 * Audit trail.
 *
 * Two write paths, chosen deliberately:
 *
 *  `record()`            — fire-and-forget. Used for reads, logins and other
 *                          non-transactional events. A failure to write an audit
 *                          row must NEVER fail the user's request, so errors are
 *                          logged and swallowed.
 *
 *  `recordInTransaction()` — enlisted in the caller's transaction. Used for
 *                          stock movements and challan state changes, where the
 *                          audit row and the business change must commit or roll
 *                          back together. Here a failure DOES abort the
 *                          operation, which is correct: an unauditable stock
 *                          deduction is worse than a failed one.
 *
 * Payloads are redacted before storage, so a password change logs that it
 * happened without ever persisting the password.
 */
import type { AuditAction, Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';
import { buildDateRangeFilter, buildOrderBy, resolvePagination } from '../utils/pagination';
import { logger, redact } from '../utils/logger';
import type { ActorContext, PagedResult } from '../types/common.types';
import type { SortOrder } from '../constants/app.constants';

export interface AuditEntryInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  /** One-line description shown in the UI timeline. */
  summary: string;
  before?: unknown;
  after?: unknown;
  actor?: ActorContext | null;
  /** Overrides for events where there is no authenticated actor (failed login). */
  actorEmail?: string | null;
}

export interface AuditListQuery {
  page?: number;
  limit?: number;
  sortOrder?: SortOrder;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

const SORTABLE_FIELDS = ['createdAt', 'action', 'entityType'] as const;

/**
 * Prisma's `Json` columns reject `undefined`, and storing a giant object would
 * bloat the table. This normalises: redact secrets, drop undefined, cap size.
 */
const toJsonPayload = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined || value === null) return undefined;

  const safe = redact(value);
  const serialised = JSON.stringify(safe, (_key, val: unknown) =>
    typeof val === 'bigint' ? val.toString() : val,
  );

  // 16 KB ceiling — beyond this we store a marker rather than the payload.
  if (serialised.length > 16_384) {
    return { truncated: true, size: serialised.length } as Prisma.InputJsonValue;
  }
  return JSON.parse(serialised) as Prisma.InputJsonValue;
};

const toCreateInput = (entry: AuditEntryInput): Prisma.AuditLogUncheckedCreateInput => ({
  actorId: entry.actor?.id ?? null,
  actorEmail: entry.actor?.email ?? entry.actorEmail ?? null,
  actorRole: entry.actor?.role ?? null,
  action: entry.action,
  entityType: entry.entityType,
  entityId: entry.entityId ?? null,
  summary: entry.summary.slice(0, 255),
  before: toJsonPayload(entry.before),
  after: toJsonPayload(entry.after),
  ipAddress: entry.actor?.ipAddress ?? null,
  userAgent: entry.actor?.userAgent?.slice(0, 255) ?? null,
  requestId: entry.actor?.requestId ?? null,
});

class AuditService {
  /**
   * Best-effort write. Intentionally NOT awaited by most callers — it returns a
   * promise so tests can await it, but a rejection is handled internally.
   */
  async record(entry: AuditEntryInput): Promise<void> {
    try {
      await prisma.auditLog.create({ data: toCreateInput(entry) });
    } catch (error) {
      // Swallowed by design — see the module docblock.
      logger.error('Failed to write audit log entry', error, {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
      });
    }
  }

  /** Transactional write. Rejections propagate and roll the caller back. */
  async recordInTransaction(tx: DbClient, entry: AuditEntryInput): Promise<void> {
    await tx.auditLog.create({ data: toCreateInput(entry) });
  }

  /** Paginated audit browser used by the Admin/Accounts UI. */
  async list(query: AuditListQuery): Promise<PagedResult<Prisma.AuditLogGetPayload<object>>> {
    const { skip, take } = resolvePagination(query);

    const createdAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: buildOrderBy(undefined, query.sortOrder, SORTABLE_FIELDS, 'createdAt'),
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }

  /** Activity feed for a single entity — powers the customer detail timeline. */
  async timelineFor(
    entityType: string,
    entityId: string,
    limit = 25,
  ): Promise<Array<Prisma.AuditLogGetPayload<object>>> {
    return prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  /**
   * Computes a shallow diff so the audit row stores only what actually changed.
   * Storing whole entities makes the table unreadable and expensive.
   */
  diff<T extends Record<string, unknown>>(
    before: T,
    after: Partial<T>,
  ): { before: Partial<T>; after: Partial<T> } | null {
    const changedBefore: Partial<T> = {};
    const changedAfter: Partial<T> = {};
    let hasChanges = false;

    for (const key of Object.keys(after) as Array<keyof T>) {
      const previous = before[key];
      const next = after[key];

      // Normalise Date/Decimal to strings before comparing, otherwise every
      // update looks like a change because object identity differs.
      const normalise = (value: unknown): unknown =>
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'object' && value !== null && 'toString' in value
            ? String(value)
            : value;

      if (next !== undefined && normalise(previous) !== normalise(next)) {
        changedBefore[key] = previous;
        changedAfter[key] = next as T[keyof T];
        hasChanges = true;
      }
    }

    return hasChanges ? { before: changedBefore, after: changedAfter } : null;
  }
}

export const auditService = new AuditService();
export { AuditService };
