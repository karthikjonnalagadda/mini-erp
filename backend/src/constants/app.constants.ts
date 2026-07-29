/**
 * Cross-cutting application constants.
 * Anything a reviewer might call a "magic number" belongs in this file.
 */

/** Pagination defaults and hard limits (protects the DB from `?limit=100000`). */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
} as const;

/** Sort directions accepted by every list endpoint. */
export const SORT_ORDER = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDER)[number];

/** Business-key prefixes for generated document numbers. */
export const SEQUENCE_KEYS = {
  SALES_CHALLAN: 'SALES_CHALLAN',
  CUSTOMER: 'CUSTOMER',
} as const;

export const SEQUENCE_PREFIX = {
  SALES_CHALLAN: 'CH',
  CUSTOMER: 'CUST',
} as const;

/** Polymorphic `referenceType` values written onto stock movements. */
export const REFERENCE_TYPE = {
  SALES_CHALLAN: 'SALES_CHALLAN',
  MANUAL: 'MANUAL',
  OPENING: 'OPENING',
} as const;

/** Entity names used by the audit trail. Keep in sync with the UI filters. */
export const AUDIT_ENTITY = {
  USER: 'User',
  ROLE: 'Role',
  CUSTOMER: 'Customer',
  CUSTOMER_FOLLOW_UP: 'CustomerFollowUp',
  CATEGORY: 'Category',
  PRODUCT: 'Product',
  INVENTORY: 'Inventory',
  STOCK_MOVEMENT: 'StockMovement',
  SALES_CHALLAN: 'SalesChallan',
  AUTH: 'Auth',
} as const;

/**
 * Keys scrubbed from audit payloads and request logs.
 * Matching is case-insensitive and substring-based.
 */
export const REDACTED_KEYS = [
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'secret',
  'apikey',
] as const;

export const REDACTED_PLACEHOLDER = '[REDACTED]';

/** Maximum accepted JSON body size. */
export const MAX_JSON_BODY_SIZE = '1mb';

/** Header used to correlate logs, audit rows and client error reports. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Cookie carrying the refresh token (httpOnly — never readable from JS). */
export const REFRESH_TOKEN_COOKIE = 'erp_refresh_token';

/** Stock guard-rails. */
export const STOCK = {
  MIN_QUANTITY: 1,
  MAX_QUANTITY_PER_LINE: 1_000_000,
} as const;

/** Money/tax rounding. All monetary maths is done in integer paise then scaled. */
export const MONEY = {
  SCALE: 2,
  MAX_AMOUNT: 999_999_999.99,
} as const;
