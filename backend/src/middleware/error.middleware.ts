/**
 * Global error handling — the single exit point for every failure in the API.
 *
 * Responsibilities, in order:
 *   1. Translate infrastructure errors (Prisma, Zod, JWT, body-parser) into our
 *      own `AppError` hierarchy. Layers below never leak vendor error types.
 *   2. Decide what the client is allowed to see. Operational errors return
 *      their message; unexpected errors return a generic message in production
 *      and the real one in development.
 *   3. Log with the right severity — 5xx as errors (page someone), 4xx as
 *      warnings (usually the client's fault, still worth trending).
 *
 * Express identifies an error handler purely by its four-parameter signature,
 * which is why `_next` is present and unused.
 */
import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env';
import { ErrorCode, HttpStatus } from '../constants/http-status';
import { CommonMessages } from '../constants/messages';
import { ApiResponse } from '../utils/api-response';
import {
  AppError,
  BadRequestError,
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';
import type { FieldError } from '../utils/errors';
import { logger } from '../utils/logger';

/** Extracts the offending column(s) from a Prisma P2002 unique-constraint error. */
const uniqueTargetOf = (error: Prisma.PrismaClientKnownRequestError): string => {
  const target = error.meta?.['target'];
  if (Array.isArray(target)) return target.join(', ');
  if (typeof target === 'string') return target;
  return 'field';
};

/**
 * Maps Prisma's error codes onto HTTP semantics.
 * https://www.prisma.io/docs/reference/api-reference/error-reference
 */
const fromPrismaError = (error: Prisma.PrismaClientKnownRequestError): AppError => {
  switch (error.code) {
    case 'P2002': {
      const field = uniqueTargetOf(error);
      return new ConflictError(
        `A record with this ${field} already exists`,
        ErrorCode.DUPLICATE_RESOURCE,
        { field },
      );
    }
    case 'P2003': {
      // FK violation — the client referenced something that does not exist.
      // `meta` is loosely typed by Prisma, so narrow rather than stringify:
      // `String({})` would put "[object Object]" in the client's error detail.
      const fieldName = error.meta?.['field_name'];
      return new BadRequestError('A referenced record does not exist', {
        field: typeof fieldName === 'string' ? fieldName : 'reference',
      });
    }
    case 'P2014':
      return new ConflictError(
        'This change would break a required relation between records',
        ErrorCode.CONFLICT,
      );
    case 'P2025':
      // "Record to update/delete does not exist."
      return new NotFoundError('Record');
    case 'P2000':
      return new BadRequestError('A provided value is too long for its column');
    case 'P2011':
      return new BadRequestError('A required field was null');
    default:
      return new DatabaseError('A database error occurred', { prismaCode: error.code });
  }
};

/** Converts a stray ZodError (thrown outside the validate middleware) to 422. */
const fromZodError = (error: ZodError): ValidationError => {
  const details: FieldError[] = error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
    code: issue.code,
  }));
  return new ValidationError(CommonMessages.VALIDATION_FAILED, details);
};

/** Normalises anything thrown anywhere into an AppError. */
const normalizeError = (error: unknown): AppError => {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return fromZodError(error);

  if (error instanceof Prisma.PrismaClientKnownRequestError) return fromPrismaError(error);

  if (error instanceof Prisma.PrismaClientValidationError) {
    // Almost always a bug in our query construction, not the client's fault.
    return new DatabaseError('Invalid database query');
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new DatabaseError('The database is currently unavailable');
  }

  // body-parser surfaces malformed JSON as a SyntaxError carrying `body`.
  if (error instanceof SyntaxError && 'body' in error) {
    return new BadRequestError('Request body contains malformed JSON');
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error).type === 'entity.too.large'
  ) {
    return new AppError(
      'Request body exceeds the maximum allowed size',
      HttpStatus.PAYLOAD_TOO_LARGE,
      ErrorCode.PAYLOAD_TOO_LARGE,
    );
  }

  // Anything reaching here is an unhandled bug: mark it non-operational so the
  // message is suppressed in production and it is logged at ERROR.
  const message = error instanceof Error ? error.message : 'Unknown error';
  return new AppError(
    message,
    HttpStatus.INTERNAL_SERVER_ERROR,
    ErrorCode.INTERNAL_ERROR,
    undefined,
    false,
  );
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const appError = normalizeError(error);

  const logMeta = {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    status: appError.statusCode,
    errorCode: appError.errorCode,
    userId: req.user?.id,
  };

  if (appError.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR || !appError.isOperational) {
    logger.error(`Unhandled failure: ${appError.message}`, error, logMeta);
  } else {
    logger.warn(`Request rejected: ${appError.message}`, logMeta);
  }

  // Never surface an internal message or stack trace in production.
  const clientMessage =
    appError.isOperational || !env.isProduction ? appError.message : CommonMessages.INTERNAL_ERROR;

  const stack = env.isProduction ? undefined : (error as Error)?.stack;

  ApiResponse.error(
    res,
    appError.statusCode,
    clientMessage,
    appError.errorCode,
    appError.details,
    stack,
  );
};

/**
 * 404 handler for unmatched routes. Mounted after all routers but before the
 * error handler, so unknown paths flow through the same envelope as everything
 * else instead of hitting Express's HTML default page.
 */
export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(
    new AppError(
      `${CommonMessages.ROUTE_NOT_FOUND}: ${req.method} ${req.originalUrl}`,
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
    ),
  );
};
