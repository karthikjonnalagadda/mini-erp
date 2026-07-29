/**
 * Types shared across layers.
 *
 * These describe the *contracts between layers* (controller -> service ->
 * repository), which is why they live here rather than inside any one module.
 */
import type { RoleName } from '@prisma/client';

import type { SortOrder } from '../constants/app.constants';

/** Base shape every list-query DTO extends. */
export interface BaseListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
}

/** What repositories return for a page of rows. */
export interface PagedResult<T> {
  items: T[];
  total: number;
}

/**
 * The subset of the authenticated user that services need.
 *
 * Services must not depend on Express's `Request`. Passing this small object
 * instead keeps the domain layer framework-agnostic and trivially unit-testable
 * (Dependency Inversion — the service depends on an abstraction it owns).
 */
export interface ActorContext {
  id: string;
  email: string;
  role: RoleName;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/** Discriminated result type used where throwing would be control flow abuse. */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Makes selected keys of T required. */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/** Recursively marks every property optional — handy for partial update DTOs. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Prisma `Decimal` values serialised for JSON transport. */
export type Serialized<T> = {
  [K in keyof T]: T[K] extends { toNumber(): number } ? number : T[K];
};
