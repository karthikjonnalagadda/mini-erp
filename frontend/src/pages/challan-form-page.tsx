/**
 * Challan create/edit form.
 *
 * The most involved screen in the application: a customer picker, a dynamic
 * line-item table with live totals, and stock warnings.
 *
 * IMPORTANT — the totals computed here are a PREVIEW ONLY. The server recomputes
 * every line and the document total from the catalogue on save, and its numbers
 * win. Client-side maths exists so the user sees the effect of a quantity change
 * immediately; it is never the source of truth. The two implementations agree
 * because both apply discount before tax and round the same way, but if they
 * ever diverge, the server is right by definition.
 *
 * A challan is always created as a DRAFT. Nothing on this page moves stock.
 */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';

import { ApiRequestError } from '@/api/client';
import { invalidateGroup, queryKeys } from '@/api/query-client';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DetailSkeleton, ErrorState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast, toastApiError } from '@/hooks/use-toast';
import { challanService } from '@/services/challan.service';
import type { ChallanItemPayload } from '@/services/challan.service';
import { customerService } from '@/services/customer.service';
import { productService } from '@/services/product.service';
import type { Product } from '@/types/api.types';
import { cn } from '@/utils/cn';
import { formatCurrency, formatNumber, toDateInputValue } from '@/utils/format';

/** A line as the user is editing it, before it becomes a payload item. */
interface DraftLine {
  /** Stable key for React. Line identity must survive reordering and deletion. */
  key: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

let lineCounter = 0;
const newLine = (): DraftLine => ({
  key: `line-${++lineCounter}`,
  productId: '',
  quantity: 1,
  unitPrice: 0,
  discountPercent: 0,
});

/**
 * Line maths, mirroring the server's `calculateLineAmounts`.
 * Discount applies BEFORE tax — the other order overstates the total.
 */
const lineAmounts = (line: DraftLine, taxRate: number) => {
  const gross = line.unitPrice * line.quantity;
  const discount = gross * (line.discountPercent / 100);
  const subtotal = gross - discount;
  const tax = subtotal * (taxRate / 100);
  return { gross, discount, subtotal, tax, total: subtotal + tax };
};

export const ChallanFormPage = (): React.JSX.Element => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [customerId, setCustomerId] = React.useState('');
  const [challanDate, setChallanDate] = React.useState(toDateInputValue(new Date()));
  const [transporterName, setTransporterName] = React.useState('');
  const [vehicleNumber, setVehicleNumber] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<DraftLine[]>([newLine()]);
  const [formError, setFormError] = React.useState<string | null>(null);

  // --- Reference data ------------------------------------------------------

