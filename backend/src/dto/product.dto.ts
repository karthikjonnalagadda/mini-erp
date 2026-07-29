/**
 * Product, category, inventory and stock-movement DTOs.
 *
 * The `stock` block on a product response is computed, not stored:
 *   available = onHand - reserved
 *   status    = OUT_OF_STOCK | LOW_STOCK | IN_STOCK
 *
 * Deriving it server-side means the badge on a table row, the warning in a
 * challan form and the dashboard counter can never disagree — there is one
 * implementation of the rule, not three.
 */
import type { MovementReason, MovementType } from '@prisma/client';

import type { CategoryWithCounts } from '../repositories/category.repository';
import type { ProductWithRelations } from '../repositories/product.repository';
import type { StockMovementWithRelations } from '../repositories/inventory.repository';
import { toNumber } from '../utils/money';

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export interface CreateProductDto {
  sku: string;
  name: string;
  description?: string | null;
  barcode?: string | null;
  imageUrl?: string | null;
  categoryId: string;
  unitPrice: number;
  costPrice?: number;
  taxRate?: number;
  unit?: string;
  minimumStock?: number;
  isActive?: boolean;
  /** Opening balance — recorded as an OPENING_BALANCE stock movement. */
  openingStock?: number;
  warehouseLocation?: string | null;
  binLocation?: string | null;
}

export type UpdateProductDto = Partial<Omit<CreateProductDto, 'openingStock'>>;

export interface CreateCategoryDto {
  name: string;
  description?: string | null;
  parentId?: string | null;
  isActive?: boolean;
}

export type UpdateCategoryDto = Partial<CreateCategoryDto>;

export interface AdjustStockDto {
  quantityDelta: number;
  reason: MovementReason;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export interface ProductResponseDto {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  barcode: string | null;
  imageUrl: string | null;
  category: { id: string; name: string; slug: string };
  unitPrice: number;
  costPrice: number;
  taxRate: number;
  unit: string;
  /** Selling price including tax — the number a salesperson actually quotes. */
  priceWithTax: number;
  minimumStock: number;
  stock: {
    onHand: number;
    reserved: number;
    available: number;
    status: StockStatus;
    warehouseLocation: string | null;
    binLocation: string | null;
    lastMovementAt: string | null;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  parent: { id: string; name: string } | null;
  stats: { productCount: number; childCount: number };
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementResponseDto {
  id: string;
  product: { id: string; sku: string; name: string; unit: string };
  movementType: MovementType;
  reason: MovementReason;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  /** Signed change, convenient for the UI's +/- rendering. */
  netChange: number;
  reference: { type: string | null; id: string | null; code: string | null };
  notes: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Single definition of the low-stock rule. */
export const resolveStockStatus = (onHand: number, minimumStock: number): StockStatus => {
  if (onHand <= 0) return 'OUT_OF_STOCK';
  if (onHand <= minimumStock) return 'LOW_STOCK';
  return 'IN_STOCK';
};

export const toProductResponse = (product: ProductWithRelations): ProductResponseDto => {
  const onHand = product.inventory?.quantityOnHand ?? 0;
  const reserved = product.inventory?.quantityReserved ?? 0;
  const unitPrice = toNumber(product.unitPrice);
  const taxRate = toNumber(product.taxRate);

  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    barcode: product.barcode,
    imageUrl: product.imageUrl,
    category: product.category,
    unitPrice,
    costPrice: toNumber(product.costPrice),
    taxRate,
    unit: product.unit,
    priceWithTax: Number((unitPrice * (1 + taxRate / 100)).toFixed(2)),
    minimumStock: product.minimumStock,
    stock: {
      onHand,
      reserved,
      available: Math.max(0, onHand - reserved),
      status: resolveStockStatus(onHand, product.minimumStock),
      warehouseLocation: product.inventory?.warehouseLocation ?? null,
      binLocation: product.inventory?.binLocation ?? null,
      lastMovementAt: product.inventory?.lastMovementAt?.toISOString() ?? null,
    },
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
};

export const toCategoryResponse = (category: CategoryWithCounts): CategoryResponseDto => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
  description: category.description,
  isActive: category.isActive,
  parent: category.parent,
  stats: {
    productCount: category._count.products,
    childCount: category._count.children,
  },
  createdAt: category.createdAt.toISOString(),
  updatedAt: category.updatedAt.toISOString(),
});

export const toStockMovementResponse = (
  movement: StockMovementWithRelations,
): StockMovementResponseDto => ({
  id: movement.id,
  product: movement.product,
  movementType: movement.movementType,
  reason: movement.reason,
  quantity: movement.quantity,
  quantityBefore: movement.quantityBefore,
  quantityAfter: movement.quantityAfter,
  netChange: movement.quantityAfter - movement.quantityBefore,
  reference: {
    type: movement.referenceType,
    id: movement.referenceId,
    code: movement.referenceCode,
  },
  notes: movement.notes,
  createdBy: {
    id: movement.createdBy.id,
    name: `${movement.createdBy.firstName} ${movement.createdBy.lastName}`.trim(),
  },
  createdAt: movement.createdAt.toISOString(),
});
