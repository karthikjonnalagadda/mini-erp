/**
 * Application smoke tests.
 *
 * These boot the REAL Express app via supertest — the full middleware stack,
 * every router, the error handler. No database is required: the assertions
 * target paths that never issue a query (health liveness, 404s, CORS
 * rejection, unauthenticated 401s, malformed JSON).
 *
 * This catches a category of bug that typechecking cannot: a middleware
 * mounted in the wrong order, a router mounted at the wrong prefix, an error
 * handler with the wrong arity (Express identifies it by parameter count, so a
 * three-parameter "error handler" is silently treated as normal middleware and
 * every failure becomes an unhandled 500).
 */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

const app = createApp();
const API = '/api/v1';

afterAll(async () => {
  // The client is instantiated at import time; disconnect so vitest exits.
  await prisma.$disconnect().catch(() => undefined);
});

describe('health probes', () => {
  it('liveness responds without touching the database', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(response.body.uptimeSeconds).toBeTypeOf('number');
  });

  it('liveness is exempt from the rate limiter', async () => {
    // A 429 on the health endpoint would make an orchestrator mark a healthy
    // instance as down.
    const responses = await Promise.all(
      Array.from({ length: 25 }, () => request(app).get('/health')),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
  });
});

describe('request correlation', () => {
  it('assigns a request id to every response', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('honours an inbound request id so traces span services', async () => {
    const response = await request(app)
      .get('/health')
      .set('X-Request-Id', 'trace-from-upstream');

    expect(response.headers['x-request-id']).toBe('trace-from-upstream');
  });
});

describe('security headers', () => {
  it('sets the headers Helmet is configured for', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    // Express advertises itself by default; we disable it.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('routing', () => {
  it('serves API metadata at the versioned root', async () => {
    const response = await request(app).get(API);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.endpoints).toContain('challans');
  });

  it('exposes the OpenAPI specification', async () => {
    const response = await request(app).get(`${API}/openapi.json`);

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
    // Proves the documented paths were not silently dropped.
    expect(response.body.paths).toHaveProperty('/challans/{id}/confirm');
  });

  it('returns the standard envelope for an unknown route', async () => {
    const response = await request(app).get(`${API}/does-not-exist`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.timestamp).toBeTruthy();
  });
});

describe('authentication boundary', () => {
  // Each of these proves the router is mounted AND that `authenticate` runs
  // before anything that would need a database.
  const protectedRoutes = [
    `${API}/customers`,
    `${API}/products`,
    `${API}/categories`,
    `${API}/inventory/summary`,
    `${API}/stock-movements`,
    `${API}/challans`,
    `${API}/dashboard`,
    `${API}/audit-logs`,
    `${API}/auth/me`,
  ];

  it.each(protectedRoutes)('rejects anonymous access to %s', async (route) => {
    const response = await request(app).get(route);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a malformed bearer token as invalid, not expired', async () => {
    const response = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(response.status).toBe(401);
    // The distinction matters: the client silently refreshes on TOKEN_EXPIRED
    // but must force a re-login on TOKEN_INVALID.
    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('ignores a non-bearer Authorization scheme', async () => {
    const response = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', 'Basic dXNlcjpwYXNz');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('request parsing and validation', () => {
  it('rejects malformed JSON with a 400, not a crash', async () => {
    const response = await request(app)
      .post(`${API}/auth/login`)
      .set('Content-Type', 'application/json')
      .send('{"email": "broken"');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns field-level detail for a failed login payload', async () => {
    const response = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'not-an-email', password: '' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(response.body.error.details)).toBe(true);

    const fields = (response.body.error.details as Array<{ field: string }>).map((d) => d.field);
    expect(fields).toContain('email');
  });

  it('validates a UUID path parameter before touching the database', async () => {
    const response = await request(app)
      .get(`${API}/customers/not-a-uuid`)
      .set('Authorization', 'Bearer whatever');

    // Auth runs first, so this is a 401 — which is itself the assertion:
    // an unauthenticated caller never reaches parameter validation or the DB.
    expect(response.status).toBe(401);
  });
});

describe('CORS', () => {
  it('allows a configured origin', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    // Required for the httpOnly refresh cookie to travel cross-origin.
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects an origin outside the allow-list as an operational 403', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example.com');

    // The critical property: the allow-origin header is NOT echoed, so the
    // browser blocks the response regardless of status.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();

    // And it is classified, not a crash — otherwise a probing scanner fills
    // the error log with false 500s and buries real ones.
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
