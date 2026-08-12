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

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

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
  has(url: string): boolean {
    return this.cache.has(url);
  }

  /** Check if an image URL is fully loaded and ready. */
  isLoaded(url: string): boolean {
    const entry = this.cache.get(url);
    return entry?.state === 'loaded' && entry.image !== null;
  }

  /** Get a cached image entry, or undefined if not cached. */
  get(url: string): ImageCacheEntry | undefined {
    const entry = this.cache.get(url);
    if (entry) this.touch(url);
    return entry;
  }

  /** Get the loaded cached image (element or bitmap), or null if not yet loaded. */
  getImage(url: string): CachedImage | null {
    const entry = this.cache.get(url);
    if (entry?.state === 'loaded') {
      this.touch(url);
      return entry.image ?? null;
    }
    return null;
  }

  /**
   * Load an image. Returns a promise that resolves to the loaded image element.
   * Subsequent calls with the same URL return the same promise while loading,
   * or resolve immediately if already cached.
   */
  async load(url: string): Promise<CachedImage> {
    // Already loaded
    const existing = this.cache.get(url);
    if (existing?.state === 'loaded' && existing.image) {
      this.hits++;
      this.touch(url);
      return existing.image;
    }

    // Already pending
    const pending = this.pending.get(url);
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
    this.cache.set(url, { state: 'loading', image: null });
    const loadToken = Symbol(url);
    this.loadTokens.set(url, loadToken);

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
        if (this.loadTokens.get(url) !== loadToken) {
          // The request was cancelled, superseded, or cleared while the
          // browser was decoding. The cache no longer owns this result, so
          // release transferable resources instead of leaking them.
          this.closeImage(img);
          return img;
        }
        const bytes = this.estimateBytes(img);
        this.cache.set(url, { state: 'loaded', image: img });
        this.pending.delete(url);
        this.loadTokens.delete(url);
        this.touch(url);
        this.entryBytes.set(url, bytes);
        this.retainedBytes += bytes;
        // Notify while the completed entry is observable, even when it cannot
        // be admitted to the retained cache and will be released immediately.
        this.notifyListeners(url);
        if (bytes > this.maxBytes) {
          this.rejectedOversize++;
          // The caller still owns an oversized result returned from load().
          // It cannot be retained by this cache, but closing it here would
          // make the successful return value unusable when it is an
          // ImageBitmap.
          this.remove(url, false, false);
        } else {
          this.evictIfNeeded();
        }
        return img;
      })
      .catch(async (error: Error) => {
        if (this.loadTokens.get(url) !== loadToken) throw error;
        // Classify the failure so consumers can distinguish missing files
        // from corruption, CORS restrictions, permission problems, and
        // transient unavailability instead of one generic "image failed".
        const typed = await this.classifyFailure(url, error);
        this.cache.set(url, { state: 'error', image: null, error: typed });
        this.evictIfNeeded();
        this.pending.delete(url);
        this.loadTokens.delete(url);
        this.touch(url);
        this.notifyListeners(url);
        throw typed;
      });

    this.pending.set(url, promise);
    this.touch(url);
    return promise;
  }

  /**
   * Preload multiple images. Resolves when all are loaded (or all have failed).
   * Useful for batch preloading before rendering.
   */
  async preload(urls: string[]): Promise<void> {
    const results = await Promise.allSettled(urls.map((url) => this.load(url)));
    for (const result of results) {
      if (result.status === 'rejected') {
        // Errors are already recorded in the cache entry
      }
    }
  }

  /**
   * Cancel a pending load. Marks the entry as 'idle' so it can be retried later.
   */
  cancel(url: string): void {
    this.pending.delete(url);
    this.loadTokens.delete(url);
    const existing = this.cache.get(url);
    if (existing?.state === 'loading') {
      this.cache.set(url, { state: 'idle', image: null });
    }
  }

  /** Remove an entry from the cache. */
  evict(url: string): void {
    this.pending.delete(url);
    this.loadTokens.delete(url);
    this.remove(url, false);
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
  subscribe(url: string, callback: () => void): () => void {
    if (!this.listeners.has(url)) {
      this.listeners.set(url, new Set());
    }
    this.listeners.get(url)?.add(callback);
    return () => {
      const set = this.listeners.get(url);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.listeners.delete(url);
      }
    };
  }

  /** Get the load state for a URL. */
  state(url: string): ImageLoadState {
    return this.cache.get(url)?.state ?? 'idle';
  }

  /**
   * Directly inject a pre-loaded image into the cache.
   * Intended for tests and offline-preload scenarios where the caller
   * already has the decoded image and wants it available synchronously.
   */
  setLoaded(url: string, image: CachedImage): void {
    // Invalidate an older async decode before publishing the replacement.
    // The stale completion will dispose its own result when it arrives.
    this.loadTokens.delete(url);
    this.pending.delete(url);
    const previous = this.cache.get(url);
    if (previous?.state === 'loaded' && previous.image && previous.image !== image) {
      this.closeImage(previous.image);
    }
    const previousBytes = this.entryBytes.get(url) ?? 0;
    this.retainedBytes = Math.max(0, this.retainedBytes - previousBytes);
    const bytes = this.estimateBytes(image);
    this.cache.set(url, { state: 'loaded', image });
    this.pending.delete(url);
    this.touch(url);
    this.entryBytes.set(url, bytes);
    this.retainedBytes += bytes;
    this.notifyListeners(url);
    if (bytes > this.maxBytes) {
      this.rejectedOversize++;
      this.remove(url, false);
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
  atSizeKey(url: string, maxDim: number): string {
    return `${url}@${Math.max(1, Math.floor(maxDim))}`;
  }

  /**
   * Whether an at-size representation entry is loaded and ready.
   */
  isLoadedAtSize(url: string, maxDim: number): boolean {
    return this.isLoaded(this.atSizeKey(url, maxDim));
  }

  /**
   * The cached at-size representation, or null. The full-size entry is never
   * consulted: the at-size entry is the only image this returns, so callers
   * cannot accidentally render a blurry preview of a small image. May hold
   * an ImageBitmap (large sources) or the full-size element itself (sources
   * that fit the cap); both are valid `createImageBitmap` inputs.
   */
  getImageAtSize(url: string, maxDim: number): CachedImage | null {
    const key = this.atSizeKey(url, maxDim);
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
  ): Promise<ImageBitmap | CachedImage> {
    if (!this.isRepresentationCapable(url)) {
      return this.load(url);
    }
    const key = this.atSizeKey(url, maxDim);
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

    const promise = this.decodeAtSize(url, maxDim, source)
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
  ): Promise<ImageBitmap | CachedImage> {
    if (typeof createImageBitmap === 'undefined') {
      throw new Error(`createImageBitmap unavailable for at-size decode: ${url}`);
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
        return this.load(url);
      }
      const blob = await (await fetch(url)).blob();
      return createImageBitmap(blob, {
        resizeWidth: Math.max(1, Math.round(source.width * scale)),
        resizeHeight: Math.max(1, Math.round(source.height * scale)),
        resizeQuality: 'high',
      });
    }
    const blob = await (await fetch(url)).blob();
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
  failureCode(url: string): ImageErrorCode | null {
    const error = this.cache.get(url)?.error;
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
