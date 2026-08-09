/**
 * ImageCache — manages async loading and caching of raster images.
 *
 * Images are stored as HTMLImageElement for immediate canvas drawImage() usage.
 * Supports data URLs, relative paths (resolved via base URL), and absolute URLs.
 *
 * Research basis: Figma image loading strategy (progressive, priority-ordered).
 */

export type ImageLoadState = 'idle' | 'loading' | 'loaded' | 'error';

export interface ImageCacheEntry {
  state: ImageLoadState;
  image: HTMLImageElement | null;
  error?: Error;
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
  private pending = new Map<string, Promise<HTMLImageElement>>();
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

  private estimateBytes(image: HTMLImageElement): number {
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    return width * height * 4;
  }

  private remove(url: string, countEviction: boolean): void {
    const bytes = this.entryBytes.get(url) ?? 0;
    this.retainedBytes = Math.max(0, this.retainedBytes - bytes);
    this.entryBytes.delete(url);
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

  /** Get the loaded HTMLImageElement, or null if not yet loaded. */
  getImage(url: string): HTMLImageElement | null {
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
  async load(url: string): Promise<HTMLImageElement> {
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

    const attempt = (crossOrigin: boolean): Promise<HTMLImageElement> =>
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
        if (this.loadTokens.get(url) !== loadToken) return img;
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
          this.remove(url, false);
        } else {
          this.evictIfNeeded();
        }
        return img;
      })
      .catch((error: Error) => {
        if (this.loadTokens.get(url) !== loadToken) throw error;
        this.cache.set(url, { state: 'error', image: null, error });
        this.evictIfNeeded();
        this.pending.delete(url);
        this.loadTokens.delete(url);
        this.touch(url);
        this.notifyListeners(url);
        throw error;
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

  /** Clear all cached images. */
  clear(): void {
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
  setLoaded(url: string, image: HTMLImageElement): void {
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
