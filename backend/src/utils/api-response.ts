/**
 * Uniform API envelope.
 *
 * Every response this service emits — success or failure — has the same top
 * level shape. Clients can therefore write one response interceptor and one
 * error handler instead of special-casing per endpoint.
 *
 *   { success: true,  message, data, meta?, timestamp, requestId? }
 *   { success: false, message, error: { code, details? }, timestamp, requestId? }
 */
import type { Response } from 'express';

import { HttpStatus } from '../constants/http-status';
import type { ErrorCodeValue, HttpStatusCode } from '../constants/http-status';
import { CommonMessages } from '../constants/messages';

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface SuccessBody<T> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta | Record<string, unknown>;
  timestamp: string;
  requestId?: string;
}

export interface ErrorBody {
  success: false;
  message: string;
  error: {
    code: ErrorCodeValue;
    details?: unknown;
    stack?: string;
  };
  timestamp: string;
  requestId?: string;
}

/** Pulls the correlation id attached by the request-context middleware. */
const requestIdOf = (res: Response): string | undefined =>
  (res.locals as { requestId?: string }).requestId;

export const ApiResponse = {
  /** 200 with a payload. */
  ok<T>(res: Response, data: T, message: string = CommonMessages.FETCHED): Response<SuccessBody<T>> {
    return res.status(HttpStatus.OK).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
      requestId: requestIdOf(res),
    });
  },

  /** 200 with a page of results plus pagination metadata. */
  paginated<T>(
    res: Response,
    items: T[],
    meta: PaginationMeta,
    message: string = CommonMessages.FETCHED,
  ): Response<SuccessBody<T[]>> {
    return res.status(HttpStatus.OK).json({
      success: true,
      message,
      data: items,
      meta,
      timestamp: new Date().toISOString(),
      requestId: requestIdOf(res),
    });
  },

  /** 201 — resource created. */
  created<T>(res: Response, data: T, message: string): Response<SuccessBody<T>> {
    return res.status(HttpStatus.CREATED).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
      requestId: requestIdOf(res),
    });
  },

  /**
   * 200 for deletes rather than 204.
   * Deliberate: the frontend surfaces a toast built from `message`, and a 204
   * carries no body. Consistency beats REST purism here.
   */
  deleted(res: Response, message: string): Response<SuccessBody<null>> {
    return res.status(HttpStatus.OK).json({
      success: true,
      message,
      data: null,
      timestamp: new Date().toISOString(),
      requestId: requestIdOf(res),
    });
  },

  /** 204 — used where a body genuinely adds nothing (e.g. logout). */
  noContent(res: Response): Response {
    return res.status(HttpStatus.NO_CONTENT).send();
  },

  /** Failure envelope. Only the error middleware should call this directly. */
  error(
    res: Response,
    statusCode: HttpStatusCode,
    message: string,
    code: ErrorCodeValue,
    details?: unknown,
    stack?: string,
  ): Response<ErrorBody> {
    return res.status(statusCode).json({
      success: false,
      message,
      error: {
        code,
        ...(details !== undefined ? { details } : {}),
        ...(stack !== undefined ? { stack } : {}),
      },
      timestamp: new Date().toISOString(),
      requestId: requestIdOf(res),
    });
  },
};
