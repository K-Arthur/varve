import type { RenderItem } from '@varve/engine';

/**
 * The paint a WebGPU run can reproduce for an item: one flat, source-over
 * solid. Real documents carry their paint in the `fills` stack (the singular
 * `fill` is the legacy field), so admission is decided from the same stack
 * the Canvas2D island replays — an item is GPU-eligible only when the stack
 * collapses to a single visible solid fill with normal blending.
 */
export interface GpuSolidPaint {
  /** EngineColor of the effective solid paint (singular fill or stack entry). */
  color: NonNullable<RenderItem['fill']>;
  /** Opacity carried by the fill entry itself; item opacity applies on top. */
  opacity: number;
}

/**
 * Resolve the GPU-reproducible paint for an item, or null when the paint
 * needs the Canvas2D island (stacked paints, gradients, images, patterns,
 * non-normal fill blending). Must stay in lockstep with replayIr's
 * paintFillsAndStrokes: one visible solid fill at `itemAlpha * fill.opacity`
 * with the item blend — the GPU vertex color folds exactly that in.
 */
export function resolveGpuSolidPaint(item: RenderItem): GpuSolidPaint | null {
  const fills = item.fills;
  if (!fills || fills.length === 0) {
    // Legacy single-fill IR: the singular fill is the whole paint.
    if (item.fill === undefined) return null;
    return { color: item.fill, opacity: 1 };
  }
  let resolved: GpuSolidPaint | null = null;
  for (const fill of fills) {
    if (!fill.visible) continue;
    // A second visible paint stacks over the first; the flat pipeline cannot
    // reproduce that composition, so the island must paint it.
    if (resolved) return null;
    if (fill.type !== 'solid') return null;
    if (fill.blendMode !== 'normal') return null;
    resolved = { color: fill.color, opacity: fill.opacity };
  }
  return resolved;
}
