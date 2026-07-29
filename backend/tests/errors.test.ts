/**
 * Error hierarchy.
 *
 * These assertions pin the API's failure contract: status codes and `errorCode`
 * values are consumed by the frontend's interceptor, so changing one silently
 * would break client behaviour (most importantly TOKEN_EXPIRED, which drives
 * the silent-refresh flow).
 */
import { describe, expect, it } from 'vitest';

import { ErrorCode, HttpStatus } from '../src/constants/http-status';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  DuplicateResourceError,
  ForbiddenError,
  InsufficientStockError,
  InvalidStateTransitionError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  isAppError,
} from '../src/utils/errors';

describe('AppError', () => {
  it('defaults to a non-recoverable 500', () => {
    const error = new AppError('boom');
    expect(error.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(error.errorCode).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.isOperational).toBe(true);
  });

  it('reports the concrete subclass name, which drives log grouping', () => {
    expect(new NotFoundError('Customer').name).toBe('NotFoundError');
    expect(new ConflictError().name).toBe('ConflictError');
  });

  it('is recognised by the narrowing helper', () => {
    expect(isAppError(new ForbiddenError())).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});

describe('status-code mapping', () => {
  it('maps each error class to its documented HTTP status', () => {
    expect(new UnauthorizedError().statusCode).toBe(401);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new NotFoundError('Product').statusCode).toBe(404);
    expect(new ConflictError().statusCode).toBe(409);
    expect(new ValidationError().statusCode).toBe(422);
    expect(new BusinessRuleError('nope').statusCode).toBe(422);
  });

  it('preserves the specific auth error code used by the client interceptor', () => {
    const expired = new UnauthorizedError('expired', ErrorCode.TOKEN_EXPIRED);
    expect(expired.errorCode).toBe(ErrorCode.TOKEN_EXPIRED);
  });
});

describe('NotFoundError', () => {
  it('includes the identifier when one is supplied', () => {
    expect(new NotFoundError('Customer', 'abc-123').message).toBe(
      "Customer with identifier 'abc-123' was not found",
    );
  });

  it('omits the identifier clause otherwise', () => {
    expect(new NotFoundError('Customer').message).toBe('Customer was not found');
  });
});

describe('DuplicateResourceError', () => {
  it('carries the offending field so the form can highlight it', () => {
    const error = new DuplicateResourceError('Mobile already in use', 'mobile');
    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe(ErrorCode.DUPLICATE_RESOURCE);
    expect(error.details).toEqual({ field: 'mobile' });
  });
});

describe('InsufficientStockError', () => {
  const shortages = [
    { productId: 'p1', sku: 'ELE-WIR-1SQ', name: 'Copper Wire', requested: 50, available: 12 },
    { productId: 'p2', sku: 'PLM-ELB-110', name: 'PVC Elbow', requested: 30, available: 0 },
  ];

  it('summarises every shortage in the message', () => {
    const error = new InsufficientStockError(shortages);
    expect(error.message).toContain('ELE-WIR-1SQ (requested 50, available 12)');
    expect(error.message).toContain('PLM-ELB-110 (requested 30, available 0)');
  });

  it('exposes structured detail the UI can render per line', () => {
    const error = new InsufficientStockError(shortages);
    expect(error.statusCode).toBe(422);
    expect(error.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK);
    expect(error.details).toEqual({ shortages });
  });
});

describe('InvalidStateTransitionError', () => {
  it('names both ends of the rejected transition', () => {
    const error = new InvalidStateTransitionError('challan', 'CANCELLED', 'CONFIRMED');
    expect(error.message).toBe('A challan cannot move from CANCELLED to CONFIRMED');
    expect(error.errorCode).toBe(ErrorCode.INVALID_STATE_TRANSITION);
    expect(error.details).toEqual({
      entity: 'challan',
      from: 'CANCELLED',
      to: 'CONFIRMED',
    });
  });
});

describe('ValidationError', () => {
  it('carries field-level detail for the form to consume', () => {
    const error = new ValidationError('Validation failed', [
      { field: 'email', message: 'Enter a valid email address', code: 'invalid_string' },
    ]);

    expect(error.statusCode).toBe(422);
    expect(Array.isArray(error.details)).toBe(true);
    expect((error.details as Array<{ field: string }>)[0]?.field).toBe('email');
  });
});
