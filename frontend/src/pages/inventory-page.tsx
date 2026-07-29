/**
 * Inventory dashboard.
 *
 * The operational counterpart to the product catalogue: what is on the shelf,
 * what is running out, and the two controls that legitimately change a quantity
 * — a signed adjustment and a physical stock take. Both write ledger entries.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ClipboardCheck,
  IndianRupee,
  Package,
  PackageX,
  SlidersHorizontal,
  Warehouse,
} from 'lucide-react';

import { queryKeys } from '@/api/query-client';
import { StockMovementChart } from '@/components/charts/charts';
import { PageHeader } from '@/components/common/page-header';
import { StatTile } from '@/components/common/stat-tile';
import { DataToolbar } from '@/components/common/data-toolbar';
import { StockAdjustDialog } from '@/components/products/stock-adjust-dialog';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/context/auth-context';
import { useListParams } from '@/hooks/use-list-params';
import { categoryService, inventoryService, productService } from '@/services/product.service';
import type { Product } from '@/types/api.types';
import { cn } from '@/utils/cn';
import { formatCurrency, formatNumber, humanizeEnum } from '@/utils/format';

const FILTER_KEYS = ['categoryId', 'lowStock', 'outOfStock'] as const;

export const InventoryPage = (): React.JSX.Element => {
  const { hasRole } = useAuth();
  const params = useListParams({ defaultSortBy: 'name', defaultSortOrder: 'asc', filterKeys: FILTER_KEYS });

  const [adjusting, setAdjusting] = React.useState<Product | null>(null);
  const [mode, setMode] = React.useState<'adjust' | 'stock-take'>('adjust');

  const canAdjust = hasRole('ADMIN', 'WAREHOUSE');

  const summaryQuery = useQuery({
    queryKey: queryKeys.inventory.summary,
    queryFn: inventoryService.summary,
    staleTime: 60_000,
  });

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list({ ...params.queryParams, _scope: 'inventory' }),
    queryFn: () => productService.list(params.queryParams),
    placeholderData: (previous) => previous,
  });

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories.options,
    queryFn: categoryService.options,
    staleTime: 10 * 60_000,
  });

  const openDialog = (product: Product, dialogMode: 'adjust' | 'stock-take'): void => {
    setMode(dialogMode);
    setAdjusting(product);
  };

  const summary = summaryQuery.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        description="Live stock levels, valuation and reorder warnings"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/stock-movements">View ledger</Link>
          </Button>
        }
      />

      {/* Summary tiles */}
      {summaryQuery.isLoading ? (
        <CardSkeleton count={4} />
      ) : summaryQuery.isError ? (
        <ErrorState error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} />
      ) : summary ? (
        <section aria-label="Inventory summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Stocked products"
            value={formatNumber(summary.totalProducts)}
            icon={Package}
          />
          <StatTile
            label="Total units on hand"
            value={formatNumber(summary.totalUnits, { compact: true })}
            icon={Warehouse}
          />
          <StatTile
            label="Low stock"
            value={formatNumber(summary.lowStockCount)}
            icon={AlertTriangle}
            intent={summary.lowStockCount > 0 ? 'warning' : 'positive'}
          />
          <StatTile
            label="Out of stock"
            value={formatNumber(summary.outOfStockCount)}
            icon={PackageX}
            intent={summary.outOfStockCount > 0 ? 'danger' : 'positive'}
          />
        </section>
      ) : null}

      {/* Valuation + movement trend */}
      {summary && (
        <section className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Stock valuation</CardTitle>
              <CardDescription>Value of units currently on hand</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IndianRupee className="size-3.5" aria-hidden="true" />
                  At cost
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(summary.valuation.atCost)}
                </span>
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">At selling price</span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(summary.valuation.atSelling)}
                </span>
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">Potential margin</span>
                <span className="text-sm font-semibold tabular-nums text-success">
                  {formatCurrency(summary.valuation.atSelling - summary.valuation.atCost)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle>Movement trend</CardTitle>
              <CardDescription>Units received and dispatched over 30 days</CardDescription>
            </CardHeader>
            <CardContent>
              <StockMovementChart data={summary.movementTrend} />
            </CardContent>
          </Card>
        </section>
      )}

      {/* Stock table */}
      <div>
        <DataToolbar
          className="mb-4"
          searchValue={params.searchInput}
          onSearchChange={params.setSearch}
          searchPlaceholder="Search product or SKU…"
          filters={[
            {
              key: 'categoryId',
              placeholder: 'All categories',
              options: (categoriesQuery.data ?? []).map((category) => ({
                value: category.id,
                label: category.name,
              })),
              width: 'sm:min-w-[11rem]',
            },
            {
              key: 'lowStock',
              placeholder: 'All stock levels',
              options: [{ value: 'true', label: 'Low stock only' }],
            },
            {
              key: 'outOfStock',
              placeholder: 'Any availability',
              options: [{ value: 'true', label: 'Out of stock only' }],
            },
          ]}
          filterValues={params.filters}
          onFilterChange={params.setFilter}
          hasActiveFilters={params.hasActiveFilters}
          onClearFilters={params.clearFilters}
        />

        <Card>
          {productsQuery.isLoading ? (
            <TableSkeleton rows={8} columns={6} />
          ) : productsQuery.isError ? (
            <ErrorState error={productsQuery.error} onRetry={() => void productsQuery.refetch()} />
          ) : productsQuery.data && productsQuery.data.items.length === 0 ? (
            <EmptyState
              icon={Warehouse}
              variant={params.hasActiveFilters ? 'no-results' : 'empty'}
              title={params.hasActiveFilters ? 'No matching stock' : 'No stock records'}
              description={
                params.hasActiveFilters
                  ? 'Try adjusting your search or filters.'
                  : 'Add products to start tracking inventory.'
              }
            />
          ) : (
            <>
              <div className={cn('transition-opacity', productsQuery.isFetching && 'opacity-60')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Reorder at</TableHead>
                      <TableHead>Status</TableHead>
                      {canAdjust && <TableHead className="w-24 text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {productsQuery.data?.items.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <p className="truncate font-medium text-foreground">{product.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {product.stock.warehouseLocation ?? '—'}
                          {product.stock.binLocation && ` / ${product.stock.binLocation}`}
                        </TableCell>

                        <TableCell className="table-cell-numeric">
                          <span className="text-sm font-semibold">
                            {formatNumber(product.stock.onHand)}
                          </span>
                          <span className="ml-1 text-xs text-muted-foreground">{product.unit}</span>
                        </TableCell>

                        <TableCell className="table-cell-numeric text-sm text-muted-foreground">
                          {formatNumber(product.minimumStock)}
                        </TableCell>

                        <TableCell>
                          <Badge variant={statusVariant.stock(product.stock.status)}>
                            {humanizeEnum(product.stock.status)}
                          </Badge>
                        </TableCell>

                        {canAdjust && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => openDialog(product, 'adjust')}
                                aria-label={`Adjust stock for ${product.name}`}
                                title="Adjust stock"
                              >
                                <SlidersHorizontal aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => openDialog(product, 'stock-take')}
                                aria-label={`Record stock take for ${product.name}`}
                                title="Stock take"
                              >
                                <ClipboardCheck aria-hidden="true" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {productsQuery.data && (
                <Pagination
                  meta={productsQuery.data.meta}
                  onPageChange={params.setPage}
                  onLimitChange={params.setLimit}
                />
              )}
            </>
          )}
        </Card>
      </div>

      {adjusting && (
        <StockAdjustDialog
          open
          onOpenChange={(open) => !open && setAdjusting(null)}
          product={adjusting}
          mode={mode}
        />
      )}
    </div>
  );
};
