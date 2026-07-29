/**
 * Pagination, sorting and filter construction.
 *
 * The security-relevant case here is `buildOrderBy`: `sortBy` arrives from the
 * query string, and passing it into Prisma unchecked would let a caller order
 * by arbitrary columns.
 */
import { describe, expect, it } from 'vitest';

import {
  buildDateRangeFilter,
  buildOrderBy,
  buildPaginationMeta,
  buildSearchFilter,
  resolvePagination,
} from '../src/utils/pagination';

describe('resolvePagination', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(resolvePagination({})).toEqual({ skip: 0, take: 20, page: 1, limit: 20 });
  });

  it('computes the correct offset', () => {
    expect(resolvePagination({ page: 3, limit: 25 })).toEqual({
      skip: 50,
      take: 25,
      page: 3,
      limit: 25,
    });
  });

  it('clamps an oversized limit instead of trusting the client', () => {
    // Protects the database from `?limit=100000`.
    expect(resolvePagination({ limit: 100_000 }).take).toBe(100);
  });

  it('coerces nonsensical values into the valid range', () => {
    expect(resolvePagination({ page: -5, limit: 0 })).toEqual({
      skip: 0,
      take: 1,
      page: 1,
      limit: 1,
    });
  });
});

describe('buildPaginationMeta', () => {
  it('computes page counts and navigation flags', () => {
    expect(buildPaginationMeta(137, { page: 3, limit: 20 })).toEqual({
      page: 3,
      limit: 20,
      totalItems: 137,
      totalPages: 7,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('reports no pages and no navigation for an empty result set', () => {
    expect(buildPaginationMeta(0, { page: 1, limit: 20 })).toEqual({
      page: 1,
      limit: 20,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('marks the last page as having no next page', () => {
    const meta = buildPaginationMeta(40, { page: 2, limit: 20 });
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });
});

describe('buildOrderBy', () => {
  const allowed = ['createdAt', 'name', 'unitPrice'] as const;

  it('honours an allow-listed field', () => {
    expect(buildOrderBy('name', 'asc', allowed, 'createdAt')).toEqual({ name: 'asc' });
  });

  it('falls back to the default for a field outside the allow-list', () => {
    // This is the guard: `passwordHash` must never reach Prisma's orderBy.
    expect(buildOrderBy('passwordHash', 'asc', allowed, 'createdAt')).toEqual({
      createdAt: 'asc',
    });
  });

  it('defaults to descending for an unrecognised direction', () => {
    expect(buildOrderBy('name', 'sideways' as never, allowed, 'createdAt')).toEqual({
      name: 'desc',
    });
  });

  it('expands a dotted path into Prisma’s nested shape', () => {
    expect(buildOrderBy('customer.name', 'asc', ['customer.name'] as const, 'customer.name')).toEqual({
      customer: { name: 'asc' },
    });
  });
});

describe('buildSearchFilter', () => {
  it('produces a case-insensitive OR across the given columns', () => {
    expect(buildSearchFilter('acme', ['name', 'email'] as const)).toEqual({
      OR: [
        { name: { contains: 'acme', mode: 'insensitive' } },
        { email: { contains: 'acme', mode: 'insensitive' } },
      ],
    });
  });

  it('returns undefined for empty or whitespace-only input', () => {
    expect(buildSearchFilter(undefined, ['name'] as const)).toBeUndefined();
    expect(buildSearchFilter('   ', ['name'] as const)).toBeUndefined();
  });
});

describe('buildDateRangeFilter', () => {
  it('extends a midnight end date to the end of that day', () => {
    // `?dateTo=2026-07-29` must include everything that happened on the 29th,
    // not just the instant of midnight.
    const filter = buildDateRangeFilter(undefined, new Date('2026-07-29T00:00:00.000Z'));
    expect(filter?.lte?.toISOString()).toBe('2026-07-29T23:59:59.999Z');
  });

  it('leaves a precise end timestamp untouched', () => {
    const precise = new Date('2026-07-29T14:30:00.000Z');
    expect(buildDateRangeFilter(undefined, precise)?.lte?.toISOString()).toBe(
      '2026-07-29T14:30:00.000Z',
    );
  });

  it('returns undefined when neither bound is given', () => {
    expect(buildDateRangeFilter(undefined, undefined)).toBeUndefined();
  });
});
