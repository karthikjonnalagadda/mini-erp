/**
 * Display formatting.
 *
 * Centralised so that a currency or date renders identically in a table, a
 * card and a PDF preview. Every function tolerates null/undefined and returns a
 * dash — a table cell showing "NaN" or "Invalid Date" is worse than an empty one.
 */
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

const EM_DASH = '—';

// ---------------------------------------------------------------------------
// Numbers & money
// ---------------------------------------------------------------------------

/**
 * Indian-format currency. `en-IN` groups as 1,23,456.78 (lakh/crore), which is
 * what users in this market expect — western grouping reads as a typo to them.
 */
export const formatCurrency = (
  value: number | null | undefined,
  options: { compact?: boolean; showSymbol?: boolean } = {},
): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;

  const { compact = false, showSymbol = true } = options;

  // Compact form for dashboard tiles, where "₹12.4L" fits and "₹12,40,000.00"
  // does not.
  if (compact && Math.abs(value) >= 100_000) {
    const inCrore = Math.abs(value) >= 10_000_000;
    const scaled = inCrore ? value / 10_000_000 : value / 100_000;
    const suffix = inCrore ? 'Cr' : 'L';
    return `${showSymbol ? '₹' : ''}${scaled.toFixed(2)}${suffix}`;
  }

  return new Intl.NumberFormat('en-IN', {
    style: showSymbol ? 'currency' : 'decimal',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export const formatNumber = (
  value: number | null | undefined,
  options: { compact?: boolean; decimals?: number } = {},
): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;

  const { compact = false, decimals = 0 } = options;

  return new Intl.NumberFormat('en-IN', {
    notation: compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

export const formatPercent = (value: number | null | undefined, decimals = 1): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return `${value >= 0 ? '' : ''}${value.toFixed(decimals)}%`;
};

/** Applies the `format` discriminator carried by dashboard metrics. */
export const formatMetric = (
  value: number,
  metricFormat: 'number' | 'currency' | 'percent',
): string => {
  switch (metricFormat) {
    case 'currency':
      return formatCurrency(value, { compact: true });
    case 'percent':
      return formatPercent(value);
    default:
      return formatNumber(value, { compact: true });
  }
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Parses an ISO string or Date, returning null rather than an Invalid Date. */
const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = typeof value === 'string' ? parseISO(value) : value;
  return isValid(parsed) ? parsed : null;
};

export const formatDate = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy') : EM_DASH;
};

export const formatDateTime = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy, HH:mm') : EM_DASH;
};

export const formatTime = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? format(date, 'HH:mm') : EM_DASH;
};

/** "3 days ago" — used in activity feeds where precision matters less than recency. */
export const formatRelative = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? formatDistanceToNow(date, { addSuffix: true }) : EM_DASH;
};

/** `yyyy-MM-dd`, the value format required by `<input type="date">`. */
export const toDateInputValue = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd') : '';
};

/** `yyyy-MM-dd'T'HH:mm`, required by `<input type="datetime-local">`. */
export const toDateTimeInputValue = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? format(date, "yyyy-MM-dd'T'HH:mm") : '';
};

export const isPast = (value: string | Date | null | undefined): boolean => {
  const date = toDate(value);
  return date ? date.getTime() < Date.now() : false;
};

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** `SITE_VISIT` -> `Site Visit`. Enum values are rendered, never shown raw. */
export const humanizeEnum = (value: string | null | undefined): string => {
  if (!value) return EM_DASH;
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/** Two-letter initials for avatars. */
export const initialsOf = (name: string | null | undefined): string => {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
};

export const truncate = (value: string | null | undefined, max = 60): string => {
  if (!value) return EM_DASH;
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
};

/** Masks all but the last four digits — used where a full number is not needed. */
export const maskMobile = (mobile: string | null | undefined): string => {
  if (!mobile || mobile.length < 4) return mobile ?? EM_DASH;
  return `${'•'.repeat(Math.max(0, mobile.length - 4))}${mobile.slice(-4)}`;
};

export { EM_DASH };
