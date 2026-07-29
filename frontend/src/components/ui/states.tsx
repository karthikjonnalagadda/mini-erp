/**
 * Loading, empty and error states.
 *
 * Every list and detail screen has four possible states — loading, empty,
 * error, and populated — and the first three are where amateur dashboards fall
 * apart. Centralising them here means every screen handles all four, and does so
 * consistently.
 *
 * Skeletons deliberately mirror the shape of the content they replace: a
 * spinner in the middle of the page tells the user nothing, while a skeleton
 * table tells them a table is coming and prevents layout shift when it lands.
 */
import * as React from 'react';
import { AlertTriangle, Inbox, RefreshCw, SearchX, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiRequestError } from '@/api/client';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

export const Skeleton = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => (
  <div className={cn('skeleton h-4 w-full', className)} aria-hidden="true" {...props} />
);

export const TableSkeleton = ({
  rows = 8,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}): React.JSX.Element => (
  <Table>
    <TableHeader>
      <TableRow>
        {Array.from({ length: columns }).map((_, index) => (
          <TableHead key={index}>
            <Skeleton className="h-3 w-20" />
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <TableRow key={rowIndex}>
          {Array.from({ length: columns }).map((_, colIndex) => (
            <TableCell key={colIndex}>
              {/* Varying widths read as data rather than as a placeholder grid. */}
              <Skeleton className={cn('h-4', colIndex === 0 ? 'w-32' : 'w-16')} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const CardSkeleton = ({ count = 4 }: { count?: number }): React.JSX.Element => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {Array.from({ length: count }).map((_, index) => (
      <Card key={index}>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-16" />
        </CardContent>
      </Card>
    ))}
  </div>
);

export const DetailSkeleton = (): React.JSX.Element => (
  <div className="space-y-4">
    <Skeleton className="h-8 w-64" />
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="space-y-4 p-5">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-full max-w-sm" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Distinguishes "no data yet" from "no results for this filter". */
  variant?: 'empty' | 'no-results';
  className?: string;
}

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  variant = 'empty',
  className,
}: EmptyStateProps): React.JSX.Element => {
  const ResolvedIcon = Icon ?? (variant === 'no-results' ? SearchX : Inbox);

  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <ResolvedIcon className="size-6 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Renders an API failure in terms the user can act on.
 *
 * A 403 gets "you don't have permission" with no retry button (retrying will
 * never help); a network error gets a retry button and a different icon. This
 * is why errors are normalised into `ApiRequestError` at the client layer —
 * components can branch on `code` instead of parsing messages.
 */
export const ErrorState = ({ error, onRetry, className }: ErrorStateProps): React.JSX.Element => {
  const apiError = error instanceof ApiRequestError ? error : null;
  const isNetwork = apiError?.code === 'NETWORK_ERROR';
  const isForbidden = apiError?.code === 'FORBIDDEN' || apiError?.code === 'INSUFFICIENT_ROLE';

  const title = isNetwork
    ? 'Cannot reach the server'
    : isForbidden
      ? 'You do not have access'
      : 'Something went wrong';

  const description =
    apiError?.message ??
    (error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.');

  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      <div
        className={cn(
          'mb-4 flex size-12 items-center justify-center rounded-full',
          isNetwork ? 'bg-warning/12' : 'bg-destructive/12',
        )}
      >
        {isNetwork ? (
          <WifiOff className="size-6 text-warning" />
        ) : (
          <AlertTriangle className="size-6 text-destructive" />
        )}
      </div>

      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>

      {/* The request id is what makes a support ticket actionable. */}
      {apiError?.requestId && (
        <p className="mt-2 font-mono text-xs text-muted-foreground/70">
          Reference: {apiError.requestId}
        </p>
      )}

      {/* Retry is offered only where it could plausibly succeed. */}
      {onRetry && !isForbidden && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inline states
// ---------------------------------------------------------------------------

/** Small inline spinner for buttons and cells. */
export const InlineLoader = ({ label = 'Loading' }: { label?: string }): React.JSX.Element => (
  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
    <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
    <span>{label}</span>
  </span>
);

/**
 * Full-page loader used only for the initial session check, where there is
 * genuinely nothing else to show.
 */
export const PageLoader = (): React.JSX.Element => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
    <RefreshCw className="size-7 animate-spin text-primary" aria-hidden="true" />
    <p className="text-sm text-muted-foreground">Loading workspace…</p>
  </div>
);
