/**
 * Product create/edit dialog.
 *
 * `openingStock` appears on CREATE only. On edit the field is absent entirely,
 * because the server refuses to change stock outside the movement ledger — an
 * editable quantity here would either be silently ignored (confusing) or
 * bypass the audit trail (dangerous).
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';

import { ApiRequestError } from '@/api/client';
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
import { productService } from '@/services/product.service';
import type { ProductPayload } from '@/services/product.service';
import type { CategoryOption, Product } from '@/types/api.types';
import { formatCurrency } from '@/utils/format';

const UNITS = ['PCS', 'BOX', 'CTN', 'KG', 'GM', 'LTR', 'ML', 'MTR', 'SET', 'PKT'] as const;

const productSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .min(3, 'SKU must be at least 3 characters')
      .max(40)
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9\-_]*$/, 'Use letters, digits, - and _ only'),
    name: z.string().trim().min(1, 'Product name is required').max(160),
    description: z.union([z.string().trim().max(5000), z.literal('')]).optional(),
    categoryId: z.string().uuid('Select a category'),
    unitPrice: z.coerce.number().nonnegative('Price cannot be negative').max(999_999_999),
    costPrice: z.coerce.number().nonnegative('Cost cannot be negative').max(999_999_999),
    taxRate: z.coerce.number().min(0).max(100, 'Tax rate cannot exceed 100%'),
    unit: z.enum(UNITS),
    minimumStock: z.coerce.number().int('Whole units only').nonnegative(),
    openingStock: z.coerce.number().int('Whole units only').nonnegative(),
    warehouseLocation: z.union([z.string().trim().max(80), z.literal('')]).optional(),
    isActive: z.boolean(),
  })
  // Mirrors the server rule. Selling below cost is usually a data-entry slip;
  // zero cost is legitimate (not yet captured), so it is exempt.
  .refine((data) => data.costPrice === 0 || data.costPrice <= data.unitPrice, {
    path: ['costPrice'],
    message: 'Cost price should not exceed the selling price',
  });

type ProductFormValues = z.input<typeof productSchema>;

const EMPTY_FORM: ProductFormValues = {
  sku: '',
  name: '',
  description: '',
  categoryId: '',
  unitPrice: 0,
  costPrice: 0,
  taxRate: 18,
  unit: 'PCS',
  minimumStock: 0,
  openingStock: 0,
  warehouseLocation: '',
  isActive: true,
};

export interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  categories: CategoryOption[];
}

export const ProductFormDialog = ({
  open,
  onOpenChange,
  product,
  categories,
}: ProductFormDialogProps): React.JSX.Element => {
  const isEdit = product !== null;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: EMPTY_FORM,
  });

  React.useEffect(() => {
    if (!open) return;

    reset(
      product
        ? {
            sku: product.sku,
            name: product.name,
            description: product.description ?? '',
            categoryId: product.category.id,
            unitPrice: product.unitPrice,
            costPrice: product.costPrice,
            taxRate: product.taxRate,
            unit: (UNITS as readonly string[]).includes(product.unit)
              ? (product.unit as (typeof UNITS)[number])
              : 'PCS',
            minimumStock: product.minimumStock,
            openingStock: 0,
            warehouseLocation: product.stock.warehouseLocation ?? '',
            isActive: product.isActive,
          }
        : EMPTY_FORM,
    );
  }, [open, product, reset]);

  const mutation = useMutation({
    mutationFn: (values: ProductFormValues) => {
      const payload: ProductPayload = {
        sku: String(values.sku).toUpperCase(),
        name: String(values.name).trim(),
        description: values.description ? String(values.description).trim() : null,
        categoryId: String(values.categoryId),
        unitPrice: Number(values.unitPrice),
        costPrice: Number(values.costPrice),
        taxRate: Number(values.taxRate),
        unit: values.unit,
        minimumStock: Number(values.minimumStock),
        isActive: Boolean(values.isActive),
        warehouseLocation: values.warehouseLocation
          ? String(values.warehouseLocation).trim()
          : null,
      };

      // Opening stock is a create-only concern — see the module docblock.
      if (!isEdit) payload.openingStock = Number(values.openingStock);

      return isEdit ? productService.update(product.id, payload) : productService.create(payload);
    },

    onSuccess: async (saved) => {
      toast.success(isEdit ? 'Product updated' : 'Product created', saved.sku);
      await invalidateGroup('catalogue');
      onOpenChange(false);
    },

    onError: (mutationError: unknown) => {
      if (mutationError instanceof ApiRequestError) {
        if (mutationError.code === 'DUPLICATE_RESOURCE') {
          const field = (mutationError.details as { field?: string } | undefined)?.field;
          if (field === 'sku' || field === 'barcode') {
            setError('sku', { message: mutationError.message });
            return;
          }
        }
        if (mutationError.code === 'VALIDATION_ERROR') {
          for (const fieldError of mutationError.fieldErrors) {
            if (fieldError.field in EMPTY_FORM) {
              setError(fieldError.field as keyof ProductFormValues, {
                message: fieldError.message,
              });
            }
          }
          return;
        }
      }
      toastApiError(mutationError, isEdit ? 'Could not update product' : 'Could not create product');
    },
  });

  const unitPrice = Number(watch('unitPrice')) || 0;
  const taxRate = Number(watch('taxRate')) || 0;
  const costPrice = Number(watch('costPrice')) || 0;

  // Live commercial feedback — margin errors are much easier to catch here than
  // on a month-end report.
  const priceWithTax = unitPrice * (1 + taxRate / 100);
  const marginPercent = unitPrice > 0 && costPrice > 0
    ? ((unitPrice - costPrice) / unitPrice) * 100
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit product' : 'New product'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Stock quantity is changed from the Inventory screen so every change is recorded in the ledger.'
                : 'Opening stock is posted as an OPENING_BALANCE movement, not written directly.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="SKU"
                htmlFor="sku"
                required
                error={errors.sku?.message}
                hint="Unique stock-keeping code"
              >
                <Input
                  {...register('sku')}
                  {...fieldAria('sku', errors.sku?.message, 'Unique stock-keeping code')}
                  placeholder="ELE-WIR-1SQ"
                  className="font-mono uppercase"
                  hasError={Boolean(errors.sku)}
                />
              </FormField>

              <FormField label="Category" htmlFor="categoryId" required error={errors.categoryId?.message}>
                <Select
                  value={watch('categoryId')}
                  onValueChange={(value) => setValue('categoryId', value, { shouldValidate: true })}
                >
                  <SelectTrigger id="categoryId" hasError={Boolean(errors.categoryId)}>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField label="Product name" htmlFor="name" required error={errors.name?.message}>
              <Input
                {...register('name')}
                {...fieldAria('name', errors.name?.message)}
                placeholder="Copper Wire 1.0 sq mm (90m coil)"
                hasError={Boolean(errors.name)}
              />
            </FormField>

            <FormField label="Description" htmlFor="description">
              <Textarea
                {...register('description')}
                id="description"
                rows={2}
                placeholder="Specification, grade, packaging…"
              />
            </FormField>

            <fieldset>
              <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pricing
              </legend>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  label="Selling price"
                  htmlFor="unitPrice"
                  required
                  error={errors.unitPrice?.message}
                >
                  <Input
                    {...register('unitPrice')}
                    {...fieldAria('unitPrice', errors.unitPrice?.message)}
                    type="number"
                    min={0}
                    step="0.01"
                    className="tabular-nums"
                    hasError={Boolean(errors.unitPrice)}
                  />
                </FormField>

                <FormField label="Cost price" htmlFor="costPrice" error={errors.costPrice?.message}>
                  <Input
                    {...register('costPrice')}
                    {...fieldAria('costPrice', errors.costPrice?.message)}
                    type="number"
                    min={0}
                    step="0.01"
                    className="tabular-nums"
                    hasError={Boolean(errors.costPrice)}
                  />
                </FormField>

                <FormField label="GST %" htmlFor="taxRate" error={errors.taxRate?.message}>
                  <Input
                    {...register('taxRate')}
                    {...fieldAria('taxRate', errors.taxRate?.message)}
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    className="tabular-nums"
                    hasError={Boolean(errors.taxRate)}
                  />
                </FormField>
              </div>

              {unitPrice > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-muted px-3 py-2 text-xs">
                  <span className="text-muted-foreground">
                    Price incl. tax{' '}
                    <strong className="tabular-nums text-foreground">
                      {formatCurrency(priceWithTax)}
                    </strong>
                  </span>
                  {marginPercent !== null && (
                    <span className="text-muted-foreground">
                      Margin{' '}
                      <strong className="tabular-nums text-foreground">
                        {marginPercent.toFixed(1)}%
                      </strong>
                    </span>
                  )}
                </div>
              )}
            </fieldset>

            <fieldset>
              <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Stock
              </legend>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Unit" htmlFor="unit">
                  <Select
                    value={watch('unit')}
                    onValueChange={(value) =>
                      setValue('unit', value as (typeof UNITS)[number], { shouldDirty: true })
                    }
                  >
                    <SelectTrigger id="unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField
                  label="Reorder level"
                  htmlFor="minimumStock"
                  error={errors.minimumStock?.message}
                  hint="Low-stock warning threshold"
                >
                  <Input
                    {...register('minimumStock')}
                    {...fieldAria(
                      'minimumStock',
                      errors.minimumStock?.message,
                      'Low-stock warning threshold',
                    )}
                    type="number"
                    min={0}
                    className="tabular-nums"
                    hasError={Boolean(errors.minimumStock)}
                  />
                </FormField>

                {/* Create-only. */}
                {!isEdit ? (
                  <FormField
                    label="Opening stock"
                    htmlFor="openingStock"
                    error={errors.openingStock?.message}
                    hint="Recorded as a stock movement"
                  >
                    <Input
                      {...register('openingStock')}
                      {...fieldAria(
                        'openingStock',
                        errors.openingStock?.message,
                        'Recorded as a stock movement',
                      )}
                      type="number"
                      min={0}
                      className="tabular-nums"
                      hasError={Boolean(errors.openingStock)}
                    />
                  </FormField>
                ) : (
                  <FormField label="Current stock" htmlFor="currentStock" hint="Adjust from Inventory">
                    <Input
                      id="currentStock"
                      value={product.stock.onHand}
                      readOnly
                      disabled
                      className="tabular-nums"
                    />
                  </FormField>
                )}
              </div>

              <div className="mt-4">
                <FormField label="Warehouse location" htmlFor="warehouseLocation">
                  <Input
                    {...register('warehouseLocation')}
                    id="warehouseLocation"
                    placeholder="WH-A"
                  />
                </FormField>
              </div>

              <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  {...register('isActive')}
                  className="size-4 rounded border-input accent-primary"
                />
                <span className="text-foreground">Active</span>
                <span className="text-xs text-muted-foreground">
                  — inactive products cannot be added to a challan
                </span>
              </label>
            </fieldset>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting || mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {isEdit ? 'Save changes' : 'Create product'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
