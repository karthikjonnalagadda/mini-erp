/**
 * Pagination control.
 *
 * Renders a windowed page list with ellipses rather than every page number —
 * a 200-page result set must not produce 200 buttons. The window always shows
 * the first page, the last page, and a span around the current one, so the user
 * can always jump to either end.
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PaginationMeta } from '@/types/api.types';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';

const PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * Builds the page window, e.g. [1, '…', 7, 8, 9, '…', 42].
 * `siblings` controls how many pages flank the current one.
 */
export const buildPageWindow = (
  current: number,
  total: number,
  siblings = 1,
): Array<number | 'ellipsis'> => {
  // Small page counts render in full — ellipses would take more space than the
  // numbers they replace.
  const maxVisible = siblings * 2 + 5;
  if (total <= maxVisible) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const left = Math.max(current - siblings, 1);
  const right = Math.min(current + siblings, total);

  const showLeftEllipsis = left > 2;
  const showRightEllipsis = right < total - 1;

  const pages: Array<number | 'ellipsis'> = [1];

  if (showLeftEllipsis) {
    pages.push('ellipsis');
  } else {
    for (let page = 2; page < left; page += 1) pages.push(page);
  }

  for (let page = Math.max(left, 2); page <= Math.min(right, total - 1); page += 1) {
    pages.push(page);
  }

  if (showRightEllipsis) {
    pages.push('ellipsis');
  } else {
    for (let page = right + 1; page < total; page += 1) pages.push(page);
  }

  pages.push(total);
  return pages;
};

export interface PaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  className?: string;
}

export const Pagination = ({
  meta,
  onPageChange,
  onLimitChange,
  className,
}: PaginationProps): React.JSX.Element | null => {
  // Nothing to paginate — but the caller still renders us, so decide here
  // rather than making every list screen write the same guard.
  if (meta.totalItems === 0) return null;

  const firstItem = (meta.page - 1) * meta.limit + 1;
  const lastItem = Math.min(meta.page * meta.limit, meta.totalItems);
  const pages = buildPageWindow(meta.page, meta.totalPages);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row',
        className,
      )}
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing <span className="font-medium text-foreground">{formatNumber(firstItem)}</span>–
        <span className="font-medium text-foreground">{formatNumber(lastItem)}</span> of{' '}
        <span className="font-medium text-foreground">{formatNumber(meta.totalItems)}</span>
      </p>

      <div className="flex items-center gap-3">
        {onLimitChange && (
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-xs text-muted-foreground">Rows</span>
            <Select
              value={String(meta.limit)}
              onValueChange={(value) => onLimitChange(Number(value))}
            >
              <SelectTrigger className="h-8 w-[4.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(meta.page - 1)}
            disabled={!meta.hasPreviousPage}
            aria-label="Previous page"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>

          {/* Page numbers are hidden on very small screens, where prev/next and
              the "showing X–Y of Z" label carry the same information. */}
          <div className="hidden items-center gap-1 sm:flex">
            {pages.map((page, index) =>
              page === 'ellipsis' ? (
                <span
                  key={`ellipsis-${index}`}
                  className="px-1.5 text-sm text-muted-foreground"
                  aria-hidden="true"
                >
                  …
                </span>
              ) : (
                <Button
                  key={page}
                  variant={page === meta.page ? 'default' : 'ghost'}
                  size="icon-sm"
                  onClick={() => onPageChange(page)}
                  aria-label={`Page ${page}`}
                  aria-current={page === meta.page ? 'page' : undefined}
                >
                  {page}
                </Button>
              ),
            )}
          </div>

          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(meta.page + 1)}
            disabled={!meta.hasNextPage}
            aria-label="Next page"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  );
};
