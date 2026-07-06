/**
 * Subtree replay cache — skip re-replay when subtree hash + zoom bucket unchanged.
 * Not a spatial tile renderer; keys are content-hash + camera bucket.
 */
const DEFAULT_TILE = 256;

export interface SubtreeReplayCacheEntry {
  key: string;
  lastUsed: number;
}

/** @deprecated Use SubtreeReplayCache — kept for backward compatibility. */
export type TileCacheEntry = SubtreeReplayCacheEntry;

export class SubtreeReplayCache {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, SubtreeReplayCacheEntry>();

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  static replayKey(subtreeHash: string, cameraBucket: string): string {
    return `${subtreeHash}:${cameraBucket}`;
  }

  static cameraBucket(zoom: number, tileSize = DEFAULT_TILE): string {
    const zBucket = Math.round(zoom * 100) / 100;
    return `z${zBucket}:t${tileSize}`;
  }

  has(key: string): boolean {
    const e = this.entries.get(key);
    if (e) {
      e.lastUsed = performance.now();
      return true;
    }
    return false;
  }

  touch(key: string): void {
    this.entries.set(key, { key, lastUsed: performance.now() });
    this.evictIfNeeded();
  }

  invalidate(prefix?: string): void {
    if (!prefix) {
      this.entries.clear();
      return;
    }
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = [...this.entries.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    const remove = sorted.slice(0, this.entries.size - this.maxEntries);
    for (const e of remove) this.entries.delete(e.key);
  }
}

/** @deprecated Use SubtreeReplayCache */
export class TileCache extends SubtreeReplayCache {
  static tileKey(subtreeHash: string, cameraBucket: string): string {
    return SubtreeReplayCache.replayKey(subtreeHash, cameraBucket);
  }
}
