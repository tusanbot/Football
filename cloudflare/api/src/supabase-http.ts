export interface SupabaseHttpConfig {
  url: string;
  serviceRoleKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SupabaseRequestOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export class SupabaseHttpError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: string | null;

  constructor(status: number, message: string, code: string | null = null, details: string | null = null) {
    super(message);
    this.name = "SupabaseHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function validateIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) throw new TypeError(label + " must be a lowercase SQL identifier");
  return value;
}

function normalizeBaseUrl(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new TypeError("SUPABASE_URL must be a valid HTTPS URL"); }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co") || parsed.username || parsed.password) {
    throw new TypeError("SUPABASE_URL must use an HTTPS Supabase project host");
  }
  if (parsed.search || parsed.hash) throw new TypeError("SUPABASE_URL must not contain query parameters or a fragment");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed;
}

/** Worker-only PostgREST transport. Mutations are never automatically retried. */
export class SupabaseHttpClient {
  private readonly baseUrl: URL;
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SupabaseHttpConfig) {
    this.baseUrl = normalizeBaseUrl(config.url);
    if (!config.serviceRoleKey || config.serviceRoleKey.trim().length < 20) {
      throw new TypeError("SUPABASE_SERVICE_ROLE_KEY is required");
    }
    this.key = config.serviceRoleKey;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000) {
      throw new RangeError("Supabase HTTP timeout must be between 100 and 30000 milliseconds");
    }
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async select<T>(table: string, query: Record<string, string>, options?: SupabaseRequestOptions): Promise<T> {
    return this.request<T>("GET", this.resourcePath(table, query), undefined, options);
  }

  async insert<T>(table: string, rows: unknown | unknown[], options?: SupabaseRequestOptions): Promise<T> {
    return this.request<T>("POST", this.resourcePath(table), rows, {
      ...options, headers: { Prefer: "return=representation", ...options?.headers },
    });
  }

  async update<T>(table: string, query: Record<string, string>, values: unknown, options?: SupabaseRequestOptions): Promise<T> {
    return this.request<T>("PATCH", this.resourcePath(table, query), values, {
      ...options, headers: { Prefer: "return=representation", ...options?.headers },
    });
  }

  async delete<T>(table: string, query: Record<string, string>, options?: SupabaseRequestOptions): Promise<T> {
    return this.request<T>("DELETE", this.resourcePath(table, query), undefined, {
      ...options, headers: { Prefer: "return=representation", ...options?.headers },
    });
  }

  async rpc<T>(functionName: string, args: Record<string, unknown>, options?: SupabaseRequestOptions): Promise<T> {
    const name = validateIdentifier(functionName, "RPC function name");
    return this.request<T>("POST", "/rest/v1/rpc/" + name, args, options);
  }

  private resourcePath(table: string, query?: Record<string, string>): string {
    const name = validateIdentifier(table, "Table name");
    const params = new URLSearchParams();
    if (query) for (const [key, value] of Object.entries(query)) {
      validateIdentifier(key, "Query parameter");
      if (typeof value !== "string") throw new TypeError("PostgREST query values must be strings");
      params.set(key, value);
    }
    const suffix = params.toString();
    return "/rest/v1/" + name + (suffix ? "?" + suffix : "");
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    options?: SupabaseRequestOptions,
  ): Promise<T> {
    const url = new URL(this.baseUrl.toString());
    const query = path.indexOf("?");
    const basePath = this.baseUrl.pathname.replace(/\/+$/, "");
    url.pathname = basePath + (query < 0 ? path : path.slice(0, query));
    if (query >= 0) url.search = path.slice(query + 1);

    const headers = new Headers(options?.headers);
    headers.set("apikey", this.key);
    headers.set("authorization", "Bearer " + this.key);
    headers.set("accept", "application/json");
    if (body !== undefined) headers.set("content-type", "application/json");
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal,
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "Supabase HTTP request timed out" : "Supabase HTTP request failed";
      throw new Error(message, { cause: error });
    }

    const text = await response.text();
    if (!response.ok) {
      let payload: { message?: unknown; code?: unknown; details?: unknown } = {};
      try { payload = JSON.parse(text) as typeof payload; } catch { /* generic error */ }
      const message = typeof payload.message === "string" ? payload.message.slice(0, 500) : "Supabase HTTP request was rejected";
      const code = typeof payload.code === "string" ? payload.code.slice(0, 64) : null;
      const details = typeof payload.details === "string" ? payload.details.slice(0, 500) : null;
      throw new SupabaseHttpError(response.status, message, code, details);
    }
    if (!text) return undefined as T;
    try { return JSON.parse(text) as T; }
    catch { throw new Error("Supabase returned a non-JSON success response"); }
  }
}
