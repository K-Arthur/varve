/**
 * Cross-frame memo for scene→engine node conversion.
 *
 * Why this exists:
 *   `drawContent`'s pre-loop converts every visible scene node into an
 *   `EngineNode` on every frame (`toEngineNode` → `sceneNodeToEngineNode`,
 *   which resolves paint refs and raster mask assets and allocates a fresh
 *   object per node). At ~900 nodes that walk dominated the frame even when
 *   every node's IR was already cached, because the IR cache is consulted
 *   *after* the engine node exists.
 *
 *   During a drag only the dragged node's scene object changes identity —
 *   the document is immutable and structurally shared, so the other N-1
 *   nodes keep the exact same reference frame to frame. Memoizing on that
 *   reference turns the per-frame conversion from O(visible) into
 *   O(changed).
 *
 * Correctness model — an entry is reused only when all four inputs to the
 * conversion are reference-identical to the memoized ones:
 *
 *   - `src`   the effective scene node (post variant resolution and variable
 *             bindings). Both of those return the input unchanged when the
 *             node has no variant override / no bindings, so the common case
 *             is `doc.nodes[id]` itself.
 *   - `world` the cached world transform (returned by reference from
 *             TransformCache while the node is clean).
 *   - the frame-level inputs that `sceneNodeToEngineNode` reads from outside
 *             the node — `doc.paints`, `doc.rasterMaskAssets`, `doc.styles`,
 *             and the "show original background" node id — which `beginFrame`
 *             compares, clearing the whole memo when any of them changes.
 *
 * `doc.styles` is a frame-level key rather than a per-node one on purpose. The
 * resolved reusable-style override is a pure function of (node, doc.styles),
 * and the node is already part of the key — but `resolveAllStyles` allocates a
 * fresh override object on every call and is memoized on `state.document`,
 * which changes on every drag frame. Keying on the override's identity would
 * therefore miss on every frame for every styled node, which is exactly the
 * population this memo most needs to cover.
 *
 * Two node kinds are deliberately never memoized by the caller (see
 * CanvasArea): text-on-path nodes, whose engine shape is patched from a
 * *different* node's geometry, and any node while a timeline is playing,
 * because the motion sampler mutates the produced engine node in place.
 *
 * Memory: bounded by `maxEntries` (wired to MemoryBudgets). Eviction is
 * insertion-order FIFO — entries hold references to objects the document
 * already retains, so an entry's own marginal cost is the wrapper object.
 */

import type { SceneNode as EngineNode } from '@varve/engine';

interface MemoEntry {
  src: unknown;
  world: unknown;
  result: EngineNode;
}

/** Sentinel distinct from every real value, including `undefined`. */
const UNINITIALIZED = Symbol('engineNodeMemo.uninitialized');

export class EngineNodeMemo {
  private entries = new Map<string, MemoEntry>();
  private paintsRef: unknown = UNINITIALIZED;
  private maskAssetsRef: unknown = UNINITIALIZED;
  private stylesRef: unknown = UNINITIALIZED;
  private extraKey: unknown = UNINITIALIZED;
  private computeCount = 0;
  private hitCount = 0;

  constructor(private maxEntries = 20000) {}

  /**
   * Call once per frame before any get/set. Clears the memo when a
   * conversion input that lives outside the individual node has changed, so
   * a stale engine node can never survive a shared-paint, mask-asset, or
   * compare-toggle edit.
   */
  beginFrame(paints: unknown, rasterMaskAssets: unknown, styles: unknown, extraKey: string): void {
    if (
      paints !== this.paintsRef ||
      rasterMaskAssets !== this.maskAssetsRef ||
      styles !== this.stylesRef ||
      extraKey !== this.extraKey
    ) {
      this.entries.clear();
      this.paintsRef = paints;
      this.maskAssetsRef = rasterMaskAssets;
      this.stylesRef = styles;
      this.extraKey = extraKey;
    }
  }

  /** Memoized engine node, or undefined when any input changed identity. */
  get(nodeId: string, src: unknown, world: unknown): EngineNode | undefined {
    const existing = this.entries.get(nodeId);
    if (existing && existing.src === src && existing.world === world) {
      this.hitCount++;
      return existing.result;
    }
    return undefined;
  }

  /** Record a freshly converted engine node against the inputs that produced it. */
  set(nodeId: string, src: unknown, world: unknown, result: EngineNode): void {
    if (!this.entries.has(nodeId) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(nodeId, { src, world, result });
    this.computeCount++;
  }

  /** Drop one node's entry (structural edit / explicit invalidation). */
  invalidate(nodeId: string): void {
    this.entries.delete(nodeId);
  }

  /** Real conversions since construction (perf guard: flat during pan). */
  get computes(): number {
    return this.computeCount;
  }

  /** Memo hits since construction. */
  get hits(): number {
    return this.hitCount;
  }

  /** Current memoized-node count. */
  get size(): number {
    return this.entries.size;
  }

  /** Configured upper bound on retained entries. */
  get capacity(): number {
    return this.maxEntries;
  }

  /** Re-bound the memo (memory-budget tier change); evicts down to the new cap. */
  setMaxEntries(maxEntries: number): void {
    this.maxEntries = Math.max(1, maxEntries);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Drop all memoized state. */
  clear(): void {
    this.entries.clear();
    this.paintsRef = UNINITIALIZED;
    this.maskAssetsRef = UNINITIALIZED;
    this.stylesRef = UNINITIALIZED;
    this.extraKey = UNINITIALIZED;
  }
}