  const customersQuery = useQuery({
    queryKey: queryKeys.customers.list({ limit: 100, status: 'ACTIVE' }),
    queryFn: () => customerService.list({ limit: 100, status: 'ACTIVE', sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 5 * 60_000,
  });

  const productsQuery = useQuery({
    queryKey: queryKeys.products.list({ limit: 100, isActive: 'true', _scope: 'challan-form' }),
    queryFn: () => productService.list({ limit: 100, isActive: 'true', sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 5 * 60_000,
  });

  const existingQuery = useQuery({
    queryKey: queryKeys.challans.detail(id ?? ''),
    queryFn: () => challanService.getById(id as string),
    enabled: isEdit,
  });

  const productById = React.useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of productsQuery.data?.items ?? []) map.set(product.id, product);
    return map;
  }, [productsQuery.data]);

  // Populate from the existing draft once it loads.
  React.useEffect(() => {
    const challan = existingQuery.data;
    if (!challan) return;

    setCustomerId(challan.customer.id);
    setChallanDate(toDateInputValue(challan.challanDate));
    setTransporterName(challan.transporterName ?? '');
    setVehicleNumber(challan.vehicleNumber ?? '');
    setNotes(challan.notes ?? '');
    setLines(
      challan.items.map((item) => ({
        key: `line-${++lineCounter}`,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
      })),
    );
  }, [existingQuery.data]);

  // --- Line editing --------------------------------------------------------

  const updateLine = (key: string, patch: Partial<DraftLine>): void => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  /** Selecting a product seeds its catalogue price, which stays editable. */
  const selectProduct = (key: string, productId: string): void => {
    const product = productById.get(productId);
    updateLine(key, { productId, unitPrice: product?.unitPrice ?? 0 });
  };

  const addLine = (): void => setLines((current) => [...current, newLine()]);

  const removeLine = (key: string): void =>
    setLines((current) => (current.length === 1 ? current : current.filter((l) => l.key !== key)));

  // --- Derived state -------------------------------------------------------

  /** Products already on the challan — excluded from other rows' dropdowns so
      a duplicate cannot be created (the server rejects it, and the DB has a
      unique constraint; blocking it here avoids the round-trip). */
  const usedProductIds = React.useMemo(
    () => new Set(lines.map((line) => line.productId).filter(Boolean)),
    [lines],
  );

  const totals = React.useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;

    for (const line of lines) {
      const product = productById.get(line.productId);
      if (!product) continue;
      const amounts = lineAmounts(line, product.taxRate);
      subtotal += amounts.gross;
      discount += amounts.discount;
      tax += amounts.tax;
    }

    return {
      subtotal,
      discount,
      tax,
      total: subtotal - discount + tax,
      quantity: lines.reduce((sum, line) => sum + (line.productId ? line.quantity : 0), 0),
    };
  }, [lines, productById]);

  /** Lines whose quantity exceeds available stock. A warning, not a block —
      the draft is still valid; confirmation is what would fail. */
  const shortages = React.useMemo(
    () =>
      lines
        .map((line) => {
          const product = productById.get(line.productId);
          if (!product) return null;
          if (line.quantity <= product.stock.available) return null;
          return { sku: product.sku, requested: line.quantity, available: product.stock.available };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    [lines, productById],
  );

  // --- Save ----------------------------------------------------------------

  const mutation = useMutation({
    mutationFn: () => {
      const items: ChallanItemPayload[] = lines
        .filter((line) => line.productId && line.quantity > 0)
        .map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
        }));

      const payload = {
        customerId,
        challanDate: new Date(challanDate).toISOString(),
        transporterName: transporterName.trim() || null,
        vehicleNumber: vehicleNumber.trim() || null,
        notes: notes.trim() || null,
        items,
      };

      return isEdit
        ? challanService.update(id as string, payload)
        : challanService.create(payload);
    },

    onSuccess: async (saved) => {
      toast.success(
        isEdit ? 'Challan updated' : 'Draft challan created',
        `${saved.challanNumber} · ${formatCurrency(saved.totals.totalAmount)}`,
      );
      await invalidateGroup('challan');
      navigate(`/challans/${saved.id}`, { replace: true });
    },

    onError: (error: unknown) => {
      if (error instanceof ApiRequestError && error.code === 'VALIDATION_ERROR') {
        const first = error.fieldErrors[0];
        setFormError(first ? `${first.field}: ${first.message}` : error.message);
        return;
      }
      if (error instanceof ApiRequestError) {
        setFormError(error.message);
      }
      toastApiError(error, isEdit ? 'Could not update challan' : 'Could not create challan');
    },
  });

  const validate = (): string | null => {
    if (!customerId) return 'Select a customer.';
    const validLines = lines.filter((line) => line.productId);
    if (validLines.length === 0) return 'Add at least one product.';
    if (validLines.some((line) => line.quantity < 1)) return 'Every line needs a quantity of at least 1.';
    return null;
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const validationError = validate();
    setFormError(validationError);
    if (!validationError) mutation.mutate();
  };

  // --- Render --------------------------------------------------------------

  if (isEdit && existingQuery.isLoading) return <DetailSkeleton />;

  if (isEdit && existingQuery.isError) {
    return <ErrorState error={existingQuery.error} onRetry={() => void existingQuery.refetch()} />;
  }

  // A confirmed or cancelled challan is immutable — send the user to the
  // read-only view rather than showing an editor that cannot save.
  if (isEdit && existingQuery.data && !existingQuery.data.permissions.canEdit) {
    return (
      <ErrorState
        error={
          new ApiRequestError({
            message: `Challan ${existingQuery.data.challanNumber} is ${existingQuery.data.status.toLowerCase()} and can no longer be edited.`,
            code: 'BUSINESS_RULE_VIOLATION',
            status: 422,
          })
        }
      />
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <PageHeader
        breadcrumbs={[
          { label: 'Challans', to: '/challans' },
          { label: isEdit ? (existingQuery.data?.challanNumber ?? 'Edit') : 'New' },
        ]}
        title={isEdit ? `Edit ${existingQuery.data?.challanNumber ?? 'challan'}` : 'New challan'}
        description="Drafts do not affect stock. Confirming the challan is what dispatches inventory."
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            <Button type="submit" size="sm" loading={mutation.isPending}>
              <Save aria-hidden="true" />
              {isEdit ? 'Save draft' : 'Create draft'}
            </Button>
          </>
        }
      />

      {formError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
        >
          {formError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Header details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Document details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="Customer" htmlFor="customerId" required>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger id="customerId" hasError={Boolean(formError && !customerId)}>
                    <SelectValue placeholder="Select a customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {(customersQuery.data?.items ?? []).map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.businessName ?? customer.name} · {customer.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Challan date" htmlFor="challanDate" required>
                <Input
                  id="challanDate"
                  type="date"
                  value={challanDate}
                  onChange={(event) => setChallanDate(event.target.value)}
                />
              </FormField>

              <FormField label="Transporter" htmlFor="transporterName">
                <Input
                  id="transporterName"
                  value={transporterName}
                  onChange={(event) => setTransporterName(event.target.value)}
                  placeholder="VRL Logistics"
                />
              </FormField>

              <FormField
                label="Vehicle number"
                htmlFor="vehicleNumber"
                hint="Format: MH12AB1234"
              >
                <Input
                  id="vehicleNumber"
                  value={vehicleNumber}
                  onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())}
                  placeholder="MH12AB1234"
                  className="font-mono uppercase"
                />
              </FormField>
            </CardContent>
          </Card>

          {/* Line items */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle>Line items</CardTitle>
                <CardDescription>Prices default to the catalogue and stay editable</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus aria-hidden="true" />
                Add line
              </Button>
            </CardHeader>

            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Product</TableHead>
                    <TableHead className="w-24 text-right">Qty</TableHead>
                    <TableHead className="w-28 text-right">Rate</TableHead>
                    <TableHead className="w-24 text-right">Disc %</TableHead>
                    <TableHead className="w-28 text-right">Amount</TableHead>
                    <TableHead className="w-12 pr-5" />
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {lines.map((line) => {
                    const product = productById.get(line.productId);
                    const amounts = product ? lineAmounts(line, product.taxRate) : null;
                    const isShort = product ? line.quantity > product.stock.available : false;

                    return (
                      <TableRow key={line.key}>
                        <TableCell className="pl-5">
                          <Select
                            value={line.productId}
                            onValueChange={(value) => selectProduct(line.key, value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select a product" />
                            </SelectTrigger>
                            <SelectContent>
                              {(productsQuery.data?.items ?? [])
                                // Hide products already on another line.
                                .filter(
                                  (candidate) =>
                                    candidate.id === line.productId ||
                                    !usedProductIds.has(candidate.id),
                                )
                                .map((candidate) => (
                                  <SelectItem key={candidate.id} value={candidate.id}>
                                    {candidate.sku} — {candidate.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>

                          {product && (
                            <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <span>
                                Available: {formatNumber(product.stock.available)} {product.unit}
                              </span>
                              <span>·</span>
                              <span>GST {product.taxRate}%</span>
                              {isShort && (
                                <Badge variant="soft-warning" className="ml-1">
                                  <AlertTriangle className="size-3" aria-hidden="true" />
                                  Short
                                </Badge>
                              )}
                            </p>
                          )}
                        </TableCell>

                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(event) =>
                              updateLine(line.key, {
                                quantity: Math.max(1, Number(event.target.value) || 1),
                              })
                            }
                            className={cn('text-right tabular-nums', isShort && 'border-warning')}
                            aria-label="Quantity"
                          />
                        </TableCell>

                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.unitPrice}
                            onChange={(event) =>
                              updateLine(line.key, {
                                unitPrice: Math.max(0, Number(event.target.value) || 0),
                              })
                            }
                            className="text-right tabular-nums"
                            aria-label="Unit price"
                          />
                        </TableCell>

                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={line.discountPercent}
                            onChange={(event) =>
                              updateLine(line.key, {
                                discountPercent: Math.min(
                                  100,
                                  Math.max(0, Number(event.target.value) || 0),
                                ),
                              })
                            }
                            className="text-right tabular-nums"
                            aria-label="Discount percent"
                          />
                        </TableCell>

                        <TableCell className="table-cell-numeric text-sm font-medium">
                          {amounts ? formatCurrency(amounts.total) : '—'}
                        </TableCell>

                        <TableCell className="pr-5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeLine(line.key)}
                            disabled={lines.length === 1}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Remove line"
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Delivery instructions, PO reference, packing notes…"
                aria-label="Challan notes"
              />
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        <div className="space-y-4">
          <Card className="lg:sticky lg:top-20">
            <CardHeader className="pb-3">
              <CardTitle>Summary</CardTitle>
              <CardDescription>Recalculated by the server on save</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items</span>
                <span className="tabular-nums">
                  {lines.filter((line) => line.productId).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total units</span>
                <span className="tabular-nums">{formatNumber(totals.quantity)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2.5">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="tabular-nums text-success">
                    − {formatCurrency(totals.discount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">GST</span>
                <span className="tabular-nums">{formatCurrency(totals.tax)}</span>
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-2.5">
                <span className="font-semibold">Grand total</span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(totals.total)}
                </span>
              </div>

              <Button type="submit" className="mt-2 w-full" loading={mutation.isPending}>
                <Save aria-hidden="true" />
                {isEdit ? 'Save draft' : 'Create draft'}
              </Button>
            </CardContent>
          </Card>

          {/* Stock warning — informational: a draft with a shortage is legal,
              confirming it is not. */}
          {shortages.length > 0 && (
            <Card className="border-warning/30 bg-warning/6">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  Stock shortage
                </CardTitle>
                <CardDescription>
                  This draft can be saved, but confirmation will be rejected until stock is
                  available.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-xs">
                  {shortages.map((shortage) => (
                    <li key={shortage.sku} className="flex justify-between gap-2">
                      <span className="font-mono text-foreground">{shortage.sku}</span>
                      <span className="tabular-nums text-muted-foreground">
                        need {shortage.requested}, have {shortage.available}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </form>
  );
};
