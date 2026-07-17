/**
 * Per-node IR item cache — skip rebuild when node content hash is unchanged.
 * Complements compositor SubtreeReplayCache (replay skip, not IR generation).
 *
 * Architecture:
 *   SubtreeIrCache caches RenderItem per nodeId. The cached entry is
 *   looked up by a FNV-1a hash that includes every field that affects IR
 *   output. CacheContentParts() extracts the full set of render-relevant
 *   fields; nodeHash() hashes them together with nodeId, transform, and
 *   styleKey.
 *
 *   When cacheContentParts changes (any field that affects IR), the hash
 *   changes and the entry is a miss — this is the defence-in-depth layer.
 *   Explicit invalidate(nodeId) is the primary invalidation mechanism,
 *   called from CanvasArea.tsx document-diffing.
 *
 * Budget model:
 *   The cache enforces both entry-count and byte-count limits. set()
 *   accounts for the estimated retained bytes of the inserted item and
 *   evicts LRU entries until both limits are satisfied. Entries larger
 *   than the entire soft budget are refused.
 *
 * Sub-hash system:
 *   cacheContentParts returns a SubHashReport containing both the content
 *   parts (for the primary hash) and a breakdown by category (geometry,
 *   paint, text, effects, image). The breakdown is used for diagnostics
 *   only — the primary hash is still a single FNV-1a over all parts.
 */

import type { SceneNode as EngineNode, RenderItem } from '@strata/engine';

/** Diagnostics: which sub-category of content changed. */
export interface ChangedSubHashes {
  geometry: boolean;
  paint: boolean;
  text: boolean;
  effects: boolean;
  image: boolean;
  mask: boolean;
}

export interface SubHashReport {
  parts: string[];
  sub: ChangedSubHashes;
}

/** Raster-layer content version summary for hash — avoids hashing full pixels. */
function rasterLayerVersionSummary(data: NonNullable<EngineNode['rasterLayerData']>): string {
  const { width, height, pixelMode, tiles } = data;
  const tileKeys = Object.keys(tiles).sort();
  let versionSum = 0;
  for (const k of tileKeys) {
    const t = tiles[k];
    if (t) versionSum += t.version;
  }
  return `raster:${width}x${height}:${pixelMode ? 'pixel' : 'image'}:t${tileKeys.length}:v${versionSum}`;
}

/** Extract all render-relevant fields from an EngineNode for hashing.
 *
 * Returns a SubHashReport with both the content parts array (for the primary
 * hash) and a sub-hash breakdown for diagnostics.
 *
 * Every field that shapeToPrimitive() or buildIr() reads MUST be represented
 * here, directly or through JSON serialization of its container object.
 *
 * Fields are split into sub-categories so diagnostics can explain WHY a hash
 * changed (which category of content drifted).
 */
