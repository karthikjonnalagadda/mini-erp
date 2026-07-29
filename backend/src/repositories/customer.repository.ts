/**
 * Customer + follow-up persistence.
 *
 * Note the `deletedAt: null` predicate on every read. Soft delete is only as
 * good as its discipline: a single query that forgets the filter resurrects
 * deleted records in a dropdown somewhere. Centralising the queries here is
 * precisely how that discipline is enforced.
 */
import type {
  Customer,
  CustomerFollowUp,
  CustomerStatus,
  CustomerType,
  FollowUpStatus,
  FollowUpType,
  Prisma,
} from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';
import {
  buildDateRangeFilter,
  buildOrderBy,
  buildSearchFilter,
  resolvePagination,
} from '../utils/pagination';
import type { PagedResult } from '../types/common.types';
import type { SortOrder } from '../constants/app.constants';

/** Customer with the joined data every list row needs. */
export type CustomerWithRelations = Customer & {
  owner: { id: string; firstName: string; lastName: string; email: string } | null;
  _count: { challans: number; followUps: number };
};

export type FollowUpWithCreator = CustomerFollowUp & {
  createdBy: { id: string; firstName: string; lastName: string };
};

export interface CustomerListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  status?: CustomerStatus;
  customerType?: CustomerType;
  ownerId?: string;
  city?: string;
  state?: string;
  /** Customers whose follow-up date has passed and is still pending. */
  followUpDue?: boolean;
  followUpFrom?: Date;
  followUpTo?: Date;
}

export interface FollowUpListQuery {
  page?: number;
  limit?: number;
  sortOrder?: SortOrder;
  customerId?: string;
  status?: FollowUpStatus;
  type?: FollowUpType;
  createdById?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

const SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'businessName',
  'status',
  'customerType',
  'followUpDate',
  'outstandingAmount',
] as const;

const SEARCHABLE_FIELDS = ['name', 'businessName', 'email', 'mobile', 'code', 'gstNumber'] as const;

const customerInclude = {
  owner: { select: { id: true, firstName: true, lastName: true, email: true } },
  _count: { select: { challans: true, followUps: true } },
} satisfies Prisma.CustomerInclude;

const followUpInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.CustomerFollowUpInclude;

class CustomerRepository {
  private db(tx?: DbClient): DbClient {
    return tx ?? prisma;
  }

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------

  async findById(id: string, tx?: DbClient): Promise<CustomerWithRelations | null> {
    return this.db(tx).customer.findFirst({
      where: { id, deletedAt: null },
      include: customerInclude,
    });
  }

