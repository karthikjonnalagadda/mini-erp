/**
 * Auth routes.
 *
 * Route files are the security manifest of the application: reading down this
 * file tells you exactly who can call what. Middleware order is significant and
 * always the same —
 *
 *   rate limit -> authenticate -> authorize -> validate -> controller
 *
 * Rate limiting first so that abusive traffic is rejected before it costs us a
 * database round-trip; validation last so we never validate a payload the
 * caller was not allowed to submit anyway.
 */
import { Router } from 'express';

import { authController } from '../controllers/auth.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';
import { authLimiter } from '../middleware/rate-limit.middleware';
import { adminOnly } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';
import { idParamSchema } from '../validators/common.validators';
import {
  changePasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  updateProfileSchema,
  updateUserStatusSchema,
  userListQuerySchema,
} from '../validators/auth.validators';

const router = Router();

// ---------------------------------------------------------------------------
// Public — strictly rate limited
// ---------------------------------------------------------------------------

router.post('/login', authLimiter, validate({ body: loginSchema }), authController.login);

router.post(
  '/refresh',
  authLimiter,
  validate({ body: refreshTokenSchema }),
  authController.refresh,
);

// Optional auth: works with an expired access token so a user can always end
// their session.
router.post('/logout', optionalAuthenticate, authController.logout);

// ---------------------------------------------------------------------------
// Authenticated — any role
// ---------------------------------------------------------------------------

router.use(authenticate);

router.get('/me', authController.me);
router.patch('/me', validate({ body: updateProfileSchema }), authController.updateProfile);
router.post(
  '/change-password',
  authLimiter,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);
router.post('/logout-all', authController.logoutAll);

// ---------------------------------------------------------------------------
// Administration — ADMIN only
//
// There is no public sign-up: accounts in an internal ERP are provisioned by an
// administrator. Exposing self-registration would let anyone mint an ADMIN.
// ---------------------------------------------------------------------------

router.get('/roles', authController.listRoles);

router.post('/users', adminOnly, validate({ body: registerSchema }), authController.register);

router.get(
  '/users',
  adminOnly,
  validate({ query: userListQuerySchema }),
  authController.listUsers,
);

router.patch(
  '/users/:id/status',
  adminOnly,
  validate({ params: idParamSchema, body: updateUserStatusSchema }),
  authController.updateUserStatus,
);

router.delete(
  '/users/:id',
  adminOnly,
  validate({ params: idParamSchema }),
  authController.deleteUser,
);

export default router;
