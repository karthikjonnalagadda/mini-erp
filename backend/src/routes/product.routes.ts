/**
 * Catalogue, inventory and stock-movement routes.
 *
 * Three routers are exported from one file because they share a controller
 * module and a permission story. Note how the policies enforce separation of
 * duties: SALES can *read* the catalogue (to build a challan) but only
 * WAREHOUSE and ADMIN can change stock.
 */
import { Router } from 'express';

import {
  categoryController,
  inventoryController,
  productController,
} from '../controllers/product.controller';
import { authenticate } from '../middleware/auth.middleware';
import { RolePolicy, authorizePolicy } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';
import { idParamSchema } from '../validators/common.validators';
import {
  adjustStockSchema,
  categoryListQuerySchema,
  createCategorySchema,
  createProductSchema,
  productListQuerySchema,
  stockMovementListQuerySchema,
  stockTakeSchema,
  updateCategorySchema,
  updateProductSchema,
  updateStockLocationSchema,
} from '../validators/product.validators';

// ===========================================================================
// /categories
// ===========================================================================

export const categoryRouter = Router();
categoryRouter.use(authenticate);

// Literal path before `/:id` — see customer.routes.ts for the reasoning.
categoryRouter.get(
  '/options',
  authorizePolicy(RolePolicy.VIEW_PRODUCTS),
  categoryController.options,
);

categoryRouter.get(
  '/',
  authorizePolicy(RolePolicy.VIEW_PRODUCTS),
  validate({ query: categoryListQuerySchema }),
  categoryController.list,
);

categoryRouter.post(
  '/',
  authorizePolicy(RolePolicy.MANAGE_PRODUCTS),
  validate({ body: createCategorySchema }),
  categoryController.create,
);

categoryRouter.get(
  '/:id',
  authorizePolicy(RolePolicy.VIEW_PRODUCTS),
  validate({ params: idParamSchema }),
  categoryController.getById,
);

categoryRouter.put(
  '/:id',
  authorizePolicy(RolePolicy.MANAGE_PRODUCTS),
  validate({ params: idParamSchema, body: updateCategorySchema }),
  categoryController.update,
);

categoryRouter.delete(
  '/:id',
  authorizePolicy(RolePolicy.DELETE_PRODUCTS),
  validate({ params: idParamSchema }),
  categoryController.remove,
);

// ===========================================================================
// /products
// ===========================================================================

export const productRouter = Router();
productRouter.use(authenticate);

productRouter.get(
  '/',
  authorizePolicy(RolePolicy.VIEW_PRODUCTS),
  validate({ query: productListQuerySchema }),
  productController.list,
);

productRouter.post(
  '/',
  authorizePolicy(RolePolicy.MANAGE_PRODUCTS),
  validate({ body: createProductSchema }),
  productController.create,
);

productRouter.get(
  '/:id',
  authorizePolicy(RolePolicy.VIEW_PRODUCTS),
  validate({ params: idParamSchema }),
  productController.getById,
);

productRouter.put(
  '/:id',
  authorizePolicy(RolePolicy.MANAGE_PRODUCTS),
  validate({ params: idParamSchema, body: updateProductSchema }),
  productController.update,
);

productRouter.delete(
  '/:id',
  authorizePolicy(RolePolicy.DELETE_PRODUCTS),
  validate({ params: idParamSchema }),
  productController.remove,
);

productRouter.get(
  '/:id/movements',
  authorizePolicy(RolePolicy.VIEW_INVENTORY),
  validate({ params: idParamSchema, query: stockMovementListQuerySchema }),
  productController.movements,
);

// ===========================================================================
// /inventory
// ===========================================================================

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

inventoryRouter.get(
  '/summary',
  authorizePolicy(RolePolicy.VIEW_INVENTORY),
  inventoryController.summary,
);

// Stock-changing endpoints are restricted to WAREHOUSE/ADMIN. A salesperson
// must not be able to make a shortage disappear by adjusting the number.
inventoryRouter.post(
  '/:id/adjust',
  authorizePolicy(RolePolicy.ADJUST_STOCK),
  validate({ params: idParamSchema, body: adjustStockSchema }),
  inventoryController.adjust,
);

inventoryRouter.post(
  '/:id/stock-take',
  authorizePolicy(RolePolicy.ADJUST_STOCK),
  validate({ params: idParamSchema, body: stockTakeSchema }),
  inventoryController.stockTake,
);

inventoryRouter.patch(
  '/:id/location',
  authorizePolicy(RolePolicy.ADJUST_STOCK),
  validate({ params: idParamSchema, body: updateStockLocationSchema }),
  inventoryController.updateLocation,
);

// ===========================================================================
// /stock-movements — read-only. The ledger is append-only by design; rows are
// created as a side effect of stock operations and can never be edited.
// ===========================================================================

export const stockMovementRouter = Router();
stockMovementRouter.use(authenticate);

stockMovementRouter.get(
  '/',
  authorizePolicy(RolePolicy.VIEW_INVENTORY),
  validate({ query: stockMovementListQuerySchema }),
  inventoryController.listMovements,
);

stockMovementRouter.get(
  '/:id',
  authorizePolicy(RolePolicy.VIEW_INVENTORY),
  validate({ params: idParamSchema }),
  inventoryController.getMovementById,
);
