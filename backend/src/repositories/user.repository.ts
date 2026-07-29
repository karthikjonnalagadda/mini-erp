/**
 * User persistence.
 *
 * Repositories are the ONLY layer that talks to Prisma. Services compose
 * business rules from repository calls; controllers never touch either. That
 * boundary is what makes the services unit-testable without a database.
 *
 * Every read here filters out soft-deleted rows by default — forgetting
 * `deletedAt: null` in one query is how "deleted" users come back to life.
 */
import type { Prisma, RoleName, User, UserStatus } from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';
import { buildOrderBy, buildSearchFilter, resolvePagination } from '../utils/pagination';
import type { PagedResult } from '../types/common.types';
import type { SortOrder } from '../constants/app.constants';

/** User joined with its role — the shape the auth layer needs. */
export type UserWithRole = User & { role: { id: string; name: RoleName; description: string } };

export interface UserListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  role?: RoleName;
  status?: UserStatus;
}

/** Columns a client is permitted to sort by. Anything else falls back. */
const SORTABLE_FIELDS = ['createdAt', 'firstName', 'lastName', 'email', 'lastLoginAt'] as const;
const SEARCHABLE_FIELDS = ['firstName', 'lastName', 'email'] as const;

const withRole = { role: { select: { id: true, name: true, description: true } } } as const;

class UserRepository {
  /** Resolves the client to use: the caller's transaction, or the root client. */
  private db(tx?: DbClient): DbClient {
    return tx ?? prisma;
  }

  async findById(id: string, tx?: DbClient): Promise<UserWithRole | null> {
    return this.db(tx).user.findFirst({
      where: { id, deletedAt: null },
      include: withRole,
    });
  }

  /**
   * Used by the auth middleware on every authenticated request.
   * Filters on status as well as deletion, so a suspended account fails closed.
   */
  async findActiveById(id: string, tx?: DbClient): Promise<UserWithRole | null> {
    return this.db(tx).user.findFirst({
      where: { id, deletedAt: null, status: 'ACTIVE' },
      include: withRole,
    });
  }

  /** Login lookup. Email is stored normalised, so no case handling is needed. */
  async findByEmail(email: string, tx?: DbClient): Promise<UserWithRole | null> {
    return this.db(tx).user.findFirst({
      where: { email, deletedAt: null },
      include: withRole,
    });
  }

  /** Uniqueness check that ignores the row being edited. */
  async emailExists(email: string, excludeUserId?: string, tx?: DbClient): Promise<boolean> {
    const found = await this.db(tx).user.findFirst({
      where: {
        email,
        deletedAt: null,
        ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  async findMany(query: UserListQuery, tx?: DbClient): Promise<PagedResult<UserWithRole>> {
    const { skip, take } = resolvePagination(query);
    const db = this.db(tx);

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: { name: query.role } } : {}),
      ...(buildSearchFilter(query.search, SEARCHABLE_FIELDS) ?? {}),
    };

    // Page and count are issued concurrently. We deliberately do NOT wrap them
    // in a transaction: a read-only pair like this does not need snapshot
    // isolation, and taking one would hold a connection for no benefit.
    const [items, total] = await Promise.all([
      db.user.findMany({
        where,
        include: withRole,
        orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE_FIELDS, 'createdAt'),
        skip,
        take,
      }),
      db.user.count({ where }),
    ]);

    return { items, total };
  }

  async create(data: Prisma.UserCreateInput, tx?: DbClient): Promise<UserWithRole> {
    return this.db(tx).user.create({ data, include: withRole });
  }

  async update(id: string, data: Prisma.UserUpdateInput, tx?: DbClient): Promise<UserWithRole> {
    return this.db(tx).user.update({ where: { id }, data, include: withRole });
  }

  /**
   * Soft delete. Users are referenced by immutable stock and audit history, so
   * a hard delete would either orphan those rows or cascade away the audit
   * trail — both unacceptable.
   *
   * The email is tombstoned (`user@x.com` -> `user@x.com.deleted.1738...`) so
   * the address can be reused for a new account without dropping the unique
   * index.
   */
  async softDelete(id: string, tx?: DbClient): Promise<void> {
    const now = new Date();
    const user = await this.db(tx).user.findUnique({ where: { id }, select: { email: true } });
    if (!user) return;

    await this.db(tx).user.update({
      where: { id },
      data: {
        deletedAt: now,
        status: 'INACTIVE',
        email: `${user.email}.deleted.${now.getTime()}`,
      },
    });
  }

  async recordLogin(id: string, tx?: DbClient): Promise<void> {
    await this.db(tx).user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async updatePassword(id: string, passwordHash: string, tx?: DbClient): Promise<void> {
    await this.db(tx).user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
  }

  async countByRole(tx?: DbClient): Promise<Array<{ role: RoleName; count: number }>> {
    const rows = await this.db(tx).user.groupBy({
      by: ['roleId'],
      where: { deletedAt: null },
      _count: { _all: true },
    });

    const roles = await this.db(tx).role.findMany({ select: { id: true, name: true } });
    const roleById = new Map(roles.map((role) => [role.id, role.name]));

    return rows.map((row) => ({
      role: roleById.get(row.roleId) ?? ('ADMIN' as RoleName),
      count: row._count._all,
    }));
  }
}

/**
 * Exported as a singleton. The class stays exported too so tests can construct
 * an isolated instance or a subclass with a stubbed `db()`.
 */
export const userRepository = new UserRepository();
export { UserRepository };
