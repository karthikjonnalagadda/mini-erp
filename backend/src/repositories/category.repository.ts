/**
 * Category persistence.
 *
 * Categories form a shallow tree via a self-relation. They are NOT soft-deleted:
 * a category with products cannot be removed at all (enforced in the service),
 * so a deleted category is by definition unreferenced and safe to drop.
 */
import type { Category, Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import type { DbClient } from '../config/prisma';
import { buildOrderBy, buildSearchFilter, resolvePagination } from '../utils/pagination';
import type { PagedResult } from '../types/common.types';
import type { SortOrder } from '../constants/app.constants';

export type CategoryWithCounts = Category & {
  parent: { id: string; name: string } | null;
  _count: { products: number; children: number };
};

export interface CategoryListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  isActive?: boolean;
  parentId?: string | null;
}

const SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
const SEARCHABLE_FIELDS = ['name', 'description'] as const;

const categoryInclude = {
  parent: { select: { id: true, name: true } },
  _count: { select: { products: true, children: true } },
} satisfies Prisma.CategoryInclude;

class CategoryRepository {
  private db(tx?: DbClient): DbClient {
    return tx ?? prisma;
  }

  async findById(id: string, tx?: DbClient): Promise<CategoryWithCounts | null> {
    return this.db(tx).category.findUnique({ where: { id }, include: categoryInclude });
  }

  async findByName(name: string, excludeId?: string, tx?: DbClient): Promise<Category | null> {
    return this.db(tx).category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
  }

  async findMany(
    query: CategoryListQuery,
    tx?: DbClient,
  ): Promise<PagedResult<CategoryWithCounts>> {
    const { skip, take } = resolvePagination(query);
    const db = this.db(tx);

    const where: Prisma.CategoryWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
      ...(buildSearchFilter(query.search, SEARCHABLE_FIELDS) ?? {}),
    };

    const [items, total] = await Promise.all([
      db.category.findMany({
        where,
        include: categoryInclude,
        orderBy: buildOrderBy(query.sortBy, query.sortOrder ?? 'asc', SORTABLE_FIELDS, 'name'),
        skip,
        take,
      }),
      db.category.count({ where }),
    ]);

    return { items, total };
  }

  /** Flat list for dropdowns — no pagination, active only. */
  async findAllActive(tx?: DbClient): Promise<Array<Pick<Category, 'id' | 'name' | 'slug'>>> {
    return this.db(tx).category.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(data: Prisma.CategoryUncheckedCreateInput, tx?: DbClient): Promise<CategoryWithCounts> {
    return this.db(tx).category.create({ data, include: categoryInclude });
  }

  async update(
    id: string,
    data: Prisma.CategoryUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<CategoryWithCounts> {
    return this.db(tx).category.update({ where: { id }, data, include: categoryInclude });
  }

  async delete(id: string, tx?: DbClient): Promise<void> {
    await this.db(tx).category.delete({ where: { id } });
  }

  async countProducts(categoryId: string, tx?: DbClient): Promise<number> {
    return this.db(tx).product.count({ where: { categoryId, deletedAt: null } });
  }
}

export const categoryRepository = new CategoryRepository();
export { CategoryRepository };
