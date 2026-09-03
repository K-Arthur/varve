/**
 * ImageCache — manages async loading and caching of raster images.
 *
 * Images are stored as HTMLImageElement for immediate canvas drawImage() usage.
 * Supports data URLs, relative paths (resolved via base URL), and absolute URLs.
 *
 * Research basis: Figma image loading strategy (progressive, priority-ordered).
 */

import {
  classifyInlineImageFailure,
  classifyRemoteImageFailure,
  type ImageErrorCode,
  type ImageLoadError,
  isImageErrorCode,
} from './imageErrors';

export type ImageLoadState = 'idle' | 'loading' | 'loaded' | 'error';

/** A decodable raster payload: HTMLImageElement or a decoded ImageBitmap. */
export type CachedImage = HTMLImageElement | ImageBitmap;

/**
 * Resolve a CachedImage's pixel dimensions. HTMLImageElement reports
 * naturalWidth/naturalHeight (falling back to layout width/height once
 * decoded); ImageBitmap carries width/height directly.
 */
export function cachedImageDims(image: CachedImage): { width: number; height: number } {
  if ('naturalWidth' in image) {
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
  }
  return { width: image.width, height: image.height };
}

export interface ImageCacheEntry {
  state: ImageLoadState;
  image: CachedImage | null;
  error?: ImageLoadError;
}

export interface ImageCacheOptions {
  maxEntries?: number;
  /** Maximum estimated decoded RGBA bytes retained by the cache. */
  maxBytes?: number;
}

export interface ImageCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
  rejectedOversize: number;
}

/** Color interpretation used to partition decoded cache entries. */
export interface ImageCacheColorVariant {
  /** Stable source/working encoding identity, e.g. `rasterEncodingKey()`. */
  colorKey: string;
}

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

function cacheKey(url: string, variant?: ImageCacheColorVariant): string {
  if (!variant?.colorKey) return url;
  return `${url}\u0000varve-color=${encodeURIComponent(variant.colorKey)}`;
}

/**
 * Blob for a source the cache is about to resize.
 *
 * `data:` URLs are decoded in memory rather than fetched. `fetch()` on a
 * data URL is a *connect* operation to the CSP, and a policy that sensibly
 * allows `img-src data:` will still refuse it — the `/try` demo ships
 * exactly that combination (`connect-src 'self' blob:`), so every embedded
 * image large enough to need an at-size representation failed there while
 * working in dev. Decoding is also strictly cheaper: the bytes are already
 * in the string.
 */
