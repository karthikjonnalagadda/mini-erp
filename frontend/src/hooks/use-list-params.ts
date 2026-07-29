/**
 * List query state, synchronised with the URL.
 *
 * Putting page/search/sort/filters in the query string rather than component
 * state buys four things for free:
 *   - the back button works,
 *   - a filtered view is a shareable link,
 *   - a refresh does not reset the user's filters,
 *   - React Query caches per-URL, so navigating back is instant.
 *
 * Search is debounced separately from the URL so that typing does not push a
 * history entry per keystroke.
 */
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';

const DEFAULT_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 350;

export interface ListParamsState {
  page: number;
  limit: number;
  search: string;
  sortBy: string | undefined;
  sortOrder: 'asc' | 'desc';
  filters: Record<string, string>;
}

export interface UseListParamsResult extends ListParamsState {
  /** Immediate value for the controlled input (not debounced). */
  searchInput: string;
  setSearch: (value: string) => void;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  /** Toggles direction when the same field is clicked twice. */
  toggleSort: (field: string) => void;
  setFilter: (key: string, value: string | undefined) => void;
  clearFilters: () => void;
  /** True when any filter or search term is active. */
  hasActiveFilters: boolean;
  /** Params object ready to hand to a service call. */
  queryParams: Record<string, string | number | undefined>;
}

export const useListParams = (options?: {
  defaultSortBy?: string;
  defaultSortOrder?: 'asc' | 'desc';
  defaultLimit?: number;
  /** Filter keys this list understands; anything else in the URL is ignored. */
  filterKeys?: readonly string[];
}): UseListParamsResult => {
  const {
    defaultSortBy,
    defaultSortOrder = 'desc',
    defaultLimit = DEFAULT_LIMIT,
    filterKeys = [],
  } = options ?? {};

  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get('page') ?? 1);
  const limit = Number(searchParams.get('limit') ?? defaultLimit);
  const urlSearch = searchParams.get('search') ?? '';
  const sortBy = searchParams.get('sortBy') ?? defaultSortBy;
  const sortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc' | null) ?? defaultSortOrder;

  const filters = React.useMemo(() => {
    const result: Record<string, string> = {};
    for (const key of filterKeys) {
      const value = searchParams.get(key);
      if (value) result[key] = value;
    }
    return result;
    // `searchParams` is a new object identity per render; its string form is the
    // real dependency.
  }, [searchParams, filterKeys]);

  // Local mirror so the input stays responsive while the URL update is debounced.
  const [searchInput, setSearchInput] = React.useState(urlSearch);

  // Keep the input in step when the URL changes from outside (back button,
  // "clear filters"), without clobbering what the user is currently typing.
  React.useEffect(() => {
    setSearchInput((current) => (current === urlSearch ? current : urlSearch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);

  /** Merges updates into the query string, replacing rather than pushing. */
  const updateParams = React.useCallback(
    (updates: Record<string, string | number | undefined>, resetPage = true) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);

          for (const [key, value] of Object.entries(updates)) {
            if (value === undefined || value === '' || value === null) next.delete(key);
            else next.set(key, String(value));
          }

          // Any change to filtering or sorting invalidates the current page
          // number — page 7 of the old result set is meaningless in the new one.
          if (resetPage && !('page' in updates)) next.delete('page');

          return next;
        },
        // `replace` keeps the back button meaningful: it should return to the
        // previous screen, not step back through every filter tweak.
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Debounced search -> URL.
  React.useEffect(() => {
    if (searchInput === urlSearch) return undefined;

    const timer = setTimeout(() => {
      updateParams({ search: searchInput || undefined });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchInput, urlSearch, updateParams]);

  const toggleSort = React.useCallback(
    (field: string) => {
      const isSameField = sortBy === field;
      updateParams({
        sortBy: field,
        // First click on a new column sorts descending (most recent / largest
        // first), which is the useful default for every column in this app.
        sortOrder: isSameField && sortOrder === 'desc' ? 'asc' : 'desc',
      });
    },
    [sortBy, sortOrder, updateParams],
  );

  const setFilter = React.useCallback(
    (key: string, value: string | undefined) => updateParams({ [key]: value }),
    [updateParams],
  );

  const clearFilters = React.useCallback(() => {
    const cleared: Record<string, undefined> = { search: undefined };
    for (const key of filterKeys) cleared[key] = undefined;
    setSearchInput('');
    updateParams(cleared);
  }, [filterKeys, updateParams]);

  const queryParams = React.useMemo(
    () => ({
      page,
      limit,
      ...(urlSearch ? { search: urlSearch } : {}),
      ...(sortBy ? { sortBy } : {}),
      sortOrder,
      ...filters,
    }),
    [page, limit, urlSearch, sortBy, sortOrder, filters],
  );

  return {
    page,
    limit,
    search: urlSearch,
    searchInput,
    sortBy,
    sortOrder,
    filters,
    setSearch: setSearchInput,
    setPage: (nextPage: number) => updateParams({ page: nextPage }, false),
    setLimit: (nextLimit: number) => updateParams({ limit: nextLimit }),
    toggleSort,
    setFilter,
    clearFilters,
    hasActiveFilters: Boolean(urlSearch) || Object.keys(filters).length > 0,
    queryParams,
  };
};
