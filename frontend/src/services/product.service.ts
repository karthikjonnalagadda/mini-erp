/**
 * Catalogue, inventory and stock-movement API calls.
 */
import { apiDelete, apiGet, apiGetPaginated, apiPatch, apiPost, apiPut } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import type {
  BaseListParams,
  Category,
  CategoryOption,
  InventorySummary,
  MovementReason,
  Paginated,
  Product,
  ProductListParams,
  StockMovement,
  StockMovementListParams,
} from '@/types/api.types';

export interface CategoryPayload {
  name: string;
  description?: string | null;
  parentId?: string | null;
  isActive?: boolean;
}

export interface ProductPayload {
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
  /** Only accepted on create — stock changes afterwards go through movements. */
  openingStock?: number;
  warehouseLocation?: string | null;
  binLocation?: string | null;
}

export interface AdjustStockPayload {
  /** Signed, non-zero. Positive adds stock, negative removes it. */
  quantityDelta: number;
  reason: MovementReason;
  notes?: string | null;
}

export interface StockTakePayload {
  countedQuantity: number;
  notes?: string | null;
}

export const categoryService = {
  list: (params: BaseListParams & { isActive?: boolean }): Promise<Paginated<Category>> =>
    apiGetPaginated<Category>(endpoints.categories.list, params),

  options: (): Promise<CategoryOption[]> => apiGet<CategoryOption[]>(endpoints.categories.options),

  getById: (id: string): Promise<Category> => apiGet<Category>(endpoints.categories.detail(id)),

  create: (payload: CategoryPayload): Promise<Category> =>
    apiPost<Category, CategoryPayload>(endpoints.categories.list, payload),

  update: (id: string, payload: Partial<CategoryPayload>): Promise<Category> =>
    apiPut<Category, Partial<CategoryPayload>>(endpoints.categories.detail(id), payload),

  remove: (id: string): Promise<null> => apiDelete<null>(endpoints.categories.detail(id)),
};

export const productService = {
  list: (params: ProductListParams): Promise<Paginated<Product>> =>
    apiGetPaginated<Product>(endpoints.products.list, params),

  getById: (id: string): Promise<Product> => apiGet<Product>(endpoints.products.detail(id)),

  create: (payload: ProductPayload): Promise<Product> =>
    apiPost<Product, ProductPayload>(endpoints.products.list, payload),

  update: (id: string, payload: Partial<ProductPayload>): Promise<Product> =>
    apiPut<Product, Partial<ProductPayload>>(endpoints.products.detail(id), payload),

  remove: (id: string): Promise<null> => apiDelete<null>(endpoints.products.detail(id)),

  movements: (id: string, params: StockMovementListParams): Promise<Paginated<StockMovement>> =>
    apiGetPaginated<StockMovement>(endpoints.products.movements(id), params),
};

export const inventoryService = {
  summary: (): Promise<InventorySummary> => apiGet<InventorySummary>(endpoints.inventory.summary),

  adjust: (
    productId: string,
    payload: AdjustStockPayload,
  ): Promise<{ movementId: string; quantityBefore: number; quantityAfter: number }> =>
    apiPost(endpoints.inventory.adjust(productId), payload),

  stockTake: (
    productId: string,
    payload: StockTakePayload,
  ): Promise<{ movementId: string; quantityBefore: number; quantityAfter: number } | null> =>
    apiPost(endpoints.inventory.stockTake(productId), payload),

  updateLocation: (
    productId: string,
    payload: { warehouseLocation?: string | null; binLocation?: string | null },
  ): Promise<unknown> => apiPatch(endpoints.inventory.location(productId), payload),
};

export const stockMovementService = {
  list: (params: StockMovementListParams): Promise<Paginated<StockMovement>> =>
    apiGetPaginated<StockMovement>(endpoints.stockMovements.list, params),

  getById: (id: string): Promise<StockMovement> =>
    apiGet<StockMovement>(endpoints.stockMovements.detail(id)),
};
