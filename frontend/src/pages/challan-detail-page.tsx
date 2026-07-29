/**
 * Challan detail — the document view and its state transitions.
 *
 * Button availability comes from `challan.permissions`, which the SERVER
 * computes from the document's status. The UI does not re-implement the state
 * machine; if it did, the two would drift and users would see a Confirm button
 * that always fails.
 *
 * Role checks are layered on top: `canConfirm` requires BOTH that the document
 * is confirmable and that this user's role may confirm. Separation of duties
 * means a salesperson sees a confirmable draft but cannot release the stock.
 */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  Pencil,
  Trash2,
  Truck,
} from 'lucide-react';

import { ApiRequestError } from '@/api/client';
import { invalidateGroup, queryKeys } from '@/api/query-client';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageHeader } from '@/components/common/page-header';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailSkeleton, ErrorState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/context/auth-context';
import { toast, toastApiError } from '@/hooks/use-toast';
import { challanService } from '@/services/challan.service';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDateTime, formatNumber, humanizeEnum } from '@/utils/format';

type PendingAction = 'confirm' | 'cancel' | 'delete' | null;

export const ChallanDetailPage = (): React.JSX.Element => {
  const { id = '' } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);

  const { data: challan, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.challans.detail(id),
    queryFn: () => challanService.getById(id),
    enabled: id.length > 0,
  });

  /** Shared success handling: refresh every cache the transition touched. */
  const afterTransition = async (message: string, description?: string): Promise<void> => {
    toast.success(message, description);
    setPendingAction(null);
    await invalidateGroup('challan');
    await queryClient.invalidateQueries({ queryKey: queryKeys.challans.detail(id) });
  };

  const confirmMutation = useMutation({
    mutationFn: () => challanService.confirm(id),
    onSuccess: (updated) =>
      afterTransition('Challan confirmed', `Stock deducted for ${updated.totals.itemCount} line(s).`),
    onError: (mutationError: unknown) => {
      // INSUFFICIENT_STOCK carries per-SKU detail; the toast helper surfaces the
      // full message so the warehouse knows exactly what is short.
      toastApiError(mutationError, 'Could not confirm challan');
      if (mutationError instanceof ApiRequestError) setPendingAction(null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => challanService.cancel(id, reason),
    onSuccess: (updated) =>
      afterTransition(
        'Challan cancelled',
        updated.audit.confirmedAt ? 'Stock has been returned to inventory.' : undefined,
      ),
    onError: (mutationError: unknown) => toastApiError(mutationError, 'Could not cancel challan'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => challanService.remove(id),
    onSuccess: async () => {
      toast.success('Draft challan deleted');
      await invalidateGroup('challan');
      navigate('/challans', { replace: true });
    },
    onError: (mutationError: unknown) => toastApiError(mutationError, 'Could not delete challan'),
  });

  const handleDownload = async (): Promise<void> => {
    if (!challan) return;
    setIsDownloading(true);
    try {
      await challanService.downloadPdf(challan.id, challan.challanNumber);
    } catch (downloadError) {
      toastApiError(downloadError, 'Could not download PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) return <DetailSkeleton />;
  if (isError || !challan) return <ErrorState error={error} onRetry={() => void refetch()} />;

  // Server permission AND role permission must both hold.
  const canEdit = challan.permissions.canEdit && hasRole('ADMIN', 'SALES');
  const canDelete = challan.permissions.canDelete && hasRole('ADMIN', 'SALES');
  const canConfirm = challan.permissions.canConfirm && hasRole('ADMIN', 'WAREHOUSE');
  const canCancel = challan.permissions.canCancel && hasRole('ADMIN', 'ACCOUNTS');

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Challans', to: '/challans' }, { label: challan.challanNumber }]}
        title={challan.challanNumber}
        description={`${challan.customer.businessName ?? challan.customer.name} · ${formatDateTime(challan.challanDate)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/challans')}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>

            <Button variant="outline" size="sm" onClick={() => void handleDownload()} loading={isDownloading}>
              <Download aria-hidden="true" />
              PDF
            </Button>

            {canEdit && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/challans/${challan.id}/edit`}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Link>
              </Button>
            )}

            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => setPendingAction('delete')}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            )}

            {canCancel && (
              <Button variant="outline" size="sm" onClick={() => setPendingAction('cancel')}>
                <Ban aria-hidden="true" />
                Cancel challan
              </Button>
            )}

            {canConfirm && (
              <Button size="sm" onClick={() => setPendingAction('confirm')}>
                <CheckCircle2 aria-hidden="true" />
                Confirm &amp; dispatch
              </Button>
            )}
          </>
        }
      />

      {/* Status banner — a cancelled document must be unmistakable. */}
      {challan.status !== 'DRAFT' && (
        <div
          className={cn(
            'mb-4 flex flex-wrap items-center gap-2 rounded-md border px-4 py-3 text-sm',
            challan.status === 'CONFIRMED'
              ? 'border-success/25 bg-success/8'
              : 'border-destructive/25 bg-destructive/8',
          )}
        >
          {challan.status === 'CONFIRMED' ? (
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <Ban className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <span className="font-medium text-foreground">
            {challan.status === 'CONFIRMED'
              ? `Confirmed by ${challan.audit.confirmedBy?.name ?? 'system'} on ${formatDateTime(challan.audit.confirmedAt)} — stock deducted.`
              : `Cancelled by ${challan.audit.cancelledBy?.name ?? 'system'} on ${formatDateTime(challan.audit.cancelledAt)}.`}
          </span>
          {challan.audit.cancellationReason && (
            <span className="text-muted-foreground">
              Reason: {challan.audit.cancellationReason}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Line items */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Line items</CardTitle>
              <CardDescription>
                {challan.totals.itemCount} product{challan.totals.itemCount === 1 ? '' : 's'} ·{' '}
                {formatNumber(challan.totals.totalQuantity)} units
              </CardDescription>
            </div>
            <Badge variant={statusVariant.challan(challan.status)}>
              {humanizeEnum(challan.status)}
            </Badge>
          </CardHeader>

          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Disc.</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="pr-5 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {challan.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="pl-5">
                      {/* Snapshot values: what the document said when issued,
                          not what the catalogue says today. */}
                      <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
                    </TableCell>
                    <TableCell className="table-cell-numeric text-sm">
                      {formatNumber(item.quantity)} {item.unit}
                    </TableCell>
                    <TableCell className="table-cell-numeric text-sm">
                      {formatCurrency(item.unitPrice)}
                    </TableCell>
                    <TableCell className="table-cell-numeric text-sm text-muted-foreground">
                      {item.discountPercent > 0 ? `${item.discountPercent}%` : '—'}
                    </TableCell>
                    <TableCell className="table-cell-numeric text-sm text-muted-foreground">
                      {item.taxRate}%
                    </TableCell>
                    <TableCell className="table-cell-numeric pr-5 text-sm font-medium">
                      {formatCurrency(item.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>

              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="pl-5 text-right text-xs text-muted-foreground">
                    Subtotal
                  </TableCell>
                  <TableCell className="table-cell-numeric pr-5 text-sm">
                    {formatCurrency(challan.totals.subtotal)}
                  </TableCell>
                </TableRow>
                {challan.totals.discountAmount > 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="pl-5 text-right text-xs text-muted-foreground">
                      Discount
                    </TableCell>
                    <TableCell className="table-cell-numeric pr-5 text-sm text-success">
                      − {formatCurrency(challan.totals.discountAmount)}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell colSpan={5} className="pl-5 text-right text-xs text-muted-foreground">
                    GST
                  </TableCell>
                  <TableCell className="table-cell-numeric pr-5 text-sm">
                    {formatCurrency(challan.totals.taxAmount)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={5} className="pl-5 text-right text-sm font-semibold">
                    Grand total
                  </TableCell>
                  <TableCell className="table-cell-numeric pr-5 text-base font-semibold">
                    {formatCurrency(challan.totals.totalAmount)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link
                to={`/customers/${challan.customer.id}`}
                className="block font-medium text-foreground hover:text-primary"
              >
                {challan.customer.businessName ?? challan.customer.name}
              </Link>
              <p className="font-mono text-xs text-muted-foreground">{challan.customer.code}</p>
              <p className="tabular-nums text-muted-foreground">{challan.customer.mobile}</p>
              {challan.customer.gstNumber && (
                <p className="font-mono text-xs text-muted-foreground">
                  GSTIN {challan.customer.gstNumber}
                </p>
              )}
              {(challan.shippingAddress ?? challan.customer.address) && (
                <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                  {challan.shippingAddress ?? challan.customer.address}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Truck className="size-4" aria-hidden="true" />
                Dispatch
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-xs text-muted-foreground">Dispatch date</span>
                <span>{challan.dispatchDate ? formatDateTime(challan.dispatchDate) : '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-xs text-muted-foreground">Transporter</span>
                <span className="truncate">{challan.transporterName ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-xs text-muted-foreground">Vehicle</span>
                <span className="font-mono">{challan.vehicleNumber ?? '—'}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                Created by{' '}
                <span className="text-foreground">{challan.audit.createdBy?.name ?? 'system'}</span>{' '}
                on {formatDateTime(challan.audit.createdAt)}
              </p>
              {challan.audit.confirmedAt && (
                <p>
                  Confirmed by{' '}
                  <span className="text-foreground">
                    {challan.audit.confirmedBy?.name ?? 'system'}
                  </span>{' '}
                  on {formatDateTime(challan.audit.confirmedAt)}
                </p>
              )}
              {challan.audit.cancelledAt && (
                <p>
                  Cancelled by{' '}
                  <span className="text-foreground">
                    {challan.audit.cancelledBy?.name ?? 'system'}
                  </span>{' '}
                  on {formatDateTime(challan.audit.cancelledAt)}
                </p>
              )}
            </CardContent>
          </Card>

          {challan.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{challan.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* State-transition confirmations */}
      <ConfirmDialog
        open={pendingAction === 'confirm'}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Confirm and dispatch?"
        description={
          <>
            This will deduct <strong>{formatNumber(challan.totals.totalQuantity)} units</strong>{' '}
            across {challan.totals.itemCount} product
            {challan.totals.itemCount === 1 ? '' : 's'} from inventory and add{' '}
            <strong>{formatCurrency(challan.totals.totalAmount)}</strong> to the customer&apos;s
            outstanding balance. A confirmed challan cannot be edited — it can only be cancelled.
          </>
        }
        confirmLabel="Confirm &amp; dispatch"
        isLoading={confirmMutation.isPending}
        onConfirm={() => confirmMutation.mutate()}
      />

      <ConfirmDialog
        open={pendingAction === 'cancel'}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Cancel this challan?"
        description={
          challan.status === 'CONFIRMED' ? (
            <>
              The {formatNumber(challan.totals.totalQuantity)} dispatched units will be returned to
              inventory and the customer&apos;s balance reversed. This action is final — a cancelled
              challan cannot be reinstated.
            </>
          ) : (
            <>
              This draft will be marked cancelled. No stock was deducted, so inventory is
              unaffected.
            </>
          )
        }
        confirmLabel="Cancel challan"
        cancelLabel="Keep it"
        variant="destructive"
        requireReason
        reasonLabel="Cancellation reason"
        isLoading={cancelMutation.isPending}
        onConfirm={(reason) => reason && cancelMutation.mutate(reason)}
      />

      <ConfirmDialog
        open={pendingAction === 'delete'}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Delete this draft?"
        description="The draft and its line items will be removed permanently. Only drafts can be deleted; confirmed challans must be cancelled instead."
        confirmLabel="Delete draft"
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
};
