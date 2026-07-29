/**
 * React Query configuration.
 *
 * Defaults are tuned for an operational ERP rather than a content site:
 *
 * - `staleTime: 30s` — an operator scanning between screens should not refetch
 *   the same customer list four times a minute, but stock levels change often
 *   enough that minutes-long staleness would be misleading.
 *
 * - `refetchOnWindowFocus: true` — an ERP tab is left open all day. Coming back
 *   to it should show current data, not a snapshot from two hours ago.
 *
 * - Retry is CONDITIONAL. Retrying a 403 or a 422 is pointless (the answer will
 *   not change) and retrying a 401 races the refresh interceptor. Only server
 *   and network errors are retried.
 */
import { QueryClient } from '@tanstack/react-query';

import { ApiRequestError } from './client';

const MAX_RETRIES = 2;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error): boolean => {
        if (failureCount >= MAX_RETRIES) return false;
        if (error instanceof ApiRequestError) return error.isRetryable;
        return false;
      },
      // Exponential backoff, capped so a retry is never a 30-second wait.
      retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 8_000),
    },
    mutations: {
      // Mutations are never retried automatically: re-sending "confirm challan"
      // after an ambiguous failure could deduct stock twice. The user decides.
      retry: false,
    },
  },
});

/**
 * Query-key factory.
 *
 * Hierarchical keys make targeted invalidation possible:
 *   `queryKeys.customers.all`    invalidates every customer query,
 *   `queryKeys.customers.detail(id)` invalidates just one record.
 *
 * Hand-written string arrays scattered across files are how cache bugs start —
 * one typo and an invalidation silently matches nothing.
 */
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
    roles: ['auth', 'roles'] as const,
    users: (params?: unknown) => ['auth', 'users', params] as const,
  },

  dashboard: {
    overview: ['dashboard', 'overview'] as const,
  },

  customers: {
    all: ['customers'] as const,
    list: (params?: unknown) => ['customers', 'list', params] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
    timeline: (id: string) => ['customers', 'timeline', id] as const,
    followUps: (id: string, params?: unknown) => ['customers', id, 'follow-ups', params] as const,
    allFollowUps: (params?: unknown) => ['customers', 'follow-ups', params] as const,
  },

  categories: {
    all: ['categories'] as const,
    list: (params?: unknown) => ['categories', 'list', params] as const,
    options: ['categories', 'options'] as const,
    detail: (id: string) => ['categories', 'detail', id] as const,
  },

  products: {
    all: ['products'] as const,
    list: (params?: unknown) => ['products', 'list', params] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
    movements: (id: string, params?: unknown) => ['products', id, 'movements', params] as const,
  },

  inventory: {
    all: ['inventory'] as const,
    summary: ['inventory', 'summary'] as const,
  },

  stockMovements: {
    all: ['stock-movements'] as const,
    list: (params?: unknown) => ['stock-movements', 'list', params] as const,
  },

  challans: {
    all: ['challans'] as const,
    list: (params?: unknown) => ['challans', 'list', params] as const,
    detail: (id: string) => ['challans', 'detail', id] as const,
  },

  audit: {
    all: ['audit-logs'] as const,
    list: (params?: unknown) => ['audit-logs', 'list', params] as const,
  },
} as const;

/**
 * Invalidation groups.
 *
 * Confirming a challan changes stock, movements, the challan itself, the
 * customer's balance AND the dashboard. Listing those five keys at every call
 * site guarantees one gets forgotten; naming the group once does not.
 */
export const invalidationGroups = {
  /** After any stock-changing operation. */
  stock: [
    queryKeys.products.all,
    queryKeys.inventory.all,
    queryKeys.stockMovements.all,
    queryKeys.dashboard.overview,
  ],

  /** After a challan is created, confirmed, cancelled or deleted. */
  challan: [
    queryKeys.challans.all,
    queryKeys.products.all,
    queryKeys.inventory.all,
    queryKeys.stockMovements.all,
    queryKeys.customers.all,
    queryKeys.dashboard.overview,
  ],

  /** After a customer or follow-up write. */
  customer: [queryKeys.customers.all, queryKeys.dashboard.overview],

  /** After a catalogue write. */
  catalogue: [queryKeys.products.all, queryKeys.categories.all, queryKeys.dashboard.overview],
} as const;

/** Invalidates every key in a group. */
export const invalidateGroup = async (
  group: keyof typeof invalidationGroups,
): Promise<void> => {
  await Promise.all(
    invalidationGroups[group].map((key) => queryClient.invalidateQueries({ queryKey: key })),
  );
};
