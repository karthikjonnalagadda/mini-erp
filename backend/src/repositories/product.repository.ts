/**
 * Product persistence.
 *
 * Every product read joins its `inventory` row, because a product without its
 * stock level is almost never useful in this application — and a lazy second
 * query per row is how list endpoints become N+1 disasters.
 */
import type { Prisma, Product } from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';
import { buildOrderBy, buildSearchFilter, resolvePagination } from '../utils/pagination';
import type { PagedResult } from '../types/common.types';
import type { SortOrder } from '../constants/app.constants';

export type ProductWithRelations = Product & {
  category: { id: string; name: string; slug: string };
  inventory: {
    id: string;
    quantityOnHand: number;
    quantityReserved: number;
    warehouseLocation: string | null;
    binLocation: string | null;
    lastMovementAt: Date | null;
  } | null;
};

export interface ProductListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  categoryId?: string;
  isActive?: boolean;
  warehouseLocation?: string;
  minPrice?: number;
  maxPrice?: number;
  /** Only products at or below their reorder threshold. */
  lowStock?: boolean;
  /** Only products with zero units on hand. */
  outOfStock?: boolean;
}

const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'name', 'sku', 'unitPrice', 'minimumStock'] as const;
const SEARCHABLE_FIELDS = ['name', 'sku', 'description', 'barcode'] as const;

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  inventory: {
    select: {
      id: true,
      quantityOnHand: true,
      quantityReserved: true,
      warehouseLocation: true,
      binLocation: true,
      lastMovementAt: true,
    },
  },
} satisfies Prisma.ProductInclude;

class ProductRepository {
  private db(tx?: DbClient): DbClient {
    return tx ?? prisma;
  }

  async findById(id: string, tx?: DbClient): Promise<ProductWithRelations | null> {
    return this.db(tx).product.findFirst({
      where: { id, deletedAt: null },
      include: productInclude,
    });
  }

