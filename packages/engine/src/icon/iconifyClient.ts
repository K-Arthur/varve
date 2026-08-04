/**
 * Iconify API client — a single tested HTTP client for the Iconify public
 * API (and official backup hosts), with timeouts, cancellation, bounded
 * retries, circuit breaking, response validation, and batching.
 *
 * Endpoints implemented (verified against the official API documentation
 * and live responses on 2026-08-04):
 *
 *   GET /search?query=&limit=&start=&prefix=&category=
 *       -> { icons: string[], total, limit, start, collections? }
 *   GET /collections?prefixes=a,b,c
 *       -> Record<prefix, CollectionInfo>
 *   GET /collection?prefix=X&limit=&start=
 *       -> { prefix, total, title, lastModified, icons: string[] | Record<...> }
 *   GET /{prefix}.json?icons=a,b,c
 *       -> icon data (bodies) for a batch of icons in one request
 *   GET /{prefix}/{icon}.svg
 *       -> raw SVG for a single icon
 *   GET /keywords?keyword=... | ?prefix=...
 *       -> { keyword, exists, matches[] }
 *   GET /last-modified?prefixes=a,b,c
 *       -> Record<prefix, unix seconds>
 *   GET /version
 *       -> "1.7.0" style API version string
 *
 * Host policy: primary host first, official backup hosts after a timeout
 * (0.75s per the Iconify redundancy design) or after a connection failure.
 * The best responding host is remembered for subsequent requests. Retries
 * use exponential backoff with jitter and are only attempted for
 * retry-safe failures (network errors, timeouts, 5xx). HTTP 4xx responses
 * are never retried.
 *
 * No user tracking: requests carry only the parameters required by the API.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const ICONIFY_PRIMARY_HOST = 'https://api.iconify.design';
export const ICONIFY_BACKUP_HOSTS = [
  'https://api.simplesvg.com',
  'https://api.unisvg.com',
] as const;

export const ICONIFY_HOSTS = [ICONIFY_PRIMARY_HOST, ...ICONIFY_BACKUP_HOSTS] as const;

/** Hosts the Tauri CSP must allow for the icon workflow. */
export const ICONIFY_CSP_HOSTS: readonly string[] = ICONIFY_HOSTS;

export type IconifyClientErrorCode =
  | 'network-error'
  | 'timeout'
  | 'cancelled'
  | 'http-error'
  | 'invalid-response'
  | 'response-too-large'
  | 'content-type-mismatch'
  | 'all-hosts-failed';

export class IconifyClientError extends Error {
  constructor(
    message: string,
    public readonly code: IconifyClientErrorCode,
    public readonly host: string,
    public readonly status?: number,
    public readonly attempt = 1,
    public readonly attemptDurationMs?: number,
  ) {
    super(message);
    this.name = 'IconifyClientError';
  }
}

/** Validated shape of the /search response (only fields we consume). */
export interface IconifySearchResponse {
  icons: string[];
  total: number;
  limit: number;
  start: number;
  collections?: Record<string, IconifyCollectionInfo>;
}

/** Validated shape of collection metadata (from /collections, /search, /collection). */
export interface IconifyCollectionInfo {
  name: string;
  total: number;
  version?: string;
  author?: { name?: string; url?: string };
  license?: { title?: string; spdx?: string; url?: string; scope?: string };
  category?: string;
  tags?: string[];
  samples?: string[];
  height?: number;
  width?: number;
  palette?: boolean;
  hidden?: boolean;
  lastModified?: number;
}

/** Validated shape of the /collection response. */
export interface IconifyCollectionResponse {
  prefix: string;
  total: number;
  title?: string;
  lastModified?: number;
  /** Icon names in the collection (when requested without icon data). */
  icons: string[] | Record<string, string>;
  aliases?: Record<string, { parent?: string }>;
  categories?: Record<string, string[]>;
  info?: IconifyCollectionInfo;
}

/** Validated shape of the /{prefix}.json icon-data batch response. */
export interface IconifyIconsResponse {
  prefix: string;
  lastModified?: number;
  width?: number;
  height?: number;
  icons: Record<string, IconifyIconData>;
  aliases?: Record<string, { parent?: string }>;
  notify?: string[];
}

