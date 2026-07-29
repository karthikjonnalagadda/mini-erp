/**
 * Sales challan routes.
 *
 * SEPARATION OF DUTIES is visible here and is the reason the policies differ
 * per verb:
 *
 *   CREATE_CHALLANS  : ADMIN, SALES      — raise the document
 *   CONFIRM_CHALLANS : ADMIN, WAREHOUSE  — release the physical stock
 *   CANCEL_CHALLANS  : ADMIN, ACCOUNTS   — reverse a financial document
 *
 * A salesperson therefore cannot both create a challan and release the goods,
 * which is the standard control against a single actor moving inventory
 * unilaterally.
 */
import { Router } from 'express';

import { challanController } from '../controllers/challan.controller';
import { authenticate } from '../middleware/auth.middleware';
import { heavyOperationLimiter } from '../middleware/rate-limit.middleware';
import { RolePolicy, authorizePolicy } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';
import { idParamSchema } from '../validators/common.validators';
import {
  cancelChallanSchema,
  challanListQuerySchema,
  confirmChallanSchema,
  createChallanSchema,
  updateChallanSchema,
} from '../validators/challan.validators';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  authorizePolicy(RolePolicy.VIEW_CHALLANS),
  validate({ query: challanListQuerySchema }),
  challanController.list,
);

router.post(
  '/',
  authorizePolicy(RolePolicy.CREATE_CHALLANS),
  validate({ body: createChallanSchema }),
  challanController.create,
);

router.get(
  '/:id',
  authorizePolicy(RolePolicy.VIEW_CHALLANS),
  validate({ params: idParamSchema }),
  challanController.getById,
);

router.put(
  '/:id',
  authorizePolicy(RolePolicy.CREATE_CHALLANS),
  validate({ params: idParamSchema, body: updateChallanSchema }),
  challanController.update,
);

router.delete(
  '/:id',
  authorizePolicy(RolePolicy.CREATE_CHALLANS),
  validate({ params: idParamSchema }),
  challanController.remove,
);

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

router.post(
  '/:id/confirm',
  authorizePolicy(RolePolicy.CONFIRM_CHALLANS),
  validate({ params: idParamSchema, body: confirmChallanSchema }),
  challanController.confirm,
);

router.post(
  '/:id/cancel',
  authorizePolicy(RolePolicy.CANCEL_CHALLANS),
  validate({ params: idParamSchema, body: cancelChallanSchema }),
  challanController.cancel,
);

// ---------------------------------------------------------------------------
// Documents — PDF rendering is CPU-bound, so it gets its own tighter limiter.
// ---------------------------------------------------------------------------

router.get(
  '/:id/pdf',
  heavyOperationLimiter,
  authorizePolicy(RolePolicy.VIEW_CHALLANS),
  validate({ params: idParamSchema }),
  challanController.downloadPdf,
);

export default router;
