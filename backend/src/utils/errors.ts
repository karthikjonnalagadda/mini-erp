/**
 * Custom error hierarchy.
 *
 * Every error thrown intentionally by the application extends `AppError`. The
 * global error middleware can then distinguish "expected" failures (which carry
 * a safe, client-facing message) from genuine bugs (which must never leak an
 * internal message or stack trace to the client).
 *
 * `isOperational` is the switch: true  -> a handled business/HTTP condition,
 *                                false -> an unexpected crash worth alerting on.
 */
import { ErrorCode, HttpStatus } from '../constants/http-status';
import type { ErrorCodeValue, HttpStatusCode } from '../constants/http-status';

/** Field-level detail returned alongside 422 responses. */
export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export class AppError extends Error {
  public readonly statusCode: HttpStatusCode;
  public readonly errorCode: ErrorCodeValue;
  public readonly isOperational: boolean;
  public readonly details?: FieldError[] | Record<string, unknown>;

  constructor(
    message: string,
    statusCode: HttpStatusCode = HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: ErrorCodeValue = ErrorCode.INTERNAL_ERROR,
    details?: FieldError[] | Record<string, unknown>,
    isOperational = true,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.details = details;

    // Keeps the stack trace pointing at the throw site, not at this constructor.
    Error.captureStackTrace(this, new.target);
  }
}

/** 400 — the request itself is malformed (bad query params, unusable body). */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: FieldError[] | Record<string, unknown>) {
    super(message, HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST, details);
  }
}

/** 401 — no credentials, or credentials that cannot be trusted. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', errorCode: ErrorCodeValue = ErrorCode.UNAUTHORIZED) {
    super(message, HttpStatus.UNAUTHORIZED, errorCode);
  }
}

/** 403 — authenticated, but the role is not permitted to do this. */
export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to perform this action',
    details?: Record<string, unknown>,
  ) {
    super(message, HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, details);
  }
}

/** 404 — resource does not exist (or is soft-deleted / out of the caller's scope). */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource', identifier?: string) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' was not found`
      : `${resource} was not found`;
    super(message, HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
  }
}

/** 409 — the request conflicts with current state (duplicates, stale writes). */
export class ConflictError extends AppError {
  constructor(
    message = 'The request conflicts with the current state of the resource',
    errorCode: ErrorCodeValue = ErrorCode.CONFLICT,
    details?: Record<string, unknown>,
  ) {
    super(message, HttpStatus.CONFLICT, errorCode, details);
  }
}

/** 409 — a uniqueness constraint was violated. */
export class DuplicateResourceError extends ConflictError {
  constructor(message: string, field?: string) {
    super(message, ErrorCode.DUPLICATE_RESOURCE, field ? { field } : undefined);
  }
}

/** 422 — syntactically valid, semantically rejected by Zod. */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details: FieldError[] = []) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, details);
  }
}

/**
 * 422 — a domain invariant was violated (e.g. confirming an already-cancelled
 * challan). Distinct from ValidationError so the UI can style it differently:
 * the user's *input* was fine, the *operation* was not allowed.
 */
export class BusinessRuleError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.BUSINESS_RULE_VIOLATION, details);
  }
}

/** 422 — specialised business rule with the data the UI needs to explain itself. */
export class InsufficientStockError extends AppError {
  constructor(
    shortages: Array<{ productId: string; sku: string; name: string; requested: number; available: number }>,
  ) {
    const summary = shortages
      .map((s) => `${s.sku} (requested ${s.requested}, available ${s.available})`)
      .join('; ');
    super(
      `Insufficient stock for: ${summary}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.INSUFFICIENT_STOCK,
      { shortages },
    );
  }
}

/** 422 — an illegal status transition was attempted. */
export class InvalidStateTransitionError extends AppError {
  constructor(entity: string, from: string, to: string) {
    super(
      `A ${entity} cannot move from ${from} to ${to}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.INVALID_STATE_TRANSITION,
      { entity, from, to },
    );
  }
}

/** 429 — rate limiter tripped. */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', retryAfterSeconds?: number) {
    super(message, HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMIT_EXCEEDED, {
      retryAfterSeconds,
    });
  }
}

/** 500 — database failure we could classify but not recover from. */
export class DatabaseError extends AppError {
  constructor(message = 'A database error occurred', details?: Record<string, unknown>) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.DATABASE_ERROR, details, false);
  }
}

/** 503 — a dependency is down; the client should retry. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.SERVICE_UNAVAILABLE);
  }
}

/** Narrowing helper used by the error middleware and tests. */
export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
