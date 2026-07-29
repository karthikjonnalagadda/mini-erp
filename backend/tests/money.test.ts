/**
 * Money arithmetic.
 *
 * These tests exist because floating-point money bugs are invisible in review
 * and expensive in production: they surface as a one-paisa mismatch on an
 * invoice six weeks later. Each case below is a value that a naive
 * `price * qty * (1 + tax)` implementation gets wrong.
 */
import { describe, expect, it } from 'vitest';

import {
  calculateDocumentTotals,
  calculateLineAmounts,
  formatCurrency,
  fromMinorUnits,
  toMinorUnits,
  toNumber,
} from '../src/utils/money';

describe('minor-unit conversion', () => {
  it('converts rupees to paise without float drift', () => {
    expect(toMinorUnits(1250.5)).toBe(125_050);
    expect(toMinorUnits('99.99')).toBe(9_999);
    expect(toMinorUnits(0)).toBe(0);
  });

  it('rounds half-up on values stored imprecisely in binary floating point', () => {
    // 8.475 is actually 8.474999999999999... in IEEE-754. Math.round alone
    // would yield 847; the epsilon nudge in toMinorUnits yields 848.
    expect(toMinorUnits(8.475)).toBe(848);
    expect(toMinorUnits(1.005)).toBe(101);
  });

  it('round-trips through Decimal without loss', () => {
    // Note: Decimal.toString() normalises trailing zeros ("1250.5"), so the
    // scale assertion uses toFixed. The stored DECIMAL(14,2) column keeps the
    // scale regardless; this is a display concern, not a precision one.
    expect(fromMinorUnits(125_050).toFixed(2)).toBe('1250.50');
    expect(fromMinorUnits(125_050).equals('1250.50')).toBe(true);
    expect(toNumber(fromMinorUnits(9_999))).toBe(99.99);
  });

  it('rejects non-finite input rather than silently producing NaN', () => {
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => toMinorUnits('not-a-number')).toThrow(TypeError);
  });
});

describe('calculateLineAmounts', () => {
  it('computes a simple taxed line', () => {
    const result = calculateLineAmounts({
      quantity: 10,
      unitPrice: 100,
      taxRate: 18,
      discountPercent: 0,
    });

    expect(toNumber(result.lineSubtotal)).toBe(1000);
    expect(toNumber(result.lineTaxAmount)).toBe(180);
    expect(toNumber(result.lineTotal)).toBe(1180);
  });

  it('applies the discount before tax, not after', () => {
    // Discount-then-tax:  (1000 - 100) * 1.18 = 1062
    // Tax-then-discount:  (1000 * 1.18) - 100 = 1080   <- wrong
    const result = calculateLineAmounts({
      quantity: 10,
      unitPrice: 100,
      taxRate: 18,
      discountPercent: 10,
    });

    expect(toNumber(result.lineSubtotal)).toBe(900);
    expect(toNumber(result.lineTaxAmount)).toBe(162);
    expect(toNumber(result.lineTotal)).toBe(1062);
  });

  it('handles fractional prices without accumulating error', () => {
    const result = calculateLineAmounts({
      quantity: 3,
      unitPrice: 0.1,
      taxRate: 0,
      discountPercent: 0,
    });

    // The canonical float trap: 0.1 * 3 === 0.30000000000000004
    expect(toNumber(result.lineTotal)).toBe(0.3);
  });

  it('treats a 100% discount as a zero-value line', () => {
    const result = calculateLineAmounts({
      quantity: 5,
      unitPrice: 250,
      taxRate: 18,
      discountPercent: 100,
    });

    expect(toNumber(result.lineSubtotal)).toBe(0);
    expect(toNumber(result.lineTaxAmount)).toBe(0);
    expect(toNumber(result.lineTotal)).toBe(0);
  });
});

describe('calculateDocumentTotals', () => {
  it('sums lines in paise so the document total matches the sum of its lines', () => {
    const lines = [
      { quantity: 3, unitPrice: 33.33, taxRate: 18, discountPercent: 0 },
      { quantity: 7, unitPrice: 12.15, taxRate: 12, discountPercent: 5 },
      { quantity: 1, unitPrice: 999.99, taxRate: 18, discountPercent: 2.5 },
    ];

    const totals = calculateDocumentTotals(lines);
    const lineTotals = lines.map((line) => toNumber(calculateLineAmounts(line).lineTotal));
    const sumOfLines = Number(lineTotals.reduce((a, b) => a + b, 0).toFixed(2));

    // The invariant that matters: the printed grand total equals the printed
    // line totals added up. A customer WILL check this.
    expect(toNumber(totals.totalAmount)).toBe(sumOfLines);
  });

  it('keeps subtotal, discount, tax and total internally consistent', () => {
    const totals = calculateDocumentTotals([
      { quantity: 10, unitPrice: 100, taxRate: 18, discountPercent: 10 },
      { quantity: 4, unitPrice: 250, taxRate: 12, discountPercent: 0 },
    ]);

    const subtotal = toNumber(totals.subtotal);
    const discount = toNumber(totals.discountAmount);
    const tax = toNumber(totals.taxAmount);
    const total = toNumber(totals.totalAmount);

    expect(subtotal).toBe(2000); // 1000 + 1000
    expect(discount).toBe(100);
    expect(tax).toBe(282); // 900*0.18 + 1000*0.12
    expect(total).toBe(Number((subtotal - discount + tax).toFixed(2)));
  });

  it('returns zeroes for an empty document', () => {
    const totals = calculateDocumentTotals([]);
    expect(toNumber(totals.totalAmount)).toBe(0);
    expect(toNumber(totals.subtotal)).toBe(0);
  });
});

describe('formatCurrency', () => {
  it('formats with Indian digit grouping and two decimals', () => {
    expect(formatCurrency(1234.5)).toBe('INR 1,234.50');
    expect(formatCurrency(0)).toBe('INR 0.00');
  });
});
