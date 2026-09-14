/**
 * Shared stroke sampling and pressure normalization for coverage-painting
 * pointer tools (refine mask, trimap, quick-mask selection paint).
 *
 * Coalesced pointer events improve resolution but do not guarantee that the
 * geometric segment between two samples is covered; tools that only painted
 * at event positions left dashed strokes on fast movement. These helpers walk
 * the segment between samples at a bounded spacing and always include the
 * segment end, so the last pointer position of a gesture is painted too.
 */

export interface StrokePoint {
  x: number;
  y: number;
}

/**
 * Normalized brush pressure.
 *
 * A positive reported pressure is used as-is (clamped). A zero pressure — a
 * pen at first contact on some stacks, or a synthetic/event stream without
 * pressure — falls back to half strength for pens and full strength for
 * mouse/unknown pointers so a valid stroke is never silently dropped.
 */
export function effectivePressure(event: { pressure?: number; pointerType?: string }): number {
  const pressure = event.pressure;
  if (typeof pressure === 'number' && Number.isFinite(pressure) && pressure > 0) {
    return Math.max(0.05, Math.min(1, pressure));
  }
  return event.pointerType === 'pen' ? 0.5 : 1;
}

/**
 * Points along the segment `from → to` (excluding `from`, including `to`)
 * spaced at most `spacing` apart. Returns `[to]` for a degenerate segment and
 * a single point when the distance is already within one step.
 */
export function interpolateStrokeSegment(
  from: StrokePoint,
  to: StrokePoint,
  spacing: number,
): StrokePoint[] {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) {
    return [{ x: to.x, y: to.y }];
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1e-9) return [{ x: to.x, y: to.y }];
  const step = Math.max(1e-6, spacing);
  const steps = Math.max(1, Math.ceil(distance / step));
  const points: StrokePoint[] = new Array<StrokePoint>(steps);
  for (let index = 0; index < steps; index += 1) {
    const t = (index + 1) / steps;
    points[index] = { x: from.x + dx * t, y: from.y + dy * t };
  }
  return points;
}
