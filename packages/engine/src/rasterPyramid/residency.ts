/**
 * Raster pyramid — tile residency.
 *
 * Byte-budgeted store for decoded pyramid tiles (ADR-0214 D10). Eviction is
 * LRU with a protected set: the tile(s) currently being presented or in the
 * middle of a generation pipeline are never evicted mid-use. Budgets are
 * passed in by the caller (editor memory resolver at integration time) —
 * this module never imports editor code.
 *
 * The snapshot stored on each entry is the revision string the tile was
 * generated from; the cache layer compares it to the current source state to
 * detect staleness (ADR-0214 D4).
 */
import { PYRAMID_TILE_SIZE } from './pyramid';

export const DEFAULT_PYRAMID_BUDGET_BYTES = 32 * 1024 * 1024; // 512 tiles of 64 KiB

export interface PyramidTileEntry {
  readonly key: string;
  readonly layerId: string;
  readonly level: number;
  readonly col: number;
  readonly row: number;
  /** Revision snapshot the tile was generated from (empty for L0 sources). */
  readonly snapshot: string;
  readonly pixels: Uint8ClampedArray;
  readonly bytes: number;
  lastUsedAt: number;
  protected: boolean;
}

export interface PyramidResidencyOptions {
  budgetBytes?: number;
  /** Per-tile byte size; default 128x128x4. */
  tileBytes?: number;
}

export interface PyramidResidencyDiagnostics {
  readonly residentBytes: number;
  readonly peakBytes: number;
  readonly residentTiles: number;
  readonly evictions: number;
  readonly hits: number;
  readonly misses: number;
}

export class PyramidResidency {
  private readonly entries = new Map<string, PyramidTileEntry>();
  private budgetBytes: number;
  private readonly tileBytes: number;
  private residentBytes = 0;
  private peakBytes = 0;
  private evictions = 0;
  private hits = 0;
  private misses = 0;
  private clock = 0;

  constructor(options: PyramidResidencyOptions = {}) {
    this.budgetBytes = options.budgetBytes ?? DEFAULT_PYRAMID_BUDGET_BYTES;
    this.tileBytes = options.tileBytes ?? PYRAMID_TILE_SIZE * PYRAMID_TILE_SIZE * 4;
  }

  get budget(): number {
    return this.budgetBytes;
  }

  setBudget(bytes: number): void {
    this.budgetBytes = Math.max(0, bytes);
    this.evictToBudget();
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): PyramidTileEntry | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    this.hits++;
    entry.lastUsedAt = ++this.clock;
    return entry;
  }

  /**
   * Insert or replace a tile. The replacement may push the store over budget;
   * eviction happens here (never mid-presentation — protected tiles are
   * skipped).
   */
  put(
    entry: Omit<PyramidTileEntry, 'lastUsedAt' | 'protected'> & { protected?: boolean },
  ): PyramidTileEntry {
    const existing = this.entries.get(entry.key);
    if (existing) {
      this.residentBytes -= existing.bytes;
      this.evictions++;
      this.entries.delete(entry.key);
    }
    const full: PyramidTileEntry = {
      ...entry,
      bytes: entry.bytes > 0 ? entry.bytes : this.tileBytes,
      lastUsedAt: ++this.clock,
      protected: entry.protected ?? false,
    };
    this.entries.set(full.key, full);
    this.residentBytes += full.bytes;
    this.peakBytes = Math.max(this.peakBytes, this.residentBytes);
    this.evictToBudget();
    return full;
  }

  touch(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.lastUsedAt = ++this.clock;
  }

  protect(key: string, on: boolean): void {
    const entry = this.entries.get(key);
    if (entry) entry.protected = on;
  }

  /** Mark all tiles of a layer protected/unprotected (presentation windows). */
  protectLayer(layerId: string, on: boolean): void {
    for (const entry of this.entries.values()) {
      if (entry.layerId === layerId) entry.protected = on;
    }
  }

  /**
   * Evict least-recently-used tiles until within budget. Protected entries
   * are skipped; if every entry is protected, eviction stops (the caller's
   * presentation window must clear protection).
   */
  evictToBudget(): number {
    let evicted = 0;
    while (this.residentBytes > this.budgetBytes) {
      let oldest: PyramidTileEntry | null = null;
      for (const entry of this.entries.values()) {
        if (entry.protected) continue;
        if (!oldest || entry.lastUsedAt < oldest.lastUsedAt) oldest = entry;
      }
      if (!oldest) break;
      this.entries.delete(oldest.key);
      this.residentBytes -= oldest.bytes;
      this.evictions++;
      evicted++;
    }
    return evicted;
  }

  /** Drop every tile of a layer (document close, layer delete — ADR-0214 D12-ish). */
  releaseLayer(layerId: string): number {
    let released = 0;
    for (const [key, entry] of this.entries) {
      if (entry.layerId === layerId) {
        this.entries.delete(key);
        this.residentBytes -= entry.bytes;
        released++;
      }
    }
    return released;
  }

  clear(): void {
    this.entries.clear();
    this.residentBytes = 0;
  }

  diagnostics(): PyramidResidencyDiagnostics {
    return {
      residentBytes: this.residentBytes,
      peakBytes: this.peakBytes,
      residentTiles: this.entries.size,
      evictions: this.evictions,
      hits: this.hits,
      misses: this.misses,
    };
  }
}
