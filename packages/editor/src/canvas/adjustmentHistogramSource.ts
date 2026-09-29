/**
 * Compute a Histogram from an adjustment layer's scope targets.
 *
 * The histogram represents the ADJUSTMENT INPUT — the pixels the adjustment
 * will modify — computed by rendering the resolved scope targets at reduced
 * resolution through the canonical scene→engine→replay pipeline.
 *
 * Architecture:
 *   resolveAdjustmentScope → target node ids
 *   → flattenSceneToEngine(doc, targets)
 *   → engine.buildIr(nodes)
 *   → replayIr(ctx, ir) on a small offscreen surface
 *   → getImageData → computeHistogram
 *
 * This mirrors the thumbnail generation path (flattenSceneToEngine + buildIr
 * + replayIr) but returns raw ImageData instead of a data URL.
 */
import type { Histogram } from '@varve/engine';
import {
  adjustmentsToFilters,
  applyFilterWithCompositing,
  computeHistogram,
  createEngine,
  createRasterSurface,
  effectPixelExpansion,
  replayIr,
} from '@varve/engine';
import type { CoordSpace } from '@varve/engine/liveEffects';
import type { Adjustment, AdjustmentNode, Document } from '@varve/scene';
import { resolveAdjustmentScope } from '@varve/scene';
import { flattenSceneToEngine } from '../render/sceneToEngine';

export interface AdjustmentSourceSample {
  imageData: ImageData;
  histogram: Histogram;
  /** Maps this sample surface back to its document-space origin and scale. */
  coordSpace: CoordSpace;
  detailRegion?: { x: number; y: number; width: number; height: number };
}

export function createAdjustmentSampleCoordSpace(
  x: number,
  y: number,
  scale: number,
  halo = 0,
): CoordSpace {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const safeHalo = Number.isFinite(halo) ? halo : 0;
  return {
    scale: safeScale,
    originX: 0,
    originY: 0,
    regionX: x * safeScale - safeHalo,
    regionY: y * safeScale - safeHalo,
  };
}

/** Maximum dimension (px) of the histogram sample canvas. */
const SAMPLE_MAX = 256;

/**
 * Module-level cache. Document state is immutable, so document identity is a
 * stronger revision key than `nextId`: editing an existing adjustment or
 * target does not mint a node and therefore leaves `nextId` unchanged. The
 * bounded list also prevents previews of many documents from becoming an
 * unbounded raster cache.
 */
const MAX_CACHE_ENTRIES = 8;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;
const histogramCache: Array<{
  doc: Document;
  key: string;
  result: AdjustmentSourceSample;
}> = [];

function buildCacheKey(
  adjNode: AdjustmentNode,
  targetIds: readonly string[],
  beforeAdjustmentId?: string,
): string {
  return `${adjNode.id}:${beforeAdjustmentId ?? 'scope-source'}:${[...targetIds].sort().join(',')}`;
}

/**
 * Compute a rough axis-aligned bounding box for a set of engine nodes
 * in pasteboard (world) coordinates. Uses each node's transform to map
 * the node-local bounds into world space.
 *
 * This is intentionally approximate — a histogram does not need spatial
 * accuracy. Underestimating slightly just means a few edge pixels get
 * clipped; overestimating wastes canvas pixels that remain transparent
 * and do not affect the histogram.
 */
function computeWorldBounds(
  nodes: Array<{
    transform: readonly [number, number, number, number, number, number];
    shape?: { kind: string; x?: number; y?: number; w?: number; h?: number };
  }>,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const t = node.transform as unknown as number[];
    const shape = node.shape as
      | { kind?: string; x?: number; y?: number; w?: number; h?: number }
      | undefined;

    // Map the four corners of the node's local bbox through its transform.
    // Most nodes are rect-based; fall back to a unit square for non-rect.
    const lx = shape?.x ?? 0;
    const ly = shape?.y ?? 0;
    let lw = shape?.w ?? 100;
    let lh = shape?.h ?? 100;
    if (lw <= 0 || lh <= 0) {
      lw = 100;
      lh = 100;
    }

    const corners = [
      [lx, ly],
      [lx + lw, ly],
      [lx, ly + lh],
      [lx + lw, ly + lh],
    ];
    for (const corner of corners) {
      const cx = corner[0]!;
      const cy = corner[1]!;
      // Affine: [a, b, c, d, tx, ty] → (a*cx + c*cy + tx, b*cx + d*cy + ty)
      const wx = t[0]! * cx + t[2]! * cy + t[4]!;
      const wy = t[1]! * cx + t[3]! * cy + t[5]!;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
    }
  }

  if (minX >= maxX || minY >= maxY) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Resolve the scope of an adjustment node to a set of target node ids.
 * Returns null if the node is not an adjustment or has no targets.
 */
export function getAdjustmentTargetIds(doc: Document, adjNode: AdjustmentNode): string[] | null {
  const targets = resolveAdjustmentScope(doc, adjNode.scope, adjNode.id);
  return targets.length > 0 ? targets : null;
}

/** Return the canonical upstream entries for a histogram stage. */
export function adjustmentsBeforeEntry(
  adjNode: Pick<AdjustmentNode, 'adjustments'>,
  beforeAdjustmentId?: string,
): Adjustment[] {
  if (!beforeAdjustmentId) return [];
  const adjustments = adjNode.adjustments ?? [];
  const index = adjustments.findIndex((adjustment) => adjustment.id === beforeAdjustmentId);
  return index >= 0 ? adjustments.slice(0, index) : [];
}

