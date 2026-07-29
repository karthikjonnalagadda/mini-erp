/**
 * Dashboard + audit-log HTTP layer.
 */
import type { Request, Response } from 'express';

import { requireUser } from '../middleware/auth.middleware';
import { getValidatedQuery } from '../middleware/validate.middleware';
import { auditService } from '../services/audit.service';
import type { AuditListQuery } from '../services/audit.service';
import { dashboardService } from '../services/dashboard.service';
import { ApiResponse } from '../utils/api-response';
import { asyncHandler } from '../utils/async-handler';
import { buildPaginationMeta, resolvePagination } from '../utils/pagination';

export const dashboardController = {
  /** GET /dashboard — one call renders the whole landing page. */
  overview: asyncHandler(async (req: Request, res: Response) => {
    const user = requireUser(req);
    const overview = await dashboardService.getOverview(user.role);
    return ApiResponse.ok(res, overview);
  }),
};

export const auditController = {
  /** GET /audit-logs */
  list: asyncHandler(async (_req: Request, res: Response) => {
    const query = getValidatedQuery<AuditListQuery>(res);
    const { items, total } = await auditService.list(query);
    const { page, limit } = resolvePagination(query);

    // Prisma returns `Json` columns as `JsonValue`; the envelope serialises them
    // as-is, which is what the UI's diff viewer expects.
    return ApiResponse.paginated(
      res,
      items.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: entry.summary,
        actor: { id: entry.actorId, email: entry.actorEmail, role: entry.actorRole },
        before: entry.before,
        after: entry.after,
        ipAddress: entry.ipAddress,
        requestId: entry.requestId,
        createdAt: entry.createdAt.toISOString(),
      })),
      buildPaginationMeta(total, { page, limit }),
    );
  }),

  /** GET /audit-logs/:entityType/:entityId — timeline for one record. */
  timeline: asyncHandler(async (req: Request, res: Response) => {
    const entries = await auditService.timelineFor(
      req.params['entityType'] as string,
      req.params['entityId'] as string,
    );

    return ApiResponse.ok(
      res,
      entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        summary: entry.summary,
        actor: entry.actorEmail,
        before: entry.before,
        after: entry.after,
        createdAt: entry.createdAt.toISOString(),
      })),
    );
  }),
};
