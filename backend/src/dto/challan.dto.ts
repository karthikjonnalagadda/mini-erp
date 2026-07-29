/**
 * Sales challan DTOs.
 *
 * The response deliberately exposes a `permissions` block computed from the
 * document's status. The frontend then disables buttons from data rather than
 * re-implementing the state machine in TypeScript — one source of truth for
 * "can this be confirmed?", living next to the rule it describes.
 */
import type { ChallanStatus } from '@prisma/client';

import type { ChallanWithRelations } from '../repositories/challan.repository';
import { toNumber } from '../utils/money';

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export interface ChallanItemInputDto {
  productId: string;
  quantity: number;
  /** Optional override; defaults to the product's catalogue price. */
  unitPrice?: number;
  discountPercent?: number;
}

export interface CreateChallanDto {
  customerId: string;
  challanDate?: Date;
  dispatchDate?: Date | null;
  shippingAddress?: string | null;
  transporterName?: string | null;
  vehicleNumber?: string | null;
  notes?: string | null;
  items: ChallanItemInputDto[];
}

export type UpdateChallanDto = Partial<CreateChallanDto>;

export interface CancelChallanDto {
  reason: string;
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export interface ChallanItemResponseDto {
  id: string;
  productId: string;
  /** Snapshot values — what the document said when it was issued. */
  sku: string;
  name: string;
  unit: string;
  unitPrice: number;
  taxRate: number;
  quantity: number;
  discountPercent: number;
  lineSubtotal: number;
  lineTaxAmount: number;
  lineTotal: number;
}

export interface ChallanResponseDto {
  id: string;
  challanNumber: string;
  status: ChallanStatus;
  customer: {
    id: string;
    code: string;
    name: string;
    businessName: string | null;
    mobile: string;
    gstNumber: string | null;
    address: string;
  };
  challanDate: string;
  dispatchDate: string | null;
  shippingAddress: string | null;
  transporterName: string | null;
  vehicleNumber: string | null;
  notes: string | null;
  items: ChallanItemResponseDto[];
  totals: {
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    totalAmount: number;
    itemCount: number;
    totalQuantity: number;
  };
  audit: {
    createdBy: { id: string; name: string } | null;
    createdAt: string;
    confirmedBy: { id: string; name: string } | null;
    confirmedAt: string | null;
    cancelledBy: { id: string; name: string } | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
  };
  /** Derived from `status` — see the module docblock. */
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
    canConfirm: boolean;
    canCancel: boolean;
  };
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const nameOf = (
  person: { id: string; firstName: string; lastName: string } | null,
): { id: string; name: string } | null =>
  person ? { id: person.id, name: `${person.firstName} ${person.lastName}`.trim() } : null;

export const toChallanResponse = (challan: ChallanWithRelations): ChallanResponseDto => {
  const items = challan.items.map(
    (item): ChallanItemResponseDto => ({
      id: item.id,
      productId: item.productId,
      sku: item.productSku,
      name: item.productName,
      unit: item.unit,
      unitPrice: toNumber(item.unitPrice),
      taxRate: toNumber(item.taxRate),
      quantity: item.quantity,
      discountPercent: toNumber(item.discountPercent),
      lineSubtotal: toNumber(item.lineSubtotal),
      lineTaxAmount: toNumber(item.lineTaxAmount),
      lineTotal: toNumber(item.lineTotal),
    }),
  );

  const address = [
    challan.customer.addressLine1,
    challan.customer.addressLine2,
    challan.customer.city,
    challan.customer.state,
    challan.customer.postalCode,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ');

  return {
    id: challan.id,
    challanNumber: challan.challanNumber,
    status: challan.status,
    customer: {
      id: challan.customer.id,
      code: challan.customer.code,
      name: challan.customer.name,
      businessName: challan.customer.businessName,
      mobile: challan.customer.mobile,
      gstNumber: challan.customer.gstNumber,
      address,
    },
    challanDate: challan.challanDate.toISOString(),
    dispatchDate: challan.dispatchDate?.toISOString() ?? null,
    shippingAddress: challan.shippingAddress,
    transporterName: challan.transporterName,
    vehicleNumber: challan.vehicleNumber,
    notes: challan.notes,
    items,
    totals: {
      subtotal: toNumber(challan.subtotal),
      discountAmount: toNumber(challan.discountAmount),
      taxAmount: toNumber(challan.taxAmount),
      totalAmount: toNumber(challan.totalAmount),
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    },
    audit: {
      createdBy: nameOf(challan.createdBy),
      createdAt: challan.createdAt.toISOString(),
      confirmedBy: nameOf(challan.confirmedBy),
      confirmedAt: challan.confirmedAt?.toISOString() ?? null,
      cancelledBy: nameOf(challan.cancelledBy),
      cancelledAt: challan.cancelledAt?.toISOString() ?? null,
      cancellationReason: challan.cancellationReason,
    },
    permissions: {
      canEdit: challan.status === 'DRAFT',
      canDelete: challan.status === 'DRAFT',
      canConfirm: challan.status === 'DRAFT',
      // A cancelled document is terminal; a draft or confirmed one can still be
      // cancelled (the latter restores stock).
      canCancel: challan.status !== 'CANCELLED',
    },
  };
};
