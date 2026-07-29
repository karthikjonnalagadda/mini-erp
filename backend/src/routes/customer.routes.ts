/**
 * Customer routes.
 *
 * ORDERING IS LOAD-BEARING. Express matches routes top-down, so the literal
 * `/follow-ups` paths MUST be declared before `/:id`. Declared the other way
 * around, a request to `/customers/follow-ups` would match `/customers/:id`
 * with `id = "follow-ups"`, fail UUID validation, and return a confusing 422.
 */
import { Router } from 'express';

import { customerController } from '../controllers/customer.controller';
import { authenticate } from '../middleware/auth.middleware';
import { RolePolicy, authorizePolicy } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';
import { idParamSchema } from '../validators/common.validators';
import {
  completeFollowUpSchema,
  createCustomerSchema,
  createFollowUpSchema,
  customerListQuerySchema,
  followUpListQuerySchema,
  updateCustomerSchema,
  updateFollowUpSchema,
} from '../validators/customer.validators';

const router = Router();

// Every customer route requires a signed-in user.
router.use(authenticate);

// ---------------------------------------------------------------------------
// Follow-up collection routes — declared FIRST, see the file docblock.
// ---------------------------------------------------------------------------

router.get(
  '/follow-ups',
  authorizePolicy(RolePolicy.VIEW_CUSTOMERS),
  validate({ query: followUpListQuerySchema }),
  customerController.listFollowUps,
);

router.put(
  '/follow-ups/:id',
  authorizePolicy(RolePolicy.MANAGE_CUSTOMERS),
  validate({ params: idParamSchema, body: updateFollowUpSchema }),
  customerController.updateFollowUp,
);

router.post(
  '/follow-ups/:id/complete',
  authorizePolicy(RolePolicy.MANAGE_CUSTOMERS),
  validate({ params: idParamSchema, body: completeFollowUpSchema }),
  customerController.completeFollowUp,
);

router.delete(
  '/follow-ups/:id',
  authorizePolicy(RolePolicy.MANAGE_CUSTOMERS),
  validate({ params: idParamSchema }),
  customerController.deleteFollowUp,
);

// ---------------------------------------------------------------------------
// Customer CRUD
// ---------------------------------------------------------------------------

router.get(
  '/',
  authorizePolicy(RolePolicy.VIEW_CUSTOMERS),
  validate({ query: customerListQuerySchema }),
  customerController.list,
);

router.post(
  '/',
  authorizePolicy(RolePolicy.MANAGE_CUSTOMERS),
  validate({ body: createCustomerSchema }),
  customerController.create,
);

router.get(
  '/:id',
  authorizePolicy(RolePolicy.VIEW_CUSTOMERS),
  validate({ params: idParamSchema }),
  customerController.getById,
);

router.put(
  '/:id',
  authorizePolicy(RolePolicy.MANAGE_CUSTOMERS),
  validate({ params: idParamSchema, body: updateCustomerSchema }),
  customerController.update,
);

// Deleting a customer is ADMIN-only: it is irreversible from the UI and the
// correct action for a lapsed account is a status change, not a delete.
router.delete(
  '/:id',
  authorizePolicy(RolePolicy.DELETE_CUSTOMERS),
  validate({ params: idParamSchema }),
  customerController.remove,
);

// ---------------------------------------------------------------------------
// Customer sub-resources
// ---------------------------------------------------------------------------

router.get(
  '/:id/timeline',
  authorizePolicy(RolePolicy.VIEW_CUSTOMERS),
  validate({ params: idParamSchema }),
  customerController.timeline,
);

router.get(
  '/:id/follow-ups',
  authorizePolicy(RolePolicy.VIEW_CUSTOMERS),
  validate({ params: idParamSchema, query: followUpListQuerySchema }),
  customerController.listCustomerFollowUps,
);

router.post(
  '/:id/follow-ups',
  authorizePolicy(RolePolicy.MANAGE_CUSTOMERS),
  validate({ params: idParamSchema, body: createFollowUpSchema }),
  customerController.createFollowUp,
);

export default router;
