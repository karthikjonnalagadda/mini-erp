/**
 * Process entry point.
 *
 * Responsibilities beyond `app.listen`:
 *
 *  - VERIFY THE DATABASE BEFORE ACCEPTING TRAFFIC. Booting into a broken
 *    database means every request 500s while the platform's health check reports
 *    "started". Failing at boot makes a bad deploy roll back automatically.
 *
 *  - GRACEFUL SHUTDOWN. Render/Kubernetes send SIGTERM and then SIGKILL after a
 *    grace period. Without a handler, in-flight requests are severed mid-write.
 *    We stop accepting connections, let open requests finish, close the database
 *    pool, then exit.
 *
 *  - FAIL FAST ON PROGRAMMER ERROR. An unhandled rejection leaves the process in
 *    an unknown state; the honest response is to log loudly and let the
 *    supervisor restart a clean process.
 */
import type { Server } from 'node:http';

import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/prisma';
import { refreshTokenRepository } from './repositories/refresh-token.repository';
import { logger } from './utils/logger';

/** Seconds to let in-flight requests finish before forcing exit. */
const SHUTDOWN_GRACE_MS = 10_000;

/** How often to sweep expired refresh tokens. */
const TOKEN_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

let server: Server | undefined;
let cleanupTimer: NodeJS.Timeout | undefined;
let isShuttingDown = false;

const startCleanupJob = (): void => {
  const prune = (): void => {
    void refreshTokenRepository
      .pruneExpired()
      .then((count) => {
        if (count > 0) logger.info('Pruned expired refresh tokens', { count });
      })
      .catch((error: unknown) => {
        // Housekeeping failure must never take the service down.
        logger.error('Refresh-token cleanup failed', error);
      });
  };

  // `unref()` so this timer never keeps the event loop (and the process) alive
  // during shutdown.
  cleanupTimer = setInterval(prune, TOKEN_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
  prune(); // run once at boot
};

const start = async (): Promise<void> => {
  try {
    await connectDatabase();

    const app = createApp();

    server = app.listen(env.PORT, () => {
      logger.info('API server started', {
        port: env.PORT,
        environment: env.NODE_ENV,
        apiPrefix: env.API_PREFIX,
        docs: `http://localhost:${env.PORT}${env.API_PREFIX}/docs`,
      });
    });

    // Surface bind failures (port in use, permission denied) clearly.
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${env.PORT} is already in use`, error);
      } else {
        logger.error('HTTP server error', error);
      }
      process.exit(1);
    });

    startCleanupJob();
  } catch (error) {
    logger.error('Failed to start the API server', error);
    await disconnectDatabase().catch(() => undefined);
    process.exit(1);
  }
};

/**
 * Idempotent shutdown. Both SIGTERM and SIGINT can arrive, and a slow shutdown
 * may receive a second signal — the guard prevents a double-close.
 */
const shutdown = (signal: string): void => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully`);

  if (cleanupTimer) clearInterval(cleanupTimer);

  // Hard deadline: if a request hangs, we still exit before the platform SIGKILLs
  // us mid-transaction.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forceExit.unref();

  const finish = (): void => {
    void disconnectDatabase()
      .then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error('Error during database disconnect', error);
        process.exit(1);
      });
  };

  if (server) {
    server.close(() => finish());
  } else {
    finish();
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * An unhandled rejection means a promise failed with nobody to handle it. The
 * process state is now unknown, so we log and restart rather than limping on
 * and corrupting data.
 */
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', reason);
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', error);
  shutdown('uncaughtException');
});

void start();
