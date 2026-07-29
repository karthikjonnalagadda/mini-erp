/**
 * Sales challan persistence.
 *
 * Challans are transactional documents, so almost every write here is expected
 * to run inside a caller-supplied transaction alongside stock movements and
 * customer-balance updates. The `tx` parameter is threaded through accordingly.
 */
import type { ChallanStatus, Prisma, SalesChallan } from '@prisma/client';

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

export type ChallanWithRelations = Prisma.SalesChallanGetPayload<{
  include: {
    customer: {
      select: {
        id: true;
        code: true;
        name: true;
        businessName: true;
        mobile: true;
        gstNumber: true;
        addressLine1: true;
        addressLine2: true;
        city: true;
        state: true;
        postalCode: true;
      };
    };
    items: true;
    createdBy: { select: { id: true; firstName: true; lastName: true } };
    confirmedBy: { select: { id: true; firstName: true; lastName: true } };
    cancelledBy: { select: { id: true; firstName: true; lastName: true } };
  };
}>;

export interface ChallanListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  status?: ChallanStatus;
  customerId?: string;
  createdById?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
}

const SORTABLE_FIELDS = [
  'challanDate',
  'createdAt',
  'updatedAt',
  'totalAmount',
  'challanNumber',
  'status',
] as const;

const SEARCHABLE_FIELDS = ['challanNumber', 'vehicleNumber', 'transporterName'] as const;