export function cacheContentParts(en: EngineNode): SubHashReport {
  const parts: string[] = [];
  const sub: ChangedSubHashes = {
    geometry: false,
    paint: false,
    text: false,
    effects: false,
    image: false,
    mask: false,
  };

  const shape = en.shape;
  if (shape) {
    parts.push(JSON.stringify(shape));
    sub.geometry = true;
  }
  if (en.w !== undefined) {
    parts.push(`nw:${en.w}`);
    sub.geometry = true;
  }
  if (en.h !== undefined) {
    parts.push(`nh:${en.h}`);
    sub.geometry = true;
  }
  if (en.cornerRadius !== undefined) {
    parts.push(`cr:${JSON.stringify(en.cornerRadius)}`);
    sub.geometry = true;
  }
  if (en.cornerSmoothing !== undefined) {
    parts.push(`cs:${en.cornerSmoothing}`);
    sub.geometry = true;
  }
  if (en.shapeless !== undefined) {
    parts.push(`sl:${en.shapeless}`);
    sub.geometry = true;
  }
  if (en.kind) {
    parts.push(`k:${en.kind}`);
    sub.geometry = true;
  }

  if (en.fill) {
    parts.push(JSON.stringify(en.fill));
    sub.paint = true;
  }
  if (en.fills && en.fills.length > 0) {
    parts.push(JSON.stringify(en.fills));
    sub.paint = true;
  }
  if (en.strokes && en.strokes.length > 0) {
    parts.push(JSON.stringify(en.strokes));
    sub.paint = true;
  }
  if (en.opacity !== undefined) {
    parts.push(`op:${en.opacity}`);
    sub.paint = true;
  }
  if (en.blendMode) {
    parts.push(`bm:${en.blendMode}`);
    sub.paint = true;
  }
  if (en.rotation !== undefined) {
    parts.push(`rot:${en.rotation}`);
    sub.paint = true;
  }

  if (en.text !== undefined) {
    parts.push(`txt:${en.text}`);
    sub.text = true;
  }
  if (en.fontSize !== undefined) {
    parts.push(`fs:${en.fontSize}`);
    sub.text = true;
  }
  if (en.fontFamily) {
    parts.push(`ff:${en.fontFamily}`);
    sub.text = true;
  }
  if (en.fontWeight !== undefined) {
    parts.push(`fw:${en.fontWeight}`);
    sub.text = true;
  }
  if (en.fontStyle) {
    parts.push(`fst:${en.fontStyle}`);
    sub.text = true;
  }
  if (en.textAlign) {
    parts.push(`ta:${en.textAlign}`);
    sub.text = true;
  }
  if (en.textAlignVertical) {
    parts.push(`tav:${en.textAlignVertical}`);
    sub.text = true;
  }
  if (en.letterSpacing !== undefined) {
    parts.push(`ls:${en.letterSpacing}`);
    sub.text = true;
  }
  if (en.lineHeight !== undefined) {
    parts.push(`lh:${en.lineHeight}`);
    sub.text = true;
  }
  if (en.paragraphSpacing !== undefined) {
    parts.push(`ps:${en.paragraphSpacing}`);
    sub.text = true;
  }
  if (en.textCase) {
    parts.push(`tc:${en.textCase}`);
    sub.text = true;
  }
  if (en.textDecoration) {
    parts.push(`td:${en.textDecoration}`);
    sub.text = true;
  }
  if (en.textOverflow) {
    parts.push(`to:${en.textOverflow}`);
    sub.text = true;
  }
  if (en.listStyle) {
    parts.push(`lst:${en.listStyle}`);
    sub.text = true;
  }
  if (en.textMode) {
    parts.push(`tm:${en.textMode}`);
    sub.text = true;
  }
  if (en.pathTextSettings) {
    parts.push(`pts:${JSON.stringify(en.pathTextSettings)}`);
    sub.text = true;
  }
  if (en.variableAxes) {
    parts.push(`va:${JSON.stringify(en.variableAxes)}`);
    sub.text = true;
  }
  if (en.openTypeFeatures) {
    parts.push(`otf:${JSON.stringify(en.openTypeFeatures)}`);
    sub.text = true;
  }
  if (en.richText) {
    parts.push(`rt:${JSON.stringify(en.richText)}`);
    sub.text = true;
  }

  if (en.effects && en.effects.length > 0) {
    parts.push(JSON.stringify(en.effects));
    sub.effects = true;
  }
  if (en.filters && en.filters.length > 0) {
    parts.push(JSON.stringify(en.filters));
    sub.effects = true;
  }

  if (en.src) {
    parts.push(`src:${en.src}`);
    sub.image = true;
  }
  if (en.rasterLayerData) {
    parts.push(rasterLayerVersionSummary(en.rasterLayerData));
    sub.image = true;
  }

  if (en.alphaMask) {
    parts.push(`mask:${en.alphaMask.length}`);
    sub.mask = true;
  }

  return { parts, sub };
}

export interface SubtreeIrCacheEntry {
  hash: string;
  item: RenderItem;
  lastUsed: number;
  bytes: number;
}

/** Eviction reason for diagnostics. */
export type EvictionReason = 'entry_count' | 'byte_budget' | 'oversized_entry';

export interface EvictionEvent {
  nodeId: string;
  bytes: number;
  reason: EvictionReason;
}

export class SubtreeIrCache {
  private readonly maxEntries: number;
  private readonly softBytes: number;
  private readonly hardBytes: number;
  private readonly entries = new Map<string, SubtreeIrCacheEntry>();
  private currentBytes = 0;
  private hitCount = 0;
  private missCount = 0;
  private evictionLog: EvictionEvent[] = [];

  constructor(maxEntries = 500, softBytes = 50 * 1024 * 1024, hardBytes = 100 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.softBytes = softBytes;
    this.hardBytes = hardBytes;
  }

  /** Estimate retained byte size of a RenderItem.
   *
   * Conservative estimate based on JSON serialisation size (multiplied by 2
   * for UTF-16 overhead) plus fixed per-object overhead. Actual JS engine
   * memory may differ, but this provides a consistent relative measure.
   */
  static estimateItemBytes(item: RenderItem): number {
    try {
      const json = JSON.stringify(item);
      return json.length * 2 + 64;
    } catch {
      return 1024;
    }
  }