async function blobForResize(url: string): Promise<Blob> {
  if (!url.startsWith('data:')) return (await fetch(url)).blob();
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('Malformed data URL');
  const header = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  const mime = header.split(';')[0] || 'application/octet-stream';
  if (!/;base64$|;base64;/.test(header)) {
    return new Blob([decodeURIComponent(payload)], { type: mime });
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export class ImageCache {
  private cache = new Map<string, ImageCacheEntry>();
  private pending = new Map<string, Promise<CachedImage>>();
  private loadTokens = new Map<string, symbol>();
  private listeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();
  private maxEntries: number;
  private maxBytes: number;
  private retainedBytes = 0;
  private entryBytes = new Map<string, number>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private rejectedOversize = 0;
  /** Tracks access order for LRU eviction: key → lastAccessTimestamp. */
  private accessTimes = new Map<string, number>();

  constructor(options: number | ImageCacheOptions = {}) {
    const resolved = typeof options === 'number' ? { maxEntries: options } : options;
    this.maxEntries = Math.max(1, resolved.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxBytes = Math.max(0, resolved.maxBytes ?? DEFAULT_MAX_BYTES);
  }

  /** Total number of entries in the cache. */
  get size(): number {
    return this.cache.size;
  }

  get stats(): ImageCacheStats {
    return {
      entries: this.cache.size,
      bytes: this.retainedBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      rejectedOversize: this.rejectedOversize,
    };
  }

  /** Update retention limits and immediately evict entries above them. */
  setLimits(options: ImageCacheOptions): void {
    if (options.maxEntries !== undefined) {
      this.maxEntries = Math.max(1, options.maxEntries);
    }
    if (options.maxBytes !== undefined) {
      this.maxBytes = Math.max(0, options.maxBytes);
    }
    this.evictIfNeeded();
  }

  /** True when a cached payload is a decoded ImageBitmap (duck-typed: the
   *  ImageBitmap global is absent in some non-browser runtimes). */
  private isBitmap(image: CachedImage): image is ImageBitmap {
    return typeof (image as ImageBitmap).close === 'function';
  }

  private estimateBytes(image: CachedImage): number {
    if (this.isBitmap(image)) {
      return image.width * image.height * 4;
    }
    const element = image as HTMLImageElement;
    const width = element.naturalWidth || element.width || 0;
    const height = element.naturalHeight || element.height || 0;
    return width * height * 4;
  }

  private closeImage(image: CachedImage | null): void {
    // ImageBitmap.close() is a no-op on an already-closed bitmap (the spec's
    // [[Detached]] slot check), so double-close paths are harmless here.
    if (image && this.isBitmap(image)) {
      image.close();
    }
  }

  private remove(url: string, countEviction: boolean, dispose = true): void {
    const bytes = this.entryBytes.get(url) ?? 0;
    this.retainedBytes = Math.max(0, this.retainedBytes - bytes);
    this.entryBytes.delete(url);
    const entry = this.cache.get(url);
    if (dispose && entry?.state === 'loaded') this.closeImage(entry.image);
    this.cache.delete(url);
    this.accessTimes.delete(url);
    if (countEviction) this.evictions++;
  }

  /** Evict least-recently-accessed entries when over limit. */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxEntries || this.retainedBytes > this.maxBytes) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [key, time] of this.accessTimes) {
        if (this.cache.has(key) && time < oldestTime) {
          oldestTime = time;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      this.remove(oldestKey, true);
    }
  }

  /** Touch URL as recently used. */
  private touch(url: string): void {
    this.accessTimes.set(url, performance.now());
  }

  /** Number of entries currently loading. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Check if an image URL is cached (any state). */
  has(url: string, variant?: ImageCacheColorVariant): boolean {
    return this.cache.has(cacheKey(url, variant));
  }

  /** Check if an image URL is fully loaded and ready. */
  isLoaded(url: string, variant?: ImageCacheColorVariant): boolean {
    const entry = this.cache.get(cacheKey(url, variant));
    return entry?.state === 'loaded' && entry.image !== null;
  }

  /** Get a cached image entry, or undefined if not cached. */
  get(url: string, variant?: ImageCacheColorVariant): ImageCacheEntry | undefined {
    const key = cacheKey(url, variant);
    const entry = this.cache.get(key);
    if (entry) this.touch(key);
    return entry;
  }

  /** Get the loaded cached image (element or bitmap), or null if not yet loaded. */
  getImage(url: string, variant?: ImageCacheColorVariant): CachedImage | null {
    const key = cacheKey(url, variant);
    const entry = this.cache.get(key);
    if (entry?.state === 'loaded') {
      this.touch(key);
      return entry.image ?? null;
    }
    return null;
  }

  /**
   * Load an image. Returns a promise that resolves to the loaded image element.
   * Subsequent calls with the same URL return the same promise while loading,
   * or resolve immediately if already cached.
   */
  async load(url: string, variant?: ImageCacheColorVariant): Promise<CachedImage> {
    const key = cacheKey(url, variant);
    // Already loaded
    const existing = this.cache.get(key);
    if (existing?.state === 'loaded' && existing.image) {
      this.hits++;
      this.touch(key);
      return existing.image;
    }

    // Already pending
    const pending = this.pending.get(key);
    if (pending) {
      this.hits++;
      return pending;
    }

    this.misses++;

    // Evict oldest entries if at capacity (LRU via accessTimes)
    while (this.cache.size >= this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [key, time] of this.accessTimes) {
        if (this.cache.has(key) && time < oldestTime) {
          oldestTime = time;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        this.remove(oldestKey, true);
      } else {
        break;
      }
    }

    // Mark as loading
    this.cache.set(key, { state: 'loading', image: null });
    const loadToken = Symbol(url);
    this.loadTokens.set(key, loadToken);

    const isInline = url.startsWith('data:') || url.startsWith('blob:');

    const attempt = (crossOrigin: boolean): Promise<CachedImage> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        if (crossOrigin) img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.loading = 'eager';
        img.src = url;
      });
    // Cross-origin URLs are first requested with crossOrigin='anonymous' so a
    // CORS-permissive server yields an untainted canvas (required to export
    // raster/blob output that includes the image). If the server doesn't grant
    // CORS, that request fails outright — retry without crossOrigin so the
    // image still loads for on-screen display, just tainted for pixel export.
    // Inline data:/blob: URLs are always same-origin, so skip the CORS dance.
    const promise = (isInline ? attempt(false) : attempt(true).catch(() => attempt(false)))
      .then((img) => {
        if (this.loadTokens.get(key) !== loadToken) {
          // The request was cancelled, superseded, or cleared while the
          // browser was decoding. The cache no longer owns this result, so
          // release transferable resources instead of leaking them.
          this.closeImage(img);
          return img;
        }
        const bytes = this.estimateBytes(img);
        this.cache.set(key, { state: 'loaded', image: img });
        this.pending.delete(key);
        this.loadTokens.delete(key);
        this.touch(key);
        this.entryBytes.set(key, bytes);
        this.retainedBytes += bytes;
        // Notify while the completed entry is observable, even when it cannot
        // be admitted to the retained cache and will be released immediately.
        this.notifyListeners(key);
        if (bytes > this.maxBytes) {
          this.rejectedOversize++;
          // The caller still owns an oversized result returned from load().
          // It cannot be retained by this cache, but closing it here would
          // make the successful return value unusable when it is an
          // ImageBitmap.
          this.remove(key, false, false);
        } else {
          this.evictIfNeeded();
        }
        return img;
      })
      .catch(async (error: Error) => {
        if (this.loadTokens.get(key) !== loadToken) throw error;
        // Classify the failure so consumers can distinguish missing files
        // from corruption, CORS restrictions, permission problems, and
        // transient unavailability instead of one generic "image failed".
        const typed = await this.classifyFailure(url, error);
        this.cache.set(key, { state: 'error', image: null, error: typed });
        this.evictIfNeeded();
        this.pending.delete(key);
        this.loadTokens.delete(key);
        this.touch(key);
        this.notifyListeners(key);
        throw typed;
      });

    this.pending.set(key, promise);
    this.touch(key);
    return promise;
  }

  /**
   * Preload multiple images. Resolves when all are loaded (or all have failed).
   * Useful for batch preloading before rendering.
   */
  async preload(urls: string[], variant?: ImageCacheColorVariant): Promise<void> {
    const results = await Promise.allSettled(urls.map((url) => this.load(url, variant)));
    for (const result of results) {
      if (result.status === 'rejected') {
        // Errors are already recorded in the cache entry
      }
    }
  }

  /**
   * Cancel a pending load. Marks the entry as 'idle' so it can be retried later.
   */
  cancel(url: string, variant?: ImageCacheColorVariant): void {
    const key = cacheKey(url, variant);
    this.pending.delete(key);
    this.loadTokens.delete(key);
    const existing = this.cache.get(key);
    if (existing?.state === 'loading') {
      this.cache.set(key, { state: 'idle', image: null });
    }
  }

  /** Remove an entry from the cache. */
  evict(url: string, variant?: ImageCacheColorVariant): void {
    const key = cacheKey(url, variant);
    this.pending.delete(key);
    this.loadTokens.delete(key);
    this.remove(key, false);
  }

  /**
   * Release decoded and proxy representations that cannot belong to the
   * active document. Source keys also retain their `@<maxDim>` proxy entries.
   * This is an ownership boundary, not ordinary LRU eviction: document close
   * must not leave browser-backed image resources alive indefinitely.
   */
  retainSources(sources: Iterable<string>): number {
    const retained = [...new Set(sources)].filter((source) => source.length > 0);
    let released = 0;
    for (const key of [...this.cache.keys()]) {
      const baseKey = key.split('\u0000varve-color=', 1)[0] ?? key;
      const belongsToSource = retained.some(
        (source) => baseKey === source || baseKey.startsWith(`${source}@`),
      );
      if (belongsToSource) continue;
      this.pending.delete(key);
      this.loadTokens.delete(key);
      this.remove(key, false);
      released++;
    }
    return released;
  }

  /** Clear all cached images, closing retained ImageBitmap entries. */
  clear(): void {
    for (const entry of this.cache.values()) {
      if (entry.state === 'loaded') this.closeImage(entry.image);
    }
    this.cache.clear();
    this.pending.clear();
    this.loadTokens.clear();
    this.entryBytes.clear();
    this.accessTimes.clear();
    this.retainedBytes = 0;
    this.listeners.clear();
    this.globalListeners.clear();
  }

  /**
   * Subscribe to any image load/error event (regardless of URL).
   * Useful for triggering a canvas re-render when any image finishes loading.
   * Returns an unsubscribe function.
   */
  subscribeGlobal(callback: () => void): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /**
   * Subscribe to load state changes for a URL.
   * Returns an unsubscribe function.
   */
  subscribe(url: string, callback: () => void, variant?: ImageCacheColorVariant): () => void {
    const key = cacheKey(url, variant);
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)?.add(callback);
    return () => {
      const set = this.listeners.get(key);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.listeners.delete(key);
      }
    };
  }

  /** Get the load state for a URL. */
  state(url: string, variant?: ImageCacheColorVariant): ImageLoadState {
    return this.cache.get(cacheKey(url, variant))?.state ?? 'idle';
  }

  /**
   * Directly inject a pre-loaded image into the cache.
   * Intended for tests and offline-preload scenarios where the caller
   * already has the decoded image and wants it available synchronously.
   */
  setLoaded(url: string, image: CachedImage, variant?: ImageCacheColorVariant): void {
    const key = cacheKey(url, variant);
    // Invalidate an older async decode before publishing the replacement.
    // The stale completion will dispose its own result when it arrives.
    this.loadTokens.delete(key);
    this.pending.delete(key);
    const previous = this.cache.get(key);
    if (previous?.state === 'loaded' && previous.image && previous.image !== image) {
      this.closeImage(previous.image);
    }
    const previousBytes = this.entryBytes.get(key) ?? 0;
    this.retainedBytes = Math.max(0, this.retainedBytes - previousBytes);
    const bytes = this.estimateBytes(image);
    this.cache.set(key, { state: 'loaded', image });
    this.pending.delete(key);
    this.touch(key);
    this.entryBytes.set(key, bytes);
    this.retainedBytes += bytes;
    this.notifyListeners(key);
    if (bytes > this.maxBytes) {
      this.rejectedOversize++;
      this.remove(key, false);
    } else {
      this.evictIfNeeded();
    }
  }

  private notifyListeners(url: string): void {
    const set = this.listeners.get(url);
    if (set) {
      for (const cb of set) cb();
    }
    for (const cb of this.globalListeners) cb();
  }

  /**
   * True when a source can be decoded at a reduced size through
   * `createImageBitmap` without CORS/taint complications: inline data: and
   * blob: sources only. Remote sources keep the full decode path.
   */
  isRepresentationCapable(url: string): boolean {
    return url.startsWith('data:') || url.startsWith('blob:');
  }

  /**
   * Cache key of the at-size (preview) representation of a source. The `@`
   * suffix is appended to the loadable source string; inline sources cannot
   * contain `@` before the payload (data: and blob: URLs), so the key cannot
   * collide with a real source of the same shape.
   */
  atSizeKey(url: string, maxDim: number, variant?: ImageCacheColorVariant): string {
    return cacheKey(`${url}@${Math.max(1, Math.floor(maxDim))}`, variant);
  }

  /**
   * Whether an at-size representation entry is loaded and ready.
   */
  isLoadedAtSize(url: string, maxDim: number, variant?: ImageCacheColorVariant): boolean {
    return this.isLoaded(this.atSizeKey(url, maxDim, variant));
  }

  /**
   * The cached at-size representation, or null. The full-size entry is never
   * consulted: the at-size entry is the only image this returns, so callers
   * cannot accidentally render a blurry preview of a small image. May hold
   * an ImageBitmap (large sources) or the full-size element itself (sources
   * that fit the cap); both are valid `createImageBitmap` inputs.
   */
  getImageAtSize(
    url: string,
    maxDim: number,
    variant?: ImageCacheColorVariant,
  ): CachedImage | null {
    const key = this.atSizeKey(url, maxDim, variant);
    const entry = this.get(key);
    // A closed bitmap would throw on drawImage; guard defensively (the TS
    // DOM lib lacks the `closed` property, hence the cast).
    const closedBitmap =
      entry?.state === 'loaded' &&
      entry.image &&
      this.isBitmap(entry.image) &&
      (entry.image as { closed?: boolean }).closed === true;
    if (entry?.state === 'loaded' && entry.image && !closedBitmap) {
      this.touch(key);
      return entry.image;
    }
    return null;
  }

  /**
   * Return the best live decoded proxy for a source while a more suitable
   * bucket is loading. Prefer the smallest representation at or above the
   * request; otherwise retain the sharpest lower-resolution proxy. This
   * makes proxy promotion progressive instead of briefly falling back to a
   * placeholder or an unbounded full decode.
   */
  getClosestImageAtSize(
    url: string,
    maxDim: number,
    variant?: ImageCacheColorVariant,
  ): CachedImage | null {
    const exact = this.getImageAtSize(url, maxDim, variant);
    if (exact) return exact;

    const prefix = `${url}@`;
    const colorSuffix = variant?.colorKey
      ? `\u0000varve-color=${encodeURIComponent(variant.colorKey)}`
      : '';
    let smallestAtOrAbove: { dimension: number; image: CachedImage } | null = null;
    let largestBelow: { dimension: number; image: CachedImage } | null = null;

    for (const [key, entry] of this.cache) {
      if (!key.startsWith(prefix)) continue;
      if (colorSuffix) {
        if (!key.endsWith(colorSuffix)) continue;
      } else if (key.includes('\u0000varve-color=')) {
        continue;
      }
      if (entry.state !== 'loaded' || !entry.image) continue;
      if (this.isBitmap(entry.image) && (entry.image as { closed?: boolean }).closed === true) {
        continue;
      }

      const sizeText = colorSuffix
        ? key.slice(prefix.length, -colorSuffix.length)
        : key.slice(prefix.length);
      const dimension = Number(sizeText);
      if (!Number.isInteger(dimension) || dimension <= 0) continue;

      if (dimension >= maxDim) {
        if (!smallestAtOrAbove || dimension < smallestAtOrAbove.dimension) {
          smallestAtOrAbove = { dimension, image: entry.image };
        }
      } else if (!largestBelow || dimension > largestBelow.dimension) {
        largestBelow = { dimension, image: entry.image };
      }
    }

    const chosen = smallestAtOrAbove ?? largestBelow;
    if (chosen) this.touch(this.atSizeKey(url, chosen.dimension, variant));
    return chosen?.image ?? null;
  }

  /**
   * Decode (or await the decode of) the at-size representation of an inline
   * source: the encoded bytes are decoded directly to an ImageBitmap capped
   * at `maxDim` px on the long edge, so a multi-hundred-megapixel photo
   * yields a small transferable bitmap instead of a full-RGBA decode that
   * blows the worker admission budget. The full-size entry is untouched —
   * export and main-thread replay keep the authoritative full-resolution
   * decode. Falls back to the full-size load for sources that cannot be
   * resized (remote URLs, or when createImageBitmap is unavailable), and
   * for sources smaller than the cap (when `source` dims are provided).
   */
  async loadAtSize(
    url: string,
    maxDim: number,
    source?: { width: number; height: number },
    variant?: ImageCacheColorVariant,
  ): Promise<ImageBitmap | CachedImage> {
    if (!this.isRepresentationCapable(url)) {
      return this.load(url, variant);
    }
    const key = this.atSizeKey(url, maxDim, variant);
    const existing = this.get(key);
    if (existing?.state === 'loaded' && existing.image) {
      this.hits++;
      return existing.image;
    }
    const pending = this.pending.get(key);
    if (pending) {
      this.hits++;
      return pending;
    }
    this.misses++;

    while (this.cache.size >= this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [keyCandidate, time] of this.accessTimes) {
        if (this.cache.has(keyCandidate) && time < oldestTime) {
          oldestTime = time;
          oldestKey = keyCandidate;
        }
      }
      if (oldestKey) {
        this.remove(oldestKey, true);
      } else {
        break;
      }
    }

    this.cache.set(key, { state: 'loading', image: null });
    const loadToken = Symbol(key);
    this.loadTokens.set(key, loadToken);

    const promise = this.decodeAtSize(url, maxDim, source, variant)
      .then((image) => {
        if (this.loadTokens.get(key) !== loadToken) {
          this.closeImage(image);
          return image;
        }
        const bytes = this.estimateBytes(image);
        this.cache.set(key, { state: 'loaded', image });
        this.pending.delete(key);
        this.loadTokens.delete(key);
        this.touch(key);
        this.entryBytes.set(key, bytes);
        this.retainedBytes += bytes;
        this.notifyListeners(key);
        if (bytes > this.maxBytes) {
          this.rejectedOversize++;
          // As with full-size loads, an oversized at-size result is returned
          // to the immediate caller but is not retained by the cache.
          this.remove(key, false, false);
        } else {
          this.evictIfNeeded();
        }
        return image;
      })
      .catch(async (error: Error) => {
        if (this.loadTokens.get(key) !== loadToken) throw error;
        const typed = await this.classifyFailure(url, error);
        this.cache.set(key, { state: 'error', image: null, error: typed });
        this.evictIfNeeded();
        this.pending.delete(key);
        this.loadTokens.delete(key);
        this.touch(key);
        this.notifyListeners(key);
        throw typed;
      });

    this.pending.set(key, promise);
    this.touch(key);
    return promise;
  }

  private async decodeAtSize(
    url: string,
    maxDim: number,
    source?: { width: number; height: number },
    variant?: ImageCacheColorVariant,
  ): Promise<ImageBitmap | CachedImage> {
    if (typeof createImageBitmap === 'undefined') {
      // At-size decode is an optimization, not a correctness requirement.
      // Older WebKit/WebViews can still render the full HTML image, so keep
      // thumbnails and the main Canvas2D path functional when the resize API
      // is absent.
      return this.load(url, variant);
    }
    // Known source dims let us (a) skip the preview entirely when the source
    // already fits the cap and (b) target both axes so aspect ratio and
    // orientation are preserved exactly instead of relying on the
    // single-axis resize rule.
    if (source && source.width > 0 && source.height > 0) {
      const scale = Math.min(1, maxDim / Math.max(source.width, source.height));
      if (scale >= 1) {
        // Source fits the cap: the full-size representation IS the
        // representation. Stored under the at-size key so the consumer's
        // lookup path stays uniform.
        return this.load(url, variant);
      }
      const blob = await blobForResize(url);
      return createImageBitmap(blob, {
        resizeWidth: Math.max(1, Math.round(source.width * scale)),
        resizeHeight: Math.max(1, Math.round(source.height * scale)),
        resizeQuality: 'high',
      });
    }
    const blob = await blobForResize(url);
    return createImageBitmap(blob, {
      resizeWidth: maxDim,
      resizeQuality: 'high',
    });
  }

  private async classifyFailure(url: string, cause: Error): Promise<ImageLoadError> {
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return classifyInlineImageFailure(url, cause);
    }
    return classifyRemoteImageFailure(url, cause);
  }

  /**
   * Typed failure code for a cached source, or null when the entry is not
   * in a failed state. Never throws for uncached sources.
   */
  failureCode(url: string, variant?: ImageCacheColorVariant): ImageErrorCode | null {
    const error = this.cache.get(cacheKey(url, variant))?.error;
    return error && isImageErrorCode(error.code) ? error.code : null;
  }
}

/** Singleton global image cache for the application. */
let globalCache: ImageCache | null = null;

export function getImageCache(): ImageCache {
  if (!globalCache) {
    globalCache = new ImageCache();
  }
  return globalCache;
}

export function resetImageCache(): void {
  globalCache?.clear();
  globalCache = null;
}
