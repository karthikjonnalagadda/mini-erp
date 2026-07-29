/**
 * Sales challan HTTP layer.
 *
 * The state transitions are exposed as POST sub-resources
 * (`/challans/:id/confirm`, `/challans/:id/cancel`) rather than as a PATCH on
 * `status`. Two reasons:
 *   - They are operations, not field edits: confirming moves stock and money.
 *   - They take their own payloads (dispatch details, cancellation reason) and
 *     their own permissions, which a generic status PATCH cannot express.
 */
import type { Request, Response } from 'express';

import { ChallanMessages } from '../constants/messages';
import { requireUser } from '../middleware/auth.middleware';
import { getValidatedQuery } from '../middleware/validate.middleware';
import { challanService } from '../services/challan.service';
import { pdfService } from '../services/pdf.service';
import { ApiResponse } from '../utils/api-response';
import { asyncHandler } from '../utils/async-handler';
import { buildPaginationMeta, resolvePagination } from '../utils/pagination';
import type { ActorContext } from '../types/common.types';
import type {
  CancelChallanInput,
  ChallanListQueryInput,
  ConfirmChallanInput,
  CreateChallanInput,
  UpdateChallanInput,
} from '../validators/challan.validators';

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

const paramId = (req: Request): string => req.params['id'] as string;

export const challanController = {
  /** GET /challans */
  list: asyncHandler(async (_req: Request, res: Response) => {
    const query = getValidatedQuery<ChallanListQueryInput>(res);
    const { items, total } = await challanService.list(query);
    const { page, limit } = resolvePagination(query);
    return ApiResponse.paginated(res, items, buildPaginationMeta(total, { page, limit }));
  }),

  /** GET /challans/:id */
  getById: asyncHandler(async (req: Request, res: Response) => {
    const challan = await challanService.getById(paramId(req));
    return ApiResponse.ok(res, challan);
  }),

  /** POST /challans — always creates a DRAFT. */
  create: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as CreateChallanInput;
    const challan = await challanService.create(dto, actorOf(req));
    return ApiResponse.created(res, challan, ChallanMessages.CREATED);
  }),

  /** PUT /challans/:id — DRAFT only. */
  update: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as UpdateChallanInput;
    const challan = await challanService.update(paramId(req), dto, actorOf(req));
    return ApiResponse.ok(res, challan, ChallanMessages.UPDATED);
  }),

  /** POST /challans/:id/confirm — deducts stock atomically. */
  confirm: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as ConfirmChallanInput;
    const challan = await challanService.confirm(paramId(req), dto, actorOf(req));
    return ApiResponse.ok(res, challan, ChallanMessages.CONFIRMED);
  }),

  /** POST /challans/:id/cancel — restores stock if it was confirmed. */
  cancel: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as CancelChallanInput;
    const challan = await challanService.cancel(paramId(req), dto, actorOf(req));
    return ApiResponse.ok(res, challan, ChallanMessages.CANCELLED);
  }),

  /** DELETE /challans/:id — DRAFT only. */
  remove: asyncHandler(async (req: Request, res: Response) => {
    await challanService.delete(paramId(req), actorOf(req));
    return ApiResponse.deleted(res, ChallanMessages.DELETED);
  }),

  /**
   * GET /challans/:id/pdf
   *
   * Streams straight to the response, so this handler must not go through
   * `ApiResponse` — the client receives a PDF, not a JSON envelope.
   */
  downloadPdf: asyncHandler(async (req: Request, res: Response) => {
    const challan = await challanService.getEntityById(paramId(req));
    pdfService.streamChallan(challan, res);
  }),
};