  /** FNV-1a hash of node fields relevant to IR generation.
   *
   * Includes node content fields (shape kind, fill, strokes, opacity, blend
   * mode, rotation, corner radius) alongside styleKey and transform.
   *
   * Deliberately excludes any document-wide revision counter: docVersion
   * bumps on every edit anywhere in the document (see CanvasArea.tsx), so
   * mixing it into a per-node hash would invalidate every other node's
   * entry on every single edit, defeating selective invalidation entirely.
   * Callers are responsible for explicitly invalidating a node's entry
   * (`invalidate(nodeId)`) when that node's own data changes — this hash
   * only needs to catch content drift for nodes that were *not* explicitly
   * invalidated (defence-in-depth). */
  static nodeHash(
    nodeId: string,
    transform: readonly number[],
    styleKey: string,
    contentParts?: readonly string[],
  ): string {
    let h = 2166136261;
    const parts = [nodeId, styleKey, ...transform.map(String)];
    if (contentParts) parts.push(...contentParts);
    for (const p of parts) {
      for (let i = 0; i < p.length; i++) {
        h ^= p.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
    }
    return (h >>> 0).toString(36);
  }

  get(nodeId: string, hash: string): RenderItem | null {
    const e = this.entries.get(nodeId);
    if (e && e.hash === hash) {
      e.lastUsed = performance.now();
      this.hitCount++;
      return e.item;
    }
    this.missCount++;
    return null;
  }

  set(nodeId: string, hash: string, item: RenderItem): void {
    const bytes = SubtreeIrCache.estimateItemBytes(item);

    // Refuse entries larger than the entire soft budget.
    if (bytes > this.softBytes) {
      this.evictionLog.push({ nodeId, bytes, reason: 'oversized_entry' });
      return;
    }

    // Remove old entry for this node if it exists (replacement accounting).
    const old = this.entries.get(nodeId);
    if (old) {
      this.currentBytes = Math.max(0, this.currentBytes - old.bytes);
    }

    this.entries.set(nodeId, { hash, item, lastUsed: performance.now(), bytes });
    this.currentBytes += bytes;
    this.evictIfNeeded();
  }

  invalidate(nodeId?: string): void {
    if (!nodeId) {
      this.entries.clear();
      this.currentBytes = 0;
      return;
    }
    const old = this.entries.get(nodeId);
    if (old) {
      this.currentBytes = Math.max(0, this.currentBytes - old.bytes);
    }
    this.entries.delete(nodeId);
  }

  clear(): void {
    this.entries.clear();
    this.currentBytes = 0;
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionLog = [];
  }

  private evictIfNeeded(): void {
    while (this.entries.size > 0) {
      const overCount = this.entries.size - this.maxEntries;
      const overBytes = this.currentBytes - this.softBytes;
      if (overCount <= 0 && overBytes <= 0) break;

      const sorted = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      const [id, entry] = sorted[0]!;
      const reason: EvictionReason = overCount > 0 ? 'entry_count' : 'byte_budget';
      this.currentBytes = Math.max(0, this.currentBytes - entry.bytes);
      this.entries.delete(id);
      if (this.evictionLog.length < 100) {
        this.evictionLog.push({ nodeId: id, bytes: entry.bytes, reason });
      }
    }
  }

  /** Current estimated retained bytes. */
  get currentMemoryBytes(): number {
    return this.currentBytes;
  }

  /** Current entry count. */
  get entryCount(): number {
    return this.entries.size;
  }

  /** Soft byte budget. */
  get softBudget(): number {
    return this.softBytes;
  }

  /** Hard byte limit (entries exceeding this are refused). */
  get hardBudget(): number {
    return this.hardBytes;
  }

  /** Cache hit count since last clear. */
  get hits(): number {
    return this.hitCount;
  }

  /** Cache miss count since last clear. */
  get misses(): number {
    return this.missCount;
  }

  /** Hit rate (0–1) since last clear. */
  get hitRate(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }

  /** Recent eviction events (capped at 100). */
  get recentEvictions(): readonly EvictionEvent[] {
    return this.evictionLog;
  }

  /** Return diagnostics snapshot. */
  diagnostics(): {
    entries: number;
    bytes: number;
    softBudget: number;
    hardBudget: number;
    hits: number;
    misses: number;
    hitRate: number;
    recentEvictions: readonly EvictionEvent[];
  } {
    return {
      entries: this.entryCount,
      bytes: this.currentMemoryBytes,
      softBudget: this.softBytes,
      hardBudget: this.hardBytes,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: this.hitRate,
      recentEvictions: this.evictionLog,
    };
  }
}
