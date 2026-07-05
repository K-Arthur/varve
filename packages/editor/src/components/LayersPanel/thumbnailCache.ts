/**
 * LRU Thumbnail Cache for layer thumbnails.
 * Keys are computed from node properties (id, kind, fill hash).
 * Automatically evicts least recently used entries at max capacity.
 */

export interface ThumbnailCacheEntry {
  dataUrl: string;
  lastUsed: number;
}

export class ThumbnailCache {
  private cache: Map<string, ThumbnailCacheEntry>;
  private maxSize: number;

  constructor(maxSize = 200) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get a thumbnail from cache. Returns undefined on miss.
   * Updates lastUsed on hit (LRU ordering).
   */
  get(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    entry.lastUsed = Date.now();
    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.dataUrl;
  }

  /**
   * Store a thumbnail in cache. Evicts LRU if over capacity.
   */
  set(key: string, dataUrl: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, { dataUrl, lastUsed: Date.now() });
    this.evictIfNeeded();
  }

  /**
   * Check if key exists in cache (without updating LRU order).
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Remove entries for a specific node ID.
   */
  invalidate(nodeId: string): void {
    for (const [key] of this.cache) {
      if (key.startsWith(`${nodeId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached thumbnails.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }
}

/**
 * Compute a cache key for a scene node thumbnail.
 * The key incorporates node identity and visual properties
 * so that changes to appearance invalidate the cache entry.
 */
export function thumbnailCacheKey(node: { id: string; kind: string; fill?: unknown }): string {
  const fillStr = node.fill ? JSON.stringify(node.fill) : 'none';
  let fillHash = 0;
  for (let i = 0; i < fillStr.length; i++) {
    const char = fillStr.charCodeAt(i);
    fillHash = (fillHash << 5) - fillHash + char;
    fillHash |= 0;
  }
  return `${node.id}:${node.kind}:${fillHash}`;
}
