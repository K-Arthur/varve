/**
 * Exact source-bounds → raster-surface transforms.
 *
 * A raster surface is the final crop boundary: sourceBounds' left/top map to
 * pixel (0, 0), and its right/bottom map to (pixelWidth, pixelHeight).
 * Width and height are independently resolved because their rounded pixel
 * dimensions need not share one exact scale. This preserves the requested
 * output dimensions without creating a transparent final row/column.
 *
 * The transform intentionally contains neither device-pixel-ratio adjustment
 * nor a blanket half-pixel offset. Callers allocate the backing surface at the
 * requested output size; Canvas retains its normal anti-aliasing for artwork
 * inside that output-space crop.
 */

export interface RasterSourceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RasterTargetDimensions {
  width: number;
  height: number;
}

export interface RasterizationTransform {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
}

export interface RasterTransformContext {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

/**
 * Resolve the one authoritative affine transform for an already-allocated
 * raster target. This is intentionally independent of requested PPI: PPI has
 * already been resolved into the target's integer pixel dimensions.
 */
export function sourceBoundsToRasterTransform(
  sourceBounds: RasterSourceBounds,
  target: RasterTargetDimensions,
): RasterizationTransform {
  assertFinite(sourceBounds.x, 'sourceBounds.x');
  assertFinite(sourceBounds.y, 'sourceBounds.y');
  assertFinite(sourceBounds.width, 'sourceBounds.width');
  assertFinite(sourceBounds.height, 'sourceBounds.height');
  if (sourceBounds.width <= 0 || sourceBounds.height <= 0) {
    throw new RangeError('source bounds must have positive width and height');
  }
  if (!Number.isSafeInteger(target.width) || !Number.isSafeInteger(target.height)) {
    throw new RangeError('raster target dimensions must be safe integers');
  }
  if (target.width < 1 || target.height < 1) {
    throw new RangeError('raster target dimensions must be positive');
  }

  const scaleX = target.width / sourceBounds.width;
  const scaleY = target.height / sourceBounds.height;
  return {
    scaleX,
    scaleY,
    translateX: sourceBounds.x === 0 ? 0 : -sourceBounds.x * scaleX,
    translateY: sourceBounds.y === 0 ? 0 : -sourceBounds.y * scaleY,
  };
}

/** Apply the exact rasterization transform to a Canvas 2D-like context. */
export function applyRasterizationTransform(
  context: RasterTransformContext,
  sourceBounds: RasterSourceBounds,
  target: RasterTargetDimensions,
): RasterizationTransform {
  const transform = sourceBoundsToRasterTransform(sourceBounds, target);
  context.setTransform(
    transform.scaleX,
    0,
    0,
    transform.scaleY,
    transform.translateX,
    transform.translateY,
  );
  return transform;
}
