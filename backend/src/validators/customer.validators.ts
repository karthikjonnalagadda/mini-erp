/**
 * Customer + follow-up request schemas.
 *
 * Optional-field convention: `.optional()` alone means "may be omitted";
 * `.or(z.literal(''))` + transform means "may be omitted OR explicitly cleared".
 * The distinction matters for a PATCH — a form that submits an empty string for
 * GST must clear the value, not fail validation.
 */
import { z } from 'zod';

import {
  dateSchema,
  emailSchema,
  futureDateSchema,
  gstSchema,
  mobileSchema,
  postalCodeSchema,
  priceSchema,
  shortTextSchema,
  uuidSchema,
  withValidDateRange,
} from './common.validators';

const CUSTOMER_TYPES = ['RETAILER', 'WHOLESALER', 'DISTRIBUTOR', 'CORPORATE', 'WALK_IN'] as const;
const CUSTOMER_STATUSES = ['LEAD', 'ACTIVE', 'INACTIVE', 'BLACKLISTED'] as const;
const FOLLOW_UP_TYPES = ['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'WHATSAPP', 'OTHER'] as const;
const FOLLOW_UP_STATUSES = ['PENDING', 'COMPLETED', 'OVERDUE', 'CANCELLED'] as const;

/** Treats '' as "clear this field" rather than a validation failure. */
const optionalOrCleared = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .union([schema, z.literal('')])
    .optional()
    .transform((value) => (value === '' ? null : (value)));

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const createCustomerSchema = z.object({
  name: shortTextSchema(120, 'Customer name'),
  businessName: optionalOrCleared(shortTextSchema(160, 'Business name')),
  email: optionalOrCleared(emailSchema),
  mobile: mobileSchema,
  gstNumber: optionalOrCleared(gstSchema),
  customerType: z.enum(CUSTOMER_TYPES).default('RETAILER'),
  status: z.enum(CUSTOMER_STATUSES).default('LEAD'),
  addressLine1: optionalOrCleared(shortTextSchema(180, 'Address line 1')),
  addressLine2: optionalOrCleared(shortTextSchema(180, 'Address line 2')),
  city: optionalOrCleared(shortTextSchema(80, 'City')),
  state: optionalOrCleared(shortTextSchema(80, 'State')),
  postalCode: optionalOrCleared(postalCodeSchema),
  country: z.string().trim().max(80).default('India'),
  creditLimit: priceSchema.default(0),
  followUpDate: dateSchema.optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  /** Sales rep who owns the account. Defaults to the creator in the service. */
  ownerId: uuidSchema.optional().nullable(),
});

/**
 * PATCH semantics: every field optional, but the body must not be empty —
 * otherwise the endpoint silently succeeds while doing nothing, which hides
 * client bugs.
 */
export const updateCustomerSchema = createCustomerSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const customerListQuerySchema = withValidDateRange(
  z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().max(120).optional(),
    sortBy: z
      .enum([
        'createdAt',
        'updatedAt',
        'name',
        'businessName',
        'status',
        'customerType',
        'followUpDate',
        'outstandingAmount',
      ])
      .optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    status: z.enum(CUSTOMER_STATUSES).optional(),
    customerType: z.enum(CUSTOMER_TYPES).optional(),
    ownerId: uuidSchema.optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    followUpDue: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  }),
);

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export const createFollowUpSchema = z.object({
  type: z.enum(FOLLOW_UP_TYPES).default('CALL'),
  subject: shortTextSchema(180, 'Subject'),
  notes: z.string().trim().max(5000).optional().nullable(),
  // A follow-up you schedule in the past is a log entry, not a reminder — the
  // "complete" endpoint exists for that, so scheduling requires a future date.
  scheduledAt: futureDateSchema,
});

export const updateFollowUpSchema = z
  .object({
    type: z.enum(FOLLOW_UP_TYPES).optional(),
    status: z.enum(FOLLOW_UP_STATUSES).optional(),
    subject: shortTextSchema(180, 'Subject').optional(),
    notes: z.string().trim().max(5000).optional().nullable(),
    outcome: z.string().trim().max(5000).optional().nullable(),
    scheduledAt: dateSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const completeFollowUpSchema = z.object({
  outcome: shortTextSchema(5000, 'Outcome'),
  /** Optionally chain the next activity in one round-trip. */
  nextFollowUpDate: futureDateSchema.optional().nullable(),
});

export const followUpListQuerySchema = withValidDateRange(
  z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    customerId: uuidSchema.optional(),
    status: z.enum(FOLLOW_UP_STATUSES).optional(),
    type: z.enum(FOLLOW_UP_TYPES).optional(),
    createdById: uuidSchema.optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  }),
);

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CustomerListQueryInput = z.infer<typeof customerListQuerySchema>;
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;
export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>;
export type CompleteFollowUpInput = z.infer<typeof completeFollowUpSchema>;
export type FollowUpListQueryInput = z.infer<typeof followUpListQuerySchema>;
