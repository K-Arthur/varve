/**
 * Shared onion-skin compositor — replaces per-frame canvas rendering with a
 * single composited output. Each ghost frame is rendered to an offscreen
 * bitmap, cached (LRU), and composited onto the shared canvas with proper
 * tinting and distance-based opacity falloff.
 *
 * Research basis: Adobe Animate onion-skinning (single overlay + tint),
 * Toon Boom Harmony ghost frames, Blender onion-skinning cache.
 */

import type { Affine, SceneNode as EngineNode, ReplayTarget } from '@varve/engine';
import { createEngine, replayIr } from '@varve/engine';
import type { Document, SceneNode, Timeline } from '@varve/scene';
import { buildParentIndexMap, isContainer } from '@varve/scene';
import { sceneNodeToEngineNode } from '../render/sceneToEngine';
import { nodeWorldTransform } from '../scene/world';
import { sampleTimeline } from '../timeline/TimelineSampler';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OnionFrameKey {
  timelineId: string;
  frameTime: number;
  docVersion: number;
  zoom: number;
  panX: number;
  panY: number;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
}

export interface OnionFrameEntry {
  key: string;
  bitmap: ImageBitmap | HTMLCanvasElement;
  timestamp: number;
  byteSize: number;
}

export type OnionSkinCacheEvictionReason =
  | 'byte-budget'
  | 'entry-limit'
  | 'invalidate'
  | 'clear'
  | 'oversized-entry';

export interface OnionSkinCacheStats {
  entries: number;
  /** Current decoded pixel memory held by the cache. */
  memoryBytes: number;
  /** @deprecated Use memoryBytes. Kept for diagnostics compatibility. */
  memoryEstimate: number;
  maxBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  evictionsByReason: Record<OnionSkinCacheEvictionReason, number>;
}

export interface OnionSkinCompositorOptions {
  beforeTint: [number, number, number];
  afterTint: [number, number, number];
  maxCacheEntries: number;
  maxCacheBytes: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Serialize a frame key into a stable string for cache lookup.
 */
function serializeFrameKey(key: OnionFrameKey): string {
  return `${key.timelineId}:${key.frameTime.toFixed(2)}:${key.docVersion}:${key.zoom.toFixed(4)}:${key.panX.toFixed(2)}:${key.panY.toFixed(2)}:${key.canvasWidth}:${key.canvasHeight}:${key.dpr.toFixed(3)}`;
}

function closeBitmap(bitmap: ImageBitmap | HTMLCanvasElement): void {
  const close = (bitmap as ImageBitmap).close;
  if (typeof close === 'function') close.call(bitmap);
}

/**
 * Module-private conversion of a scene node + timeline overrides into an engine
 * node, applying world transform and animation overrides. Mirrors the existing
 * `toEngineNodeForOnion` in OnionSkinOverlay.tsx.
 */
function toEngineNodeForOnion(
  node: SceneNode,
  overrides: Map<string, unknown>,
  worldTransform: Affine,
  _doc: Document,
): EngineNode | null {
  if (isContainer(node)) return null;

  const engineNode = sceneNodeToEngineNode(node, {}, _doc) as EngineNode & Record<string, unknown>;
  engineNode.transform = worldTransform;
  engineNode.opacity = (overrides.get('opacity') as number | undefined) ?? engineNode.opacity ?? 1;

  const transformOverride = overrides.get('transform');
  if (transformOverride && Array.isArray(transformOverride) && transformOverride.length === 6) {
    engineNode.transform = transformOverride as unknown as Affine;
  }

  const rotationOverride = overrides.get('rotation');
  if (typeof rotationOverride === 'number') {
    const [a, b, c, d, e, f] = engineNode.transform;
    const t: [number, number, number, number, number, number] = [a, b, c, d, e, f];
    const rad = rotationOverride * (Math.PI / 180);
    t[0] = Math.cos(rad);
    t[1] = Math.sin(rad);
    t[2] = -Math.sin(rad);
    t[3] = Math.cos(rad);
    engineNode.transform = t;
  }

  for (const [prop, value] of overrides) {
    if (prop === 'opacity' || prop === 'transform' || prop === 'rotation') continue;
    (engineNode as Record<string, unknown>)[prop] = value;
  }

  return engineNode as EngineNode;
}

// ── Compositor ─────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: OnionSkinCompositorOptions = {
  beforeTint: [255, 100, 100],
  afterTint: [100, 200, 100],
  maxCacheEntries: 30,
  maxCacheBytes: 128 * 1024 * 1024,
};

