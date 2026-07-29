/**
 * Input sanitisation.
 *
 * Scope note: Prisma parameterises every query, so SQL injection is not the
 * threat here. What we defend against is:
 *   1. Stored XSS — a `<script>` payload saved in a customer note and later
 *      rendered by some other consumer (an export, an email template).
 *   2. Prototype pollution via `__proto__` / `constructor` keys in JSON bodies.
 *   3. Control characters and zero-width joiners used to spoof identifiers.
 *   4. Unbounded whitespace padding around business keys.
 *
 * We sanitise rather than reject so that legitimate text like "Rate < 10%"
 * survives; escaping happens on output, and React escapes by default.
 */

/** Keys that must never be copied onto an object we construct. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** C0/C1 control characters except tab, LF and CR, plus zero-width characters. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/g;

/** Combining diacritical marks, stripped during slug generation. */
const COMBINING_MARKS = /[\u0300-\u036F]/g;

/** Angle brackets that could open a tag when the value is interpolated raw. */
const HTML_TAG_OPENERS = /<\s*\/?\s*(script|iframe|object|embed|link|style|img|svg)\b/gi;

export const sanitizeString = (value: string): string =>
  value
    .replace(CONTROL_CHARS, '')
    .replace(HTML_TAG_OPENERS, (match) => match.replace('<', '&lt;'))
    .trim();

/**
 * Depth-limited recursive sanitiser applied to body, query and params.
 * The depth cap stops a deeply nested payload from becoming a CPU DoS.
 */
export const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (depth > 10) return undefined;
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) continue; // prototype-pollution guard
      output[sanitizeString(key)] = sanitizeValue(item, depth + 1);
    }
    return output;
  }

  return undefined;
};

/** Normalises an email for storage and lookup: trimmed + lower-cased. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Strips spaces, dashes and brackets from a phone number. */
export const normalizePhone = (phone: string): string => phone.replace(/[\s\-()]/g, '');

/** Uppercases and strips whitespace from a GSTIN / SKU-style business key. */
export const normalizeBusinessKey = (value: string): string =>
  value.replace(/\s/g, '').toUpperCase();

/** URL-safe slug from a display name. */
export const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
