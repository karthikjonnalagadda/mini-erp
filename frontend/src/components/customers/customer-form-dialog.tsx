/**
 * Customer create/edit dialog.
 *
 * One component serves both operations. The alternative — separate Create and
 * Edit dialogs — duplicates twenty fields and their validation, and the two
 * copies drift within a sprint.
 *
 * The Zod schema here MIRRORS the server's, deliberately rather than
 * accidentally: client validation is for fast feedback, the server's is the
 * authority. Where they could disagree (uniqueness of a mobile number), only
 * the server can decide, and its 409 is mapped back onto the offending field.
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
import { customerService } from '@/services/customer.service';
import type { CustomerPayload } from '@/services/customer.service';
import type { Customer, CustomerStatus, CustomerType } from '@/types/api.types';

/** `''` is treated as "not provided" so optional fields can be cleared. */
const optionalString = (schema: z.ZodString) =>
  z.union([schema, z.literal('')]).optional();

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  businessName: optionalString(z.string().trim().max(160)),
  email: optionalString(z.string().trim().email('Enter a valid email address').max(160)),
  mobile: z
    .string()
    .trim()
    .regex(/^(?:\+91|91|0)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  gstNumber: optionalString(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
        'Enter a valid GSTIN, e.g. 27AAPFU0939F1ZV',
      ),
  ),
  customerType: z.enum(['RETAILER', 'WHOLESALER', 'DISTRIBUTOR', 'CORPORATE', 'WALK_IN']),
  status: z.enum(['LEAD', 'ACTIVE', 'INACTIVE', 'BLACKLISTED']),
  addressLine1: optionalString(z.string().trim().max(180)),
  city: optionalString(z.string().trim().max(80)),
  state: optionalString(z.string().trim().max(80)),
  postalCode: optionalString(z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit PIN code')),
  creditLimit: z.coerce.number().nonnegative('Credit limit cannot be negative').max(999_999_999),
  notes: optionalString(z.string().trim().max(5000)),
});

type CustomerFormValues = z.input<typeof customerSchema>;

const CUSTOMER_TYPES: Array<{ value: CustomerType; label: string }> = [
  { value: 'RETAILER', label: 'Retailer' },
  { value: 'WHOLESALER', label: 'Wholesaler' },
  { value: 'DISTRIBUTOR', label: 'Distributor' },
  { value: 'CORPORATE', label: 'Corporate' },
  { value: 'WALK_IN', label: 'Walk-in' },
];

const CUSTOMER_STATUSES: Array<{ value: CustomerStatus; label: string }> = [
  { value: 'LEAD', label: 'Lead' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'BLACKLISTED', label: 'Blacklisted' },
];

const EMPTY_FORM: CustomerFormValues = {
  name: '',
  businessName: '',
  email: '',
  mobile: '',
  gstNumber: '',
  customerType: 'RETAILER',
  status: 'LEAD',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  creditLimit: 0,
  notes: '',
};

export interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` creates; a customer edits. */
  customer: Customer | null;
  onSaved?: (customer: Customer) => void;
}

/** Strips empty strings to `null` so the API clears rather than stores "". */
const toPayload = (values: CustomerFormValues): CustomerPayload => {
  const clean = (value: string | undefined): string | null =>
    value && value.trim().length > 0 ? value.trim() : null;

  return {
    name: values.name.trim(),
    businessName: clean(values.businessName),
    email: clean(values.email),
    mobile: values.mobile.trim(),
    gstNumber: clean(values.gstNumber),
    customerType: values.customerType,
    status: values.status,
    addressLine1: clean(values.addressLine1),
    city: clean(values.city),
    state: clean(values.state),
    postalCode: clean(values.postalCode),
    creditLimit: Number(values.creditLimit),
    notes: clean(values.notes),
  };
};

export const CustomerFormDialog = ({
  open,
  onOpenChange,
  customer,
  onSaved,
}: CustomerFormDialogProps): React.JSX.Element => {
  const isEdit = customer !== null;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: EMPTY_FORM,
  });

  // Repopulate whenever the dialog opens or the target customer changes.
  // Without this, opening Edit after Create would show the stale create values.
  React.useEffect(() => {
    if (!open) return;

    reset(
      customer
        ? {
            name: customer.name,
            businessName: customer.businessName ?? '',
            email: customer.email ?? '',
            mobile: customer.mobile,
            gstNumber: customer.gstNumber ?? '',
            customerType: customer.customerType,
            status: customer.status,
            addressLine1: customer.address.line1 ?? '',
            city: customer.address.city ?? '',
            state: customer.address.state ?? '',
            postalCode: customer.address.postalCode ?? '',
            creditLimit: customer.creditLimit,
            notes: customer.notes ?? '',
          }
        : EMPTY_FORM,
    );
  }, [open, customer, reset]);

  const mutation = useMutation({
    mutationFn: (values: CustomerFormValues) =>
      isEdit
        ? customerService.update(customer.id, toPayload(values))
        : customerService.create(toPayload(values)),

    onSuccess: async (saved) => {
      toast.success(isEdit ? 'Customer updated' : 'Customer created', saved.code);
      await invalidateGroup('customer');
      onSaved?.(saved);
      onOpenChange(false);
    },

    onError: (mutationError: unknown) => {
      if (mutationError instanceof ApiRequestError) {
        // 409 identifies the conflicting field — attach it there rather than
        // toasting, so the user sees which input to change.
        if (mutationError.code === 'DUPLICATE_RESOURCE') {
          const field = (mutationError.details as { field?: string } | undefined)?.field;
          if (field && field in EMPTY_FORM) {
            setError(field as keyof CustomerFormValues, { message: mutationError.message });
            return;
          }
        }

        // 422 carries per-field messages from the server's Zod schema.
        if (mutationError.code === 'VALIDATION_ERROR') {
          for (const fieldError of mutationError.fieldErrors) {
            if (fieldError.field in EMPTY_FORM) {
              setError(fieldError.field as keyof CustomerFormValues, {
                message: fieldError.message,
              });
            }
          }
          return;
        }
      }

      toastApiError(mutationError, isEdit ? 'Could not update customer' : 'Could not create customer');
    },
  });

  const customerType = watch('customerType');
  const status = watch('status');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit customer' : 'New customer'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? `Update the details for ${customer.code}.`
                : 'Add a customer account. A customer code is assigned automatically.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-5">
            <fieldset className="space-y-4">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Identity
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Contact name" htmlFor="name" required error={errors.name?.message}>
                  <Input
                    {...register('name')}
                    {...fieldAria('name', errors.name?.message)}
                    placeholder="Suresh Patil"
                    hasError={Boolean(errors.name)}
                  />
                </FormField>

                <FormField
                  label="Business name"
                  htmlFor="businessName"
                  error={errors.businessName?.message}
                >
                  <Input
                    {...register('businessName')}
                    {...fieldAria('businessName', errors.businessName?.message)}
                    placeholder="Patil Electricals"
                    hasError={Boolean(errors.businessName)}
                  />
                </FormField>

                <FormField
                  label="Mobile"
                  htmlFor="mobile"
                  required
                  error={errors.mobile?.message}
                  hint="10-digit Indian mobile number"
                >
                  <Input
                    {...register('mobile')}
                    {...fieldAria('mobile', errors.mobile?.message, '10-digit Indian mobile number')}
                    type="tel"
                    inputMode="numeric"
                    placeholder="9876543210"
                    hasError={Boolean(errors.mobile)}
                  />
                </FormField>

                <FormField label="Email" htmlFor="email" error={errors.email?.message}>
                  <Input
                    {...register('email')}
                    {...fieldAria('email', errors.email?.message)}
                    type="email"
                    placeholder="contact@business.in"
                    hasError={Boolean(errors.email)}
                  />
                </FormField>

                <FormField
                  label="GSTIN"
                  htmlFor="gstNumber"
                  error={errors.gstNumber?.message}
                  hint="15-character GST identification number"
                >
                  <Input
                    {...register('gstNumber')}
                    {...fieldAria('gstNumber', errors.gstNumber?.message, '15-character GSTIN')}
                    placeholder="27AAPFU0939F1ZV"
                    className="font-mono uppercase"
                    hasError={Boolean(errors.gstNumber)}
                  />
                </FormField>

                <FormField
                  label="Credit limit"
                  htmlFor="creditLimit"
                  error={errors.creditLimit?.message}
                >
                  <Input
                    {...register('creditLimit')}
                    {...fieldAria('creditLimit', errors.creditLimit?.message)}
                    type="number"
                    min={0}
                    step="0.01"
                    className="tabular-nums"
                    hasError={Boolean(errors.creditLimit)}
                  />
                </FormField>
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Classification
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Customer type" htmlFor="customerType">
                  <Select
                    value={customerType}
                    onValueChange={(value) =>
                      setValue('customerType', value as CustomerType, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger id="customerType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_TYPES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField
                  label="Status"
                  htmlFor="status"
                  hint={
                    status === 'BLACKLISTED'
                      ? 'Blacklisted customers cannot be issued challans'
                      : undefined
                  }
                >
                  <Select
                    value={status}
                    onValueChange={(value) =>
                      setValue('status', value as CustomerStatus, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_STATUSES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Address
              </legend>

              <FormField label="Street address" htmlFor="addressLine1" error={errors.addressLine1?.message}>
                <Input
                  {...register('addressLine1')}
                  {...fieldAria('addressLine1', errors.addressLine1?.message)}
                  placeholder="221, Industrial Estate"
                  hasError={Boolean(errors.addressLine1)}
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="City" htmlFor="city" error={errors.city?.message}>
                  <Input
                    {...register('city')}
                    {...fieldAria('city', errors.city?.message)}
                    placeholder="Pune"
                    hasError={Boolean(errors.city)}
                  />
                </FormField>

                <FormField label="State" htmlFor="state" error={errors.state?.message}>
                  <Input
                    {...register('state')}
                    {...fieldAria('state', errors.state?.message)}
                    placeholder="Maharashtra"
                    hasError={Boolean(errors.state)}
                  />
                </FormField>

                <FormField label="PIN code" htmlFor="postalCode" error={errors.postalCode?.message}>
                  <Input
                    {...register('postalCode')}
                    {...fieldAria('postalCode', errors.postalCode?.message)}
                    inputMode="numeric"
                    placeholder="411001"
                    className="tabular-nums"
                    hasError={Boolean(errors.postalCode)}
                  />
                </FormField>
              </div>
            </fieldset>

            <FormField label="Notes" htmlFor="notes" error={errors.notes?.message}>
              <Textarea
                {...register('notes')}
                {...fieldAria('notes', errors.notes?.message)}
                rows={3}
                placeholder="Payment terms, delivery preferences, key contacts…"
                hasError={Boolean(errors.notes)}
              />
            </FormField>
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
              {isEdit ? 'Save changes' : 'Create customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
