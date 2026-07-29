/**
 * List toolbar — search, filters and a primary action.
 *
 * Filters live in ONE row above the content they scope, never inside a card.
 * Per-card filters mean two panels can disagree about which slice they show.
 */
import * as React from 'react';
import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/utils/cn';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  key: string;
  placeholder: string;
  options: FilterOption[];
  width?: string;
}

export interface DataToolbarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterConfig[];
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string | undefined) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

/** Sentinel for "no filter". Radix Select forbids an empty-string item value. */
const ALL_VALUE = '__all__';

export const DataToolbar = ({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters = [],
  filterValues = {},
  onFilterChange,
  hasActiveFilters = false,
  onClearFilters,
  actions,
  className,
}: DataToolbarProps): React.JSX.Element => (
  <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center', className)}>
    <div className="relative flex-1 sm:max-w-xs">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={searchPlaceholder}
        className="pl-8"
        aria-label={searchPlaceholder}
      />
    </div>

    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <Select
          key={filter.key}
          value={filterValues[filter.key] ?? ALL_VALUE}
          onValueChange={(value) =>
            onFilterChange?.(filter.key, value === ALL_VALUE ? undefined : value)
          }
        >
          <SelectTrigger className={cn('h-9 w-full sm:w-auto', filter.width ?? 'sm:min-w-[9rem]')}>
            <SelectValue placeholder={filter.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>{filter.placeholder}</SelectItem>
            {filter.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {hasActiveFilters && onClearFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          <X aria-hidden="true" />
          Clear
        </Button>
      )}
    </div>

    {actions && <div className="flex items-center gap-2 sm:ml-auto">{actions}</div>}
  </div>
);
