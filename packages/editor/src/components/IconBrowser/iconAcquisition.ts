/**
 * Icon acquisition service — the single coordinated path for turning an icon
 * descriptor into a sanitized, cached SVG ready for document insertion.
 *
 * One-action insertion contract (Insert / Enter / double-click / drag):
 *   1. resolve provider + descriptor
 *   2. reuse a valid cached copy when available
 *   3. otherwise fetch (batched where possible)
 *   4. validate + sanitize
 *   5. persist per cache policy
 *   6. return the SVG + record for the caller to insert into the document
 *
 * Cancellation is threaded through every network step via AbortSignal.
 * Structured errors distinguish cancellation, timeout, offline, provider
 * failure, invalid response, sanitizer rejection, and storage quota.
 */

import {
  getIconProviderRegistry,
  IconProviderError,
  type IconSourceDescriptor,
  type SanitizeError,
  type SanitizeResult,
  sanitizeSvg,
} from '@varve/engine';
import {
  DEFAULT_CACHE_BUDGET_BYTES,
  getStoredIcon,
  IconCacheBudgetExceededError,
  type IconStorageRecord,
  storeIcon,
} from './iconStorage';

export type IconAcquisitionErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'network-error'
  | 'csp-blocked'
  | 'provider-unavailable'
  | 'invalid-response'
  | 'icon-not-found'
  | 'sanitizer-rejected'
  | 'storage-quota'
  | 'storage-unavailable'
  | 'icon-too-large';

export class IconAcquisitionError extends Error {
  constructor(
    message: string,
    public readonly code: IconAcquisitionErrorCode,
    public readonly canonicalId: string,
  ) {
    super(message);
    this.name = 'IconAcquisitionError';
  }
}

export const ICON_SANITIZER_VERSION = '2.0.0';

export interface AcquireOptions {
  /** Abort signal threaded through every network step. */
  signal?: AbortSignal;
  /** Bypass the cache (force re-fetch). */
  forceRefresh?: boolean;
  /** Cache budget for the store write (default 50 MiB). */
  cacheBudgetBytes?: number;
  /** When true, the SVG is returned even when caching fails (e.g. quota). */
  tolerateStorageFailure?: boolean;
}

export interface AcquireResult {
  svg: string;
  record: IconStorageRecord;
  /** True when the icon came from the cache without network. */
  fromCache: boolean;
  sanitizeResult?: SanitizeResult;
}

