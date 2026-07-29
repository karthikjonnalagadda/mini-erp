/**
 * Stock adjustment / stock take.
 *
 * Two modes, because they are genuinely different operations:
 *
 *  ADJUST     — a signed DELTA ("write off 3 damaged units"). The user thinks in
 *               change, so the field is a change.
 *  STOCK TAKE — an ABSOLUTE counted quantity ("the shelf holds 37"). The user
 *               thinks in the number they just counted, so the field is that
 *               number and the server derives the delta.
 *
 * Forcing a stock take through a delta field would make the operator do mental
 * arithmetic against a figure they are trying to verify — which is exactly how
 * a miscount becomes a permanent ledger entry.
 *
 * Both paths produce a StockMovement row; neither writes a quantity directly.
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { invalidateGroup } from '@/api/query-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, fieldAria } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast, toastApiError } from '@/hooks/use-toast';
import { inventoryService } from '@/services/product.service';
import type { MovementReason, Product } from '@/types/api.types';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';

/** Reasons a human would actually pick when adjusting stock by hand. */
const ADJUST_REASONS: Array<{ value: MovementReason; label: string }> = [
  { value: 'MANUAL_CORRECTION', label: 'Manual correction' },
  { value: 'PURCHASE_RECEIPT', label: 'Goods received' },
  { value: 'DAMAGE_WRITE_OFF', label: 'Damage / write-off' },
  { value: 'CUSTOMER_RETURN', label: 'Customer return' },
  { value: 'SUPPLIER_RETURN', label: 'Return to supplier' },
];

const adjustSchema = z.object({
  quantityDelta: z.coerce
    .number()
    .int('Whole units only')
    .refine((value) => value !== 0, 'Enter a non-zero change'),
  reason: z.enum([
    'MANUAL_CORRECTION',
    'PURCHASE_RECEIPT',
    'DAMAGE_WRITE_OFF',
    'CUSTOMER_RETURN',
    'SUPPLIER_RETURN',
    'STOCK_TAKE_ADJUSTMENT',
    'CHALLAN_CANCELLATION',
    'OPENING_BALANCE',
    'SALES_CHALLAN',
  ]),
  notes: z.union([z.string().trim().max(500), z.literal('')]).optional(),
});

const stockTakeSchema = z.object({
  countedQuantity: z.coerce.number().int('Whole units only').nonnegative('Cannot be negative'),
  notes: z.union([z.string().trim().max(500), z.literal('')]).optional(),
});

type AdjustForm = z.input<typeof adjustSchema>;
type StockTakeForm = z.input<typeof stockTakeSchema>;

export interface StockAdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  mode: 'adjust' | 'stock-take';
}

