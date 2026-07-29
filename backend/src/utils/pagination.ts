/**
 * Pagination + sorting helpers shared by every list endpoint.
 *
 * Two safety properties matter:
 *  - `limit` is clamped to MAX_LIMIT so a client cannot ask for the whole table.
 *  - `sortBy` is validated against an explicit allow-list per resource. Passing
 *    a user-supplied string straight into Prisma's `orderBy` would let a caller
 *    sort by (and therefore probe) arbitrary columns.
 */
import { PAGINATION } from '../constants/app.constants';
import type { SortOrder } from '../constants/app.constants';
import type { PaginationMeta } from './api-response';

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationSlice {
  skip: number;
  take: number;
  page: number;
  limit: number;
}

/** Normalises and clamps raw page/limit input. */
export const resolvePagination = (params: Partial<PaginationParams>): PaginationSlice => {
  const page = Math.max(PAGINATION.DEFAULT_PAGE, Math.trunc(params.page ?? PAGINATION.DEFAULT_PAGE));
  const requested = Math.trunc(params.limit ?? PAGINATION.DEFAULT_LIMIT);
  const limit = Math.min(PAGINATION.MAX_LIMIT, Math.max(PAGINATION.MIN_LIMIT, requested));

  return { skip: (page - 1) * limit, take: limit, page, limit };
};

/** Builds the `meta` block returned with every paginated response. */
export const buildPaginationMeta = (
  totalItems: number,
  { page, limit }: Pick<PaginationSlice, 'page' | 'limit'>,
): PaginationMeta => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
};

/**
 * Maps a validated sort field to a Prisma `orderBy` clause.
 *
 * `allowedFields` is the security boundary — anything outside it falls back to
 * `defaultField`. Dotted paths ("customer.name") are expanded into the nested
 * object shape Prisma expects.
 */
export const buildOrderBy = <TField extends string>(
  sortBy: string | undefined,
  sortOrder: SortOrder | undefined,
  allowedFields: readonly TField[],
  defaultField: TField,
): Record<string, unknown> => {
  const field = allowedFields.includes(sortBy as TField) ? (sortBy as TField) : defaultField;
  const direction: SortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

  if (field.includes('.')) {
    // "customer.name" -> { customer: { name: 'asc' } }
    const segments = field.split('.');
    return segments.reduceRight<Record<string, unknown>>(
      (accumulator, segment, index) =>
        index === segments.length - 1 ? { [segment]: direction } : { [segment]: accumulator },
      {},
    );
  }

  return { [field]: direction };
};

/**
 * Case-insensitive "contains" filter for a set of columns.
 * Returns `undefined` when there is no search term so callers can spread it
 * into a `where` object unconditionally.
 */
export const buildSearchFilter = <TField extends string>(
  search: string | undefined,
  fields: readonly TField[],
): { OR: Array<Record<string, { contains: string; mode: 'insensitive' }>> } | undefined => {
  const term = search?.trim();
  if (!term) return undefined;

  return {
    OR: fields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' as const } })),
  };
};

/**
 * Inclusive date-range filter. `to` is pushed to the end of the day so that
 * `?dateTo=2026-07-29` includes everything that happened on the 29th.
 */
export const buildDateRangeFilter = (
  from?: Date,
  to?: Date,
): { gte?: Date; lte?: Date } | undefined => {
  if (!from && !to) return undefined;

  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = from;
  if (to) {
    const endOfDay = new Date(to);
    if (
      endOfDay.getUTCHours() === 0 &&
      endOfDay.getUTCMinutes() === 0 &&
      endOfDay.getUTCSeconds() === 0
    ) {
      endOfDay.setUTCHours(23, 59, 59, 999);
    }
    filter.lte = endOfDay;
  }
  return filter;
};
