/**
 * LRU Thumbnail Cache for layer thumbnails.
 * Keys are computed from node properties (id, kind, fill hash).
 * Automatically evicts least recently used entries at max capacity.
 *
 * Default maxSize matches MemoryBudgets.thumbnailCacheEntries (200).
 * Callers can override via settings.
 */

import { textMeasureRevision } from '@varve/shared';
import { getMemoryBudgets } from '../../canvas/memoryBudget';

export interface ThumbnailCacheEntry {
  dataUrl: string;
  lastUsed: number;
}

export class ThumbnailCache {
  private cache: Map<string, ThumbnailCacheEntry>;
  private maxSize: number;

  constructor(maxSize?: number) {
    this.cache = new Map();
    this.maxSize = maxSize ?? getMemoryBudgets().thumbnailCacheEntries;
  }

  /**
   * Update maxSize (e.g., from user settings change).
   * Triggers eviction if new size is smaller than current entries.
   */
  setMaxSize(n: number): void {
    this.maxSize = Math.max(1, n);
    this.evictIfNeeded();
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

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
}

/**
 * Compute a cache key for a scene node thumbnail.
 * The key incorporates node identity and visual properties so that changes
 * to appearance invalidate the cache entry:
 * - `docId`, since node ids are per-document sequential counters starting at
 *   `n1` — two different open documents routinely have colliding ids (every
 *   new document's first node is `n1`), and this cache is a module-level
 *   singleton shared for the process lifetime, so without `docId` switching
 *   tabs could serve a different document's stale thumbnail for a
 *   coincidentally-matching id.
 * - `shape`, since `renderNodeToCanvas` draws shape-specific geometry (ellipse
 *   rx/ry, path points, line tolerance) for ShapeNodes — hashing only `fill`
 *   would leave a stale thumbnail after a resize/reshape that didn't also
 *   touch the fill.
 * - mask `editRevision`, so editing a raster mask invalidates the thumbnail.
 */
export function thumbnailCacheKey(
  node: {
    id: string;
    kind: string;
    fill?: unknown;
    shape?: unknown;
    fills?: Array<{ type: string; image?: { src: string } }>;
    mask?: { rasterMask?: { editRevision?: number }; visible?: boolean };
    w?: number;
    h?: number;
    text?: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: string;
  },
  docId?: string,
): string {
  const fillHash = stableHash(node.fill ? JSON.stringify(node.fill) : 'none');
  const shapeHash = stableHash(node.shape ? JSON.stringify(node.shape) : 'none');
  const imageSrcHash = stableHash(
    node.fills?.find((f) => f.type === 'image' && f.image?.src)?.image?.src ?? 'none',
  );
  const maskRev = node.mask?.rasterMask?.editRevision ?? 0;
  const dims = node.w !== undefined && node.h !== undefined ? `${node.w}x${node.h}` : '';
  return `${docId ?? ''}:${node.id}:${node.kind}:${fillHash}:${shapeHash}:${imageSrcHash}:mask${maskRev}:${dims}:${textIdentity(node)}`;
}

/**
 * What a text thumbnail actually depends on.
 *
 * Text nodes carry no `shape`, so the hashes above are constant for them: a
 * cached thumbnail survived editing the string, restyling it, and — through
 * the measurement revision — the font it is set in becoming usable, which left
 * the layers panel showing fallback typography indefinitely after the canvas
 * had corrected itself. Non-text nodes contribute nothing here, so a font load
 * does not invalidate every thumbnail in the document.
 */
function textIdentity(node: {
  kind: string;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: string;
}): string {
  if (node.kind !== 'text') return '';
  const style = `${node.fontFamily ?? ''}/${node.fontSize ?? ''}/${node.fontWeight ?? ''}/${node.fontStyle ?? ''}`;
  return `text${stableHash(`${node.text ?? ''}|${style}`)}:${textMeasureRevision()}`;
}