/**
 * Compute the source histogram for an adjustment node's scope targets.
 *
 * Returns a cached Histogram when the document/adjustment haven't changed.
 * Returns null on failure, empty scope, or missing canvas support.
 *
 * This is async because `engine.buildIr` may delegate to WASM/native.
 */
export async function computeAdjustmentSourceSample(
  doc: Document,
  adjNode: AdjustmentNode,
  beforeAdjustmentId?: string,
  /** Explicit 128px detail region, normalized within the scoped world bounds. */
  detail?: { x: number; y: number },
): Promise<AdjustmentSourceSample | null> {
  const targets = getAdjustmentTargetIds(doc, adjNode);
  if (!targets) return null;

  const key = `${buildCacheKey(adjNode, targets, beforeAdjustmentId)}:${detail ? `${detail.x},${detail.y}` : 'overview'}`;
  const cached = histogramCache.find((entry) => entry.doc === doc && entry.key === key);
  if (cached) return cached.result;

  try {
    const { nodes: engineNodes } = flattenSceneToEngine(doc, targets);
    if (engineNodes.length === 0) return null;

    const bounds = computeWorldBounds(engineNodes);
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;

    // Scale to fit the sample canvas.
    const scale = detail ? 1 : Math.min(SAMPLE_MAX / bounds.w, SAMPLE_MAX / bounds.h, 1);
    const cw = Math.max(1, Math.round(detail ? Math.min(128, bounds.w) : bounds.w * scale));
    const ch = Math.max(1, Math.round(detail ? Math.min(128, bounds.h) : bounds.h * scale));
    const x = detail
      ? Math.round(bounds.x + Math.max(0, Math.min(1, detail.x)) * (bounds.w - cw))
      : bounds.x;
    const y = detail
      ? Math.round(bounds.y + Math.max(0, Math.min(1, detail.y)) * (bounds.h - ch))
      : bounds.y;
    const upstreamFilters = adjustmentsToFilters(
      adjustmentsBeforeEntry(adjNode, beforeAdjustmentId),
    );
    // A detail crop needs the upstream spatial kernels' original halo. Refuse
    // oversized diagnostic work rather than silently cutting the kernel off.
    const selected = adjNode.adjustments?.find((entry) => entry.id === beforeAdjustmentId);
    const detailFilters = selected
      ? [...upstreamFilters, ...adjustmentsToFilters([selected])]
      : upstreamFilters;
    const halo = detail
      ? detailFilters.reduce(
          (sum, filter) => sum + Math.max(...effectPixelExpansion(filter, scale)),
          0,
        )
      : 0;
    const width = cw + 2 * halo,
      height = ch + 2 * halo;
    if (width * height > 1_048_576) return null;

    const surface = createRasterSurface(width, height);
    const ctx = surface.context;

    ctx.save();
    ctx.translate(-x * scale + halo, -y * scale + halo);
    ctx.scale(scale, scale);

    const engine = await createEngine('stub');
    const ir = await engine.buildIr({ nodes: engineNodes });
    replayIr(ctx, ir);
    ctx.restore();

    // A histogram for a later stack entry must describe that entry's input,
    // not the original scoped composite. Reuse the canonical FilterIR and
    // compositor so the diagnostic follows the same ordering, opacity, blend,
    // and backend contract as the visible adjustment stack.
    if (beforeAdjustmentId) {
      if (upstreamFilters.length > 0) {
        applyFilterWithCompositing(
          ctx as CanvasRenderingContext2D,
          upstreamFilters,
          width,
          height,
          {
            treatmentSpace: { pixelsPerUnit: scale },
          },
        );
      }
    }

    const cropped = ctx.getImageData(halo, halo, cw, ch);
    const imageData = detail ? ctx.getImageData(0, 0, width, height) : cropped;
    const histogram = computeHistogram(cropped);

    const existingIndex = histogramCache.findIndex(
      (entry) => entry.doc === doc && entry.key === key,
    );
    if (existingIndex >= 0) histogramCache.splice(existingIndex, 1);
    const result: AdjustmentSourceSample = {
      imageData,
      histogram,
      coordSpace: createAdjustmentSampleCoordSpace(x, y, scale, halo),
      ...(detail ? { detailRegion: { x: halo, y: halo, width: cw, height: ch } } : {}),
    };
    histogramCache.unshift({ doc, key, result });
    while (
      histogramCache.length > MAX_CACHE_ENTRIES ||
      histogramCache.reduce((bytes, entry) => bytes + entry.result.imageData.data.byteLength, 0) >
        MAX_CACHE_BYTES
    )
      histogramCache.pop();
    return result;
  } catch {
    return null;
  }
}

/**
 * Clear the module-level histogram cache. Useful for tests or when the
 * document is fully replaced.
 */
export function clearHistogramCache(): void {
  histogramCache.length = 0;
}

/** Histogram-only compatibility facade over the same bounded source sample. */
export async function computeAdjustmentSourceHistogram(
  doc: Document,
  adjNode: AdjustmentNode,
  beforeAdjustmentId?: string,
): Promise<Histogram | null> {
  return (await computeAdjustmentSourceSample(doc, adjNode, beforeAdjustmentId))?.histogram ?? null;
}
