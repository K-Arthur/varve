/**
 * Per-node IR item cache — skip rebuild when node content hash is unchanged.
 * Complements compositor SubtreeReplayCache (replay skip, not IR generation).
 */
import type { SceneNode as EngineNode, RenderItem } from '@strata/engine';

/** Lightweight content string for SubtreeIrCache hash — encodes the EngineNode
 * fields that affect IR output. This makes the cache invalidate on content
 * changes even if a node's explicit `.invalidate(id)` call was missed
 * (defence-in-depth). The string is compact but distinct per unique content
 * state. */
export function cacheContentParts(en: EngineNode): string[] {
  const parts: string[] = [];
  const shape = en.shape;
  if (shape) {
    parts.push(shape.kind);
    if ('w' in shape) parts.push(String((shape as { w: number }).w));
    if ('h' in shape) parts.push(String((shape as { h: number }).h));
    if ('x' in shape) parts.push(String((shape as { x: number }).x));
    if ('y' in shape) parts.push(String((shape as { y: number }).y));
  }
  // Fills/strokes/effects/filters are serialized in full (not just array
  // length) so weight, align, dash pattern, cap/join, gradient/image/pattern
  // params, and per-entry visibility all participate in the hash — a length
  // check alone can't see e.g. a stroke weight or fill visibility toggle.
  if (en.fill) parts.push(JSON.stringify(en.fill));
  if (en.fills && en.fills.length > 0) parts.push(JSON.stringify(en.fills));
  if (en.strokes && en.strokes.length > 0) parts.push(JSON.stringify(en.strokes));
  if (en.effects && en.effects.length > 0) parts.push(JSON.stringify(en.effects));
  if (en.filters && en.filters.length > 0) parts.push(JSON.stringify(en.filters));
  if (en.opacity !== undefined) parts.push(String(en.opacity));
  if (en.blendMode) parts.push(en.blendMode);
  if (en.rotation) parts.push(String(en.rotation));
  if (en.cornerRadius) parts.push(String(en.cornerRadius));
  if (en.cornerSmoothing) parts.push(String(en.cornerSmoothing));
  // Full text content, not just length — two different strings of equal
  // length must not hash identically.
  if (en.text) parts.push(en.text);
  if (en.fontSize !== undefined) parts.push(String(en.fontSize));
  if (en.fontFamily) parts.push(en.fontFamily);
  if (en.fontWeight !== undefined) parts.push(String(en.fontWeight));
  if (en.fontStyle) parts.push(en.fontStyle);
  if (en.textAlign) parts.push(en.textAlign);
  if (en.textAlignVertical) parts.push(en.textAlignVertical);
  if (en.letterSpacing !== undefined) parts.push(String(en.letterSpacing));
  if (en.lineHeight !== undefined) parts.push(String(en.lineHeight));
  if (en.paragraphSpacing !== undefined) parts.push(String(en.paragraphSpacing));
  if (en.textCase) parts.push(en.textCase);
  if (en.textDecoration) parts.push(en.textDecoration);
  if (en.textOverflow) parts.push(en.textOverflow);
  if (en.listStyle) parts.push(en.listStyle);
  if (en.textMode) parts.push(en.textMode);
  if (en.pathTextSettings) parts.push(JSON.stringify(en.pathTextSettings));
  if (en.variableAxes) parts.push(JSON.stringify(en.variableAxes));
  if (en.openTypeFeatures) parts.push(JSON.stringify(en.openTypeFeatures));
  if (en.richText) parts.push(JSON.stringify(en.richText));
  if (en.src) parts.push(en.src);
  // Alpha masks are data URLs that can run to megabytes — length is a cheap
  // proxy signal here; explicit `.invalidate(id)` (CanvasArea's document-diff
  // path) is what actually guarantees correctness on mask changes.
  if (en.alphaMask) parts.push(`mask:${en.alphaMask.length}`);
  return parts;
}

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
