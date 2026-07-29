/**
 * Audit trail browser.
 *
 * Restricted to ADMIN and ACCOUNTS by both the router guard and the API. The
 * before/after JSON diff is collapsed by default — an expanded diff on every row
 * turns a compliance tool into a wall of braces.
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';

import { queryKeys } from '@/api/query-client';
import { DataToolbar } from '@/components/common/data-toolbar';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useListParams } from '@/hooks/use-list-params';
import { auditService } from '@/services/challan.service';
import { cn } from '@/utils/cn';
import { formatDateTime, humanizeEnum } from '@/utils/format';

const FILTER_KEYS = ['action', 'entityType'] as const;

const ACTION_OPTIONS = [
  { value: 'CREATE', label: 'Create' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'DELETE', label: 'Delete' },
  { value: 'LOGIN', label: 'Sign in' },
  { value: 'LOGIN_FAILED', label: 'Failed sign-in' },
  { value: 'LOGOUT', label: 'Sign out' },
  { value: 'STATUS_CHANGE', label: 'Status change' },
  { value: 'STOCK_ADJUSTMENT', label: 'Stock adjustment' },
  { value: 'CHALLAN_CONFIRM', label: 'Challan confirmed' },
  { value: 'CHALLAN_CANCEL', label: 'Challan cancelled' },
];

const ENTITY_OPTIONS = [
  { value: 'Customer', label: 'Customer' },
  { value: 'Product', label: 'Product' },
  { value: 'Inventory', label: 'Inventory' },
  { value: 'SalesChallan', label: 'Sales challan' },
  { value: 'User', label: 'User' },
  { value: 'Auth', label: 'Authentication' },
  { value: 'Category', label: 'Category' },
];

/** Actions worth visually flagging in a long list. */
const actionVariant = (action: string): 'soft-success' | 'soft-danger' | 'soft-warning' | 'soft-info' | 'soft-neutral' => {
  switch (action) {
    case 'CREATE':
    case 'CHALLAN_CONFIRM':
      return 'soft-success';
    case 'DELETE':
    case 'CHALLAN_CANCEL':
    case 'LOGIN_FAILED':
      return 'soft-danger';
    case 'STOCK_ADJUSTMENT':
    case 'STATUS_CHANGE':
      return 'soft-warning';
    case 'LOGIN':
    case 'LOGOUT':
      return 'soft-info';
    default:
      return 'soft-neutral';
  }
};

/** Renders a before/after payload, or nothing when there is no diff. */
const DiffView = ({ before, after }: { before: unknown; after: unknown }): React.JSX.Element | null => {
  if (before === null && after === null) return null;
  if (before === undefined && after === undefined) return null;

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        View changes
      </summary>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        {before !== null && before !== undefined && (
          <div>
            <p className="mb-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
              Before
            </p>
            <pre className="overflow-x-auto rounded-md bg-destructive/8 p-2 font-mono text-[0.65rem] leading-relaxed text-foreground">
              {JSON.stringify(before, null, 2)}
            </pre>
          </div>
        )}
        {after !== null && after !== undefined && (
          <div>
            <p className="mb-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
              After
            </p>
            <pre className="overflow-x-auto rounded-md bg-success/8 p-2 font-mono text-[0.65rem] leading-relaxed text-foreground">
              {JSON.stringify(after, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
};

export const AuditLogsPage = (): React.JSX.Element => {
  const params = useListParams({ filterKeys: FILTER_KEYS });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.audit.list(params.queryParams),
    queryFn: () => auditService.list(params.queryParams),
    placeholderData: (previous) => previous,
  });

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Every change to business data, with actor, timestamp and diff"
      />

      <DataToolbar
        className="mb-4"
        searchValue={params.searchInput}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search summaries…"
        filters={[
          { key: 'action', placeholder: 'All actions', options: ACTION_OPTIONS, width: 'sm:min-w-[11rem]' },
          { key: 'entityType', placeholder: 'All entities', options: ENTITY_OPTIONS },
        ]}
        filterValues={params.filters}
        onFilterChange={params.setFilter}
        hasActiveFilters={params.hasActiveFilters}
        onClearFilters={params.clearFilters}
      />

      <Card>
        {isLoading ? (
          <TableSkeleton rows={10} columns={5} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            variant={params.hasActiveFilters ? 'no-results' : 'empty'}
            title={params.hasActiveFilters ? 'No matching entries' : 'No audit entries yet'}
            description="Changes to customers, products, stock and challans are recorded here automatically."
            action={
              params.hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={params.clearFilters}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className={cn('transition-opacity', isFetching && 'opacity-60')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">When</TableHead>
                    <TableHead className="w-40">Action</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-52">Actor</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {data?.items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </TableCell>

                      <TableCell className="align-top">
                        <Badge variant={actionVariant(entry.action)}>
                          {humanizeEnum(entry.action)}
                        </Badge>
                        <p className="mt-1 text-[0.65rem] text-muted-foreground">
                          {entry.entityType}
                        </p>
                      </TableCell>

                      <TableCell className="align-top">
                        <p className="text-sm text-foreground">{entry.summary}</p>
                        <DiffView before={entry.before} after={entry.after} />
                      </TableCell>

                      <TableCell className="align-top">
                        <p className="truncate text-xs text-foreground">
                          {entry.actor.email ?? 'System'}
                        </p>
                        {entry.actor.role && (
                          <p className="text-[0.65rem] text-muted-foreground">{entry.actor.role}</p>
                        )}
                        {entry.ipAddress && (
                          <p className="font-mono text-[0.65rem] text-muted-foreground">
                            {entry.ipAddress}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {data && (
              <Pagination
                meta={data.meta}
                onPageChange={params.setPage}
                onLimitChange={params.setLimit}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
};
