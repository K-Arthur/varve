/**
 * Per-node IR item cache — skip rebuild when node content hash is unchanged.
 * Complements compositor SubtreeReplayCache (replay skip, not IR generation).
 */
import type { RenderItem } from '@strata/engine';

export interface SubtreeIrCacheEntry {
  hash: string;
  item: RenderItem;
  lastUsed: number;
}

export class SubtreeIrCache {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, SubtreeIrCacheEntry>();

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
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
      return e.item;
    }
    return null;
  }

  set(nodeId: string, hash: string, item: RenderItem): void {
    this.entries.set(nodeId, { hash, item, lastUsed: performance.now() });
    this.evictIfNeeded();
  }

  invalidate(nodeId?: string): void {
    if (!nodeId) {
      this.entries.clear();
      return;
    }
    this.entries.delete(nodeId);
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const remove = sorted.slice(0, this.entries.size - this.maxEntries);
    for (const [id] of remove) this.entries.delete(id);
  }
}
