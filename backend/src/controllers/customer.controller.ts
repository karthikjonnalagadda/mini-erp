/**
 * Customer + follow-up HTTP layer.
 *
 * Every list handler follows the same three lines: read the validated query,
 * call the service, wrap in a paginated envelope. That repetition is
 * intentional — an abstraction that hides it would obscure which query schema
 * governs which endpoint.
 */
import type { Request, Response } from 'express';

import { CustomerMessages } from '../constants/messages';
import { requireUser } from '../middleware/auth.middleware';
import { getValidatedQuery } from '../middleware/validate.middleware';
import { customerService } from '../services/customer.service';
import { ApiResponse } from '../utils/api-response';
import { asyncHandler } from '../utils/async-handler';
import { buildPaginationMeta, resolvePagination } from '../utils/pagination';
import type { ActorContext } from '../types/common.types';
import type {
  CompleteFollowUpInput,
  CreateCustomerInput,
  CreateFollowUpInput,
  CustomerListQueryInput,
  FollowUpListQueryInput,
  UpdateCustomerInput,
  UpdateFollowUpInput,
} from '../validators/customer.validators';

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

/** Route params are validated upstream, so this cast is safe by construction. */
const paramId = (req: Request, key = 'id'): string => req.params[key] as string;

export const customerController = {
  /** GET /customers */
  list: asyncHandler(async (_req: Request, res: Response) => {
    const query = getValidatedQuery<CustomerListQueryInput>(res);
    const { items, total } = await customerService.list(query);
    const { page, limit } = resolvePagination(query);
    return ApiResponse.paginated(res, items, buildPaginationMeta(total, { page, limit }));
  }),

  /** GET /customers/:id */
  getById: asyncHandler(async (req: Request, res: Response) => {
    const customer = await customerService.getById(paramId(req));
    return ApiResponse.ok(res, customer);
  }),

  /** POST /customers */
  create: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as CreateCustomerInput;
    const customer = await customerService.create(dto, actorOf(req));
    return ApiResponse.created(res, customer, CustomerMessages.CREATED);
  }),

  /** PUT /customers/:id */
  update: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as UpdateCustomerInput;
    const customer = await customerService.update(paramId(req), dto, actorOf(req));
    return ApiResponse.ok(res, customer, CustomerMessages.UPDATED);
  }),

  /** DELETE /customers/:id */
  remove: asyncHandler(async (req: Request, res: Response) => {
    await customerService.delete(paramId(req), actorOf(req));
    return ApiResponse.deleted(res, CustomerMessages.DELETED);
  }),

  /** GET /customers/:id/timeline */
  timeline: asyncHandler(async (req: Request, res: Response) => {
    const events = await customerService.getActivityTimeline(paramId(req));
    return ApiResponse.ok(res, events);
  }),

  // -------------------------------------------------------------------------
  // Follow-ups
  // -------------------------------------------------------------------------

  /** GET /customers/follow-ups — cross-customer inbox for the logged-in rep. */
  listFollowUps: asyncHandler(async (_req: Request, res: Response) => {
    const query = getValidatedQuery<FollowUpListQueryInput>(res);
    const { items, total } = await customerService.listFollowUps(query);
    const { page, limit } = resolvePagination(query);
    return ApiResponse.paginated(res, items, buildPaginationMeta(total, { page, limit }));
  }),

  /** GET /customers/:id/follow-ups */
  listCustomerFollowUps: asyncHandler(async (req: Request, res: Response) => {
    const query = getValidatedQuery<FollowUpListQueryInput>(res);
    const { items, total } = await customerService.listFollowUps({
      ...query,
      customerId: paramId(req),
    });
    const { page, limit } = resolvePagination(query);
    return ApiResponse.paginated(res, items, buildPaginationMeta(total, { page, limit }));
  }),

  /** POST /customers/:id/follow-ups */
  createFollowUp: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as CreateFollowUpInput;
    const followUp = await customerService.createFollowUp(paramId(req), dto, actorOf(req));
    return ApiResponse.created(res, followUp, CustomerMessages.FOLLOW_UP_CREATED);
  }),

  /** PUT /customers/follow-ups/:id */
  updateFollowUp: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as UpdateFollowUpInput;
    const followUp = await customerService.updateFollowUp(paramId(req), dto, actorOf(req));
    return ApiResponse.ok(res, followUp, CustomerMessages.FOLLOW_UP_UPDATED);
  }),

  /** POST /customers/follow-ups/:id/complete */
  completeFollowUp: asyncHandler(async (req: Request, res: Response) => {
    const dto = req.body as CompleteFollowUpInput;
    const followUp = await customerService.completeFollowUp(paramId(req), dto, actorOf(req));
    return ApiResponse.ok(res, followUp, CustomerMessages.FOLLOW_UP_UPDATED);
  }),

  /** DELETE /customers/follow-ups/:id */
  deleteFollowUp: asyncHandler(async (req: Request, res: Response) => {
    await customerService.deleteFollowUp(paramId(req), actorOf(req));
    return ApiResponse.deleted(res, CustomerMessages.FOLLOW_UP_DELETED);
  }),
};
