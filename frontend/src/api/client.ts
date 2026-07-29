/**
 * HTTP client.
 *
 * ===========================================================================
 * THE REFRESH PROBLEM
 * ===========================================================================
 *
 * When an access token expires, several in-flight requests fail with 401 at
 * once. The naive interceptor calls `/auth/refresh` for each of them, which:
 *   - fires N refresh calls for one expiry, and
 *   - because refresh tokens ROTATE, calls 2..N present a token that call 1 has
 *     already consumed. The backend treats that as token theft and revokes
 *     every session — logging the user out for doing nothing wrong.
 *
 * The fix implemented below is a single-flight refresh:
 *   - the first 401 starts a refresh and stores the promise,
 *   - every other 401 awaits that same promise instead of starting its own,
 *   - when it resolves, all queued requests retry with the new token,
 *   - if it rejects, all of them fail and the session is cleared once.
 *
 * ===========================================================================
 * TOKEN STORAGE
 * ===========================================================================
 *
 * The access token lives in memory (a module variable), NOT in localStorage.
 * An XSS payload can read localStorage; it cannot read a closure variable
 * without already executing in the same context long enough to hook fetch.
 * The trade-off is that a page refresh loses the access token — which is fine,
 * because the httpOnly refresh cookie silently restores the session on boot.
 * That cookie is unreadable from JavaScript by construction.
 */
import axios from 'axios';
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import type { ApiError, ApiErrorCode, ApiSuccess, Paginated } from '@/types/api.types';

/**
 * Base URL.
 *
 * In development this is `/api/v1` so requests go through the Vite proxy and
 * stay same-origin (no CORS preflight, no SameSite=None requirement). In
 * production it is the absolute API origin from the build-time env var.
 */
const API_BASE_URL: string =
  (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

/** Requests that take longer than this are almost certainly not coming back. */
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// In-memory access token
// ---------------------------------------------------------------------------

let accessToken: string | null = null;

/** Callback invoked when the session is irrecoverably lost. Set by AuthContext. */
let onSessionExpired: (() => void) | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const getAccessToken = (): string | null => accessToken;

export const setSessionExpiredHandler = (handler: (() => void) | null): void => {
  onSessionExpired = handler;
};

// ---------------------------------------------------------------------------
// Normalised client error
// ---------------------------------------------------------------------------

/**
 * Every failure surfaces as this shape, so components never branch on
 * `axios.isAxiosError` or dig through `error.response.data.error.code`.
 */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string | undefined;

  constructor(params: {
    message: string;
    code: ApiErrorCode;
    status: number;
    details?: unknown;
    requestId?: string | undefined;
  }) {
    super(params.message);
    this.name = 'ApiRequestError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.requestId = params.requestId;
  }

  /** Field-level errors, when the backend returned a 422. */
  get fieldErrors(): Array<{ field: string; message: string }> {
    return Array.isArray(this.details)
      ? (this.details as Array<{ field: string; message: string }>)
      : [];
  }

  /** True for failures a retry might fix. Drives React Query's retry policy. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.code === 'NETWORK_ERROR';
  }
}

/** Converts any thrown value from Axios into an ApiRequestError. */
const toApiRequestError = (error: unknown): ApiRequestError => {
  if (error instanceof ApiRequestError) return error;

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiError>;
    const payload = axiosError.response?.data;

    // No response at all: DNS failure, offline, CORS rejection, timeout.
    if (!axiosError.response) {
      return new ApiRequestError({
        message:
          axiosError.code === 'ECONNABORTED'
            ? 'The request timed out. Please check your connection and try again.'
            : 'Unable to reach the server. Please check your connection.',
        code: 'NETWORK_ERROR',
        status: 0,
      });
    }

    return new ApiRequestError({
      message: payload?.message ?? axiosError.message ?? 'Request failed',
      code: payload?.error?.code ?? 'INTERNAL_ERROR',
      status: axiosError.response.status,
      details: payload?.error?.details,
      requestId: payload?.requestId,
    });
  }

  return new ApiRequestError({
    message: error instanceof Error ? error.message : 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
    status: 0,
  });
};

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

export const httpClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  // Required for the httpOnly refresh cookie to travel with requests.
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

/** Attaches the bearer token to every outgoing request. */
httpClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

// ---------------------------------------------------------------------------
// Single-flight refresh
// ---------------------------------------------------------------------------

/** Holds the in-progress refresh so concurrent 401s share one call. */
let refreshPromise: Promise<string> | null = null;

