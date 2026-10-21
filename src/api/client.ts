/**
 * OmniSight Centralized API Client
 *
 * Provides a robust, typed HTTP foundation for communicating with the
 * OmniSight FastAPI backend service (Person 3).
 *
 * Features:
 * - Configurable base URL via VITE_API_BASE_URL or constructor.
 * - Native AbortController-based timeout support and external cancellation signals.
 * - Comprehensive, sanitized error handling (distinguishing HTTP errors, network failures, timeouts, and validation errors).
 * - Safe query parameter stringification.
 * - Zero external dependencies.
 */

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  params?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
}

export interface ApiClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

export type ApiErrorKind =
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT_ERROR"
  | "ABORT_ERROR"
  | "VALIDATION_ERROR";

export class ApiError extends Error {
  public readonly kind: ApiErrorKind;
  public readonly status: number;
  public readonly endpoint: string;
  public readonly details?: unknown;

  constructor(params: {
    message: string;
    kind: ApiErrorKind;
    status?: number;
    endpoint: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.kind = params.kind;
    this.status = params.status ?? 0;
    this.endpoint = params.endpoint;
    this.details = sanitizeDetails(params.details);
  }

  get isNetworkError(): boolean {
    return this.kind === "NETWORK_ERROR";
  }

  get isTimeout(): boolean {
    return this.kind === "TIMEOUT_ERROR";
  }

  get isAbort(): boolean {
    return this.kind === "ABORT_ERROR";
  }

  get isValidationError(): boolean {
    return this.kind === "VALIDATION_ERROR";
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Removes sensitive authentication or system credential markers from error details
 */
function sanitizeDetails(details: unknown): unknown {
  if (!details || typeof details !== "object") return details;

  try {
    const serialized = JSON.stringify(details);
    const cleaned = serialized.replace(
      /"([^"]*?(?:token|bearer|password|secret|authorization|key)[^"]*?)"\s*:\s*"[^"]*"/gi,
      '"$1": "[REDACTED]"'
    );
    return JSON.parse(cleaned);
  } catch {
    return "[Unserializable Error Payload]";
  }
}

export class OmniSightApiClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: ApiClientConfig = {}) {
    // Resolve base URL from configuration or Vite environment
    const envBase =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
        ? import.meta.env.VITE_API_BASE_URL
        : "/api";

    const envTimeout =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_API_TIMEOUT_MS
        ? Number(import.meta.env.VITE_API_TIMEOUT_MS)
        : 10000;

    this.baseUrl = config.baseUrl || envBase;
    this.defaultTimeoutMs = config.timeoutMs || (Number.isFinite(envTimeout) ? envTimeout : 10000);
    this.defaultHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...config.defaultHeaders,
    };
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getDefaultTimeout(): number {
    return this.defaultTimeoutMs;
  }

  /**
   * Executes an HTTP request with timeout protection, signal handling, and standardized error mapping.
   */
  public async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const cleanEndpoint = endpoint.replace(/^\/+/, "");
    const cleanBase = this.baseUrl.replace(/\/+$/, "");
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    // Build URL with query params
    let url = `${cleanBase}/${cleanEndpoint}`;
    if (options.params) {
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(options.params)) {
        if (val !== undefined && val !== null) {
          searchParams.append(key, String(val));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += (url.includes("?") ? "&" : "?") + qs;
      }
    }

    // Set up AbortController with timeout
    const controller = new AbortController();
    let isTimeoutTriggered = false;

    const timeoutId = setTimeout(() => {
      isTimeoutTriggered = true;
      controller.abort();
    }, timeoutMs);

    // Chain external abort signal if supplied
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        controller.abort();
      });
    }

    const headers = {
      ...this.defaultHeaders,
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle non-2xx HTTP responses
      if (!response.ok) {
        let errorDetail: unknown;
        try {
          errorDetail = await response.json();
        } catch {
          errorDetail = await response.text();
        }

        const message =
          typeof errorDetail === "object" && errorDetail !== null && "detail" in errorDetail
            ? String((errorDetail as { detail: unknown }).detail)
            : `API request to ${cleanEndpoint} failed with HTTP ${response.status}`;

        throw new ApiError({
          message,
          kind: "HTTP_ERROR",
          status: response.status,
          endpoint: cleanEndpoint,
          details: errorDetail,
        });
      }

      // Handle empty response bodies (e.g. 204 No Content)
      if (response.status === 204) {
        return null as unknown as T;
      }

      // Parse JSON response
      return (await response.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      // Re-throw existing ApiError instances
      if (err instanceof ApiError) {
        throw err;
      }

      // Handle timeout
      if (isTimeoutTriggered) {
        throw new ApiError({
          message: `Request to ${cleanEndpoint} timed out after ${timeoutMs}ms`,
          kind: "TIMEOUT_ERROR",
          endpoint: cleanEndpoint,
        });
      }

      // Handle external cancellation
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiError({
          message: `Request to ${cleanEndpoint} was cancelled`,
          kind: "ABORT_ERROR",
          endpoint: cleanEndpoint,
        });
      }

      // Handle network errors
      throw new ApiError({
        message: err instanceof Error ? err.message : "Network request failed",
        kind: "NETWORK_ERROR",
        endpoint: cleanEndpoint,
        details: err,
      });
    }
  }

  /**
   * Typed GET request
   */
  public async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  }

  /**
   * Typed POST request
   */
  public async post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Typed PUT request
   */
  public async put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Typed DELETE request
   */
  public async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  }
}

// Default singleton client instance
export const apiClient = new OmniSightApiClient();