  /** Lightweight existence/state check used before creating a challan. */
  async findBasicById(
    id: string,
    tx?: DbClient,
  ): Promise<Pick<Customer, 'id' | 'name' | 'status' | 'code'> | null> {
    return this.db(tx).customer.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, status: true, code: true },
    });
  }

  /**
   * Uniqueness check scoped to live rows only.
   *
   * A plain unique index would be wrong here: after soft-deleting a customer,
   * their mobile number must be reusable. Enforcing it in the repository lets
   * "unique among non-deleted" mean exactly that.
   */
  async isFieldTaken(
    field: 'mobile' | 'email' | 'gstNumber',
    value: string,
    excludeId?: string,
    tx?: DbClient,
  ): Promise<boolean> {
    const found = await this.db(tx).customer.findFirst({
      where: {
        [field]: value,
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      } as Prisma.CustomerWhereInput,
      select: { id: true },
    });
    return found !== null;
  }

  async findMany(
    query: CustomerListQuery,
    tx?: DbClient,
  ): Promise<PagedResult<CustomerWithRelations>> {
    const { skip, take } = resolvePagination(query);
    const db = this.db(tx);

    const followUpRange = buildDateRangeFilter(query.followUpFrom, query.followUpTo);

    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerType ? { customerType: query.customerType } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      ...(query.state ? { state: { equals: query.state, mode: 'insensitive' } } : {}),
      ...(query.followUpDue ? { followUpDate: { lte: new Date(), not: null } } : {}),
      ...(followUpRange ? { followUpDate: followUpRange } : {}),
      ...(buildSearchFilter(query.search, SEARCHABLE_FIELDS) ?? {}),
    };

    const [items, total] = await Promise.all([
      db.customer.findMany({
        where,
        include: customerInclude,
        orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE_FIELDS, 'createdAt'),
        skip,
        take,
      }),
      db.customer.count({ where }),
    ]);

    return { items, total };
  }

  async create(
    data: Prisma.CustomerUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<CustomerWithRelations> {
    return this.db(tx).customer.create({ data, include: customerInclude });
  }

  async update(
    id: string,
    data: Prisma.CustomerUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<CustomerWithRelations> {
    return this.db(tx).customer.update({ where: { id }, data, include: customerInclude });
  }

  /**
   * Soft delete with business-key tombstoning, mirroring the user repository:
   * the mobile number becomes free for a new customer immediately.
   */
  async softDelete(id: string, tx?: DbClient): Promise<void> {
    const now = new Date();
    await this.db(tx).customer.update({
      where: { id },
      data: {
        deletedAt: now,
        status: 'INACTIVE',
        mobile: `${id.slice(0, 8)}.${now.getTime()}`.slice(0, 20),
      },
    });
  }

  async countChallans(customerId: string, tx?: DbClient): Promise<number> {
    return this.db(tx).salesChallan.count({ where: { customerId } });
  }

  /** Dashboard aggregate: how many customers sit in each lifecycle stage. */
  async countByStatus(tx?: DbClient): Promise<Array<{ status: CustomerStatus; count: number }>> {
    const rows = await this.db(tx).customer.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  /** Customers with a pending follow-up scheduled on or before `until`. */
  async findDueFollowUps(until: Date, limit = 10, tx?: DbClient): Promise<Customer[]> {
    return this.db(tx).customer.findMany({
      where: { deletedAt: null, followUpDate: { lte: until, not: null } },
      orderBy: { followUpDate: 'asc' },
      take: limit,
    });
  }

  // -------------------------------------------------------------------------
  // Follow-ups
  // -------------------------------------------------------------------------

  async findFollowUpById(id: string, tx?: DbClient): Promise<FollowUpWithCreator | null> {
    return this.db(tx).customerFollowUp.findUnique({ where: { id }, include: followUpInclude });
  }

  async findFollowUps(
    query: FollowUpListQuery,
    tx?: DbClient,
  ): Promise<PagedResult<FollowUpWithCreator>> {
    const { skip, take } = resolvePagination(query);
    const db = this.db(tx);

    const scheduledAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    const where: Prisma.CustomerFollowUpWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(scheduledAt ? { scheduledAt } : {}),
    };

    const [items, total] = await Promise.all([
      db.customerFollowUp.findMany({
        where,
        include: followUpInclude,
        orderBy: { scheduledAt: query.sortOrder ?? 'desc' },
        skip,
        take,
      }),
      db.customerFollowUp.count({ where }),
    ]);

    return { items, total };
  }

  async createFollowUp(
    data: Prisma.CustomerFollowUpUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<FollowUpWithCreator> {
    return this.db(tx).customerFollowUp.create({ data, include: followUpInclude });
  }

  async updateFollowUp(
    id: string,
    data: Prisma.CustomerFollowUpUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<FollowUpWithCreator> {
    return this.db(tx).customerFollowUp.update({
      where: { id },
      data,
      include: followUpInclude,
    });
  }

  async deleteFollowUp(id: string, tx?: DbClient): Promise<void> {
    await this.db(tx).customerFollowUp.delete({ where: { id } });
  }

  /**
   * Marks past-due PENDING follow-ups as OVERDUE.
   *
   * Derived-state materialisation: computing "overdue" on read would mean the
   * status column and reality disagree, and every filter would need the same
   * date arithmetic. A cheap periodic sweep keeps the column honest.
   */
  async markOverdueFollowUps(tx?: DbClient): Promise<number> {
    const result = await this.db(tx).customerFollowUp.updateMany({
      where: { status: 'PENDING', scheduledAt: { lt: new Date() } },
      data: { status: 'OVERDUE' },
    });
    return result.count;
  }

  /** Next pending activity for a customer — shown on the detail header. */
  async findNextPendingFollowUp(
    customerId: string,
    tx?: DbClient,
  ): Promise<CustomerFollowUp | null> {
    return this.db(tx).customerFollowUp.findFirst({
      where: { customerId, status: { in: ['PENDING', 'OVERDUE'] } },
      orderBy: { scheduledAt: 'asc' },
    });
  }
}

export const customerRepository = new CustomerRepository();
export { CustomerRepository };
