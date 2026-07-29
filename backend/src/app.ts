/**
 * Express application assembly.
 *
 * MIDDLEWARE ORDER IS THE CONTRACT OF THIS FILE. Each layer depends on the
 * previous one having run:
 *
 *   1. trust proxy    — so `req.ip` is the client, not the load balancer
 *   2. helmet         — security headers before anything can respond
 *   3. CORS           — reject disallowed origins before parsing a body
 *   4. compression    — wraps the response stream
 *   5. body parsers   — populate `req.body`
 *   6. cookie parser  — populates `req.cookies` (refresh token)
 *   7. request context— assigns the request id everything else logs with
 *   8. sanitisation   — normalises input before validation sees it
 *   9. rate limiting  — cheap rejection before touching the database
 *  10. routes
 *  11. 404 handler    — anything unmatched
 *  12. error handler  — must be LAST; Express identifies it by arity
 *
 * `app` is exported without listening so integration tests can drive it with
 * supertest and never bind a port.
 */
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { Application, Request, Response } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env';
import { prisma } from './config/prisma';
import { openApiSpec } from './config/swagger';
import { MAX_JSON_BODY_SIZE } from './constants/app.constants';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { apiLimiter } from './middleware/rate-limit.middleware';
import { requestContext } from './middleware/request-context.middleware';
import { sanitizeRequest } from './middleware/sanitize.middleware';
import routes from './routes';
import { logger } from './utils/logger';

export const createApp = (): Application => {
  const app = express();

  // -------------------------------------------------------------------------
  // 1. Proxy awareness
  //
  // Render/Vercel terminate TLS at their edge and forward via X-Forwarded-*.
  // Without this, every request appears to originate from the proxy, which
  // breaks both rate limiting (one bucket for the whole world) and audit IPs.
  // Set to 1 rather than `true`: trusting an unbounded chain lets a client
  // spoof its own X-Forwarded-For.
  // -------------------------------------------------------------------------
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // -------------------------------------------------------------------------
  // 2. Security headers
  // -------------------------------------------------------------------------
  app.use(
    helmet({
      // This service is a JSON API; the only HTML it serves is Swagger UI,
      // which needs inline styles/scripts. CSP is scoped accordingly rather
      // than disabled outright.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      // The SPA is on a different origin and must be able to read responses.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: env.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // -------------------------------------------------------------------------
  // 3. CORS
  //
  // `credentials: true` is required for the httpOnly refresh cookie to be sent
  // cross-origin, and it makes a wildcard origin illegal — hence the explicit
  // allow-list from the environment.
  // -------------------------------------------------------------------------
  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin requests and server-to-server clients (curl, Postman)
        // send no Origin header; those are not subject to CORS at all.
        if (!origin) return callback(null, true);

        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);

        logger.warn('Blocked CORS request from disallowed origin', { origin });
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining'],
      maxAge: 86_400, // cache the preflight for a day
    }),
  );

  // -------------------------------------------------------------------------
  // 4-6. Payload handling
  // -------------------------------------------------------------------------
  app.use(compression());
  app.use(express.json({ limit: MAX_JSON_BODY_SIZE }));
  app.use(express.urlencoded({ extended: true, limit: MAX_JSON_BODY_SIZE }));
  app.use(cookieParser());

  // -------------------------------------------------------------------------
  // 7-8. Observability and input hygiene
  // -------------------------------------------------------------------------
  app.use(requestContext);
  app.use(sanitizeRequest);

  // -------------------------------------------------------------------------
  // Health probes — mounted BEFORE the rate limiter and outside the API prefix
  // so orchestrators can always reach them.
  // -------------------------------------------------------------------------

  /** Liveness: is the process up? Deliberately does not touch the database. */
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Readiness: can we serve traffic? Checks the database.
   * Returning 503 here makes a load balancer drain this instance instead of
   * sending it requests it cannot fulfil.
   */
  app.get('/health/ready', (_req: Request, res: Response) => {
    void (async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ status: 'ready', database: 'connected' });
      } catch (error) {
        logger.error('Readiness probe failed', error);
        res.status(503).json({ status: 'unavailable', database: 'disconnected' });
      }
    })();
  });

  // -------------------------------------------------------------------------
  // 9. Rate limiting, then 10. routes
  // -------------------------------------------------------------------------
  app.use(env.API_PREFIX, apiLimiter);

  // Interactive API documentation.
  app.use(
    `${env.API_PREFIX}/docs`,
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'Mini ERP + CRM API Reference',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'none', filter: true },
    }),
  );

  // Raw spec, for client generators and Postman imports.
  app.get(`${env.API_PREFIX}/openapi.json`, (_req: Request, res: Response) => {
    res.json(openApiSpec);
  });

  app.use(env.API_PREFIX, routes);

  // Root convenience redirect.
  app.get('/', (_req: Request, res: Response) => {
    res.redirect(`${env.API_PREFIX}/docs`);
  });

  // -------------------------------------------------------------------------
  // 11-12. Failure handling — order matters, error handler must be last.
  // -------------------------------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
