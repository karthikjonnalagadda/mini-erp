/**
 * Zero-dependency structured logger.
 *
 * Why not Winston/Pino? For a service of this size the requirements are: level
 * filtering, structured metadata, secret redaction, and machine-readable output
 * in production. That is ~100 lines. Adding a logging framework here would be
 * dependency weight without benefit — and this implementation is trivially
 * swappable because everything imports the `logger` object, not the transport.
 *
 * - development : colourised, human-readable single lines
 * - production  : newline-delimited JSON, ready for Render/Datadog ingestion
 */
import { REDACTED_KEYS, REDACTED_PLACEHOLDER } from '../constants/app.constants';
import { env } from '../config/env';

export const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

const LEVEL_COLOURS: Record<LogLevel, string> = {
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  info: '\x1b[36m', // cyan
  http: '\x1b[35m', // magenta
  debug: '\x1b[90m', // grey
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

/** Recursively strips secrets from anything we are about to write to a log. */
export const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(source)) {
      const normalised = key.toLowerCase();
      const isSecret = REDACTED_KEYS.some((secret) => normalised.includes(secret));
      output[key] = isSecret ? REDACTED_PLACEHOLDER : redact(val, depth + 1);
    }
    return output;
  }

  return value;
};

/** Serialises an Error (including our AppError extras) for structured output. */
const serialiseError = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) return { error: String(error) };
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...('statusCode' in error ? { statusCode: (error as { statusCode: unknown }).statusCode } : {}),
    ...('errorCode' in error ? { errorCode: (error as { errorCode: unknown }).errorCode } : {}),
  };
};

class Logger {
  private readonly threshold: number;

  constructor(level: LogLevel) {
    this.threshold = LOG_LEVELS[level];
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= this.threshold;
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const safeMeta = meta ? (redact(meta) as Record<string, unknown>) : undefined;
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

    if (env.isProduction) {
      // NDJSON — one object per line, no ANSI codes.
      sink(JSON.stringify({ timestamp, level, message, ...safeMeta }));
      return;
    }

    const colour = LEVEL_COLOURS[level];
    const label = level.toUpperCase().padEnd(5);
    const time = timestamp.slice(11, 23);
    const suffix =
      safeMeta && Object.keys(safeMeta).length > 0 ? ` ${DIM}${JSON.stringify(safeMeta)}${RESET}` : '';

    sink(`${DIM}${time}${RESET} ${colour}${label}${RESET} ${message}${suffix}`);
  }

  error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    this.write('error', message, {
      ...(error !== undefined ? { err: serialiseError(error) } : {}),
      ...meta,
    });
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  http(message: string, meta?: Record<string, unknown>): void {
    this.write('http', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  /**
   * Returns a logger that stamps every line with fixed context (e.g. requestId).
   * Used by the request-context middleware for end-to-end traceability.
   */
  child(context: Record<string, unknown>): Logger {
    const parent = this;
    const bound = Object.create(Logger.prototype) as Logger;
    (bound as unknown as { threshold: number }).threshold = LOG_LEVELS[env.LOG_LEVEL];
    for (const level of ['error', 'warn', 'info', 'http', 'debug'] as const) {
      Object.defineProperty(bound, level, {
        value: (message: string, ...rest: unknown[]) => {
          if (level === 'error') {
            const [err, meta] = rest as [unknown, Record<string, unknown>?];
            parent.error(message, err, { ...context, ...meta });
          } else {
            const [meta] = rest as [Record<string, unknown>?];
            parent[level](message, { ...context, ...meta });
          }
        },
        writable: false,
      });
    }
    return bound;
  }
}

export const logger = new Logger(env.LOG_LEVEL);
export type { Logger };
