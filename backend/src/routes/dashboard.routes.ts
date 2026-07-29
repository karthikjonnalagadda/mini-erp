/**
 * Dashboard and audit-log routes.
 *
 * The dashboard is available to every authenticated role — the *content* is
 * scoped inside the service rather than by blocking the route, so each role
 * gets a useful landing page without seeing figures outside their remit.
 *
 * Audit logs are restricted to ADMIN and ACCOUNTS: the trail records who did
 * what, and unrestricted access to it is itself a privacy concern.
 */
import { Router } from 'express';
import { z } from 'zod';

import { auditController, dashboardController } from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/auth.middleware';
import { RolePolicy, authorizePolicy } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validate.middleware';
import { uuidSchema, withValidDateRange } from '../validators/common.validators';

const auditListQuerySchema = withValidDateRange(
  z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    action: z
      .enum([
        'CREATE',
        'UPDATE',
        'DELETE',
        'LOGIN',
        'LOGOUT',
        'LOGIN_FAILED',
        'STATUS_CHANGE',
        'STOCK_ADJUSTMENT',
        'CHALLAN_CONFIRM',
        'CHALLAN_CANCEL',
      ])
      .optional(),
    entityType: z.string().trim().max(40).optional(),
    entityId: z.string().trim().max(64).optional(),
    actorId: uuidSchema.optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  }),
);

const auditTimelineParamsSchema = z.object({
  entityType: z.string().trim().min(1).max(40),
  entityId: z.string().trim().min(1).max(64),
});

// ---------------------------------------------------------------------------
// /dashboard
// ---------------------------------------------------------------------------

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);
dashboardRouter.get('/', dashboardController.overview);

// ---------------------------------------------------------------------------
// /audit-logs
// ---------------------------------------------------------------------------

export const auditRouter = Router();
auditRouter.use(authenticate);

auditRouter.get(
  '/',
  authorizePolicy(RolePolicy.VIEW_AUDIT_LOGS),
  validate({ query: auditListQuerySchema }),
  auditController.list,
);

auditRouter.get(
  '/:entityType/:entityId',
  authorizePolicy(RolePolicy.VIEW_AUDIT_LOGS),
  validate({ params: auditTimelineParamsSchema }),
  auditController.timeline,
);
