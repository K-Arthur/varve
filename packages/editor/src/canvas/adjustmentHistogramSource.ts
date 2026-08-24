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
import { computeHistogram, createEngine, createRasterSurface, replayIr } from '@varve/engine';
import type { AdjustmentNode, Document } from '@varve/scene';
import { resolveAdjustmentScope } from '@varve/scene';
import { flattenSceneToEngine } from '../render/sceneToEngine';

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
const histogramCache: Array<{
  doc: Document;
  key: string;
  result: Histogram;
}> = [];

function buildCacheKey(adjNode: AdjustmentNode, targetIds: readonly string[]): string {
  return `${adjNode.id}:${[...targetIds].sort().join(',')}`;
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

/**
 * Compute the source histogram for an adjustment node's scope targets.
 *
 * Returns a cached Histogram when the document/adjustment haven't changed.
 * Returns null on failure, empty scope, or missing canvas support.
 *
 * This is async because `engine.buildIr` may delegate to WASM/native.
 */
export async function computeAdjustmentSourceHistogram(
  doc: Document,
  adjNode: AdjustmentNode,
): Promise<Histogram | null> {
  const targets = getAdjustmentTargetIds(doc, adjNode);
  if (!targets) return null;

  const key = buildCacheKey(adjNode, targets);
  const cached = histogramCache.find((entry) => entry.doc === doc && entry.key === key);
  if (cached) return cached.result;

  try {
    const { nodes: engineNodes } = flattenSceneToEngine(doc, targets);
    if (engineNodes.length === 0) return null;

    const bounds = computeWorldBounds(engineNodes);
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;

    // Scale to fit the sample canvas.
    const scale = Math.min(SAMPLE_MAX / bounds.w, SAMPLE_MAX / bounds.h, 1);
    const cw = Math.max(1, Math.round(bounds.w * scale));
    const ch = Math.max(1, Math.round(bounds.h * scale));

    const surface = createRasterSurface(cw, ch);
    const ctx = surface.context;

    ctx.save();
    ctx.translate(-bounds.x * scale, -bounds.y * scale);
    ctx.scale(scale, scale);

    const engine = await createEngine('stub');
    const ir = await engine.buildIr({ nodes: engineNodes });
    replayIr(ctx, ir);
    ctx.restore();

    const imageData = ctx.getImageData(0, 0, cw, ch);
    const histogram = computeHistogram(imageData);

    const existingIndex = histogramCache.findIndex((entry) => entry.doc === doc);
    if (existingIndex >= 0) histogramCache.splice(existingIndex, 1);
    histogramCache.unshift({ doc, key, result: histogram });
    if (histogramCache.length > MAX_CACHE_ENTRIES) histogramCache.pop();
    return histogram;
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
