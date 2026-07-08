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

export class ImageCache {
  private cache = new Map<string, ImageCacheEntry>();
  private pending = new Map<string, Promise<HTMLImageElement>>();
  private listeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();
  private maxEntries: number;
  /** Tracks access order for LRU eviction: key → lastAccessTimestamp. */
  private accessTimes = new Map<string, number>();

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  /** Total number of entries in the cache. */
  get size(): number {
    return this.cache.size;
  }

  /** Evict least-recently-accessed entries when over limit. */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxEntries) return;
    const sorted = [...this.accessTimes.entries()]
      .filter(([k]) => this.cache.has(k))
      .sort((a, b) => a[1] - b[1]);
    const remove = sorted.slice(0, this.cache.size - this.maxEntries);
    for (const [url] of remove) {
      this.cache.delete(url);
      this.accessTimes.delete(url);
      this.listeners.delete(url);
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
      return existing.image;
    }

    // Already pending
    const pending = this.pending.get(url);
    if (pending) return pending;

    // Mark as loading
    this.cache.set(url, { state: 'loading', image: null });

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.cache.set(url, { state: 'loaded', image: img });
        this.evictIfNeeded();
        this.pending.delete(url);
        this.touch(url);
        this.notifyListeners(url);
        resolve(img);
      };
      img.onerror = () => {
        const error = new Error(`Failed to load image: ${url}`);
        this.cache.set(url, { state: 'error', image: null, error });
        this.evictIfNeeded();
        this.pending.delete(url);
        this.touch(url);
        this.notifyListeners(url);
        reject(error);
      };
      img.loading = 'eager';
      img.src = url;
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
    const existing = this.cache.get(url);
    if (existing?.state === 'loading') {
      this.cache.set(url, { state: 'idle', image: null });
    }
  }

  /** Remove an entry from the cache. */
  evict(url: string): void {
    this.pending.delete(url);
    this.cache.delete(url);
    this.listeners.delete(url);
  }

  /** Clear all cached images. */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
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
    this.cache.set(url, { state: 'loaded', image });
    this.evictIfNeeded();
    this.pending.delete(url);
    this.touch(url);
    this.notifyListeners(url);
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
  globalCache = null;
}
