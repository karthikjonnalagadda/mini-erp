/**
 * Sales challan request schemas.
 *
 * The interesting rule here is the duplicate-product check. The database has a
 * `@@unique([challanId, productId])` constraint, so a duplicate would fail
 * anyway — but as a raw Prisma P2002 with an opaque message. Catching it in Zod
 * produces a field-level error the form can attach to the offending row.
 */
import { z } from 'zod';

import {
  dateSchema,
  percentageSchema,
  priceSchema,
  quantitySchema,
  shortTextSchema,
  uuidSchema,
  withValidDateRange,
} from './common.validators';

const CHALLAN_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;

/** Indian commercial vehicle registration, e.g. MH12AB1234. */
const vehicleNumberSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/, 'Enter a valid vehicle number, e.g. MH12AB1234'),
  );

export const challanItemSchema = z.object({
  productId: uuidSchema,
  quantity: quantitySchema,
  /**
   * Optional price override for negotiated deals. When omitted the service uses
   * the catalogue price — the client is never trusted to supply a default.
   */
  unitPrice: priceSchema.optional(),
  discountPercent: percentageSchema.default(0),
});

const itemsSchema = z
  .array(challanItemSchema)
  .min(1, 'Add at least one product to the challan')
  .max(200, 'A challan may contain at most 200 line items')
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'productId'],
          message: 'This product is already on the challan — increase its quantity instead',
        });
      }
      seen.add(item.productId);
    });
  });

export const createChallanSchema = z
  .object({
    customerId: uuidSchema,
    challanDate: dateSchema.optional(),
    dispatchDate: dateSchema.optional().nullable(),
    shippingAddress: z.string().trim().max(1000).optional().nullable(),
    transporterName: z.string().trim().max(120).optional().nullable(),
    vehicleNumber: vehicleNumberSchema.optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    items: itemsSchema,
  })
  .superRefine((data, ctx) => {
    if (data.dispatchDate && data.challanDate && data.dispatchDate < data.challanDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dispatchDate'],
        message: 'Dispatch date cannot be earlier than the challan date',
      });
    }
  });

/**
 * Updates apply to DRAFT challans only (enforced in the service). `items`, when
 * present, replaces the whole line set — a partial line update would leave the
 * stored totals inconsistent with the lines.
 */
export const updateChallanSchema = z
  .object({
    customerId: uuidSchema.optional(),
    challanDate: dateSchema.optional(),
    dispatchDate: dateSchema.optional().nullable(),
    shippingAddress: z.string().trim().max(1000).optional().nullable(),
    transporterName: z.string().trim().max(120).optional().nullable(),
    vehicleNumber: vehicleNumberSchema.optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    items: itemsSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const confirmChallanSchema = z.object({
  dispatchDate: dateSchema.optional().nullable(),
  transporterName: z.string().trim().max(120).optional().nullable(),
  vehicleNumber: vehicleNumberSchema.optional().nullable(),
});

export const cancelChallanSchema = z.object({
  reason: shortTextSchema(500, 'Cancellation reason'),
});

export const challanListQuerySchema = withValidDateRange(
  z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().max(120).optional(),
    sortBy: z
      .enum(['challanDate', 'createdAt', 'updatedAt', 'totalAmount', 'challanNumber', 'status'])
      .optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    status: z.enum(CHALLAN_STATUSES).optional(),
    customerId: uuidSchema.optional(),
    createdById: uuidSchema.optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    minAmount: z.coerce.number().nonnegative().optional(),
    maxAmount: z.coerce.number().nonnegative().optional(),
  }),
);

export type CreateChallanInput = z.infer<typeof createChallanSchema>;
export type UpdateChallanInput = z.infer<typeof updateChallanSchema>;
export type ConfirmChallanInput = z.infer<typeof confirmChallanSchema>;
export type CancelChallanInput = z.infer<typeof cancelChallanSchema>;
export type ChallanListQueryInput = z.infer<typeof challanListQuerySchema>;