  async findBySku(sku: string, excludeId?: string, tx?: DbClient): Promise<Product | null> {
    return this.db(tx).product.findFirst({
      where: { sku, deletedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
  }

  async findByBarcode(barcode: string, excludeId?: string, tx?: DbClient): Promise<Product | null> {
    return this.db(tx).product.findFirst({
      where: { barcode, deletedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
  }

  /**
   * Bulk fetch for challan validation. Returns only sellable products, so a
   * caller cannot accidentally put a deleted or inactive SKU on a document.
   */
  async findSellableByIds(ids: string[], tx?: DbClient): Promise<ProductWithRelations[]> {
    if (ids.length === 0) return [];
    return this.db(tx).product.findMany({
      where: { id: { in: ids }, deletedAt: null, isActive: true },
      include: productInclude,
    });
  }

  async findMany(query: ProductListQuery, tx?: DbClient): Promise<PagedResult<ProductWithRelations>> {
    const { skip, take } = resolvePagination(query);
    const db = this.db(tx);

    const priceFilter =
      query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
            ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
          }
        : undefined;

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(priceFilter ? { unitPrice: priceFilter } : {}),
      ...(query.warehouseLocation
        ? { inventory: { warehouseLocation: { equals: query.warehouseLocation, mode: 'insensitive' } } }
        : {}),
      ...(query.outOfStock ? { inventory: { quantityOnHand: { lte: 0 } } } : {}),
      ...(buildSearchFilter(query.search, SEARCHABLE_FIELDS) ?? {}),
    };

    const [items, total] = await Promise.all([
      db.product.findMany({
        where,
        include: productInclude,
        orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE_FIELDS, 'createdAt'),
        skip,
        take,
      }),
      db.product.count({ where }),
    ]);

    // `lowStock` compares two columns (quantityOnHand <= minimumStock), which
    // Prisma's query builder cannot express. Filtering in memory would break
    // pagination, so the dedicated raw query below is used instead — this
    // branch exists only to keep the API shape consistent.
    if (query.lowStock) {
      const lowStockIds = await this.findLowStockProductIds(tx);
      const idSet = new Set(lowStockIds);
      const filtered = items.filter((item) => idSet.has(item.id));
      return { items: filtered, total: filtered.length };
    }

    return { items, total };
  }

  /**
   * Column-to-column comparison requires raw SQL.
   * `quantityOnHand <= minimumStock` cannot be expressed in Prisma's typed API.
   */
  async findLowStockProductIds(tx?: DbClient): Promise<string[]> {
    const rows = await this.db(tx).$queryRaw<Array<{ id: string }>>`
      SELECT p."id"
      FROM "products" p
      INNER JOIN "inventory" i ON i."productId" = p."id"
      WHERE p."deletedAt" IS NULL
        AND p."isActive" = true
        AND i."quantityOnHand" <= p."minimumStock"
    `;
    return rows.map((row) => row.id);
  }

  /** Low-stock list for the inventory dashboard, ordered by severity. */
  async findLowStockProducts(limit = 20, tx?: DbClient): Promise<ProductWithRelations[]> {
    const rows = await this.db(tx).$queryRaw<Array<{ id: string }>>`
      SELECT p."id"
      FROM "products" p
      INNER JOIN "inventory" i ON i."productId" = p."id"
      WHERE p."deletedAt" IS NULL
        AND p."isActive" = true
        AND i."quantityOnHand" <= p."minimumStock"
      ORDER BY (i."quantityOnHand" - p."minimumStock") ASC
      LIMIT ${limit}
    `;

    if (rows.length === 0) return [];

    const products = await this.db(tx).product.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: productInclude,
    });

    // Preserve the severity ordering from the raw query.
    const order = new Map(rows.map((row, index) => [row.id, index]));
    return products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  /**
   * Creates the product AND its inventory row in one nested write.
   * A product without an inventory row would break every stock operation, so
   * the two are never allowed to exist apart.
   */
  async create(
    data: Omit<Prisma.ProductUncheckedCreateInput, 'id'>,
    inventory: { quantityOnHand: number; warehouseLocation?: string | null; binLocation?: string | null },
    tx?: DbClient,
  ): Promise<ProductWithRelations> {
    return this.db(tx).product.create({
      data: {
        ...data,
        inventory: {
          create: {
            quantityOnHand: inventory.quantityOnHand,
            warehouseLocation: inventory.warehouseLocation ?? null,
            binLocation: inventory.binLocation ?? null,
            lastMovementAt: inventory.quantityOnHand > 0 ? new Date() : null,
          },
        },
      },
      include: productInclude,
    });
  }

  async update(
    id: string,
    data: Prisma.ProductUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<ProductWithRelations> {
    return this.db(tx).product.update({ where: { id }, data, include: productInclude });
  }

  /** Soft delete with SKU tombstoning so the SKU can be reissued. */
  async softDelete(id: string, tx?: DbClient): Promise<void> {
    const now = new Date();
    const product = await this.db(tx).product.findUnique({ where: { id }, select: { sku: true } });
    if (!product) return;

    await this.db(tx).product.update({
      where: { id },
      data: {
        deletedAt: now,
        isActive: false,
        sku: `${product.sku}.DEL.${now.getTime()}`.slice(0, 40),
      },
    });
  }

  async countChallanItems(productId: string, tx?: DbClient): Promise<number> {
    return this.db(tx).salesChallanItem.count({ where: { productId } });
  }

  // -------------------------------------------------------------------------
  // Dashboard aggregates
  // -------------------------------------------------------------------------

  async countActive(tx?: DbClient): Promise<number> {
    return this.db(tx).product.count({ where: { deletedAt: null, isActive: true } });
  }

  /**
   * Total value of stock at cost.
   *
   * Computed in SQL rather than by summing in JavaScript: fetching every
   * product to add up a number is an unbounded memory cost that grows with the
   * catalogue.
   */
  async totalStockValuation(tx?: DbClient): Promise<{ atCost: number; atSelling: number }> {
    const rows = await this.db(tx).$queryRaw<Array<{ atCost: string | null; atSelling: string | null }>>`
      SELECT
        COALESCE(SUM(i."quantityOnHand" * p."costPrice"), 0)::text AS "atCost",
        COALESCE(SUM(i."quantityOnHand" * p."unitPrice"), 0)::text AS "atSelling"
      FROM "products" p
      INNER JOIN "inventory" i ON i."productId" = p."id"
      WHERE p."deletedAt" IS NULL
    `;

    return {
      atCost: Number(rows[0]?.atCost ?? 0),
      atSelling: Number(rows[0]?.atSelling ?? 0),
    };
  }

  async countByCategory(
    tx?: DbClient,
  ): Promise<Array<{ categoryId: string; categoryName: string; productCount: number }>> {
    const rows = await this.db(tx).$queryRaw<
      Array<{ categoryId: string; categoryName: string; productCount: bigint }>
    >`
      SELECT c."id" AS "categoryId", c."name" AS "categoryName", COUNT(p."id") AS "productCount"
      FROM "categories" c
      LEFT JOIN "products" p ON p."categoryId" = c."id" AND p."deletedAt" IS NULL
      GROUP BY c."id", c."name"
      ORDER BY COUNT(p."id") DESC
    `;

    // Postgres COUNT() returns bigint, which Prisma surfaces as a JS BigInt.
    // JSON.stringify throws on BigInt, so it must be narrowed here.
    return rows.map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      productCount: Number(row.productCount),
    }));
  }
}

export const productRepository = new ProductRepository();
export { ProductRepository };
