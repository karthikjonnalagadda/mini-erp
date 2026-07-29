/**
 * Reusable Zod primitives.
 *
 * Every domain rule that appears in more than one schema lives here exactly
 * once. When the GST format changes or we start accepting international phone
 * numbers, there is a single line to edit — not fourteen.
 *
 * Note the heavy use of `z.coerce` for query parameters: everything arriving on
 * a query string is a string, so schemas must coerce before validating or
 * `?page=2` fails a `z.number()` check for the wrong reason.
 */
import { z } from 'zod';

import { PAGINATION, SORT_ORDER } from '../constants/app.constants';
import { normalizeBusinessKey, normalizeEmail, normalizePhone } from '../utils/sanitize';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid('Must be a valid UUID');

/** `/:id` route params. Used by every detail/update/delete endpoint. */
export const idParamSchema = z.object({
  id: uuidSchema,
});

export const customerIdParamSchema = z.object({
  customerId: uuidSchema,
});

// ---------------------------------------------------------------------------
// Contact details
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string()
  .trim()
  .min(5, 'Email is too short')
  .max(160, 'Email must be at most 160 characters')
  .email('Enter a valid email address')
  .transform(normalizeEmail);

/**
 * Indian mobile number: optional +91 / 0 prefix, then a 10-digit number that
 * must start with 6-9 (the only valid leading digits for Indian mobiles).
 */
export const mobileSchema = z
  .string()
  .trim()
  .transform(normalizePhone)
  .pipe(
    z
      .string()
      .regex(
        /^(?:\+91|91|0)?[6-9]\d{9}$/,
        'Enter a valid 10-digit Indian mobile number',
      ),
  );

/** Landline or mobile, used for the softer "phone" field on users. */
export const phoneSchema = z
  .string()
  .trim()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\+?\d{6,15}$/, 'Enter a valid phone number'));

/**
 * GSTIN — 15 characters: 2-digit state code, 10-char PAN, 1 entity digit,
 * a literal 'Z', then a checksum character.
 * e.g. 27AAPFU0939F1ZV
 */
export const gstSchema = z
  .string()
  .trim()
  .transform(normalizeBusinessKey)
  .pipe(
    z
      .string()
      .length(15, 'A GSTIN is exactly 15 characters')
      .regex(
        /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
        'Enter a valid GSTIN, e.g. 27AAPFU0939F1ZV',
      ),
  );

export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter a valid 6-digit PIN code');

// ---------------------------------------------------------------------------
// Commercial values
// ---------------------------------------------------------------------------

/** Money. Rejects negatives and enforces at most 2 decimal places. */
export const priceSchema = z.coerce
  .number({ invalid_type_error: 'Price must be a number' })
  .nonnegative('Price cannot be negative')
  .max(999_999_999.99, 'Price exceeds the maximum allowed value')
  .refine(
    (value) => Number.isInteger(Math.round(value * 100)) && (value * 100) % 1 < 1e-6,
    'Price may have at most 2 decimal places',
  );

/** Whole units. Stock is never fractional in this system. */
export const quantitySchema = z.coerce
  .number({ invalid_type_error: 'Quantity must be a number' })
  .int('Quantity must be a whole number')
  .positive('Quantity must be greater than zero')
  .max(1_000_000, 'Quantity exceeds the maximum allowed per line');

/** Allows zero — used for minimum-stock thresholds and opening balances. */
export const nonNegativeIntSchema = z.coerce
  .number({ invalid_type_error: 'Must be a number' })
  .int('Must be a whole number')
  .nonnegative('Cannot be negative')
  .max(100_000_000, 'Value exceeds the maximum allowed');

export const percentageSchema = z.coerce
  .number({ invalid_type_error: 'Must be a number' })
  .min(0, 'Cannot be negative')
  .max(100, 'Cannot exceed 100%');

/** Signed delta for stock adjustments — zero is meaningless, so it is rejected. */
export const stockDeltaSchema = z.coerce
  .number({ invalid_type_error: 'Adjustment must be a number' })
  .int('Adjustment must be a whole number')
  .refine((value) => value !== 0, 'Adjustment cannot be zero')
  .refine((value) => Math.abs(value) <= 1_000_000, 'Adjustment exceeds the maximum allowed');

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export const shortTextSchema = (max: number, label = 'Value') =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

export const longTextSchema = (max = 5000) => z.string().trim().max(max).optional();

/** SKU: uppercase alphanumeric with dashes/underscores, normalised on the way in. */
export const skuSchema = z
  .string()
  .trim()
  .min(3, 'SKU must be at least 3 characters')
  .max(40, 'SKU must be at most 40 characters')
  .transform(normalizeBusinessKey)
  .pipe(
    z.string().regex(/^[A-Z0-9][A-Z0-9\-_]*$/, 'SKU may contain only letters, digits, - and _'),
  );

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Accepts an ISO-8601 string or a Date, always yields a Date. */
export const dateSchema = z.coerce.date({ invalid_type_error: 'Enter a valid date' });

/** For fields that must not be backdated, e.g. a scheduled follow-up. */
export const futureDateSchema = dateSchema.refine(
  (value) => value.getTime() > Date.now() - 60_000, // 60s clock-skew tolerance
  'Date must be in the future',
);

/** For fields that cannot be in the future, e.g. a document date. */
export const pastOrPresentDateSchema = dateSchema.refine(
  (value) => value.getTime() <= Date.now() + 60_000,
  'Date cannot be in the future',
);

// ---------------------------------------------------------------------------
// List queries
// ---------------------------------------------------------------------------

export const sortOrderSchema = z.enum(SORT_ORDER).default('desc');

/**
 * Base query every list endpoint extends with its own `sortBy` enum and filters.
 * `limit` is clamped by the schema itself, so an out-of-range value is corrected
 * rather than rejected — friendlier for a UI that remembers a stale page size.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .default(PAGINATION.DEFAULT_LIMIT)
    .transform((value) => Math.min(value, PAGINATION.MAX_LIMIT)),
  search: z.string().trim().max(120).optional(),
  sortOrder: sortOrderSchema,
});

/** Inclusive date-range filter shared by the challan and movement listings. */
export const dateRangeQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

/**
 * Cross-field guard: `dateFrom` must not be after `dateTo`. Applied with
 * `.superRefine` at the schema level so the error attaches to the right field.
 */
export const withValidDateRange = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((value, ctx) => {
    const { dateFrom, dateTo } = value as { dateFrom?: Date; dateTo?: Date };
    if (dateFrom && dateTo && dateFrom > dateTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateFrom'],
        message: 'Start date must be before end date',
      });
    }
  });

/**
 * Password policy.
 *
 * Length is the dominant factor in resistance to offline cracking, so the floor
 * is 8 with a composition requirement rather than a shorter password with
 * elaborate rules. The 72-byte ceiling is bcrypt's hard limit — input beyond it
 * is silently truncated by the algorithm, which would make two different
 * passwords equivalent. We reject instead of truncating.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a number');

/** Coerces "true"/"false"/"1"/"0" query strings into real booleans. */
export const booleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');