/**
 * A bare Axios instance for the refresh call itself.
 *
 * Using `httpClient` here would re-enter the response interceptor if the
 * refresh returned 401, producing infinite recursion.
 */
const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  withCredentials: true,
});

const performRefresh = async (): Promise<string> => {
  const response = await refreshClient.post<ApiSuccess<{ tokens: { accessToken: string } }>>(
    '/auth/refresh',
    {},
  );

  const token = response.data.data.tokens.accessToken;
  setAccessToken(token);
  return token;
};

/** Starts a refresh, or joins the one already running. */
const refreshAccessToken = async (): Promise<string> => {
  refreshPromise ??= performRefresh().finally(() => {
    // Cleared in `finally` so the NEXT expiry starts a fresh attempt rather
    // than reusing a settled promise.
    refreshPromise = null;
  });

  return refreshPromise;
};

/** Requests that must never trigger a refresh attempt. */
const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

httpClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(toApiRequestError(error));
    }

    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retried?: boolean })
      | undefined;

    const status = error.response?.status;
    const errorCode = (error.response?.data as ApiError | undefined)?.error?.code;
    const url = originalRequest?.url ?? '';

    const shouldAttemptRefresh =
      status === 401 &&
      errorCode === 'TOKEN_EXPIRED' &&
      originalRequest !== undefined &&
      originalRequest._retried !== true &&
      !NO_REFRESH_PATHS.some((path) => url.includes(path));

    if (!shouldAttemptRefresh) {
      // A 401 that is not an expiry (invalid token, deactivated account) is
      // terminal — clear the session once and let the router redirect.
      if (status === 401 && !NO_REFRESH_PATHS.some((path) => url.includes(path))) {
        setAccessToken(null);
        onSessionExpired?.();
      }
      return Promise.reject(toApiRequestError(error));
    }

    // Mark before awaiting, so a retry that also 401s is not retried again.
    originalRequest._retried = true;

    try {
      const token = await refreshAccessToken();
      originalRequest.headers.set('Authorization', `Bearer ${token}`);
      return await httpClient.request(originalRequest);
    } catch (refreshError) {
      setAccessToken(null);
      onSessionExpired?.();
      return Promise.reject(toApiRequestError(refreshError));
    }
  },
);

// ---------------------------------------------------------------------------
// Typed request helpers
// ---------------------------------------------------------------------------

/**
 * These unwrap the response envelope so callers work with `data` directly and
 * never write `response.data.data`.
 */

/**
 * `params` is typed as `object` rather than `Record<string, unknown>` so that
 * the domain query interfaces (CustomerListParams, ProductListParams, …) can be
 * passed directly. A declared interface has no index signature and is therefore
 * not assignable to a Record — a well-known TypeScript friction point that
 * would otherwise force a cast at every call site.
 */
export const apiGet = async <T>(url: string, params?: object): Promise<T> => {
  const response = await httpClient.get<ApiSuccess<T>>(url, { params });
  return response.data.data;
};

/** GET for a list endpoint — returns items alongside the pagination metadata. */
export const apiGetPaginated = async <T>(
  url: string,
  params?: object,
): Promise<Paginated<T>> => {
  const response = await httpClient.get<ApiSuccess<T[]>>(url, { params });
  return {
    items: response.data.data,
    meta: response.data.meta ?? {
      page: 1,
      limit: response.data.data.length,
      totalItems: response.data.data.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
};

export const apiPost = async <T, TBody = unknown>(url: string, body?: TBody): Promise<T> => {
  const response = await httpClient.post<ApiSuccess<T>>(url, body);
  return response.data.data;
};

export const apiPut = async <T, TBody = unknown>(url: string, body?: TBody): Promise<T> => {
  const response = await httpClient.put<ApiSuccess<T>>(url, body);
  return response.data.data;
};

export const apiPatch = async <T, TBody = unknown>(url: string, body?: TBody): Promise<T> => {
  const response = await httpClient.patch<ApiSuccess<T>>(url, body);
  return response.data.data;
};

export const apiDelete = async <T = null>(url: string): Promise<T> => {
  const response = await httpClient.delete<ApiSuccess<T>>(url);
  return response.data.data;
};

/** Fetches a binary payload (challan PDFs). */
export const apiDownload = async (url: string, filename: string): Promise<void> => {
  const response = await httpClient.get<Blob>(url, { responseType: 'blob' });

  const blobUrl = window.URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();

  // Revoke immediately after the click — an un-revoked object URL keeps the
  // whole blob in memory for the lifetime of the document.
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(blobUrl);
};

export { toApiRequestError };
