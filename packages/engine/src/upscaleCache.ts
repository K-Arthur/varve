/**
 * LRU cache for upscaled results.
 *
 * Keyed by a content fingerprint + scale + method so that re-exporting the
 * same node at the same settings reuses the pixel data without re-upscaling.
 * Max 20 entries — large enough for a typical export batch, small enough to
 * not waste memory on stale results after the user edits a node.
 */

const MAX_ENTRIES = 20;

interface CacheEntry {
  data: ImageData;
  lastAccessed: number;
}

const store = new Map<string, CacheEntry>();

/**
 * Compute a lightweight content fingerprint for an ImageData so that
 * identical pixel buffers produce the same cache key.
 */
function contentFingerprint(data: ImageData): string {
  const d = data.data;
  const len = Math.min(d.length, 512);
  let hash = 0;
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) - hash + d[i]) | 0;
  }
  return `${data.width}x${data.height}:${hash}`;
}

function buildKey(source: ImageData, scale: number, method: string): string {
  return `${contentFingerprint(source)}:${scale}:${method}`;
}

export function upscaleCacheGet(
  source: ImageData,
  scale: number,
  method: string,
): ImageData | null {
  const key = buildKey(source, scale, method);
  const entry = store.get(key);
  if (!entry) return null;
  entry.lastAccessed = Date.now();
  return entry.data;
}

export function upscaleCacheSet(
  source: ImageData,
  scale: number,
  method: string,
  data: ImageData,
): void {
  const key = buildKey(source, scale, method);
  if (store.has(key)) {
    const entry = store.get(key)!;
    entry.data = data;
    entry.lastAccessed = Date.now();
    return;
  }
  if (store.size >= MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of store) {
      if (v.lastAccessed < oldestTime) {
        oldestTime = v.lastAccessed;
        oldestKey = k;
      }
    }
    if (oldestKey) store.delete(oldestKey);
  }
  store.set(key, { data, lastAccessed: Date.now() });
}

export function upscaleCacheClear(): void {
  store.clear();
}
