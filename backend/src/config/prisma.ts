/**
 * Prisma client singleton.
 *
 * Two things matter here:
 *  1. In development `tsx watch` re-evaluates modules on every save. Without a
 *     global cache each reload would open a brand-new connection pool and
 *     exhaust Postgres connections within a minute. We therefore stash the
 *     client on `globalThis`.
 *  2. Query events are piped into our logger so slow queries are visible in
 *     development without dragging in an APM dependency.
 */
import { PrismaClient, Prisma } from '@prisma/client';

import { env } from './env';
import { logger } from '../utils/logger';

/** Slow-query threshold (ms). Anything above this is surfaced as a warning. */
const SLOW_QUERY_THRESHOLD_MS = 300;

const createPrismaClient = (): PrismaClient => {
  const client = new PrismaClient({
    log: env.isProduction
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ],
    errorFormat: env.isProduction ? 'minimal' : 'pretty',
  });

  if (!env.isProduction) {
    client.$on('query' as never, (event: Prisma.QueryEvent) => {
      if (event.duration >= SLOW_QUERY_THRESHOLD_MS) {
        logger.warn('Slow database query detected', {
          durationMs: event.duration,
          query: event.query,
        });
      } else {
        logger.debug(`prisma ${event.duration}ms`, { query: event.query });
      }
    });
  }

  client.$on('warn' as never, (event: Prisma.LogEvent) => {
    logger.warn(`prisma: ${event.message}`);
  });

  client.$on('error' as never, (event: Prisma.LogEvent) => {
    logger.error(`prisma: ${event.message}`);
  });

  return client;
};

// Reuse the client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

/**
 * Verifies database connectivity during boot. We prefer failing at startup over
 * serving 500s once traffic arrives.
 */
export const connectDatabase = async (): Promise<void> => {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Database connection established');
};

/** Graceful shutdown hook — called from the server's SIGTERM/SIGINT handlers. */
export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  logger.info('Database connection closed');
};

/**
 * Transaction client type. Repositories accept this so that any repository call
 * can participate in an outer transaction (used heavily by the challan service).
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Either the root client or an active transaction — repositories accept both. */
export type DbClient = PrismaClient | PrismaTransactionClient;
