/**
 * Validation and sanitisation.
 *
 * The Zod schemas are the API's outer boundary, so their edge cases are worth
 * pinning down: a regex that accepts an invalid GSTIN produces bad statutory
 * documents, and a sanitiser that misses `__proto__` is a prototype-pollution
 * vector.
 */
import { describe, expect, it } from 'vitest';

import {
  gstSchema,
  mobileSchema,
  passwordSchema,
  quantitySchema,
  skuSchema,
  stockDeltaSchema,
} from '../src/validators/common.validators';
import { sanitizeValue, slugify, normalizeEmail } from '../src/utils/sanitize';

describe('mobileSchema', () => {
  it('accepts valid Indian mobile numbers in common formats', () => {
    expect(mobileSchema.parse('9876543210')).toBe('9876543210');
    expect(mobileSchema.parse('+91 98765 43210')).toBe('+919876543210');
    expect(mobileSchema.parse('098765-43210')).toBe('09876543210');
  });

  it('rejects numbers with an invalid leading digit', () => {
    // Indian mobiles start with 6-9; 5xxxxxxxxx is not assignable.
    expect(() => mobileSchema.parse('5876543210')).toThrow();
  });

  it('rejects wrong-length numbers', () => {
    expect(() => mobileSchema.parse('98765')).toThrow();
    expect(() => mobileSchema.parse('98765432101234')).toThrow();
  });
});

describe('gstSchema', () => {
  it('accepts a well-formed GSTIN and normalises case/whitespace', () => {
    expect(gstSchema.parse(' 27aapfu0939f1zv ')).toBe('27AAPFU0939F1ZV');
  });

  it('rejects a GSTIN of the wrong length', () => {
    expect(() => gstSchema.parse('27AAPFU0939F1Z')).toThrow();
  });

  it('rejects a GSTIN without the mandatory Z in position 14', () => {
    expect(() => gstSchema.parse('27AAPFU0939F1XV')).toThrow();
  });

  it('rejects an out-of-range state code', () => {
    expect(() => gstSchema.parse('99AAPFU0939F1ZV')).toThrow();
  });
});

describe('passwordSchema', () => {
  it('accepts a password meeting the composition policy', () => {
    expect(passwordSchema.parse('Admin@12345')).toBe('Admin@12345');
  });

  it('rejects passwords missing a character class', () => {
    expect(() => passwordSchema.parse('alllowercase1')).toThrow();
    expect(() => passwordSchema.parse('ALLUPPERCASE1')).toThrow();
    expect(() => passwordSchema.parse('NoDigitsHere')).toThrow();
  });

  it('rejects passwords beyond bcrypt’s 72-byte limit', () => {
    // Truncating instead of rejecting would make two different passwords
    // hash identically.
    expect(() => passwordSchema.parse(`Aa1${'x'.repeat(80)}`)).toThrow();
  });
});

describe('quantity and stock-delta schemas', () => {
  it('requires a positive whole number for a sale quantity', () => {
    expect(quantitySchema.parse('7')).toBe(7);
    expect(() => quantitySchema.parse(0)).toThrow();
    expect(() => quantitySchema.parse(-3)).toThrow();
    expect(() => quantitySchema.parse(1.5)).toThrow();
  });

  it('allows a negative stock adjustment but never a zero one', () => {
    expect(stockDeltaSchema.parse(-4)).toBe(-4);
    expect(stockDeltaSchema.parse(12)).toBe(12);
    // A zero-delta "adjustment" is a no-op that would still write a ledger row.
    expect(() => stockDeltaSchema.parse(0)).toThrow();
  });
});

describe('skuSchema', () => {
  it('uppercases and strips whitespace', () => {
    expect(skuSchema.parse(' ele-wir-1sq ')).toBe('ELE-WIR-1SQ');
  });

  it('rejects SKUs containing characters that break URLs or CSV exports', () => {
    expect(() => skuSchema.parse('ELE/WIR')).toThrow();
    expect(() => skuSchema.parse('-LEADINGDASH')).toThrow();
  });
});

describe('sanitizeValue', () => {
  it('trims strings and strips zero-width characters', () => {
    expect(sanitizeValue('  Acme​ Traders  ')).toBe('Acme Traders');
  });

  it('neutralises tag openers that could become stored XSS', () => {
    const result = sanitizeValue('<script>alert(1)</script>') as string;
    expect(result).not.toContain('<script');
    expect(result).toContain('&lt;script');
  });

  it('leaves legitimate business text with angle brackets intact', () => {
    // "Rate < 10%" must survive — over-sanitising corrupts real data.
    expect(sanitizeValue('Rate < 10% margin')).toBe('Rate < 10% margin');
  });

  it('drops prototype-pollution keys', () => {
    const polluted = JSON.parse('{"name":"ok","__proto__":{"isAdmin":true}}') as object;
    const clean = sanitizeValue(polluted) as Record<string, unknown>;

    expect(clean['name']).toBe('ok');
    expect(Object.prototype.hasOwnProperty.call(clean, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
  });

  it('recurses through nested objects and arrays', () => {
    const input = { items: [{ note: '  padded  ' }], meta: { deep: { value: ' x ' } } };
    expect(sanitizeValue(input)).toEqual({
      items: [{ note: 'padded' }],
      meta: { deep: { value: 'x' } },
    });
  });

  it('preserves numbers, booleans and null unchanged', () => {
    expect(sanitizeValue({ a: 1, b: true, c: null })).toEqual({ a: 1, b: true, c: null });
  });
});

describe('normalizeEmail and slugify', () => {
  it('lower-cases and trims emails so lookups are consistent', () => {
    expect(normalizeEmail('  Admin@ERPPortal.IO ')).toBe('admin@erpportal.io');
  });

  it('produces URL-safe slugs and strips diacritics', () => {
    expect(slugify('Paints & Chemicals')).toBe('paints-chemicals');
    expect(slugify('  Café  Supplies  ')).toBe('cafe-supplies');
  });
});