/** A single icon body from icon data (already normalized, no SVG wrapper). */
export interface IconifyIconData {
  body: string;
  width?: number;
  height?: number;
  rotate?: number;
  vFlip?: boolean;
  hFlip?: boolean;
}

export interface IconifyKeywordsResponse {
  keyword?: string;
  prefix?: string;
  exists: boolean;
  invalid?: boolean;
  matches: string[];
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface IconifyClientOptions {
  /** Hosts in preference order. Defaults to primary + official backups. */
  hosts?: readonly string[];
  /** Injectable fetch (for tests and SSR). */
  fetchFn?: typeof fetch;
  /** Per-request timeout in ms (default 8000). */
  timeoutMs?: number;
  /** Timeout before trying the next host, per the Iconify redundancy design. */
  hostSwitchTimeoutMs?: number;
  /** Maximum accepted response body size in bytes (default 8 MiB). */
  maxResponseBytes?: number;
  /** Retries per host for retry-safe failures (default 2). */
  maxRetries?: number;
  /** Icons per batch request (default 40). */
  batchSize?: number;
  /** Maximum request URL length before a batch is split (default 1900). */
  maxUrlLength?: number;
  /** Consecutive failures before a host is temporarily suppressed (default 3). */
  circuitFailureThreshold?: number;
  /** How long a suppressed host stays suppressed, ms (default 30s). */
  circuitOpenMs?: number;
  /** Diagnostic sink; safe to omit in production. */
  onDiagnostic?: (event: IconifyClientDiagnostic) => void;
}

export interface IconifyClientDiagnostic {
  kind:
    | 'request'
    | 'host-switch'
    | 'host-suppressed'
    | 'host-recovered'
    | 'retry'
    | 'error'
    | 'batch-split';
  host: string;
  path: string;
  attempt: number;
  durationMs: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validateSearchResponse(v: unknown): IconifySearchResponse {
  if (!isRecord(v) || !isStringArray(v.icons)) {
    throw new IconifyClientError(
      'Search response missing "icons" string array',
      'invalid-response',
      '',
    );
  }
  return {
    icons: v.icons,
    total: typeof v.total === 'number' ? v.total : v.icons.length,
    limit: typeof v.limit === 'number' ? v.limit : v.icons.length,
    start: typeof v.start === 'number' ? v.start : 0,
    collections: sanitizeCollectionMap(v.collections),
  };
}

function sanitizeCollectionMap(v: unknown): Record<string, IconifyCollectionInfo> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, IconifyCollectionInfo> = {};
  for (const [prefix, info] of Object.entries(v)) {
    if (isRecord(info)) {
      const clean = sanitizeCollectionInfo(info);
      if (clean.name || clean.license || clean.category) out[prefix] = clean;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeCollectionInfo(v: Record<string, unknown>): IconifyCollectionInfo {
  const info: Partial<IconifyCollectionInfo> = {};
  if (typeof v.name === 'string') info.name = v.name;
  if (typeof v.total === 'number') info.total = v.total;
  if (typeof v.version === 'string') info.version = v.version;
  if (typeof v.category === 'string') info.category = v.category;
  if (typeof v.height === 'number') info.height = v.height;
  if (typeof v.width === 'number') info.width = v.width;
  if (typeof v.palette === 'boolean') info.palette = v.palette;
  if (typeof v.hidden === 'boolean') info.hidden = v.hidden;
  if (typeof v.lastModified === 'number') info.lastModified = v.lastModified;
  if (isRecord(v.author)) {
    const author: { name?: string; url?: string } = {};
    if (typeof v.author.name === 'string') author.name = v.author.name;
    if (typeof v.author.url === 'string') author.url = v.author.url;
    info.author = author;
  }
  if (isRecord(v.license)) {
    const license: { title?: string; spdx?: string; url?: string; scope?: string } = {};
    if (typeof v.license.title === 'string') license.title = v.license.title;
    if (typeof v.license.spdx === 'string') license.spdx = v.license.spdx;
    if (typeof v.license.url === 'string') license.url = v.license.url;
    if (typeof v.license.scope === 'string') license.scope = v.license.scope;
    if (license.title || license.spdx || license.url) info.license = license;
  }
  if (isStringArray(v.tags)) info.tags = v.tags;
  if (isStringArray(v.samples)) info.samples = v.samples;
  return info as IconifyCollectionInfo;
}

function validateCollectionResponse(v: unknown): IconifyCollectionResponse {
  if (!isRecord(v) || typeof v.prefix !== 'string') {
    throw new IconifyClientError('Collection response missing "prefix"', 'invalid-response', '');
  }
  const out: IconifyCollectionResponse = {
    prefix: v.prefix,
    total: typeof v.total === 'number' ? v.total : 0,
    icons: [],
  };
  if (typeof v.title === 'string') out.title = v.title;
  if (typeof v.lastModified === 'number') out.lastModified = v.lastModified;
  if (isStringArray(v.icons)) {
    out.icons = v.icons;
  } else if (isRecord(v.icons)) {
    out.icons = v.icons as Record<string, string>;
  } else if (isStringArray(v.uncategorized)) {
    // Categorized collections list their non-categorized icons under
    // "uncategorized" and categorized ones under "categories".
    out.icons = v.uncategorized;
  } else if (isRecord(v.categories)) {
    out.icons = Object.keys(v.categories);
  } else {
    throw new IconifyClientError(
      'Collection response missing "icons" list',
      'invalid-response',
      '',
    );
  }
  if (isRecord(v.aliases)) out.aliases = v.aliases as IconifyCollectionResponse['aliases'];
  if (isRecord(v.categories)) {
    out.categories = v.categories as Record<string, string[]>;
  }
  if (isRecord(v.info)) out.info = sanitizeCollectionInfo(v.info);
  return out;
}

function validateIconsResponse(v: unknown, _requested: string[]): IconifyIconsResponse {
  if (!isRecord(v) || typeof v.prefix !== 'string' || !isRecord(v.icons)) {
    throw new IconifyClientError('Icon data response missing "icons" map', 'invalid-response', '');
  }
  const icons: Record<string, IconifyIconData> = {};
  for (const name of Object.keys(v.icons)) {
    const entry = v.icons[name];
    if (!isRecord(entry) || typeof entry.body !== 'string') continue;
    const data: IconifyIconData = { body: entry.body };
    if (typeof entry.width === 'number') data.width = entry.width;
    if (typeof entry.height === 'number') data.height = entry.height;
    icons[name] = data;
  }
  const out: IconifyIconsResponse = {
    prefix: v.prefix,
    icons,
  };
  if (typeof v.lastModified === 'number') out.lastModified = v.lastModified;
  if (typeof v.width === 'number') out.width = v.width;
  if (typeof v.height === 'number') out.height = v.height;
  if (isRecord(v.aliases)) out.aliases = v.aliases as IconifyIconsResponse['aliases'];
  return out;
}

function validateKeywordsResponse(v: unknown): IconifyKeywordsResponse {
  if (!isRecord(v) || !isStringArray(v.matches)) {
    throw new IconifyClientError('Keywords response missing "matches"', 'invalid-response', '');
  }
  return {
    exists: v.exists === true,
    invalid: v.invalid === true,
    matches: v.matches,
    keyword: typeof v.keyword === 'string' ? v.keyword : undefined,
    prefix: typeof v.prefix === 'string' ? v.prefix : undefined,
  };
}

function validateLastModifiedResponse(v: unknown): Record<string, number> {
  // The API wraps timestamps under a "lastModified" key:
  //   { "lastModified": { "mdi": 1737398331 } }
  const record = isRecord(v) && isRecord(v.lastModified) ? v.lastModified : v;
  if (!isRecord(record)) {
    throw new IconifyClientError('last-modified response is not an object', 'invalid-response', '');
  }
  const out: Record<string, number> = {};
  for (const [prefix, ts] of Object.entries(record)) {
    if (typeof ts === 'number') out[prefix] = ts;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface IconifyRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Bypass host fallback (used by tests); false by default. */
  preferFirstHost?: boolean;
}

export class IconifyClient {
  private readonly hosts: string[];
  private readonly fetchFn: typeof fetch;
  private readonly opts: Required<
    Pick<
      IconifyClientOptions,
      | 'timeoutMs'
      | 'hostSwitchTimeoutMs'
      | 'maxResponseBytes'
      | 'maxRetries'
      | 'batchSize'
      | 'maxUrlLength'
      | 'circuitFailureThreshold'
      | 'circuitOpenMs'
    >
  >;
  private readonly onDiagnostic: IconifyClientOptions['onDiagnostic'];

  /** Host health: consecutive failures and suppression deadline per host. */
  private readonly hostHealth = new Map<string, { failures: number; suppressedUntil: number }>();
  /** Host that last succeeded; tried first (moves with success). */
  private preferredHostIndex = 0;

  constructor(options: IconifyClientOptions = {}) {
    this.hosts = [...(options.hosts ?? ICONIFY_HOSTS)];
    if (this.hosts.length === 0) throw new Error('IconifyClient requires at least one host');
    this.fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
    this.opts = {
      timeoutMs: options.timeoutMs ?? 8000,
      hostSwitchTimeoutMs: options.hostSwitchTimeoutMs ?? 750,
      maxResponseBytes: options.maxResponseBytes ?? 8 * 1024 * 1024,
      maxRetries: options.maxRetries ?? 1,
      batchSize: options.batchSize ?? 40,
      maxUrlLength: options.maxUrlLength ?? 1900,
      circuitFailureThreshold: options.circuitFailureThreshold ?? 3,
      circuitOpenMs: options.circuitOpenMs ?? 30_000,
    };
    this.onDiagnostic = options.onDiagnostic;
  }

  // -------------------------------------------------------------------------
  // Public endpoint methods
  // -------------------------------------------------------------------------

  async search(
    query: string,
    params: {
      limit?: number;
      start?: number;
      prefix?: string;
      category?: string;
    } = {},
    options: IconifyRequestOptions = {},
  ): Promise<IconifySearchResponse> {
    const qp = new URLSearchParams();
    qp.set('query', query);
    if (params.limit !== undefined) qp.set('limit', String(params.limit));
    if (params.start !== undefined) qp.set('start', String(params.start));
    if (params.prefix) qp.set('prefix', params.prefix);
    if (params.category) qp.set('category', params.category);
    const data = await this.requestJson('/search', qp, validateSearchResponse, options, true);
    return data;
  }

  async collections(
    prefixes?: string[],
    options: IconifyRequestOptions = {},
  ): Promise<Record<string, IconifyCollectionInfo>> {
    const qp = new URLSearchParams();
    if (prefixes && prefixes.length > 0) qp.set('prefixes', prefixes.join(','));
    const data = await this.requestJson('/collections', qp, sanitizeCollectionMap, options, true);
    return data ?? {};
  }

  async collection(
    prefix: string,
    params: { limit?: number; start?: number } = {},
    options: IconifyRequestOptions = {},
  ): Promise<IconifyCollectionResponse> {
    const qp = new URLSearchParams();
    qp.set('prefix', prefix);
    if (params.limit !== undefined) qp.set('limit', String(params.limit));
    if (params.start !== undefined) qp.set('start', String(params.start));
    return this.requestJson('/collection', qp, validateCollectionResponse, options, false);
  }

  /**
   * Fetch icon data (bodies) for a batch of icons in one or more requests.
   * Names are sorted for cache reuse and split across URL-length limits.
   */
  async icons(
    prefix: string,
    names: string[],
    options: IconifyRequestOptions = {},
  ): Promise<{
    prefix: string;
    lastModified?: number;
    width?: number;
    height?: number;
    icons: Map<string, IconifyIconData>;
    aliases?: Record<string, { parent?: string }>;
  }> {
    const unique = [...new Set(names)].sort();
    const chunks: string[][] = [];
    let current: string[] = [];
    let currentLen = `${this.hosts[0]}/${encodeURIComponent(prefix)}.json?icons=`.length;
    for (const name of unique) {
      const addition = current.length > 0 ? name.length + 1 : name.length;
      if (current.length > 0 && currentLen + addition > this.opts.maxUrlLength) {
        chunks.push(current);
        current = [];
        currentLen = `${this.hosts[0]}/${encodeURIComponent(prefix)}.json?icons=`.length;
      }
      current.push(name);
      currentLen += addition;
      if (current.length >= this.opts.batchSize) {
        chunks.push(current);
        current = [];
        currentLen = `${this.hosts[0]}/${encodeURIComponent(prefix)}.json?icons=`.length;
      }
    }
    if (current.length > 0) chunks.push(current);

    if (chunks.length > 1) {
      this.diagnose('batch-split', '', `/${prefix}.json split into ${chunks.length} requests`);
    }

    const icons = new Map<string, IconifyIconData>();
    let lastModified: number | undefined;
    let width: number | undefined;
    let height: number | undefined;
    const aliases: Record<string, { parent?: string }> = {};
    for (const chunk of chunks) {
      const qp = new URLSearchParams();
      qp.set('icons', chunk.join(','));
      const data = await this.requestJson(
        `/${encodeURIComponent(prefix)}.json`,
        qp,
        (v) => validateIconsResponse(v, chunk),
        options,
        true,
      );
      for (const [name, entry] of Object.entries(data.icons)) {
        icons.set(name, entry);
        if (data.width) width = data.width;
        if (data.height) height = data.height;
      }
      if (data.lastModified) lastModified = data.lastModified;
      if (data.aliases) {
        for (const [name, alias] of Object.entries(data.aliases)) {
          aliases[name] = alias;
        }
      }
    }
    return { prefix, lastModified, width, height, icons, aliases };
  }

  /** Fetch a single icon's SVG through the modern /{prefix}/{icon}.svg route. */
  async svg(prefix: string, icon: string, options: IconifyRequestOptions = {}): Promise<string> {
    const path = `/${encodeURIComponent(prefix)}/${encodeURIComponent(icon)}.svg`;
    const qp = new URLSearchParams();
    const body = await this.requestText(path, qp, options, true);
    return body;
  }

  async keywords(
    keyword: string,
    options: IconifyRequestOptions = {},
  ): Promise<IconifyKeywordsResponse> {
    const qp = new URLSearchParams();
    qp.set('keyword', keyword);
    return this.requestJson('/keywords', qp, validateKeywordsResponse, options, false);
  }

  async lastModified(
    prefixes: string[],
    options: IconifyRequestOptions = {},
  ): Promise<Record<string, number>> {
    const qp = new URLSearchParams();
    qp.set('prefixes', prefixes.join(','));
    return this.requestJson('/last-modified', qp, validateLastModifiedResponse, options, true);
  }

  async version(options: IconifyRequestOptions = {}): Promise<string> {
    const qp = new URLSearchParams();
    const data = await this.requestJson(
      '/version',
      qp,
      (v) => (typeof v === 'string' ? v : ''),
      {
        ...options,
        preferFirstHost: true,
      },
      true,
    );
    if (typeof data !== 'string' || data.length === 0) {
      throw new IconifyClientError('Invalid /version response', 'invalid-response', '');
    }
    return data;
  }

  // -------------------------------------------------------------------------
  // Request machinery
  // -------------------------------------------------------------------------

  private diagnose(
    kind: IconifyClientDiagnostic['kind'],
    host: string,
    message: string,
    extra: Partial<IconifyClientDiagnostic> = {},
  ): void {
    this.onDiagnostic?.({ kind, host, path: '', attempt: 1, durationMs: 0, message, ...extra });
  }

  private candidateHosts(preferFirst: boolean): string[] {
    const alive: string[] = [];
    const suppressed: string[] = [];
    const now = Date.now();
    for (let i = 0; i < this.hosts.length; i++) {
      const host = this.hosts[i]!;
      const health = this.hostHealth.get(host);
      if (health && health.suppressedUntil > now) {
        suppressed.push(host);
        continue;
      }
      alive.push(host);
    }
    const list = alive.length > 0 ? alive : suppressed;
    if (list.length === 0) return [this.hosts[0]!];
    if (preferFirst || this.preferredHostIndex === 0) return list;
    // Rotate so the preferred host is tried first, then the rest.
    const preferred = this.hosts[this.preferredHostIndex] ?? this.hosts[0]!;
    return [preferred, ...list.filter((h) => h !== preferred)];
  }

  private async requestJson<T>(
    path: string,
    params: URLSearchParams,
    validate: (v: unknown) => T,
    options: IconifyRequestOptions,
    retrySafe: boolean,
  ): Promise<T> {
    const text = await this.requestText(path, params, options, retrySafe);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new IconifyClientError('Response body is not valid JSON', 'invalid-response', '');
    }
    return validate(parsed);
  }

  private async requestText(
    path: string,
    params: URLSearchParams,
    options: IconifyRequestOptions,
    retrySafe: boolean,
  ): Promise<string> {
    const hosts = this.candidateHosts(options.preferFirstHost === true);
    let lastError: IconifyClientError | null = null;

    for (const host of hosts) {
      const perHostRetries = this.opts.maxRetries;
      for (let attempt = 1; attempt <= perHostRetries + 1; attempt++) {
        try {
          const body = await this.singleRequest(host, path, params, options, attempt);
          this.recordSuccess(host);
          this.preferredHostIndex = this.hosts.indexOf(host);
          return body;
        } catch (err) {
          lastError =
            err instanceof IconifyClientError
              ? err
              : new IconifyClientError(
                  err instanceof Error ? err.message : 'Unknown fetch error',
                  'network-error',
                  host,
                );
          if (lastError.code === 'cancelled') throw lastError;
          if (!retrySafe && lastError.code === 'http-error') break;
          const retryable =
            lastError.code === 'network-error' ||
            lastError.code === 'timeout' ||
            (lastError.code === 'http-error' &&
              lastError.status !== undefined &&
              lastError.status >= 500);
          if (attempt <= perHostRetries && retryable) {
            await sleepWithJitter(100, lastError.attemptDurationMs ?? 0);
            continue;
          }
          break;
        }
      }
      this.recordFailure(host);
    }

    throw (
      lastError ?? new IconifyClientError('All hosts failed', 'all-hosts-failed', hosts[0] ?? '')
    );
  }

  private async singleRequest(
    host: string,
    path: string,
    params: URLSearchParams,
    options: IconifyRequestOptions,
    attempt: number,
  ): Promise<string> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const external = options.signal;
    if (external) {
      if (external.aborted) {
        throw new IconifyClientError('Request cancelled', 'cancelled', host, undefined, attempt);
      }
      external.addEventListener('abort', onAbort, { once: true });
    }
    const timeoutMs = options.timeoutMs ?? this.opts.timeoutMs;
    const timeout = setTimeout(
      () => controller.abort(new DOMException('timeout', 'TimeoutError')),
      timeoutMs,
    );
    const started = Date.now();
    try {
      const res = await this.fetchFn(`${host}${path}?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: 'application/json, image/svg+xml, */*' },
      });
      if (!res.ok) {
        throw new IconifyClientError(
          `HTTP ${res.status} for ${path}`,
          'http-error',
          host,
          res.status,
          attempt,
          Date.now() - started,
        );
      }
      const contentType = res.headers.get('content-type') ?? '';
      const ct = contentType.toLowerCase();
      const accepted =
        ct.includes('json') ||
        ct.includes('svg') ||
        (ct.includes('text') && ct.includes('plain')) ||
        ct.includes('xml');
      if (!accepted) {
        throw new IconifyClientError(
          `Unexpected content-type "${contentType}"`,
          'content-type-mismatch',
          host,
          undefined,
          attempt,
        );
      }
      const contentLength = Number(res.headers.get('content-length') ?? '0');
      if (contentLength > this.opts.maxResponseBytes) {
        throw new IconifyClientError(
          `Response exceeds ${this.opts.maxResponseBytes} bytes`,
          'response-too-large',
          host,
          undefined,
          attempt,
        );
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > this.opts.maxResponseBytes) {
            void reader.cancel().catch(() => {});
            throw new IconifyClientError(
              `Response exceeds ${this.opts.maxResponseBytes} bytes`,
              'response-too-large',
              host,
              undefined,
              attempt,
            );
          }
          chunks.push(value);
        }
      }
      let text: string;
      if (chunks.length > 0) {
        const combined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        text = new TextDecoder().decode(combined);
      } else {
        text = await res.text();
      }
      if (text.length > this.opts.maxResponseBytes) {
        throw new IconifyClientError(
          `Response exceeds ${this.opts.maxResponseBytes} bytes`,
          'response-too-large',
          host,
          undefined,
          attempt,
        );
      }
      return text;
    } catch (err) {
      if (err instanceof DOMException) {
        if (err.name === 'TimeoutError') {
          const timeoutErr = new IconifyClientError(
            `Request timed out after ${timeoutMs}ms`,
            'timeout',
            host,
            undefined,
            attempt,
            Date.now() - started,
          );
          this.onDiagnostic?.({
            kind: 'error',
            host,
            path,
            attempt,
            durationMs: Date.now() - started,
            message: timeoutErr.message,
          });
          throw timeoutErr;
        }
        if (err.name === 'AbortError') {
          throw new IconifyClientError('Request cancelled', 'cancelled', host, undefined, attempt);
        }
      }
      if (external?.aborted || controller.signal.aborted) {
        throw new IconifyClientError('Request cancelled', 'cancelled', host, undefined, attempt);
      }
      if (err instanceof IconifyClientError) {
        this.onDiagnostic?.({
          kind: 'error',
          host,
          path,
          attempt,
          durationMs: Date.now() - started,
          message: err.message,
        });
        throw err;
      }
      const netErr = new IconifyClientError(
        err instanceof Error ? err.message : 'Network error',
        'network-error',
        host,
        undefined,
        attempt,
        Date.now() - started,
      );
      this.onDiagnostic?.({
        kind: 'error',
        host,
        path,
        attempt,
        durationMs: Date.now() - started,
        message: netErr.message,
      });
      throw netErr;
    } finally {
      clearTimeout(timeout);
      if (external) external.removeEventListener('abort', onAbort);
    }
  }

  private recordSuccess(host: string): void {
    const health = this.hostHealth.get(host);
    if (health) {
      this.hostHealth.set(host, { failures: 0, suppressedUntil: 0 });
      if (health.suppressedUntil > 0) {
        this.diagnose('host-recovered', host, `${host} recovered`);
      }
    } else {
      this.hostHealth.set(host, { failures: 0, suppressedUntil: 0 });
    }
  }

  private recordFailure(host: string): void {
    const health = this.hostHealth.get(host) ?? { failures: 0, suppressedUntil: 0 };
    health.failures += 1;
    if (health.failures >= this.opts.circuitFailureThreshold) {
      health.suppressedUntil = Date.now() + this.opts.circuitOpenMs;
      this.diagnose('host-suppressed', host, `${host} suppressed for ${this.opts.circuitOpenMs}ms`);
    }
    this.hostHealth.set(host, health);
  }
}

function sleepWithJitter(baseMs: number, elapsedMs: number): Promise<void> {
  // Back off proportionally to how long the failed attempt took: instant
  // failures (dead network) retry quickly; slow timeouts wait longer.
  const computed = Math.min(2000, Math.max(120, elapsedMs * 0.5 + baseMs));
  const jitter = Math.random() * 0.4 + 0.8; // 0.8x–1.2x
  return new Promise((resolve) => setTimeout(resolve, Math.round(computed * jitter)));
}

// ---------------------------------------------------------------------------
// Default instance
// ---------------------------------------------------------------------------

let defaultClient: IconifyClient | null = null;

/** Lazily created shared client. Injectable for tests via `setDefaultClient`. */
export function getIconifyClient(): IconifyClient {
  if (!defaultClient) defaultClient = new IconifyClient();
  return defaultClient;
}

export function setDefaultClient(client: IconifyClient | null): void {
  defaultClient = client;
}