const challanInclude = {
  customer: {
    select: {
      id: true,
      code: true,
      name: true,
      businessName: true,
      mobile: true,
      gstNumber: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
    },
  },
  items: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  confirmedBy: { select: { id: true, firstName: true, lastName: true } },
  cancelledBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.SalesChallanInclude;

class ChallanRepository {
  private db(tx?: DbClient): DbClient {
    return tx ?? prisma;
  }

  async findById(id: string, tx?: DbClient): Promise<ChallanWithRelations | null> {
    return this.db(tx).salesChallan.findUnique({ where: { id }, include: challanInclude });
  }

  async findByNumber(challanNumber: string, tx?: DbClient): Promise<ChallanWithRelations | null> {
    return this.db(tx).salesChallan.findUnique({
      where: { challanNumber },
      include: challanInclude,
    });
  }

  /**
   * Locks the challan row for a state transition.
   *
   * Without this, two operators clicking "Confirm" simultaneously would both
   * read status = DRAFT and both deduct stock — a double deduction for a single
   * document. The lock serialises them; the second sees CONFIRMED and is
   * rejected by the state-machine guard.
   */
  async lockForUpdate(
    id: string,
    tx: DbClient,
  ): Promise<{ id: string; status: ChallanStatus; challanNumber: string } | null> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: ChallanStatus; challanNumber: string }>
    >`
      SELECT "id", "status", "challanNumber"
      FROM "sales_challans"
      WHERE "id" = ${id}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async findMany(
    query: ChallanListQuery,
    tx?: DbClient,
  ): Promise<PagedResult<ChallanWithRelations>> {
    const { skip, take } = resolvePagination(query);
    const db = this.db(tx);

    const challanDate = buildDateRangeFilter(query.dateFrom, query.dateTo);
    const amountFilter =
      query.minAmount !== undefined || query.maxAmount !== undefined
        ? {
            ...(query.minAmount !== undefined ? { gte: query.minAmount } : {}),
            ...(query.maxAmount !== undefined ? { lte: query.maxAmount } : {}),
          }
        : undefined;

    // Search spans the challan's own columns AND the customer's name/code, so
    // "type the customer name into the search box" behaves as users expect.
    const ownSearch = buildSearchFilter(query.search, SEARCHABLE_FIELDS);
    const searchClause = query.search?.trim()
      ? {
          OR: [
            ...(ownSearch?.OR ?? []),
            { customer: { name: { contains: query.search.trim(), mode: 'insensitive' as const } } },
            { customer: { code: { contains: query.search.trim(), mode: 'insensitive' as const } } },
            {
              customer: {
                businessName: { contains: query.search.trim(), mode: 'insensitive' as const },
              },
            },
          ],
        }
      : undefined;

    const where: Prisma.SalesChallanWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(challanDate ? { challanDate } : {}),
      ...(amountFilter ? { totalAmount: amountFilter } : {}),
      ...(searchClause ?? {}),
    };

    const [items, total] = await Promise.all([
      db.salesChallan.findMany({
        where,
        include: challanInclude,
        orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE_FIELDS, 'challanDate'),
        skip,
        take,
      }),
      db.salesChallan.count({ where }),
    ]);

    return { items, total };
  }

  async create(
    data: Prisma.SalesChallanUncheckedCreateInput,
    items: Prisma.SalesChallanItemCreateManyChallanInput[],
    tx: DbClient,
  ): Promise<ChallanWithRelations> {
    return tx.salesChallan.create({
      data: { ...data, items: { createMany: { data: items } } },
      include: challanInclude,
    });
  }

  async update(
    id: string,
    data: Prisma.SalesChallanUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<ChallanWithRelations> {
    return this.db(tx).salesChallan.update({ where: { id }, data, include: challanInclude });
  }

  /**
   * Replaces every line on a draft.
   *
   * Delete-then-insert rather than a diff: line items carry price/tax snapshots,
   * so "the same product with a different quantity" is genuinely a new snapshot.
   * Reconciling in place would risk keeping a stale price on an edited line.
   */
  async replaceItems(
    challanId: string,
    items: Prisma.SalesChallanItemCreateManyChallanInput[],
    tx: DbClient,
  ): Promise<void> {
    await tx.salesChallanItem.deleteMany({ where: { challanId } });
    if (items.length > 0) {
      await tx.salesChallanItem.createMany({
        data: items.map((item) => ({ ...item, challanId })),
      });
    }
  }

  /** Hard delete — only ever called for DRAFT challans (guarded in the service). */
  async delete(id: string, tx?: DbClient): Promise<void> {
    await this.db(tx).salesChallan.delete({ where: { id } });
  }

  // -------------------------------------------------------------------------
  // Aggregates
  // -------------------------------------------------------------------------

  async countByStatus(tx?: DbClient): Promise<Array<{ status: ChallanStatus; count: number }>> {
    const rows = await this.db(tx).salesChallan.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  /** Confirmed-sales totals for the dashboard. Cancelled documents are excluded. */
  async salesTotals(
    from: Date,
    to: Date,
    tx?: DbClient,
  ): Promise<{ challanCount: number; totalValue: number }> {
    const result = await this.db(tx).salesChallan.aggregate({
      where: { status: 'CONFIRMED', challanDate: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });

    return {
      challanCount: result._count._all,
      totalValue: Number(result._sum.totalAmount ?? 0),
    };
  }

  /** Daily confirmed-sales series for the dashboard chart. */
  async salesTrend(
    days: number,
    tx?: DbClient,
  ): Promise<Array<{ date: string; challanCount: number; totalValue: number }>> {
    const rows = await this.db(tx).$queryRaw<
      Array<{ date: Date; challanCount: bigint; totalValue: string | null }>
    >`
      SELECT
        DATE_TRUNC('day', "challanDate")            AS "date",
        COUNT(*)                                    AS "challanCount",
        COALESCE(SUM("totalAmount"), 0)::text       AS "totalValue"
      FROM "sales_challans"
      WHERE "status" = 'CONFIRMED'
        AND "challanDate" >= NOW() - (${days} || ' days')::interval
      GROUP BY DATE_TRUNC('day', "challanDate")
      ORDER BY 1 ASC
    `;

    return rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      challanCount: Number(row.challanCount),
      totalValue: Number(row.totalValue ?? 0),
    }));
  }

  /** Highest-value customers over a window — the dashboard leaderboard. */
  async topCustomers(
    days: number,
    limit: number,
    tx?: DbClient,
  ): Promise<Array<{ customerId: string; code: string; name: string; totalValue: number; challanCount: number }>> {
    const rows = await this.db(tx).$queryRaw<
      Array<{
        customerId: string;
        code: string;
        name: string;
        totalValue: string | null;
        challanCount: bigint;
      }>
    >`
      SELECT
        c."id"   AS "customerId",
        c."code",
        c."name",
        COALESCE(SUM(s."totalAmount"), 0)::text AS "totalValue",
        COUNT(s."id")                           AS "challanCount"
      FROM "sales_challans" s
      INNER JOIN "customers" c ON c."id" = s."customerId"
      WHERE s."status" = 'CONFIRMED'
        AND s."challanDate" >= NOW() - (${days} || ' days')::interval
      GROUP BY c."id", c."code", c."name"
      ORDER BY SUM(s."totalAmount") DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      customerId: row.customerId,
      code: row.code,
      name: row.name,
      totalValue: Number(row.totalValue ?? 0),
      challanCount: Number(row.challanCount),
    }));
  }

  async findRecent(limit: number, tx?: DbClient): Promise<SalesChallan[]> {
    return this.db(tx).salesChallan.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const challanRepository = new ChallanRepository();
export { ChallanRepository };
