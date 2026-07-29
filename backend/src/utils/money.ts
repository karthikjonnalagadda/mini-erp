/**
 * Monetary arithmetic.
 *
 * Rule: NEVER accumulate money in IEEE-754 floats. `0.1 + 0.2 !== 0.3` becomes a
 * one-paisa mismatch on an invoice, which becomes an accounting dispute. All
 * intermediate maths happens in integer minor units (paise), and we convert back
 * to a 2-decimal string only at the boundary.
 *
 * Prisma returns `Decimal` for DECIMAL columns; these helpers accept the union
 * of everything we might receive (Decimal | string | number) and normalise it.
 */
import { Prisma } from '@prisma/client';

import { MONEY } from '../constants/app.constants';

export type MoneyInput = Prisma.Decimal | string | number;

const MINOR_UNIT_FACTOR = 10 ** MONEY.SCALE; // 100

/** Any money-ish value -> integer paise. Rounds half-up at the last step only. */
export const toMinorUnits = (value: MoneyInput): number => {
  const asNumber =
    value instanceof Prisma.Decimal ? Number(value.toString()) : Number(value ?? 0);

  if (!Number.isFinite(asNumber)) {
    throw new TypeError(`Cannot convert non-finite value to money: ${String(value)}`);
  }
  // The +Number.EPSILON nudge protects against values like 8.475 that are
  // stored as 8.474999999999999 in binary floating point.
  return Math.round((asNumber + Number.EPSILON) * MINOR_UNIT_FACTOR);
};

/** Integer paise -> Prisma.Decimal suitable for writing to a DECIMAL column. */
export const fromMinorUnits = (minor: number): Prisma.Decimal =>
  new Prisma.Decimal((minor / MINOR_UNIT_FACTOR).toFixed(MONEY.SCALE));

/** Normalises to a plain number for JSON output (2 dp, no float artefacts). */
export const toNumber = (value: MoneyInput): number =>
  Number((toMinorUnits(value) / MINOR_UNIT_FACTOR).toFixed(MONEY.SCALE));

/** Percentage applied to a paise amount, rounded half-up. e.g. 18% GST. */
const applyPercent = (minor: number, percent: MoneyInput): number => {
  const pct = Number(percent instanceof Prisma.Decimal ? percent.toString() : percent ?? 0);
  return Math.round(minor * (pct / 100));
};

export interface LineAmounts {
  /** quantity x unitPrice, after line discount, excluding tax. */
  lineSubtotal: Prisma.Decimal;
  lineTaxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

/**
 * Single source of truth for line-item maths.
 *
 * Deliberately server-side only: the client may *display* a computed total, but
 * the value persisted is always recomputed here. Never trust prices or totals
 * that arrive in a request body.
 */
export const calculateLineAmounts = (input: {
  quantity: number;
  unitPrice: MoneyInput;
  taxRate: MoneyInput;
  discountPercent: MoneyInput;
}): LineAmounts => {
  const unitPriceMinor = toMinorUnits(input.unitPrice);
  const grossMinor = unitPriceMinor * input.quantity;
  const discountMinor = applyPercent(grossMinor, input.discountPercent);
  const subtotalMinor = grossMinor - discountMinor;
  const taxMinor = applyPercent(subtotalMinor, input.taxRate);

  return {
    lineSubtotal: fromMinorUnits(subtotalMinor),
    lineTaxAmount: fromMinorUnits(taxMinor),
    lineTotal: fromMinorUnits(subtotalMinor + taxMinor),
  };
};

export interface DocumentTotals {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}

/**
 * Rolls line items up into document totals.
 *
 * Note the ordering: we sum in paise and convert once. Converting each line to a
 * float and summing would reintroduce exactly the drift we are avoiding.
 */
export const calculateDocumentTotals = (
  lines: Array<{
    quantity: number;
    unitPrice: MoneyInput;
    taxRate: MoneyInput;
    discountPercent: MoneyInput;
  }>,
): DocumentTotals => {
  let subtotalMinor = 0;
  let discountMinor = 0;
  let taxMinor = 0;

  for (const line of lines) {
    const grossMinor = toMinorUnits(line.unitPrice) * line.quantity;
    const lineDiscountMinor = applyPercent(grossMinor, line.discountPercent);
    const lineSubtotalMinor = grossMinor - lineDiscountMinor;

    subtotalMinor += grossMinor;
    discountMinor += lineDiscountMinor;
    taxMinor += applyPercent(lineSubtotalMinor, line.taxRate);
  }

  const totalMinor = subtotalMinor - discountMinor + taxMinor;

  return {
    subtotal: fromMinorUnits(subtotalMinor),
    discountAmount: fromMinorUnits(discountMinor),
    taxAmount: fromMinorUnits(taxMinor),
    totalAmount: fromMinorUnits(totalMinor),
  };
};

/** Formats for PDFs and emails: 1234.5 -> "₹1,234.50". */
export const formatCurrency = (value: MoneyInput, symbol = 'INR '): string => {
  const amount = toNumber(value);
  return `${symbol}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: MONEY.SCALE,
    maximumFractionDigits: MONEY.SCALE,
  })}`;
};
