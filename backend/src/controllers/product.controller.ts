/**
 * Catalogue + inventory HTTP layer.
 *
 * Covers three route groups that share a service: categories, products, and
 * stock (adjustments, stock takes, the movement ledger and the inventory
 * dashboard).
 */
import type { Request, Response } from 'express';

import { CategoryMessages, InventoryMessages, ProductMessages } from '../constants/messages';
import { requireUser } from '../middleware/auth.middleware';
import { getValidatedQuery } from '../middleware/validate.middleware';
import { inventoryRepository } from '../repositories/inventory.repository';
import { productService } from '../services/product.service';
import { stockService } from '../services/stock.service';
import { ApiResponse } from '../utils/api-response';
import { asyncHandler } from '../utils/async-handler';
import { buildPaginationMeta, resolvePagination } from '../utils/pagination';
import type { ActorContext } from '../types/common.types';
import type {
  AdjustStockInput,
  CategoryListQueryInput,
  CreateCategoryInput,
  CreateProductInput,
  ProductListQueryInput,
  StockMovementListQueryInput,
  StockTakeInput,
  UpdateCategoryInput,
  UpdateProductInput,
  UpdateStockLocationInput,
} from '../validators/product.validators';

const actorOf = (req: Request): ActorContext => {
  const user = requireUser(req);
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.requestId,
  };
};

const paramId = (req: Request, key = 'id'): string => req.params[key] as string;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categoryController = {
  /** GET /categories */
  list: asyncHandler(async (_req: Request, res: Response) => {
    const query = getValidatedQuery<CategoryListQueryInput>(res);
    const { items, total } = await productService.listCategories(query);
    const { page, limit } = resolvePagination(query);
    return ApiResponse.paginated(res, items, buildPaginationMeta(total, { page, limit }));
  }),

  /** GET /categories/options — flat list for <select> inputs. */
  options: asyncHandler(async (_req: Request, res: Response) => {
    const options = await productService.listCategoryOptions();
    return ApiResponse.ok(res, options);
  }),

  /** GET /categories/:id */
  getById: asyncHandler(async (req: Request, res: Response) => {
    const category = await productService.getCategoryById(paramId(req));
    return ApiResponse.ok(res, category);
  }),

  /** POST /categories */
  create: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as CreateCategoryInput;
    const category = await productService.createCategory(dto, actorOf(req));
    return ApiResponse.created(res, category, CategoryMessages.CREATED);
  }),

  /** PUT /categories/:id */
  update: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as UpdateCategoryInput;
    const category = await productService.updateCategory(paramId(req), dto, actorOf(req));
    return ApiResponse.ok(res, category, CategoryMessages.UPDATED);
  }),

  /** DELETE /categories/:id */
  remove: asyncHandler(async (req: Request, res: Response) => {
    await productService.deleteCategory(paramId(req), actorOf(req));
    return ApiResponse.deleted(res, CategoryMessages.DELETED);
  }),
};

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const productController = {
  /** GET /products */
  list: asyncHandler(async (_req: Request, res: Response) => {
    const query = getValidatedQuery<ProductListQueryInput>(res);
    const { items, total } = await productService.listProducts(query);
    const { page, limit } = resolvePagination(query);
    return ApiResponse.paginated(res, items, buildPaginationMeta(total, { page, limit }));
  }),

  /** GET /products/:id */
  getById: asyncHandler(async (req: Request, res: Response) => {
    const product = await productService.getProductById(paramId(req));
    return ApiResponse.ok(res, product);
  }),

  /** POST /products */
  create: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as CreateProductInput;
    const product = await productService.createProduct(dto, actorOf(req));
    return ApiResponse.created(res, product, ProductMessages.CREATED);
  }),

  /** PUT /products/:id */
  update: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as UpdateProductInput;
    const product = await productService.updateProduct(paramId(req), dto, actorOf(req));
    return ApiResponse.ok(res, product, ProductMessages.UPDATED);
  }),

  /** DELETE /products/:id */
  remove: asyncHandler(async (req: Request, res: Response) => {
    await productService.deleteProduct(paramId(req), actorOf(req));
    return ApiResponse.deleted(res, ProductMessages.DELETED);
  }),

  /** GET /products/:id/movements — per-product stock ledger. */
  movements: asyncHandler(async (req: Request, res: Response) => {
    const query = getValidatedQuery<StockMovementListQueryInput>(res);
    const { items, total } = await stockService.listMovements({
      ...query,
      productId: paramId(req),
    });
    const { page, limit } = resolvePagination(query);
    return ApiResponse.paginated(res, items, buildPaginationMeta(total, { page, limit }));
  }),
};

// ---------------------------------------------------------------------------
// Inventory & stock movements
// ---------------------------------------------------------------------------

export const inventoryController = {
  /** GET /inventory/summary — powers the inventory dashboard. */
  summary: asyncHandler(async (_req: Request, res: Response) => {
    const summary = await stockService.getInventorySummary();
    return ApiResponse.ok(res, summary);
  }),

  /** POST /inventory/:id/adjust — signed manual adjustment. */
  adjust: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as AdjustStockInput;
    const result = await stockService.adjustStock(
      {
        productId: paramId(req),
        quantityDelta: dto.quantityDelta,
        reason: dto.reason,
        notes: dto.notes ?? null,
      },
      actorOf(req),
    );
    return ApiResponse.ok(res, result, InventoryMessages.ADJUSTED);
  }),

  /** POST /inventory/:id/stock-take — reconcile to a counted absolute value. */
  stockTake: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as StockTakeInput;
    const result = await stockService.setAbsoluteStock(
      {
        productId: paramId(req),
        countedQuantity: dto.countedQuantity,
        notes: dto.notes ?? null,
      },
      actorOf(req),
    );

    return ApiResponse.ok(
      res,
      result,
      result === null ? 'Stock take recorded — no variance found' : InventoryMessages.ADJUSTED,
    );
  }),

  /** PATCH /inventory/:id/location */
  updateLocation: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as UpdateStockLocationInput;
    const inventory = await inventoryRepository.updateLocation(paramId(req), dto);
    return ApiResponse.ok(res, inventory, 'Storage location updated');
  }),

  /** GET /stock-movements — global ledger with filters. */
  listMovements: asyncHandler(async (_req: Request, res: Response) => {
    const query = getValidatedQuery<StockMovementListQueryInput>(res);
    const { items, total } = await stockService.listMovements(query);
    const { page, limit } = resolvePagination(query);
    return ApiResponse.paginated(res, items, buildPaginationMeta(total, { page, limit }));
  }),

  /** GET /stock-movements/:id */
  getMovementById: asyncHandler(async (req: Request, res: Response) => {
    const movement = await stockService.getMovementById(paramId(req));
    return ApiResponse.ok(res, movement);
  }),
};
