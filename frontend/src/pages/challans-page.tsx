/**
 * Sales challan list.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';

import { queryKeys } from '@/api/query-client';
import { DataToolbar } from '@/components/common/data-toolbar';
import { PageHeader } from '@/components/common/page-header';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import {
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/context/auth-context';
import { useListParams } from '@/hooks/use-list-params';
import { challanService } from '@/services/challan.service';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDate, humanizeEnum } from '@/utils/format';

const FILTER_KEYS = ['status', 'customerId', 'dateFrom', 'dateTo'] as const;

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const ChallansPage = (): React.JSX.Element => {
  const { hasRole } = useAuth();
  const params = useListParams({ defaultSortBy: 'challanDate', filterKeys: FILTER_KEYS });

  const canCreate = hasRole('ADMIN', 'SALES');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.challans.list(params.queryParams),
    queryFn: () => challanService.list(params.queryParams),
    placeholderData: (previous) => previous,
  });

  return (
    <div>
      <PageHeader
        title="Sales Challans"
        description="Delivery documents, dispatch status and stock impact"
        actions={
          canCreate && (
            <Button asChild size="sm">
              <Link to="/challans/new">
                <Plus aria-hidden="true" />
                New challan
              </Link>
            </Button>
          )
        }
      />

      <DataToolbar
        className="mb-4"
        searchValue={params.searchInput}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search challan number, customer or vehicle…"
        filters={[{ key: 'status', placeholder: 'All statuses', options: STATUS_OPTIONS }]}
        filterValues={params.filters}
        onFilterChange={params.setFilter}
        hasActiveFilters={params.hasActiveFilters}
        onClearFilters={params.clearFilters}
        actions={
          <div className="flex items-center gap-2">
            <Input
              type="date"
              aria-label="From date"
              value={params.filters['dateFrom'] ?? ''}
              onChange={(event) => params.setFilter('dateFrom', event.target.value || undefined)}
              className="h-9 w-[9.5rem]"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To date"
              value={params.filters['dateTo'] ?? ''}
              onChange={(event) => params.setFilter('dateTo', event.target.value || undefined)}
              className="h-9 w-[9.5rem]"
            />
          </div>
        }
      />

      <Card>
        {isLoading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={FileText}
            variant={params.hasActiveFilters ? 'no-results' : 'empty'}
            title={params.hasActiveFilters ? 'No matching challans' : 'No challans yet'}
            description={
              params.hasActiveFilters
                ? 'Try adjusting your filters or date range.'
                : 'Create a draft challan, then confirm it to dispatch stock.'
            }
            action={
              params.hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={params.clearFilters}>
                  Clear filters
                </Button>
              ) : (
                canCreate && (
                  <Button asChild size="sm">
                    <Link to="/challans/new">
                      <Plus aria-hidden="true" />
                      New challan
                    </Link>
                  </Button>
                )
              )
            }
          />
        ) : (
          <>
            <div className={cn('transition-opacity', isFetching && 'opacity-60')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      field="challanNumber"
                      activeField={params.sortBy}
                      direction={params.sortOrder}
                      onSort={params.toggleSort}
                    >
                      Challan
                    </SortableHead>
                    <TableHead>Customer</TableHead>
                    <SortableHead
                      field="challanDate"
                      activeField={params.sortBy}
                      direction={params.sortOrder}
                      onSort={params.toggleSort}
                    >
                      Date
                    </SortableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <SortableHead
                      field="totalAmount"
                      activeField={params.sortBy}
                      direction={params.sortOrder}
                      onSort={params.toggleSort}
                      align="right"
                    >
                      Total
                    </SortableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Dispatch</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {data?.items.map((challan) => (
                    <TableRow key={challan.id}>
                      <TableCell>
                        <Link
                          to={`/challans/${challan.id}`}
                          className="font-mono text-sm font-medium text-foreground hover:text-primary"
                        >
                          {challan.challanNumber}
                        </Link>
                      </TableCell>

                      <TableCell>
                        <Link
                          to={`/customers/${challan.customer.id}`}
                          className="block min-w-0 hover:text-primary"
                        >
                          <span className="block truncate text-sm font-medium">
                            {challan.customer.businessName ?? challan.customer.name}
                          </span>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {challan.customer.code}
                          </span>
                        </Link>
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDate(challan.challanDate)}
                      </TableCell>

                      <TableCell className="table-cell-numeric text-sm text-muted-foreground">
                        {challan.totals.itemCount}
                      </TableCell>

                      <TableCell className="table-cell-numeric">
                        <span className="text-sm font-semibold">
                          {formatCurrency(challan.totals.totalAmount)}
                        </span>
                      </TableCell>

                      <TableCell>
                        <Badge variant={statusVariant.challan(challan.status)}>
                          {humanizeEnum(challan.status)}
                        </Badge>
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {challan.dispatchDate ? (
                          <>
                            {formatDate(challan.dispatchDate)}
                            {challan.vehicleNumber && (
                              <span className="block font-mono">{challan.vehicleNumber}</span>
                            )}
                          </>
                        ) : (
                          '—'
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
