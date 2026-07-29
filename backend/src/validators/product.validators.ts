/**
 * Catalogue, inventory and stock-movement request schemas.
 */
import { z } from 'zod';

import {
  booleanQuerySchema,
  nonNegativeIntSchema,
  percentageSchema,
  priceSchema,
  shortTextSchema,
  skuSchema,
  stockDeltaSchema,
  uuidSchema,
  withValidDateRange,
} from './common.validators';

const MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUSTMENT', 'RETURN', 'DAMAGE'] as const;
const MOVEMENT_REASONS = [
  'PURCHASE_RECEIPT',
  'SALES_CHALLAN',
  'CHALLAN_CANCELLATION',
  'CUSTOMER_RETURN',
  'SUPPLIER_RETURN',
  'STOCK_TAKE_ADJUSTMENT',
  'DAMAGE_WRITE_OFF',
  'OPENING_BALANCE',
  'MANUAL_CORRECTION',
] as const;

/** Units of measure accepted by the catalogue. */
const UNITS = ['PCS', 'BOX', 'CTN', 'KG', 'GM', 'LTR', 'ML', 'MTR', 'SET', 'PKT'] as const;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const createCategorySchema = z.object({
  name: shortTextSchema(100, 'Category name'),
  description: z.string().trim().max(400).optional().nullable(),
  parentId: uuidSchema.optional().nullable(),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const categoryListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(120).optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  isActive: booleanQuerySchema.optional(),
  parentId: uuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const createProductSchema = z.object({
  sku: skuSchema,
  name: shortTextSchema(160, 'Product name'),
  description: z.string().trim().max(5000).optional().nullable(),
  barcode: z.string().trim().max(64).optional().nullable(),
  imageUrl: z.string().url('Enter a valid image URL').max(500).optional().nullable(),
  categoryId: uuidSchema,
  unitPrice: priceSchema,
  costPrice: priceSchema.default(0),
  taxRate: percentageSchema.default(0),
  unit: z.enum(UNITS).default('PCS'),
  minimumStock: nonNegativeIntSchema.default(0),
  isActive: z.boolean().default(true),

  /** Opening balance, posted as an OPENING_BALANCE movement on creation. */
  openingStock: nonNegativeIntSchema.default(0),
  warehouseLocation: z.string().trim().max(80).optional().nullable(),
  binLocation: z.string().trim().max(40).optional().nullable(),
})
  .refine((data) => data.costPrice <= data.unitPrice || data.costPrice === 0, {
    path: ['costPrice'],
    message: 'Cost price should not exceed the selling price',
  });

/**
 * `openingStock` is intentionally absent from updates. Stock is only ever
 * changed through the stock-movement endpoints, so that every change lands in
 * the ledger. Allowing an update here would be a silent, unaudited write.
 */
export const updateProductSchema = z
  .object({
    sku: skuSchema.optional(),
    name: shortTextSchema(160, 'Product name').optional(),
    description: z.string().trim().max(5000).optional().nullable(),
    barcode: z.string().trim().max(64).optional().nullable(),
    imageUrl: z.string().url('Enter a valid image URL').max(500).optional().nullable(),
    categoryId: uuidSchema.optional(),
    unitPrice: priceSchema.optional(),
    costPrice: priceSchema.optional(),
    taxRate: percentageSchema.optional(),
    unit: z.enum(UNITS).optional(),
    minimumStock: nonNegativeIntSchema.optional(),
    isActive: z.boolean().optional(),
    warehouseLocation: z.string().trim().max(80).optional().nullable(),
    binLocation: z.string().trim().max(40).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(120).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'sku', 'unitPrice', 'minimumStock']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  categoryId: uuidSchema.optional(),
  isActive: booleanQuerySchema.optional(),
  warehouseLocation: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  lowStock: booleanQuerySchema.optional(),
  outOfStock: booleanQuerySchema.optional(),
});

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export const adjustStockSchema = z.object({
  quantityDelta: stockDeltaSchema,
  reason: z.enum(MOVEMENT_REASONS).default('MANUAL_CORRECTION'),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const stockTakeSchema = z.object({
  countedQuantity: nonNegativeIntSchema,
  notes: z.string().trim().max(500).optional().nullable(),
});

export const updateStockLocationSchema = z
  .object({
    warehouseLocation: z.string().trim().max(80).optional().nullable(),
    binLocation: z.string().trim().max(40).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const stockMovementListQuerySchema = withValidDateRange(
  z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z.enum(['createdAt', 'quantity', 'movementType']).optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    productId: uuidSchema.optional(),
    movementType: z.enum(MOVEMENT_TYPES).optional(),
    reason: z.enum(MOVEMENT_REASONS).optional(),
    createdById: uuidSchema.optional(),
    referenceType: z.string().trim().max(40).optional(),
    referenceId: uuidSchema.optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  }),
);

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CategoryListQueryInput = z.infer<typeof categoryListQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductListQueryInput = z.infer<typeof productListQuerySchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type StockTakeInput = z.infer<typeof stockTakeSchema>;
export type UpdateStockLocationInput = z.infer<typeof updateStockLocationSchema>;
export type StockMovementListQueryInput = z.infer<typeof stockMovementListQuerySchema>;
