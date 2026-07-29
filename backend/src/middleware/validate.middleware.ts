/**
 * Zod validation middleware.
 *
 * Two guarantees this provides:
 *
 *  1. TYPE SAFETY AT THE BOUNDARY. Controllers read `req.body` / `req.query`
 *     knowing the data is already parsed and coerced (query strings become
 *     numbers, ISO strings become Dates). No controller performs a cast.
 *
 *  2. STRIPPING. Zod object schemas drop unknown keys by default, so a client
 *     cannot smuggle `{ "role": "ADMIN" }` into a profile update and have it
 *     reach Prisma — mass-assignment is structurally impossible.
 *
 * All issues from all three sources are collected into ONE 422 response so the
 * form can highlight every bad field at once, rather than making the user fix
 * errors one round-trip at a time.
 */
import type { NextFunction, Request, Response } from 'express';
import type { ZodError } from 'zod';
import type { ZodTypeAny } from 'zod';

import { CommonMessages } from '../constants/messages';
import { ValidationError } from '../utils/errors';
import type { FieldError } from '../utils/errors';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Flattens Zod issues into the `{ field, message, code }[]` shape our API returns. */
const toFieldErrors = (error: ZodError, source: keyof ValidationSchemas): FieldError[] =>
  error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : source,
    message: issue.message,
    code: issue.code,
  }));

export const validate =
  (schemas: ValidationSchemas) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const errors: FieldError[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data as Record<string, unknown>;
      } else {
        errors.push(...toFieldErrors(result.error, 'body'));
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        // `req.query` cannot be reassigned reliably in Express 4 — Object.assign
        // onto the existing reference is the portable approach. We stash the
        // parsed result on `res.locals` too, so controllers get the coerced
        // types (numbers/Dates) rather than the string-typed originals.
        Object.assign(req.query, result.data as Record<string, unknown>);
        // `res.locals` is `Record<string, any>`; narrowing the target keeps the
        // assignment from being an unchecked `any` write.
        (_res.locals as { query?: unknown }).query = result.data as unknown;
      } else {
        errors.push(...toFieldErrors(result.error, 'query'));
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        Object.assign(req.params, result.data as Record<string, string>);
      } else {
        errors.push(...toFieldErrors(result.error, 'params'));
      }
    }

    if (errors.length > 0) {
      next(new ValidationError(CommonMessages.VALIDATION_FAILED, errors));
      return;
    }

    next();
  };

/**
 * Typed accessor for a validated query object.
 *
 * Controllers call `getValidatedQuery<CustomerListQuery>(res)` instead of
 * casting `req.query`, which keeps the cast in exactly one place.
 *
 * The cast goes through `unknown` deliberately: `res.locals` is typed
 * `Record<string, any>` by Express, and returning that `any` directly would
 * silently poison the caller's type — every downstream argument would become
 * unchecked. Narrowing to `unknown` first forces this one line to be the only
 * unsafe step, and it is guarded by the `validate` middleware that populated it.
 */
export const getValidatedQuery = <T>(res: Response): T =>
  (res.locals as { query?: unknown }).query as T;
