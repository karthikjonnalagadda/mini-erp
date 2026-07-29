/**
 * Uniform API envelope.
 *
 * Every response this service emits — success or failure — has the same top
 * level shape. Clients can therefore write one response interceptor and one
 * error handler instead of special-casing per endpoint.
 *
 *   { success: true,  message, data, meta?, timestamp, requestId? }
 *   { success: false, message, error: { code, details? }, timestamp, requestId? }
 *
 * Each helper builds a typed body object and then sends it, rather than
 * inlining the literal into `res.json()`. That ordering matters: `res.json()`
 * accepts `any` and returns `Response<any>`, so an inline literal is never
 * checked against `SuccessBody<T>` and the return value silently poisons the
 * caller's types. Constructing the body first makes the compiler verify the
 * envelope; the helpers return `void` because Express ignores handler return
 * values anyway.
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

/** Builds the common fields shared by every success envelope. */
const successEnvelope = <T>(
  res: Response,
  data: T,
  message: string,
  meta?: PaginationMeta,
): SuccessBody<T> => ({
  success: true,
  message,
  data,
  ...(meta ? { meta } : {}),
  timestamp: new Date().toISOString(),
  ...(requestIdOf(res) ? { requestId: requestIdOf(res) } : {}),
});

export const ApiResponse = {
  /** 200 with a payload. */
  ok<T>(res: Response, data: T, message: string = CommonMessages.FETCHED): void {
    const body: SuccessBody<T> = successEnvelope(res, data, message);
    res.status(HttpStatus.OK).json(body);
  },

  /** 200 with a page of results plus pagination metadata. */
  paginated<T>(
    res: Response,
    items: T[],
    meta: PaginationMeta,
    message: string = CommonMessages.FETCHED,
  ): void {
    const body: SuccessBody<T[]> = successEnvelope(res, items, message, meta);
    res.status(HttpStatus.OK).json(body);
  },

  /** 201 — resource created. */
  created<T>(res: Response, data: T, message: string): void {
    const body: SuccessBody<T> = successEnvelope(res, data, message);
    res.status(HttpStatus.CREATED).json(body);
  },

  /**
   * 200 for deletes rather than 204.
   * Deliberate: the frontend surfaces a toast built from `message`, and a 204
   * carries no body. Consistency beats REST purism here.
   */
  deleted(res: Response, message: string): void {
    const body: SuccessBody<null> = successEnvelope(res, null, message);
    res.status(HttpStatus.OK).json(body);
  },

  /** 204 — used where a body genuinely adds nothing. */
  noContent(res: Response): void {
    res.status(HttpStatus.NO_CONTENT).send();
  },

  /** Failure envelope. Only the error middleware should call this directly. */
  error(
    res: Response,
    statusCode: HttpStatusCode,
    message: string,
    code: ErrorCodeValue,
    details?: unknown,
    stack?: string,
  ): void {
    const body: ErrorBody = {
      success: false,
      message,
      error: {
        code,
        ...(details !== undefined ? { details } : {}),
        ...(stack !== undefined ? { stack } : {}),
      },
      timestamp: new Date().toISOString(),
      ...(requestIdOf(res) ? { requestId: requestIdOf(res) } : {}),
    };

    res.status(statusCode).json(body);
  },
};
