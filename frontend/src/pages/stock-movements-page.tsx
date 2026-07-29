/**
 * Stock movement ledger.
 *
 * Read-only by design. The ledger is append-only: a correction is a compensating
 * entry, never an edit. There is deliberately no edit or delete control on this
 * screen, because the API offers neither.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';

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
import { useListParams } from '@/hooks/use-list-params';
import { stockMovementService } from '@/services/product.service';
import { cn } from '@/utils/cn';
import { formatDateTime, formatNumber, humanizeEnum } from '@/utils/format';

const FILTER_KEYS = ['movementType', 'reason', 'dateFrom', 'dateTo'] as const;

const MOVEMENT_TYPES = [
  { value: 'IN', label: 'Stock in' },
  { value: 'OUT', label: 'Stock out' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'RETURN', label: 'Return' },
  { value: 'DAMAGE', label: 'Damage' },
];

const REASONS = [
  { value: 'SALES_CHALLAN', label: 'Sales challan' },
  { value: 'CHALLAN_CANCELLATION', label: 'Challan cancelled' },
  { value: 'PURCHASE_RECEIPT', label: 'Goods received' },
  { value: 'STOCK_TAKE_ADJUSTMENT', label: 'Stock take' },
  { value: 'DAMAGE_WRITE_OFF', label: 'Damage write-off' },
  { value: 'CUSTOMER_RETURN', label: 'Customer return' },
  { value: 'SUPPLIER_RETURN', label: 'Supplier return' },
  { value: 'OPENING_BALANCE', label: 'Opening balance' },
  { value: 'MANUAL_CORRECTION', label: 'Manual correction' },
];

export const StockMovementsPage = (): React.JSX.Element => {
  const params = useListParams({ defaultSortBy: 'createdAt', filterKeys: FILTER_KEYS });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.stockMovements.list(params.queryParams),
    queryFn: () => stockMovementService.list(params.queryParams),
    placeholderData: (previous) => previous,
  });

  return (
    <div>
      <PageHeader
        title="Stock Movements"
        description="Append-only ledger of every inventory change"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/inventory">Back to inventory</Link>
          </Button>
        }
      />

      <DataToolbar
        className="mb-4"
        searchValue={params.searchInput}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search by product…"
        filters={[
          { key: 'movementType', placeholder: 'All types', options: MOVEMENT_TYPES },
          {
            key: 'reason',
            placeholder: 'All reasons',
            options: REASONS,
            width: 'sm:min-w-[11rem]',
          },
        ]}
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
          <TableSkeleton rows={10} columns={7} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            variant={params.hasActiveFilters ? 'no-results' : 'empty'}
            title={params.hasActiveFilters ? 'No matching movements' : 'No stock movements yet'}
            description={
              params.hasActiveFilters
                ? 'Try widening the date range or clearing filters.'
                : 'Movements are recorded automatically when stock changes.'
            }
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
                    <SortableHead
                      field="createdAt"
                      activeField={params.sortBy}
                      direction={params.sortOrder}
                      onSort={params.toggleSort}
                    >
                      When
                    </SortableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <SortableHead
                      field="quantity"
                      activeField={params.sortBy}
                      direction={params.sortOrder}
                      onSort={params.toggleSort}
                      align="right"
                    >
                      Change
                    </SortableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {data?.items.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(movement.createdAt)}
                      </TableCell>

                      <TableCell>
                        <p className="truncate text-sm font-medium text-foreground">
                          {movement.product.name}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {movement.product.sku}
                        </p>
                      </TableCell>

                      <TableCell>
                        <Badge variant={statusVariant.movement(movement.movementType)}>
                          {humanizeEnum(movement.movementType)}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        {humanizeEnum(movement.reason)}
                      </TableCell>

                      <TableCell className="table-cell-numeric">
                        {/* Sign + colour together; the sign alone is enough
                            without colour, which is the point. */}
                        <span
                          className={cn(
                            'text-sm font-semibold',
                            movement.netChange > 0 ? 'text-success' : 'text-destructive',
                          )}
                        >
                          {movement.netChange > 0 ? '+' : ''}
                          {formatNumber(movement.netChange)}
                        </span>
                      </TableCell>

                      <TableCell className="table-cell-numeric text-sm text-muted-foreground">
                        {formatNumber(movement.quantityBefore)} →{' '}
                        <span className="font-medium text-foreground">
                          {formatNumber(movement.quantityAfter)}
                        </span>
                      </TableCell>

                      <TableCell>
                        {movement.reference.code ? (
                          movement.reference.type === 'SALES_CHALLAN' && movement.reference.id ? (
                            <Link
                              to={`/challans/${movement.reference.id}`}
                              className="font-mono text-xs text-primary hover:underline"
                            >
                              {movement.reference.code}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">
                              {movement.reference.code}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {movement.createdBy.name}
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
