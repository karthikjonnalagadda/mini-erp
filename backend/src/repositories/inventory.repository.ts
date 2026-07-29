/**
 * Inventory + stock-movement persistence.
 *
 * ===========================================================================
 * CONCURRENCY IS THE ENTIRE POINT OF THIS FILE.
 * ===========================================================================
 *
 * Two warehouse operators confirming challans for the same SKU at the same
 * moment is not a hypothetical — it is Tuesday. The naive sequence
 *
 *     read quantityOnHand -> check it is enough -> write quantityOnHand - n
 *
 * is a textbook lost update: both transactions read 10, both decide 8 is fine,
 * both write 2, and 16 units leave a warehouse holding 10.
 *
 * The fix used here is `SELECT ... FOR UPDATE`, which takes a row-level
 * exclusive lock inside the caller's transaction. The second transaction blocks
 * at the SELECT until the first commits, then reads the *new* value and
 * correctly fails its sufficiency check.
 *
 * Every mutating method therefore REQUIRES a transaction client — the lock is
 * released at commit, so a lock taken outside a transaction is worthless. The
 * type signature enforces this: `tx: DbClient` is not optional.
 *
 * Defence in depth: a CHECK constraint in the migration also forbids a negative
 * `quantityOnHand`, so even a future code path that bypasses this repository
 * cannot corrupt the ledger — it gets a database error instead.
 */
import { Prisma } from '@prisma/client';
import type { Inventory, MovementReason, MovementType, StockMovement } from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';
import {
  buildDateRangeFilter,
  buildOrderBy,
  resolvePagination,
} from '../utils/pagination';
import type { PagedResult } from '../types/common.types';
import type { SortOrder } from '../constants/app.constants';

export type StockMovementWithRelations = StockMovement & {
  product: { id: string; sku: string; name: string; unit: string };
  createdBy: { id: string; firstName: string; lastName: string };
};

export interface StockMovementListQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  productId?: string;
  movementType?: MovementType;
  reason?: MovementReason;
  createdById?: string;
  referenceType?: string;
  referenceId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

/** Everything needed to append one row to the immutable stock ledger. */
export interface RecordMovementInput {
  productId: string;
  movementType: MovementType;
  reason: MovementReason;
  /** Positive magnitude — direction comes from `movementType`. */
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceCode?: string | null;
  notes?: string | null;
  createdById: string;
}

const SORTABLE_FIELDS = ['createdAt', 'quantity', 'movementType'] as const;