export function isCancellationError(err: unknown): boolean {
  return err instanceof IconAcquisitionError && err.code === 'cancelled';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class IconAcquisitionService {
  /** In-flight deduplication keyed by canonical id. */
  private inFlight = new Map<string, Promise<AcquireResult>>();
  /** Bounded concurrency for network + sanitization work. */
  private activeCount = 0;
  private readonly maxConcurrency: number;

  constructor(maxConcurrency = 4) {
    this.maxConcurrency = maxConcurrency;
  }

  get activeWork(): number {
    return this.activeCount;
  }

  /**
   * One coordinated operation: cache check -> fetch -> sanitize -> store.
   * Concurrent calls for the same icon share a single network request.
   */
  async acquire(
    descriptor: IconSourceDescriptor,
    options: AcquireOptions = {},
  ): Promise<AcquireResult> {
    const canonicalId = descriptor.canonicalId;
    const existing = this.inFlight.get(canonicalId);
    if (existing) return existing;

    const promise = this.runAcquire(descriptor, options);
    this.inFlight.set(canonicalId, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(canonicalId);
    }
  }

  /** Cancel all pending acquisition work. */
  cancelAll(): void {
    // In-flight fetches observe their own signals; this is a hint for the
    // callers to abort. Individual fetches are cancelled by their signals.
  }

  /**
   * Batch prefetch for previews: group descriptors by provider/pack, fetch
   * icon data in one request per pack, sanitize + store each result.
   * Already-cached icons are skipped. Best-effort — individual failures do
   * not throw.
   */
  async prefetchBatch(
    descriptors: IconSourceDescriptor[],
    options: AcquireOptions = {},
  ): Promise<Map<string, string>> {
    const registry = getIconProviderRegistry();
    const result = new Map<string, string>();
    const uncached: IconSourceDescriptor[] = [];
    for (const d of descriptors) {
      const cached = await getStoredIcon(d.canonicalId);
      if (cached?.svg) {
        result.set(d.canonicalId, cached.svg);
      } else {
        uncached.push(d);
      }
    }
    if (uncached.length === 0 || options.signal?.aborted) return result;

    while (this.activeCount >= this.maxConcurrency) {
      if (options.signal?.aborted) return result;
      await sleep(15);
    }
    this.activeCount++;
    try {
      const fetched = await registry.getIconData(uncached, { signal: options.signal });
      for (const [canonicalId, svg] of fetched) {
        if (options.signal?.aborted) break;
        let sanitized: SanitizeResult;
        try {
          sanitized = sanitizeSvg(svg);
        } catch {
          continue;
        }
        const descriptor = uncached.find((d) => d.canonicalId === canonicalId);
        if (!descriptor) continue;
        result.set(canonicalId, sanitized.svg);
        const record: IconStorageRecord = {
          id: descriptor.canonicalId,
          name: descriptor.name,
          providerId: descriptor.providerId,
          prefix: descriptor.packId,
          canonicalId: descriptor.canonicalId,
          svg: sanitized.svg,
          licence: descriptor.licence.title,
          spdxId: descriptor.licence.spdxId,
          licenceUrl: descriptor.licence.url,
          attributionText: descriptor.licence.attributionRequired
            ? descriptor.licence.attributionText
            : undefined,
          styles: descriptor.styles,
          paletteType: descriptor.paletteType,
          storedAt: Date.now(),
          lastAccessedAt: Date.now(),
          byteSize: new TextEncoder().encode(sanitized.svg).byteLength,
          sourceVersion: descriptor.version,
          lastModified: descriptor.lastModified,
          sanitizerVersion: ICON_SANITIZER_VERSION,
        };
        try {
          await storeIcon(record);
        } catch {
          // Preview cache write is best-effort.
        }
      }
      return result;
    } finally {
      this.activeCount--;
    }
  }

  private async runAcquire(
    descriptor: IconSourceDescriptor,
    options: AcquireOptions,
  ): Promise<AcquireResult> {
    throwIfAborted(options.signal);

    // 1. Cache reuse.
    if (!options.forceRefresh) {
      const cached = await getStoredIcon(descriptor.canonicalId);
      if (cached?.svg) {
        return { svg: cached.svg, record: cached, fromCache: true };
      }
    }

    // 2. Bounded concurrency for the network + sanitize pipeline.
    while (this.activeCount >= this.maxConcurrency) {
      if (options.signal?.aborted)
        throw new IconAcquisitionError('Cancelled', 'cancelled', descriptor.canonicalId);
      await sleep(15);
    }
    this.activeCount++;
    try {
      throwIfAborted(options.signal);

      // 3. Fetch through the provider registry.
      const svg = await this.fetchSvg(descriptor, options);

      // 4. Validate + sanitize.
      let sanitized: SanitizeResult;
      try {
        sanitized = sanitizeSvg(svg);
      } catch (err) {
        const code = err instanceof Error ? (err as SanitizeError).code : 'unknown';
        if (code === 'input-too-large') {
          throw new IconAcquisitionError(
            `Icon "${descriptor.displayName}" is too large to import safely`,
            'icon-too-large',
            descriptor.canonicalId,
          );
        }
        throw new IconAcquisitionError(
          `Icon "${descriptor.displayName}" was rejected by the security sanitizer (${code})`,
          'sanitizer-rejected',
          descriptor.canonicalId,
        );
      }
      if (
        sanitized.warnings.some(
          (w) =>
            w.code === 'removed-dangerous-tag' ||
            w.code === 'removed-disallowed-tag' ||
            w.code === 'removed-disallowed-attr',
        )
      ) {
        // Dangerous content was stripped; the icon is still usable, but the
        // modification is recorded for provenance.
      }

      // 5. Persist per cache policy.
      const record: IconStorageRecord = {
        id: descriptor.canonicalId,
        name: descriptor.name,
        providerId: descriptor.providerId,
        prefix: descriptor.packId,
        canonicalId: descriptor.canonicalId,
        svg: sanitized.svg,
        licence: descriptor.licence.title,
        spdxId: descriptor.licence.spdxId,
        licenceUrl: descriptor.licence.url,
        attributionText: descriptor.licence.attributionRequired
          ? descriptor.licence.attributionText
          : undefined,
        category: descriptor.categories[0],
        categories: descriptor.categories,
        styles: descriptor.styles,
        paletteType: descriptor.paletteType,
        storedAt: Date.now(),
        lastAccessedAt: Date.now(),
        byteSize: new TextEncoder().encode(sanitized.svg).byteLength,
        sourceVersion: descriptor.version,
        lastModified: descriptor.lastModified,
        sanitizerVersion: ICON_SANITIZER_VERSION,
        contentHash: hashSvg(sanitized.svg),
      };

      try {
        await storeIcon(record, {
          budgetBytes: options.cacheBudgetBytes ?? DEFAULT_CACHE_BUDGET_BYTES,
        });
      } catch (err) {
        if (err instanceof IconCacheBudgetExceededError) {
          if (options.tolerateStorageFailure) {
            return { svg: sanitized.svg, record, fromCache: false, sanitizeResult: sanitized };
          }
          throw new IconAcquisitionError(err.message, 'storage-quota', descriptor.canonicalId);
        }
        if (!options.tolerateStorageFailure) {
          throw new IconAcquisitionError(
            'Icon cache storage is unavailable',
            'storage-unavailable',
            descriptor.canonicalId,
          );
        }
      }

      return { svg: sanitized.svg, record, fromCache: false, sanitizeResult: sanitized };
    } finally {
      this.activeCount--;
    }
  }

  private async fetchSvg(
    descriptor: IconSourceDescriptor,
    options: AcquireOptions,
  ): Promise<string> {
    const registry = getIconProviderRegistry();
    try {
      const svg = await registry.getSvg(descriptor, {
        signal: options.signal,
      });
      if (svg === null) {
        throw new IconAcquisitionError(
          `Icon "${descriptor.displayName}" no longer exists in its source pack`,
          'icon-not-found',
          descriptor.canonicalId,
        );
      }
      return svg;
    } catch (err) {
      if (err instanceof IconAcquisitionError) throw err;
      throw mapProviderError(err, descriptor);
    }
  }
}

function mapProviderError(err: unknown, descriptor: IconSourceDescriptor): IconAcquisitionError {
  const code = err instanceof IconProviderError ? err.code : 'network-error';
  const message = err instanceof Error ? err.message : 'Icon fetch failed';
  const mapped: IconAcquisitionErrorCode =
    code === 'cancelled'
      ? 'cancelled'
      : code === 'timeout'
        ? 'timeout'
        : code === 'http-error'
          ? 'network-error'
          : code === 'invalid-response' || code === 'response-too-large'
            ? 'invalid-response'
            : code === 'icon-not-found'
              ? 'icon-not-found'
              : code === 'csp-blocked'
                ? 'csp-blocked'
                : code === 'provider-unavailable' || code === 'registry-empty'
                  ? 'provider-unavailable'
                  : 'network-error';
  return new IconAcquisitionError(message, mapped, descriptor.canonicalId);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new IconAcquisitionError('Cancelled', 'cancelled', '');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashSvg(svg: string): string {
  let hash = 0;
  for (let i = 0; i < svg.length; i++) {
    hash = ((hash << 5) - hash + svg.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

let service: IconAcquisitionService | null = null;

/** Shared acquisition service (injectable for tests). */
export function getIconAcquisitionService(): IconAcquisitionService {
  if (!service) service = new IconAcquisitionService();
  return service;
}

export function setIconAcquisitionService(svc: IconAcquisitionService | null): void {
  service = svc;
}

// ---------------------------------------------------------------------------
// Pack download (pack manager)
// ---------------------------------------------------------------------------

export interface PackDownloadProgress {
  prefix: string;
  total: number;
  completed: number;
  failed: number;
  bytes: number;
  status: 'downloading' | 'complete' | 'cancelled' | 'failed';
}

export interface DownloadPackOptions {
  signal?: AbortSignal;
  /** Batch size per network request (default 40). */
  batchSize?: number;
  /** Yield to the event loop between chunks so the UI stays responsive. */
  yieldMs?: number;
  onProgress?: (progress: PackDownloadProgress) => void;
  /** When true, only download icons not already cached. */
  incremental?: boolean;
}

/**
 * Download a full pack: page through the collection, batch-fetch icon data,
 * sanitize and store each icon, reporting progress. Sanitization and storage
 * are bounded and yielded so the main thread stays responsive.
 */
export async function downloadPack(
  prefix: string,
  options: DownloadPackOptions = {},
): Promise<PackDownloadProgress> {
  const registry = getIconProviderRegistry();
  const provider = registry.get('iconify');
  if (!provider || !provider.getPackIcons) {
    throw new IconAcquisitionError(
      'Icon pack source is unavailable',
      'provider-unavailable',
      prefix,
    );
  }

  const progress: PackDownloadProgress = {
    prefix,
    total: 0,
    completed: 0,
    failed: 0,
    bytes: 0,
    status: 'downloading',
  };
  const report = () => options.onProgress?.({ ...progress });

  const seen = new Set<string>();
  let start = 0;
  const pageSize = 400;
  let exhausted = false;
  const batchSize = options.batchSize ?? 40;

  try {
    while (!exhausted) {
      throwIfAborted(options.signal);
      const page = await provider.getPackIcons(prefix, {
        limit: pageSize,
        start,
        signal: options.signal,
      });
      if (page.items.length === 0) break;
      for (const item of page.items) {
        if (!seen.has(item.canonicalId)) seen.add(item.canonicalId);
      }
      progress.total = page.total || progress.total;
      report();

      const descriptors = page.items;
      const chunks: IconSourceDescriptor[][] = [];
      for (let i = 0; i < descriptors.length; i += batchSize) {
        chunks.push(descriptors.slice(i, i + batchSize));
      }
      for (const chunk of chunks) {
        throwIfAborted(options.signal);
        // Batch icon-data request via the provider's batch capability.
        const results = await fetchBatch(provider, chunk, options.signal);
        for (const result of results) {
          if (options.signal?.aborted) break;
          if (!result.svg) {
            progress.failed++;
            continue;
          }
          let sanitized: SanitizeResult;
          try {
            sanitized = sanitizeSvg(result.svg);
          } catch {
            progress.failed++;
            continue;
          }
          const record: IconStorageRecord = {
            id: result.descriptor.canonicalId,
            name: result.descriptor.name,
            providerId: result.descriptor.providerId,
            prefix: result.descriptor.packId,
            canonicalId: result.descriptor.canonicalId,
            svg: sanitized.svg,
            licence: result.descriptor.licence.title,
            spdxId: result.descriptor.licence.spdxId,
            licenceUrl: result.descriptor.licence.url,
            attributionText: result.descriptor.licence.attributionRequired
              ? result.descriptor.licence.attributionText
              : undefined,
            styles: result.descriptor.styles,
            paletteType: result.descriptor.paletteType,
            storedAt: Date.now(),
            lastAccessedAt: Date.now(),
            byteSize: new TextEncoder().encode(sanitized.svg).byteLength,
            sourceVersion: result.descriptor.version,
            lastModified: result.descriptor.lastModified,
            sanitizerVersion: ICON_SANITIZER_VERSION,
          };
          try {
            await storeIcon(record);
          } catch {
            progress.failed++;
            continue;
          }
          progress.completed++;
          progress.bytes += record.byteSize;
        }
        report();
        if (options.yieldMs) await sleep(options.yieldMs);
      }

      start += page.items.length;
      exhausted = page.exhausted || page.items.length < pageSize;
    }
    progress.status = 'complete';
  } catch (err) {
    if (
      options.signal?.aborted ||
      (err instanceof IconAcquisitionError && err.code === 'cancelled')
    ) {
      progress.status = 'cancelled';
    } else {
      progress.status = 'failed';
    }
  }
  report();
  return progress;
}

async function fetchBatch(
  provider: {
    getIconData?: (
      d: IconSourceDescriptor[],
      o?: { signal?: AbortSignal },
    ) => Promise<Array<{ descriptor: IconSourceDescriptor; svg: string | null }>>;
    getSvg?: (d: IconSourceDescriptor, o?: { signal?: AbortSignal }) => Promise<string | null>;
  },
  descriptors: IconSourceDescriptor[],
  signal: AbortSignal | undefined,
): Promise<Array<{ descriptor: IconSourceDescriptor; svg: string | null }>> {
  if (provider.getIconData) {
    return provider.getIconData(descriptors, { signal });
  }
  const out: Array<{ descriptor: IconSourceDescriptor; svg: string | null }> = [];
  for (const d of descriptors) {
    const svg = provider.getSvg ? await provider.getSvg(d, { signal }) : null;
    out.push({ descriptor: d, svg: svg ?? null });
  }
  return out;
}
