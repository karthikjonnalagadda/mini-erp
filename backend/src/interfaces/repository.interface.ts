/**
 * Repository abstractions.
 *
 * Why interfaces at all when Prisma is already an abstraction?
 *
 * Dependency Inversion: services depend on these interfaces, not on the
 * concrete Prisma-backed classes. In practice this buys three things:
 *   1. Unit tests inject an in-memory fake without spinning up Postgres.
 *   2. Swapping the persistence layer (or adding a caching decorator in front
 *      of it) touches zero service code.
 *   3. The interface documents exactly which persistence operations the domain
 *      is allowed to perform — no service can quietly reach for a raw query.
 *
 * Every method accepts an optional transaction client so any repository call
 * can be enlisted in an outer transaction (used by the challan workflow).
 */
import type { DbClient } from '../config/prisma';
import type { PagedResult } from '../types/common.types';

/** Read/write operations common to every master-data repository. */
export interface IBaseRepository<TEntity, TCreateInput, TUpdateInput, TListQuery> {
  findById(id: string, tx?: DbClient): Promise<TEntity | null>;
  findMany(query: TListQuery, tx?: DbClient): Promise<PagedResult<TEntity>>;
  create(data: TCreateInput, tx?: DbClient): Promise<TEntity>;
  update(id: string, data: TUpdateInput, tx?: DbClient): Promise<TEntity>;
  /** Soft delete where the entity supports it, hard delete otherwise. */
  delete(id: string, tx?: DbClient): Promise<void>;
  exists(id: string, tx?: DbClient): Promise<boolean>;
}

/** Marker for repositories whose entity carries a `deletedAt` column. */
export interface ISoftDeletable {
  restore(id: string, tx?: DbClient): Promise<void>;
}

/** Contract for the atomic document-number allocator. */
export interface ISequenceRepository {
  /**
   * Allocates the next value for `key` and returns the formatted document
   * number. MUST be called inside a transaction — the underlying
   * `UPDATE ... RETURNING` takes a row lock that is only held for the
   * transaction's lifetime.
   */
  nextDocumentNumber(key: string, prefix: string, tx: DbClient): Promise<string>;
}
