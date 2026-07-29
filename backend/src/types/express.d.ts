/**
 * Express type augmentation.
 *
 * Attaching request-scoped data to `req` is idiomatic Express, but doing it
 * untyped (`(req as any).user`) leaks `any` into every controller. Declaring the
 * augmentation once here means `req.user` is fully typed — and, critically,
 * *optional*, so TypeScript forces every handler to prove authentication ran.
 */
import type { RoleName } from '@prisma/client';

/** Identity resolved from a verified access token by `authenticate`. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: RoleName;
  firstName: string;
  lastName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present only after the `authenticate` middleware has run. */
      user?: AuthenticatedUser;
      /** Correlation id shared by logs, audit rows and the error envelope. */
      requestId: string;
      /** High-resolution start time, used to compute response duration. */
      startTime: number;
    }
  }
}

export {};