export const StockAdjustDialog = ({
  open,
  onOpenChange,
  product,
  mode,
}: StockAdjustDialogProps): React.JSX.Element => {
  const isStockTake = mode === 'stock-take';
  const currentStock = product.stock.onHand;

  const adjustForm = useForm<AdjustForm>({
    resolver: zodResolver(adjustSchema),
    defaultValues: { quantityDelta: 0, reason: 'MANUAL_CORRECTION', notes: '' },
  });

  const stockTakeForm = useForm<StockTakeForm>({
    resolver: zodResolver(stockTakeSchema),
    defaultValues: { countedQuantity: currentStock, notes: '' },
  });

  React.useEffect(() => {
    if (!open) return;
    adjustForm.reset({ quantityDelta: 0, reason: 'MANUAL_CORRECTION', notes: '' });
    stockTakeForm.reset({ countedQuantity: currentStock, notes: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentStock]);

  const adjustMutation = useMutation({
    mutationFn: (values: AdjustForm) =>
      inventoryService.adjust(product.id, {
        quantityDelta: Number(values.quantityDelta),
        reason: values.reason,
        notes: values.notes ? String(values.notes).trim() : null,
      }),
    onSuccess: async (result) => {
      toast.success(
        'Stock adjusted',
        `${product.sku}: ${formatNumber(result.quantityBefore)} → ${formatNumber(result.quantityAfter)}`,
      );
      await invalidateGroup('stock');
      onOpenChange(false);
    },
    onError: (error: unknown) => toastApiError(error, 'Could not adjust stock'),
  });

  const stockTakeMutation = useMutation({
    mutationFn: (values: StockTakeForm) =>
      inventoryService.stockTake(product.id, {
        countedQuantity: Number(values.countedQuantity),
        notes: values.notes ? String(values.notes).trim() : null,
      }),
    onSuccess: async (result) => {
      // A stock take that matches the book returns null — no variance, no
      // ledger row. Saying so is more useful than a generic success message.
      toast.success(
        result === null ? 'Stock take recorded' : 'Stock reconciled',
        result === null
          ? 'The counted quantity matched the system.'
          : `${product.sku}: ${formatNumber(result.quantityBefore)} → ${formatNumber(result.quantityAfter)}`,
      );
      await invalidateGroup('stock');
      onOpenChange(false);
    },
    onError: (error: unknown) => toastApiError(error, 'Could not record stock take'),
  });

  const delta = Number(adjustForm.watch('quantityDelta')) || 0;
  const counted = Number(stockTakeForm.watch('countedQuantity')) || 0;

  const projected = isStockTake ? counted : currentStock + delta;
  const variance = isStockTake ? counted - currentStock : delta;
  const wouldGoNegative = projected < 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          onSubmit={
            isStockTake
              ? stockTakeForm.handleSubmit((values) => stockTakeMutation.mutate(values))
              : adjustForm.handleSubmit((values) => adjustMutation.mutate(values))
          }
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{isStockTake ? 'Record stock take' : 'Adjust stock'}</DialogTitle>
            <DialogDescription>
              {product.name} · <span className="font-mono">{product.sku}</span>
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {/* Before -> after preview. Seeing the resulting number before
                committing is what stops a mistyped delta from becoming a
                permanent ledger entry. */}
            <div className="grid grid-cols-3 items-center gap-2 rounded-md border border-border bg-muted/50 p-3 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Current</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">
                  {formatNumber(currentStock)}
                </p>
              </div>

              <div className="flex flex-col items-center">
                {variance !== 0 ? (
                  <>
                    {variance > 0 ? (
                      <ArrowUp className="size-4 text-success" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="size-4 text-destructive" aria-hidden="true" />
                    )}
                    <span
                      className={cn(
                        'text-xs font-medium tabular-nums',
                        variance > 0 ? 'text-success' : 'text-destructive',
                      )}
                    >
                      {variance > 0 ? '+' : ''}
                      {formatNumber(variance)}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">No change</span>
                )}
              </div>

              <div>
                <p className="text-xs text-muted-foreground">After</p>
                <p
                  className={cn(
                    'mt-0.5 text-lg font-semibold tabular-nums',
                    wouldGoNegative && 'text-destructive',
                  )}
                >
                  {formatNumber(projected)}
                </p>
              </div>
            </div>

            {wouldGoNegative && (
              <p role="alert" className="text-xs font-medium text-destructive">
                Stock cannot go below zero. The server will reject this adjustment.
              </p>
            )}

            {isStockTake ? (
              <>
                <FormField
                  label="Counted quantity"
                  htmlFor="countedQuantity"
                  required
                  error={stockTakeForm.formState.errors.countedQuantity?.message}
                  hint={`Physical count for ${product.unit.toLowerCase()}`}
                >
                  <Input
                    {...stockTakeForm.register('countedQuantity')}
                    {...fieldAria(
                      'countedQuantity',
                      stockTakeForm.formState.errors.countedQuantity?.message,
                    )}
                    type="number"
                    min={0}
                    className="tabular-nums"
                    hasError={Boolean(stockTakeForm.formState.errors.countedQuantity)}
                    autoFocus
                  />
                </FormField>

                <FormField label="Notes" htmlFor="stocktake-notes">
                  <Textarea
                    {...stockTakeForm.register('notes')}
                    id="stocktake-notes"
                    rows={2}
                    placeholder="Counted by, shelf, discrepancy explanation…"
                  />
                </FormField>
              </>
            ) : (
              <>
                <FormField
                  label="Quantity change"
                  htmlFor="quantityDelta"
                  required
                  error={adjustForm.formState.errors.quantityDelta?.message}
                  hint="Positive adds stock, negative removes it"
                >
                  <Input
                    {...adjustForm.register('quantityDelta')}
                    {...fieldAria(
                      'quantityDelta',
                      adjustForm.formState.errors.quantityDelta?.message,
                      'Positive adds stock, negative removes it',
                    )}
                    type="number"
                    step={1}
                    placeholder="-3"
                    className="tabular-nums"
                    hasError={Boolean(adjustForm.formState.errors.quantityDelta)}
                    autoFocus
                  />
                </FormField>

                <FormField label="Reason" htmlFor="reason" required>
                  <Select
                    value={adjustForm.watch('reason')}
                    onValueChange={(value) =>
                      adjustForm.setValue('reason', value as MovementReason, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger id="reason">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ADJUST_REASONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Notes" htmlFor="adjust-notes">
                  <Textarea
                    {...adjustForm.register('notes')}
                    id="adjust-notes"
                    rows={2}
                    placeholder="Reference document, approver, context…"
                  />
                </FormField>
              </>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={adjustMutation.isPending || stockTakeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={adjustMutation.isPending || stockTakeMutation.isPending}
              disabled={wouldGoNegative}
            >
              {isStockTake ? 'Record count' : 'Apply adjustment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