const movementInclude = {
  product: { select: { id: true, sku: true, name: true, unit: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.StockMovementInclude;

/** Row shape returned by the locking read. */
export interface LockedInventoryRow {
  id: string;
  productId: string;
  quantityOnHand: number;
  quantityReserved: number;
  version: number;
}

class InventoryRepository {
  private db(tx?: DbClient): DbClient {
    return tx ?? prisma;
  }

  // -------------------------------------------------------------------------
  // Locking reads
  // -------------------------------------------------------------------------

  /**
   * Acquires an exclusive row lock and returns the current quantities.
   * MUST be called inside a transaction — see the module docblock.
   *
   * Returns null when the product has no inventory row, which should be
   * impossible (products are created with one) but is handled rather than
   * assumed.
   */
  async lockForUpdate(productId: string, tx: DbClient): Promise<LockedInventoryRow | null> {
    const rows = await tx.$queryRaw<LockedInventoryRow[]>(Prisma.sql`
      SELECT "id", "productId", "quantityOnHand", "quantityReserved", "version"
      FROM "inventory"
      WHERE "productId" = ${productId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  /**
   * Locks several products at once for a multi-line challan.
   *
   * `ORDER BY "productId"` is not cosmetic: it guarantees every transaction
   * acquires locks in the same order, which is what prevents the classic
   * deadlock where transaction A holds SKU-1 waiting for SKU-2 while B holds
   * SKU-2 waiting for SKU-1.
   */
  async lockManyForUpdate(productIds: string[], tx: DbClient): Promise<LockedInventoryRow[]> {
    if (productIds.length === 0) return [];

    return tx.$queryRaw<LockedInventoryRow[]>(Prisma.sql`
      SELECT "id", "productId", "quantityOnHand", "quantityReserved", "version"
      FROM "inventory"
      WHERE "productId" IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "productId"
      FOR UPDATE
    `);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findByProductId(productId: string, tx?: DbClient): Promise<Inventory | null> {
    return this.db(tx).inventory.findUnique({ where: { productId } });
  }

  // -------------------------------------------------------------------------
  // Writes — transaction required
  // -------------------------------------------------------------------------

  /**
   * Applies a signed delta to the locked row and bumps the optimistic-locking
   * version. The caller has already validated sufficiency against the value it
   * read under the lock.
   */
  async applyDelta(
    productId: string,
    delta: number,
    tx: DbClient,
  ): Promise<{ quantityOnHand: number }> {
    const updated = await tx.inventory.update({
      where: { productId },
      data: {
        quantityOnHand: { increment: delta },
        version: { increment: 1 },
        lastMovementAt: new Date(),
      },
      select: { quantityOnHand: true },
    });
    return updated;
  }

  /** Appends one immutable row to the stock ledger. */
  async recordMovement(input: RecordMovementInput, tx: DbClient): Promise<StockMovement> {
    return tx.stockMovement.create({
      data: {
        productId: input.productId,
        movementType: input.movementType,
        reason: input.reason,
        quantity: input.quantity,
        quantityBefore: input.quantityBefore,
        quantityAfter: input.quantityAfter,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        referenceCode: input.referenceCode ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById,
      },
    });
  }

  /** Warehouse/bin relocation — metadata only, never touches quantities. */
  async updateLocation(
    productId: string,
    location: { warehouseLocation?: string | null; binLocation?: string | null },
    tx?: DbClient,
  ): Promise<Inventory> {
    return this.db(tx).inventory.update({
      where: { productId },
      data: {
        ...(location.warehouseLocation !== undefined
          ? { warehouseLocation: location.warehouseLocation }
          : {}),
        ...(location.binLocation !== undefined ? { binLocation: location.binLocation } : {}),
      },
    });
  }

  async markStockTake(productId: string, tx: DbClient): Promise<void> {
    await tx.inventory.update({
      where: { productId },
      data: { lastStockTakeAt: new Date() },
    });
  }

  // -------------------------------------------------------------------------
  // Stock movement ledger
  // -------------------------------------------------------------------------

  async findMovements(
    query: StockMovementListQuery,
    tx?: DbClient,
  ): Promise<PagedResult<StockMovementWithRelations>> {
    const { skip, take } = resolvePagination(query);
    const db = this.db(tx);

    const createdAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    const where: Prisma.StockMovementWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(query.referenceType ? { referenceType: query.referenceType } : {}),
      ...(query.referenceId ? { referenceId: query.referenceId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [items, total] = await Promise.all([
      db.stockMovement.findMany({
        where,
        include: movementInclude,
        orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE_FIELDS, 'createdAt'),
        skip,
        take,
      }),
      db.stockMovement.count({ where }),
    ]);

    return { items, total };
  }

  async findMovementById(id: string, tx?: DbClient): Promise<StockMovementWithRelations | null> {
    return this.db(tx).stockMovement.findUnique({ where: { id }, include: movementInclude });
  }

  // -------------------------------------------------------------------------
  // Aggregates for the inventory dashboard
  // -------------------------------------------------------------------------

  async summary(tx?: DbClient): Promise<{
    totalProducts: number;
    totalUnits: number;
    outOfStockCount: number;
    lowStockCount: number;
  }> {
    const rows = await this.db(tx).$queryRaw<
      Array<{
        totalProducts: bigint;
        totalUnits: string | null;
        outOfStockCount: bigint;
        lowStockCount: bigint;
      }>
    >`
      SELECT
        COUNT(*)                                                                     AS "totalProducts",
        COALESCE(SUM(i."quantityOnHand"), 0)::text                                   AS "totalUnits",
        COUNT(*) FILTER (WHERE i."quantityOnHand" <= 0)                              AS "outOfStockCount",
        COUNT(*) FILTER (WHERE i."quantityOnHand" > 0
                           AND i."quantityOnHand" <= p."minimumStock")               AS "lowStockCount"
      FROM "products" p
      INNER JOIN "inventory" i ON i."productId" = p."id"
      WHERE p."deletedAt" IS NULL AND p."isActive" = true
    `;

    const row = rows[0];
    return {
      totalProducts: Number(row?.totalProducts ?? 0),
      totalUnits: Number(row?.totalUnits ?? 0),
      outOfStockCount: Number(row?.outOfStockCount ?? 0),
      lowStockCount: Number(row?.lowStockCount ?? 0),
    };
  }

  /** Daily in/out totals for the dashboard chart. */
  async movementTrend(
    days: number,
    tx?: DbClient,
  ): Promise<Array<{ date: string; inbound: number; outbound: number }>> {
    const rows = await this.db(tx).$queryRaw<
      Array<{ date: Date; inbound: string | null; outbound: string | null }>
    >`
      SELECT
        DATE_TRUNC('day', "createdAt")                                                   AS "date",
        COALESCE(SUM("quantity") FILTER (WHERE "movementType" IN ('IN', 'RETURN')), 0)::text   AS "inbound",
        COALESCE(SUM("quantity") FILTER (WHERE "movementType" IN ('OUT', 'DAMAGE')), 0)::text  AS "outbound"
      FROM "stock_movements"
      WHERE "createdAt" >= NOW() - (${days} || ' days')::interval
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY 1 ASC
    `;

    return rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      inbound: Number(row.inbound ?? 0),
      outbound: Number(row.outbound ?? 0),
    }));
  }

  /** Fastest-moving SKUs by outbound volume — drives the dashboard leaderboard. */
  async topMovingProducts(
    days: number,
    limit: number,
    tx?: DbClient,
  ): Promise<Array<{ productId: string; sku: string; name: string; unitsOut: number }>> {
    const rows = await this.db(tx).$queryRaw<
      Array<{ productId: string; sku: string; name: string; unitsOut: string | null }>
    >`
      SELECT
        p."id" AS "productId",
        p."sku",
        p."name",
        COALESCE(SUM(m."quantity"), 0)::text AS "unitsOut"
      FROM "stock_movements" m
      INNER JOIN "products" p ON p."id" = m."productId"
      WHERE m."movementType" = 'OUT'
        AND m."createdAt" >= NOW() - (${days} || ' days')::interval
      GROUP BY p."id", p."sku", p."name"
      ORDER BY SUM(m."quantity") DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      unitsOut: Number(row.unitsOut ?? 0),
    }));
  }
}

export const inventoryRepository = new InventoryRepository();
export { InventoryRepository };
