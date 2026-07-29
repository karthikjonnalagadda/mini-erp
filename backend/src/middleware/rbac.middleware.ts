/**
 * Role-Based Access Control.
 *
 * The permission model is intentionally small and declarative:
 *
 *   ADMIN     — unrestricted; the only role that manages users and roles.
 *   SALES     — owns the CRM and creates/edits sales challans. Cannot confirm
 *               a challan (that deducts stock) and cannot touch the catalogue.
 *   WAREHOUSE — owns the catalogue and inventory. Confirms and dispatches
 *               challans. Cannot see credit limits or customer financials.
 *   ACCOUNTS  — read-only across the operational data, plus cancellation
 *               rights (a cancelled challan is a financial correction).
 *
 * Separation of duties is the point: the person who raises the document is not
 * the person who releases the stock.
 */
import type { RoleName } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';

import { ErrorCode } from '../constants/http-status';
import { AuthMessages, CommonMessages } from '../constants/messages';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

/**
 * Guards a route to an explicit allow-list of roles.
 * Must be mounted *after* `authenticate`.
 *
 * @example router.post('/', authenticate, authorize('ADMIN', 'SALES'), handler)
 */
export const authorize =
  (...allowedRoles: RoleName[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      // A misconfigured route (authorize without authenticate) must fail closed.
      next(new UnauthorizedError(AuthMessages.MISSING_TOKEN, ErrorCode.UNAUTHORIZED));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(
        new ForbiddenError(CommonMessages.FORBIDDEN, {
          requiredRoles: allowedRoles,
          actualRole: req.user.role,
        }),
      );
      return;
    }

    next();
  };

/** Shorthand for the most common guard. */
export const adminOnly = authorize('ADMIN');

/**
 * Named role bundles.
 *
 * Routes reference these instead of listing roles inline, so a policy change
 * ("ACCOUNTS may now edit customers") is a one-line edit here rather than a
 * search-and-replace across the router files. This is the Open/Closed principle
 * applied to authorisation.
 */
export const RolePolicy = {
  /** Full administrative control. */
  MANAGE_USERS: ['ADMIN'] as RoleName[],
  MANAGE_ROLES: ['ADMIN'] as RoleName[],

  /** CRM. */
  VIEW_CUSTOMERS: ['ADMIN', 'SALES', 'ACCOUNTS', 'WAREHOUSE'] as RoleName[],
  MANAGE_CUSTOMERS: ['ADMIN', 'SALES'] as RoleName[],
  DELETE_CUSTOMERS: ['ADMIN'] as RoleName[],

  /** Catalogue. */
  VIEW_PRODUCTS: ['ADMIN', 'SALES', 'WAREHOUSE', 'ACCOUNTS'] as RoleName[],
  MANAGE_PRODUCTS: ['ADMIN', 'WAREHOUSE'] as RoleName[],
  DELETE_PRODUCTS: ['ADMIN'] as RoleName[],

  /** Inventory — deliberately narrow. */
  VIEW_INVENTORY: ['ADMIN', 'SALES', 'WAREHOUSE', 'ACCOUNTS'] as RoleName[],
  ADJUST_STOCK: ['ADMIN', 'WAREHOUSE'] as RoleName[],

  /** Sales documents — separation of duties. */
  VIEW_CHALLANS: ['ADMIN', 'SALES', 'WAREHOUSE', 'ACCOUNTS'] as RoleName[],
  CREATE_CHALLANS: ['ADMIN', 'SALES'] as RoleName[],
  /** Confirmation moves physical stock, so it belongs to the warehouse. */
  CONFIRM_CHALLANS: ['ADMIN', 'WAREHOUSE'] as RoleName[],
  /** Cancellation reverses a financial document. */
  CANCEL_CHALLANS: ['ADMIN', 'ACCOUNTS'] as RoleName[],

  /** Compliance. */
  VIEW_AUDIT_LOGS: ['ADMIN', 'ACCOUNTS'] as RoleName[],
} as const;

/** Applies a named policy: `authorizePolicy(RolePolicy.CONFIRM_CHALLANS)`. */
export const authorizePolicy = (
  policy: readonly RoleName[],
): ((req: Request, res: Response, next: NextFunction) => void) => authorize(...policy);
