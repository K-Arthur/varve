/**
 * Canonical image-fill placement between source pixels and node-local space.
 *
 * Research basis: Canvas 2D drawImage destination rectangles, CSS-style
 * contain/cover sizing, and reversible pixel-coordinate mappings used by
 * non-destructive image-mask editors.
 */

export type ImagePlacementFit = 'fill' | 'fit' | 'stretch' | 'tile' | 'crop';

export interface ImagePlacementPoint {
  x: number;
  y: number;
}

export interface ImagePlacementRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComputeImagePlacementOptions {
  fit: ImagePlacementFit;
  sourceWidth: number;
  sourceHeight: number;
  bounds: ImagePlacementRect;
  x?: number;
  y?: number;
  scale?: number;
  /** Visible source sample in orientation-normalized source pixels. */
  sourceCrop?: ImagePlacementRect;
  /** Clockwise content rotation around the full image destination centre. */
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface ImagePlacement {
  fit: ImagePlacementFit;
  sourceWidth: number;
  sourceHeight: number;
  bounds: ImagePlacementRect;
  /** Full-source destination rectangle; for tile this is the anchor tile. */
  drawRect: ImagePlacementRect;
  /** Validated source sample. The full source when no crop is active. */
  sourceRect: ImagePlacementRect;
  /** Destination occupied by sourceRect before rotation/flips. */
  sampleDrawRect: ImagePlacementRect;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function finiteRect(rect: ImagePlacementRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    finitePositive(rect.w) &&
    finitePositive(rect.h)
  );
}

function containsHalfOpen(rect: ImagePlacementRect, point: ImagePlacementPoint): boolean {
  return (
    point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.w && point.y < rect.y + rect.h
  );
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function normalizeSourceRect(
  crop: ImagePlacementRect | undefined,
  sourceWidth: number,
  sourceHeight: number,
): ImagePlacementRect | null {
  if (!crop) return { x: 0, y: 0, w: sourceWidth, h: sourceHeight };
  if (
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y) ||
    !finitePositive(crop.w) ||
    !finitePositive(crop.h)
  ) {
    return null;
  }
  const x = Math.max(0, Math.min(crop.x, sourceWidth));
  const y = Math.max(0, Math.min(crop.y, sourceHeight));
  const right = Math.max(x, Math.min(crop.x + crop.w, sourceWidth));
  const bottom = Math.max(y, Math.min(crop.y + crop.h, sourceHeight));
  if (!finitePositive(right - x) || !finitePositive(bottom - y)) return null;
  return { x, y, w: right - x, h: bottom - y };
}

function sourceRectDestination(
  drawRect: ImagePlacementRect,
  sourceRect: ImagePlacementRect,
  sourceWidth: number,
  sourceHeight: number,
): ImagePlacementRect {
  return {
    x: drawRect.x + (sourceRect.x / sourceWidth) * drawRect.w,
    y: drawRect.y + (sourceRect.y / sourceHeight) * drawRect.h,
    w: (sourceRect.w / sourceWidth) * drawRect.w,
    h: (sourceRect.h / sourceHeight) * drawRect.h,
  };
}

/** Compute the exact destination geometry used by image-fill replay. */
export function computeImagePlacement(
  options: ComputeImagePlacementOptions,
): ImagePlacement | null {
  const { fit, sourceWidth, sourceHeight, bounds } = options;
  const offsetX = options.x ?? 0;
  const offsetY = options.y ?? 0;
  const scale = options.scale ?? 1;
  const rotation = options.rotation ?? 0;
  if (
    !finitePositive(sourceWidth) ||
    !finitePositive(sourceHeight) ||
    !finiteRect(bounds) ||
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !finitePositive(scale) ||
    !Number.isFinite(rotation)
  ) {
    return null;
  }
  const sourceRect = normalizeSourceRect(options.sourceCrop, sourceWidth, sourceHeight);
  if (!sourceRect) return null;

  const finish = (drawRect: ImagePlacementRect): ImagePlacement | null => {
    if (!finiteRect(drawRect)) return null;
    const sampleDrawRect = sourceRectDestination(drawRect, sourceRect, sourceWidth, sourceHeight);
    if (!finiteRect(sampleDrawRect)) return null;
    return {
      fit,
      sourceWidth,
      sourceHeight,
      bounds: { ...bounds },
      drawRect,
      sourceRect,
      sampleDrawRect,
      rotation: ((rotation % 360) + 360) % 360,
      flipH: options.flipH === true,
      flipV: options.flipV === true,
    };
  };

  if (fit === 'tile') {
    const tileWidth = sourceWidth * scale;
    const tileHeight = sourceHeight * scale;
    if (!finitePositive(tileWidth) || !finitePositive(tileHeight)) return null;
    const offsetOriginX = bounds.x + offsetX;
    const offsetOriginY = bounds.y + offsetY;
    // Tile offsets define an anchor relative to the local bounds. Normalize
    // that anchor to the nearest occurrence at or before the bounds origin so
    // replay always paints the complete clipped area, including positive
    // offset leading edges.
    const drawRect = {
      x: offsetOriginX + Math.floor((bounds.x - offsetOriginX) / tileWidth) * tileWidth,
      y: offsetOriginY + Math.floor((bounds.y - offsetOriginY) / tileHeight) * tileHeight,
      w: tileWidth,
      h: tileHeight,
    };
    return finish(drawRect);
  }

  if (fit === 'crop') {
    // Crop mode: the source image is drawn at its natural size (× scale),
    // offset by (offsetX, offsetY), and clipped to bounds.
    // When bounds change, the same crop region is maintained.
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    if (!finitePositive(drawWidth) || !finitePositive(drawHeight)) return null;
    const drawRect = {
      x: bounds.x + offsetX,
      y: bounds.y + offsetY,
      w: drawWidth,
      h: drawHeight,
    };
    return finish(drawRect);
  }

  let drawWidth: number;
  let drawHeight: number;
  if (fit === 'stretch') {
    drawWidth = bounds.w;
    drawHeight = bounds.h;
  } else {
    const aspect = sourceWidth / sourceHeight;
    const boundsAspect = bounds.w / bounds.h;
    if (!finitePositive(aspect)) return null;
    if (fit === 'fit') {
      if (aspect > boundsAspect) {
        drawWidth = bounds.w;
        drawHeight = bounds.w / aspect;
      } else {
        drawHeight = bounds.h;
        drawWidth = bounds.h * aspect;
      }
    } else if (aspect > boundsAspect) {
      drawHeight = bounds.h;
      drawWidth = bounds.h * aspect;
    } else {
      drawWidth = bounds.w;
      drawHeight = bounds.w / aspect;
    }
    drawWidth *= scale;
    drawHeight *= scale;
  }

  if (!finitePositive(drawWidth) || !finitePositive(drawHeight)) return null;
  const drawRect = {
    x: bounds.x + offsetX + (bounds.w - drawWidth) / 2,
    y: bounds.y + offsetY + (bounds.h - drawHeight) / 2,
    w: drawWidth,
    h: drawHeight,
  };
  return finish(drawRect);
}

function transformAroundDrawCenter(
  placement: ImagePlacement,
  point: ImagePlacementPoint,
  drawRect: ImagePlacementRect,
): ImagePlacementPoint {
  const cx = drawRect.x + drawRect.w / 2;
  const cy = drawRect.y + drawRect.h / 2;
  let x = point.x - cx;
  let y = point.y - cy;
  if (placement.flipH) x = -x;
  if (placement.flipV) y = -y;
  if (placement.rotation !== 0) {
    const radians = (placement.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    [x, y] = [x * cos - y * sin, x * sin + y * cos];
  }
  return { x: cx + x, y: cy + y };
}

function inverseTransformAroundDrawCenter(
  placement: ImagePlacement,
  point: ImagePlacementPoint,
  drawRect: ImagePlacementRect,
): ImagePlacementPoint {
  const cx = drawRect.x + drawRect.w / 2;
  const cy = drawRect.y + drawRect.h / 2;
  let x = point.x - cx;
  let y = point.y - cy;
  if (placement.rotation !== 0) {
    const radians = (-placement.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    [x, y] = [x * cos - y * sin, x * sin + y * cos];
  }
  if (placement.flipH) x = -x;
  if (placement.flipV) y = -y;
  return { x: cx + x, y: cy + y };
}

/** Map a visible source pixel to a deterministic node-local coordinate. */
export function sourcePixelToLocal(
  placement: ImagePlacement,
  source: ImagePlacementPoint,
): ImagePlacementPoint | null {
  if (
    !Number.isFinite(source.x) ||
    !Number.isFinite(source.y) ||
    source.x < 0 ||
    source.y < 0 ||
    source.x >= placement.sourceWidth ||
    source.y >= placement.sourceHeight ||
    !containsHalfOpen(placement.sourceRect, source)
  ) {
    return null;
  }

  const { drawRect, bounds } = placement;
  let x = drawRect.x + (source.x / placement.sourceWidth) * drawRect.w;
  let y = drawRect.y + (source.y / placement.sourceHeight) * drawRect.h;
  if (placement.fit === 'tile') {
    x += Math.ceil((bounds.x - x) / drawRect.w) * drawRect.w;
    y += Math.ceil((bounds.y - y) / drawRect.h) * drawRect.h;
  }
  const tileRect = drawRectForPoint(placement, { x, y });
  const local = transformAroundDrawCenter(placement, { x, y }, tileRect);
  return containsHalfOpen(bounds, local) ? local : null;
}

/** Map a painted node-local coordinate to source image pixels. */
export function localToSourcePixel(
  placement: ImagePlacement,
  local: ImagePlacementPoint,
  options?: { unclipped?: boolean },
): ImagePlacementPoint | null {
  if (
    !Number.isFinite(local.x) ||
    !Number.isFinite(local.y) ||
    !containsHalfOpen(placement.bounds, local)
  ) {
    return null;
  }
  const drawRect = drawRectForPoint(placement, local);
  const untransformed = inverseTransformAroundDrawCenter(placement, local, drawRect);
  let relativeX = untransformed.x - drawRect.x;
  let relativeY = untransformed.y - drawRect.y;
  if (placement.fit === 'tile') {
    relativeX = positiveModulo(relativeX, drawRect.w);
    relativeY = positiveModulo(relativeY, drawRect.h);
  } else if (!options?.unclipped && !containsHalfOpen(drawRect, untransformed)) {
    return null;
  }
  const source = {
    x: (relativeX / drawRect.w) * placement.sourceWidth,
    y: (relativeY / drawRect.h) * placement.sourceHeight,
  };
  return options?.unclipped || containsHalfOpen(placement.sourceRect, source) ? source : null;
}

function drawRectForPoint(
  placement: ImagePlacement,
  point: ImagePlacementPoint,
): ImagePlacementRect {
  if (placement.fit !== 'tile') return placement.drawRect;
  const { drawRect } = placement;
  return {
    x: drawRect.x + Math.floor((point.x - drawRect.x) / drawRect.w) * drawRect.w,
    y: drawRect.y + Math.floor((point.y - drawRect.y) / drawRect.h) * drawRect.h,
    w: drawRect.w,
    h: drawRect.h,
  };
}
