/// <reference types="vite/client" />

/**
 * Typed build-time environment.
 *
 * Only `VITE_`-prefixed variables are exposed to client code by Vite — this is
 * a security feature, not a naming convention. Anything else in `.env` stays on
 * the server. Never put a secret in a VITE_ variable: it is compiled into the
 * bundle and readable by anyone who opens devtools.
 */
interface ImportMetaEnv {
  /** Absolute API origin in production; defaults to the dev proxy path. */
  readonly VITE_API_BASE_URL?: string;
  /** Overrides the dev-server proxy target. */
  readonly VITE_DEV_API_TARGET?: string;
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
