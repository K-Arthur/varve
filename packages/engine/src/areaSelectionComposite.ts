/**
 * Phase 8 (Coverage Math).
 *
 * Pixel-wise blends between two selections' coverage planes. Unlike
 * `combineAreaSelections` (which builds analytical expressions with
 * boolean-ish add/subtract/intersect), these operate on rasterized coverage so
 * soft edges compose numerically: multiply keeps proportional overlap, min/max
 * pick the darker/lighter plane. Both inputs share one bounded working plane
 * sized from the union of their bounds, and the result re-wraps through the
 * same budgeted path as every other raster-mask producer.
 */
import {
  areaSelectionBounds,
  boundedPlaneSize,
  maskAreaSelectionFromPlane,
  rasterizeAreaSelection,
  type AreaSelection,
} from './areaSelection';

export type AreaSelectionBlend = 'add' | 'subtract' | 'multiply' | 'min' | 'max';

export interface BlendAreaSelectionsOptions {
  /** Working-plane dimension cap. Defaults to `MAX_AREA_SELECTION_DIMENSION`. */
  resolution?: number;
}

function unionFrame(
  a: AreaSelection,
  b: AreaSelection,
): { x: number; y: number; w: number; h: number } | null {
  const ba = areaSelectionBounds(a.expression);
  const bb = areaSelectionBounds(b.expression);
  const x = Math.min(ba.x, bb.x);
  const y = Math.min(ba.y, bb.y);
  const right = Math.max(ba.x + ba.w, bb.x + bb.w);
  const bottom = Math.max(ba.y + ba.h, bb.y + bb.h);
  if (!(right > x) || !(bottom > y)) return null;
  return { x, y, w: right - x, h: bottom - y };
}

function blendBytes(
  operation: AreaSelectionBlend,
  a: number,
  b: number,
): number {
  switch (operation) {
    case 'add':
      return Math.min(255, a + b);
    case 'subtract':
      return Math.max(0, a - b);
    case 'multiply':
      return Math.round((a * b) / 255);
    case 'min':
      return Math.min(a, b);
    case 'max':
      return Math.max(a, b);
  }
}

/**
 * Phase 8 — rasterize both selections onto one shared bounded plane over the
 * union of their bounds and blend their coverage per pixel.
 */
export function blendAreaSelections(
  a: AreaSelection,
  b: AreaSelection,
  operation: AreaSelectionBlend,
  options: BlendAreaSelectionsOptions = {},
): AreaSelection | null {
  const frame = unionFrame(a, b);
  if (!frame) return null;
  const size = boundedPlaneSize(frame.w, frame.h, options.resolution ?? Number.POSITIVE_INFINITY);

  const renderPlane = (selection: AreaSelection): Uint8Array | null => {
    try {
      return rasterizeAreaSelection(selection, {
        x: frame.x,
        y: frame.y,
        width: size.width,
        height: size.height,
      }).data;
    } catch {
      return null;
    }
  };
  const planeA = renderPlane(a);
  const planeB = renderPlane(b);
  if (!planeA || !planeB) return null;

  const out = new Uint8Array(size.width * size.height);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = blendBytes(operation, planeA[i]!, planeB[i]!);
  }
  return maskAreaSelectionFromPlane({ data: out, width: size.width, height: size.height }, frame);
}
