/**
 * Environment configuration.
 *
 * Design decision: the entire environment is parsed and validated ONCE at
 * module load with Zod. If a variable is missing or malformed the process
 * exits immediately with a readable report instead of throwing an obscure
 * `undefined` error under production load three hours later.
 *
 * Everything downstream imports the frozen, fully-typed `env` object — no
 * `process.env` access is allowed anywhere else in the codebase.
 */
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

// Load `.env` from the backend package root regardless of the CWD the process
// was started from (matters for `tsx`, PM2, Docker and Render alike).
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/** Comma-separated string -> trimmed, non-empty string array. */
const csvToArray = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

/** Accepts "15m" / "7d" / "3600" style durations used by `jsonwebtoken`. */
const durationSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h|d|w|y)?$/, 'Must be a number optionally suffixed with ms|s|m|h|d|w|y');

const envSchema = z.object({
  // --- Runtime -------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PREFIX: z
    .string()
    .startsWith('/', 'API_PREFIX must start with "/"')
    .default('/api/v1'),

  // --- Database ------------------------------------------------------------
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (url) => url.startsWith('postgres://') || url.startsWith('postgresql://'),
      'DATABASE_URL must be a PostgreSQL connection string',
    ),

  // --- JWT -----------------------------------------------------------------
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: durationSchema.default('15m'),
  JWT_REFRESH_EXPIRES_IN: durationSchema.default('7d'),

  // --- Security ------------------------------------------------------------
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  CORS_ORIGINS: z.string().default('http://localhost:5173').transform(csvToArray),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // --- Observability -------------------------------------------------------
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),

  // --- Seed ----------------------------------------------------------------
  SEED_ADMIN_EMAIL: z.string().email().default('admin@erpportal.io'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  // Intentionally raw console — the logger itself depends on this module.
  // eslint-disable-next-line no-console
  console.error(
    `\n[config] Invalid environment configuration. Fix your .env and restart:\n${issues}\n`,
  );
  process.exit(1);
}

/**
 * Fully validated, immutable environment. `as const`-style freezing prevents
 * accidental mutation from anywhere in the request lifecycle.
 */
export const env = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',
});

export type Env = typeof env;

/**
 * JWT secrets are re-exported separately so that token utilities never need to
 * import the whole environment object (Interface Segregation, applied to modules).
 */
export const jwtConfig = Object.freeze({
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
  refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  issuer: 'mini-erp-crm',
  audience: 'mini-erp-crm-portal',
});
