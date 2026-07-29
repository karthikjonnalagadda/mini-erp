/**
 * Express 4 does not forward rejected promises from async handlers to the error
 * middleware — an unhandled rejection would hang the request until the client
 * times out. Every controller method is therefore wrapped in `asyncHandler`,
 * which funnels rejections into `next()`.
 *
 * (Express 5 fixes this natively; this wrapper is the reason we can migrate
 * later by deleting one file rather than touching every route.)
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler =
  (handler: AsyncRequestHandler): RequestHandler =>
  (req, res, next): void => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
