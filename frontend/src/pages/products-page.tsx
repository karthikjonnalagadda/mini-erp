/**
 * Product catalogue.
 *
 * Stock is displayed but NOT editable here. Changing a quantity has to produce a
 * ledger entry, so it lives on the Inventory screen behind the adjust/stock-take
 * actions. A silently editable stock field on a product form is how an ERP's
 * numbers stop reconciling.
 */
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';

import { invalidateGroup, queryKeys } from '@/api/query-client';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataToolbar } from '@/components/common/data-toolbar';
import { PageHeader } from '@/components/common/page-header';
import { ProductFormDialog } from '@/components/products/product-form-dialog';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { toast, toastApiError } from '@/hooks/use-toast';
import { categoryService, productService } from '@/services/product.service';
import type { Product } from '@/types/api.types';
import { cn } from '@/utils/cn';
import { formatCurrency, formatNumber, humanizeEnum } from '@/utils/format';

const FILTER_KEYS = ['categoryId', 'isActive', 'lowStock'] as const;

export const ProductsPage = (): React.JSX.Element => {
  const { hasRole } = useAuth();
  const params = useListParams({ defaultSortBy: 'createdAt', filterKeys: FILTER_KEYS });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [deleting, setDeleting] = React.useState<Product | null>(null);

  const canManage = hasRole('ADMIN', 'WAREHOUSE');
  const canDelete = hasRole('ADMIN');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.products.list(params.queryParams),
    queryFn: () => productService.list(params.queryParams),
    placeholderData: (previous) => previous,
  });

  // Category options power the filter dropdown and the form's category select.
  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories.options,
    queryFn: categoryService.options,
    // Reference data — refetching it every 30s would be wasteful.
    staleTime: 10 * 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productService.remove(id),
    onSuccess: async () => {
      toast.success('Product deleted');
      setDeleting(null);
      await invalidateGroup('catalogue');
    },
    onError: (mutationError: unknown) =>
      toastApiError(mutationError, 'Could not delete product'),
  });

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Products"
        description="Catalogue, pricing and stock thresholds"
        actions={
          canManage && (
            <Button size="sm" onClick={openCreate}>
              <Plus aria-hidden="true" />
              New product
            </Button>
          )
        }
      />

      <DataToolbar
        className="mb-4"
        searchValue={params.searchInput}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search name, SKU or barcode…"
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
            key: 'isActive',
            placeholder: 'All products',
            options: [
              { value: 'true', label: 'Active only' },
              { value: 'false', label: 'Inactive only' },
            ],
          },
          {
            key: 'lowStock',
            placeholder: 'All stock levels',
            options: [{ value: 'true', label: 'Low stock only' }],
          },
        ]}
        filterValues={params.filters}
        onFilterChange={params.setFilter}
        hasActiveFilters={params.hasActiveFilters}
        onClearFilters={params.clearFilters}
      />

      <Card>
        {isLoading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={Package}
            variant={params.hasActiveFilters ? 'no-results' : 'empty'}
            title={params.hasActiveFilters ? 'No matching products' : 'No products yet'}
            description={
              params.hasActiveFilters
                ? 'Try adjusting your search or filters.'
                : 'Add your first product to start tracking stock.'
            }
            action={
              params.hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={params.clearFilters}>
                  Clear filters
                </Button>
              ) : (
                canManage && (
                  <Button size="sm" onClick={openCreate}>
                    <Plus aria-hidden="true" />
                    New product
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
                      field="name"
                      activeField={params.sortBy}
                      direction={params.sortOrder}
                      onSort={params.toggleSort}
                    >
                      Product
                    </SortableHead>
                    <TableHead>Category</TableHead>
                    <SortableHead
                      field="unitPrice"
                      activeField={params.sortBy}
                      direction={params.sortOrder}
                      onSort={params.toggleSort}
                      align="right"
                    >
                      Price
                    </SortableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {data?.items.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{product.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {product.category.name}
                        </span>
                      </TableCell>

                      <TableCell className="table-cell-numeric">
                        <span className="text-sm font-medium">
                          {formatCurrency(product.unitPrice)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          per {product.unit}
                        </span>
                      </TableCell>

                      <TableCell className="table-cell-numeric text-sm text-muted-foreground">
                        {product.taxRate}%
                      </TableCell>

                      <TableCell className="table-cell-numeric">
                        <span className="text-sm font-medium">
                          {formatNumber(product.stock.onHand)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          min {formatNumber(product.minimumStock)}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={statusVariant.stock(product.stock.status)}>
                            {humanizeEnum(product.stock.status)}
                          </Badge>
                          {!product.isActive && <Badge variant="outline">Inactive</Badge>}
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex justify-end gap-0.5">
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                setEditing(product);
                                setFormOpen(true);
                              }}
                              aria-label={`Edit ${product.name}`}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setDeleting(product)}
                              aria-label={`Delete ${product.name}`}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          )}
                        </div>
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

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        categories={categoriesQuery.data ?? []}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete product?"
        description={
          <>
            <strong>{deleting?.name}</strong> will be removed from the catalogue. Products that
            still hold stock, or that appear on an existing challan, cannot be deleted — deactivate
            them instead.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </div>
  );
};
