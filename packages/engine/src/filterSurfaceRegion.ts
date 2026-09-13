import { computeScreenBounds } from './effectPipeline';
import type { FilterIR, RenderItem } from './types';

export interface FilterSurfaceAffine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface FilterSurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PointwiseFilterSurfaceInput {
  sourceBounds: { x: number; y: number; w: number; h: number };
  cameraTransform: FilterSurfaceAffine;
  itemTransform: RenderItem['transform'];
  strokes?: readonly { weight: number }[];
  filters: readonly FilterIR[];
  hasVisibleEffects: boolean;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Return a clipped device-space region for a filter stack that cannot sample
 * neighbouring pixels or depend on a coordinate-origin-specific pattern.
 *
 * The full-surface path remains authoritative for spatial, pattern, global,
 * and effect-bearing items. This conservative classification is deliberate:
 * a zero bounds expansion in a kernel is not by itself proof that cropping is
 * equivalent to full-image evaluation.
 */
export function computePointwiseFilterSurface(
  input: PointwiseFilterSurfaceInput,
): FilterSurfaceBounds | undefined {
  if (
    input.filters.length === 0 ||
    input.hasVisibleEffects ||
    !input.filters.every(isStrictlyPointwiseFilter) ||
    !isPositiveCanvasDimension(input.canvasWidth) ||
    !isPositiveCanvasDimension(input.canvasHeight)
  ) {
    return undefined;
  }

  const { sourceBounds } = input;
  if (
    ![sourceBounds.x, sourceBounds.y, sourceBounds.w, sourceBounds.h].every(Number.isFinite) ||
    sourceBounds.w <= 0 ||
    sourceBounds.h <= 0
  ) {
    return undefined;
  }

  const strokePadding = Math.max(
    0,
    ...(input.strokes ?? []).map((stroke) =>
      Number.isFinite(stroke.weight) ? Math.abs(stroke.weight) : 0,
    ),
  );
  const localBounds = {
    x: sourceBounds.x - strokePadding,
    y: sourceBounds.y - strokePadding,
    w: sourceBounds.w + strokePadding * 2,
    h: sourceBounds.h + strokePadding * 2,
  };
  if (![localBounds.x, localBounds.y, localBounds.w, localBounds.h].every(Number.isFinite)) {
    return undefined;
  }

  const worldTransform = multiplyAffine(input.cameraTransform, input.itemTransform);
  if (!Object.values(worldTransform).every(Number.isFinite)) return undefined;

  const screen = computeScreenBounds(
    worldTransform,
    localBounds.x,
    localBounds.y,
    localBounds.w,
    localBounds.h,
  );
  if (![screen.x, screen.y, screen.w, screen.h].every(Number.isFinite)) return undefined;

  const left = Math.max(0, screen.x);
  const top = Math.max(0, screen.y);
  const right = Math.min(input.canvasWidth, screen.x + screen.w);
  const bottom = Math.min(input.canvasHeight, screen.y + screen.h);
  if (right <= left || bottom <= top) return undefined;

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function isPositiveCanvasDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function multiplyAffine(
  left: FilterSurfaceAffine,
  right: RenderItem['transform'],
): FilterSurfaceAffine {
  return {
    a: left.a * right[0] + left.c * right[1],
    b: left.b * right[0] + left.d * right[1],
    c: left.a * right[2] + left.c * right[3],
    d: left.b * right[2] + left.d * right[3],
    e: left.a * right[4] + left.c * right[5] + left.e,
    f: left.b * right[4] + left.d * right[5] + left.f,
  };
}

function isStrictlyPointwiseFilter(filter: FilterIR): boolean {
  switch (filter.kind) {
    case 'brightness':
    case 'contrast':
    case 'exposure':
    case 'saturation':
    case 'hueSaturation':
    case 'hueRotate':
    case 'sepia':
    case 'grayscale':
    case 'invert':
    case 'opacity':
    case 'temperature':
    case 'tint':
    case 'vibrance':
    case 'levels':
    case 'curves':
    case 'selectiveColor':
    case 'colorBalance':
    case 'channelMixer':
    case 'photoFilter':
    case 'gradientMap':
    case 'tritone':
    case 'duotone':
    case 'blackAndWhite':
    case 'posterize':
    case 'threshold':
    case 'lut':
      return true;
    default:
      return false;
  }
}
