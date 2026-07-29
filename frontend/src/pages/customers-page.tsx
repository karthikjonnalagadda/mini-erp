/**
 * Customer list.
 *
 * The canonical list screen in this application: URL-synchronised search /
 * filters / sorting / pagination, all four render states handled, and a form
 * dialog for create and edit that reuses one component.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';

import { ApiRequestError } from '@/api/client';
import { invalidateGroup, queryKeys } from '@/api/query-client';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataToolbar } from '@/components/common/data-toolbar';
import { PageHeader } from '@/components/common/page-header';
import { CustomerFormDialog } from '@/components/customers/customer-form-dialog';
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
import { customerService } from '@/services/customer.service';
import type { Customer } from '@/types/api.types';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDate, humanizeEnum } from '@/utils/format';

const FILTER_KEYS = ['status', 'customerType', 'followUpDue'] as const;

const STATUS_OPTIONS = [
  { value: 'LEAD', label: 'Lead' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'BLACKLISTED', label: 'Blacklisted' },
];

const TYPE_OPTIONS = [
  { value: 'RETAILER', label: 'Retailer' },
  { value: 'WHOLESALER', label: 'Wholesaler' },
  { value: 'DISTRIBUTOR', label: 'Distributor' },
  { value: 'CORPORATE', label: 'Corporate' },
  { value: 'WALK_IN', label: 'Walk-in' },
];

export const CustomersPage = (): React.JSX.Element => {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const params = useListParams({
    defaultSortBy: 'createdAt',
    filterKeys: FILTER_KEYS,
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Customer | null>(null);
  const [deleting, setDeleting] = React.useState<Customer | null>(null);

  const canManage = hasRole('ADMIN', 'SALES');
  const canDelete = hasRole('ADMIN');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.customers.list(params.queryParams),
    queryFn: () => customerService.list(params.queryParams),
    // Keeps the previous page rendered while the next loads, so paging does not
    // flash a skeleton and jump the layout.
    placeholderData: (previous) => previous,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => customerService.remove(id),
    onSuccess: async () => {
      toast.success('Customer deleted');
      setDeleting(null);
      await invalidateGroup('customer');
      await queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
    },
    onError: (mutationError: unknown) => {
      // A 409 here means the customer has challans — the message explains the
      // alternative, so it is worth showing verbatim.
      toastApiError(mutationError, 'Could not delete customer');
      if (mutationError instanceof ApiRequestError && mutationError.status === 409) {
        setDeleting(null);
      }
    },
  });

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (customer: Customer): void => {
    setEditing(customer);
    setFormOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Accounts, credit terms and follow-up activity"
        actions={
          canManage && (
            <Button size="sm" onClick={openCreate}>
              <Plus aria-hidden="true" />
              New customer
            </Button>
          )
        }
      />

      <DataToolbar
        className="mb-4"
        searchValue={params.searchInput}
        onSearchChange={params.setSearch}
        searchPlaceholder="Search name, business, mobile or GST…"
        filters={[
          { key: 'status', placeholder: 'All statuses', options: STATUS_OPTIONS },
          { key: 'customerType', placeholder: 'All types', options: TYPE_OPTIONS },
          {
            key: 'followUpDue',
            placeholder: 'All follow-ups',
            options: [{ value: 'true', label: 'Follow-up due' }],
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
            icon={Users}
            variant={params.hasActiveFilters ? 'no-results' : 'empty'}
            title={params.hasActiveFilters ? 'No matching customers' : 'No customers yet'}
            description={
              params.hasActiveFilters
                ? 'Try adjusting your search or filters.'
                : 'Add your first customer to start tracking accounts and follow-ups.'
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
                    New customer
                  </Button>
                )
              )
            }
          />
        ) : (
          <>
            {/* Refetching holds the previous render at reduced opacity rather
                than flashing a skeleton — no layout jump on page change. */}
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
                      Customer
                    </SortableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <SortableHead
                      field="outstandingAmount"
                      activeField={params.sortBy}
                      direction={params.sortOrder}
                      onSort={params.toggleSort}
                      align="right"
                    >
                      Outstanding
                    </SortableHead>
                    <SortableHead
                      field="followUpDate"
                      activeField={params.sortBy}
                      direction={params.sortOrder}
                      onSort={params.toggleSort}
                    >
                      Next follow-up
                    </SortableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {data?.items.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <Link
                          to={`/customers/${customer.id}`}
                          className="block min-w-0 font-medium text-foreground hover:text-primary"
                        >
                          <span className="block truncate">
                            {customer.businessName ?? customer.name}
                          </span>
                          <span className="block font-mono text-xs font-normal text-muted-foreground">
                            {customer.code}
                          </span>
                        </Link>
                      </TableCell>

                      <TableCell>
                        <span className="block text-sm tabular-nums">{customer.mobile}</span>
                        {customer.email && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {customer.email}
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {humanizeEnum(customer.customerType)}
                        </span>
                      </TableCell>

                      <TableCell>
                        <Badge variant={statusVariant.customer(customer.status)}>
                          {humanizeEnum(customer.status)}
                        </Badge>
                      </TableCell>

                      <TableCell className="table-cell-numeric">
                        <span
                          className={cn(
                            'text-sm font-medium',
                            customer.outstandingAmount > 0 ? 'text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {formatCurrency(customer.outstandingAmount)}
                        </span>
                      </TableCell>

                      <TableCell>
                        {customer.followUpDate ? (
                          <span className="text-sm">{formatDate(customer.followUpDate)}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex justify-end gap-0.5">
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openEdit(customer)}
                              aria-label={`Edit ${customer.name}`}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setDeleting(customer)}
                              aria-label={`Delete ${customer.name}`}
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

      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        customer={editing}
        onSaved={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete customer?"
        description={
          <>
            <strong>{deleting?.businessName ?? deleting?.name}</strong> will be removed from the
            customer list. Customers with issued challans cannot be deleted — set them to Inactive
            instead.
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