export class OnionSkinCompositor {
  private cache = new Map<string, OnionFrameEntry>();
  private cacheBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private evictionsByReason: Record<OnionSkinCacheEvictionReason, number> = {
    'byte-budget': 0,
    'entry-limit': 0,
    invalidate: 0,
    clear: 0,
    'oversized-entry': 0,
  };
  private options: OnionSkinCompositorOptions;

  constructor(options?: Partial<OnionSkinCompositorOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Render all onion-skin ghost frames onto a single shared canvas.
   *
   * For each ghost frame (before + after the current time), the compositor:
   * 1. Computes a cache key from timeline ID, frame time, doc version, zoom, pan, and canvas size
   * 2. On cache miss: renders the frame to an offscreen canvas at DPR resolution
   * 3. Composites the cached bitmap onto the output ctx with distance-based opacity and tint
   */
  async render(
    ctx: CanvasRenderingContext2D,
    doc: Document,
    timeline: Timeline,
    currentTime: number,
    beforeCount: number,
    afterCount: number,
    opacity: number,
    canvasSize: { width: number; height: number },
    zoom: number,
    pan: { x: number; y: number },
    dpr: number,
    docVersion = 0,
  ): Promise<void> {
    if (opacity <= 0 || timeline.duration <= 0) return;

    const fps = 60;
    const frameDuration = 1000 / fps;
    const currentFrame = Math.round(currentTime / frameDuration);
    const totalFrames = Math.round(timeline.duration / frameDuration);

    // Collect frame times (before in reverse, after in forward order)
    const beforeTimes: number[] = [];
    for (let i = 1; i <= beforeCount; i++) {
      const frame = currentFrame - i;
      if (frame >= 0) beforeTimes.push(frame * frameDuration);
    }
    beforeTimes.reverse();

    const afterTimes: number[] = [];
    for (let i = 1; i <= afterCount; i++) {
      const frame = currentFrame + i;
      if (frame <= totalFrames) afterTimes.push(frame * frameDuration);
    }

    const allTimes = [
      ...beforeTimes.map((t) => ({ time: t, isBefore: true })),
      ...afterTimes.map((t) => ({ time: t, isBefore: false })),
    ];

    if (allTimes.length === 0) return;

    const totalCount = allTimes.length;
    const eng = await createEngine('stub');
    const parentIndex = buildParentIndexMap(doc);

    for (let idx = 0; idx < allTimes.length; idx++) {
      const { time, isBefore } = allTimes[idx]!;
      const distance = isBefore
        ? beforeTimes.length - beforeTimes.indexOf(time)
        : idx - beforeTimes.length + 1;
      const frameOpacity = opacity * (1 - distance / (totalCount + 1));

      const key: OnionFrameKey = {
        timelineId: timeline.id,
        frameTime: time,
        docVersion,
        zoom,
        panX: pan.x,
        panY: pan.y,
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height,
        dpr,
      };
      const serializedKey = serializeFrameKey(key);

      let entry = this.cache.get(serializedKey);
      let disposeAfterDraw = false;
      if (!entry) {
        this.misses++;
        entry = await this.renderFrameToBitmap(
          doc,
          timeline,
          time,
          canvasSize,
          zoom,
          pan,
          dpr,
          eng,
          parentIndex,
        );
        entry.key = serializedKey;
        disposeAfterDraw = !this.admitEntry(entry);
      } else {
        this.hits++;
      }
      entry.timestamp = Date.now();

      // Composite onto the output canvas
      const tint = isBefore ? this.options.beforeTint : this.options.afterTint;

      ctx.save();
      try {
        ctx.globalAlpha = frameOpacity;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(entry.bitmap, 0, 0, canvasSize.width, canvasSize.height);

        // Apply tint via multiply blend
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${tint[0]}, ${tint[1]}, ${tint[2]})`;
        ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
        ctx.globalCompositeOperation = 'source-over';
      } finally {
        ctx.restore();
        if (disposeAfterDraw) closeBitmap(entry.bitmap);
      }
    }
  }

  /**
   * Clear all cached bitmaps.
   */
  clearCache(): void {
    for (const key of [...this.cache.keys()]) this.removeEntry(key, 'clear');
  }

  /**
   * Remove entries for a specific doc version.
   * Pass the *old* docVersion to remove stale entries; new entries use the
   * new version and won't match.
   */
  invalidateDoc(_docVersion: number): void {
    // Doc version is embedded in the serialized key. We scan and remove
    // entries whose key contains the old version. For performance, we
    // iterate the full cache since invalidation is infrequent.
    for (const key of [...this.cache.keys()]) {
      // The doc version is the 3rd segment in the key (after timelineId and frameTime)
      const parts = key.split(':');
      if (parts[2] === String(_docVersion)) {
        this.removeEntry(key, 'invalidate');
      }
    }
  }

  /**
   * Get cache stats for debugging.
   */
  getCacheStats(): OnionSkinCacheStats {
    return {
      entries: this.cache.size,
      memoryBytes: this.cacheBytes,
      memoryEstimate: this.cacheBytes,
      maxBytes: this.options.maxCacheBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      evictionsByReason: { ...this.evictionsByReason },
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Render a single ghost frame into an offscreen canvas and return it as a
   * cached entry. Attempts to convert to ImageBitmap for memory efficiency,
   * falling back to the raw canvas.
   */
  private async renderFrameToBitmap(
    doc: Document,
    timeline: Timeline,
    time: number,
    canvasSize: { width: number; height: number },
    zoom: number,
    pan: { x: number; y: number },
    dpr: number,
    eng: Awaited<ReturnType<typeof createEngine>>,
    parentIndex: Map<string, string>,
  ): Promise<OnionFrameEntry> {
    const offscreen = document.createElement('canvas');
    offscreen.width = canvasSize.width * dpr;
    offscreen.height = canvasSize.height * dpr;
    const offCtx = offscreen.getContext('2d')!;
    offCtx.scale(dpr, dpr);

    // Sample timeline at the ghost time
    const sample = sampleTimeline(timeline, time);

    // Build engine nodes from scene + overrides
    const nodes: EngineNode[] = [];
    for (const [nodeId, overrides] of sample.overrides) {
      const node = doc.nodes[nodeId];
      if (!node || isContainer(node)) continue;
      const worldTransform = nodeWorldTransform(doc, nodeId, parentIndex);
      const engineNode = toEngineNodeForOnion(node, overrides, worldTransform, doc);
      if (engineNode) nodes.push(engineNode);
    }

    // Build IR and replay to offscreen canvas
    const ir = await eng.buildIr({ nodes });

    offCtx.save();
    offCtx.translate(canvasSize.width / 2, canvasSize.height / 2);
    offCtx.translate(pan.x * zoom, pan.y * zoom);
    offCtx.scale(zoom, zoom);
    replayIr(offCtx as unknown as ReplayTarget, ir);
    offCtx.restore();

    // Try to convert to ImageBitmap for memory efficiency
    let bitmap: ImageBitmap | HTMLCanvasElement = offscreen;
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(offscreen);
      } catch {
        // Fall back to the canvas itself
        bitmap = offscreen;
      }
    }

    return {
      key: '',
      bitmap,
      timestamp: Date.now(),
      byteSize: bitmap.width * bitmap.height * 4,
    };
  }

  /**
   * Admit an entry if it can fit, evicting older entries when necessary.
   * Returns false when the caller must use the frame transiently and dispose it.
   */
  private admitEntry(entry: OnionFrameEntry): boolean {
    if (
      this.options.maxCacheEntries <= 0 ||
      this.options.maxCacheBytes <= 0 ||
      entry.byteSize > this.options.maxCacheBytes
    ) {
      this.recordEviction('oversized-entry');
      return false;
    }

    while (
      this.cache.size >= this.options.maxCacheEntries ||
      this.cacheBytes + entry.byteSize > this.options.maxCacheBytes
    ) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, _entry] of this.cache) {
        if (_entry.timestamp < oldestTime) {
          oldestTime = _entry.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        const reason =
          this.cacheBytes + entry.byteSize > this.options.maxCacheBytes
            ? 'byte-budget'
            : 'entry-limit';
        this.removeEntry(oldestKey, reason);
      } else {
        this.recordEviction('oversized-entry');
        return false;
      }
    }

    this.cache.set(entry.key, entry);
    this.cacheBytes += entry.byteSize;
    return true;
  }

  private removeEntry(key: string, reason: OnionSkinCacheEvictionReason): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cache.delete(key);
    this.cacheBytes = Math.max(0, this.cacheBytes - entry.byteSize);
    closeBitmap(entry.bitmap);
    this.recordEviction(reason);
  }

  private recordEviction(reason: OnionSkinCacheEvictionReason): void {
    this.evictions++;
    this.evictionsByReason[reason]++;
  }
}
