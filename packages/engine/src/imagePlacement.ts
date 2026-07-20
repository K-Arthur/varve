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
}

export interface ImagePlacement {
  fit: ImagePlacementFit;
  sourceWidth: number;
  sourceHeight: number;
  bounds: ImagePlacementRect;
  /** Canvas drawImage destination rectangle; for tile this is the anchor tile. */
  drawRect: ImagePlacementRect;
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

/** Compute the exact destination geometry used by image-fill replay. */
export function computeImagePlacement(
  options: ComputeImagePlacementOptions,
): ImagePlacement | null {
  const { fit, sourceWidth, sourceHeight, bounds } = options;
  const offsetX = options.x ?? 0;
  const offsetY = options.y ?? 0;
  const scale = options.scale ?? 1;
  if (
    !finitePositive(sourceWidth) ||
    !finitePositive(sourceHeight) ||
    !finiteRect(bounds) ||
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !Number.isFinite(scale)
  ) {
    return null;
  }

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
    if (!finiteRect(drawRect)) return null;
    return {
      fit,
      sourceWidth,
      sourceHeight,
      bounds: { ...bounds },
      drawRect,
    };
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
    if (!finiteRect(drawRect)) return null;
    return {
      fit,
      sourceWidth,
      sourceHeight,
      bounds: { ...bounds },
      drawRect,
    };
  }

  let drawWidth: number;
  let drawHeight: number;
  if (fit === 'stretch') {
    drawWidth = bounds.w;
    drawHeight = bounds.h;
  } else {
    // Replay's historical convention applies uniform image scale before
    // calculating aspect ratio. It therefore intentionally cancels for fit
    // and fill while remaining meaningful for tile.
    const referenceWidth = sourceWidth * scale;
    const referenceHeight = sourceHeight * scale;
    const aspect = referenceWidth / referenceHeight;
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
  }

  if (!finitePositive(drawWidth) || !finitePositive(drawHeight)) return null;
  const drawRect = {
    x: bounds.x + offsetX + (bounds.w - drawWidth) / 2,
    y: bounds.y + offsetY + (bounds.h - drawHeight) / 2,
    w: drawWidth,
    h: drawHeight,
  };
  if (!finiteRect(drawRect)) return null;
  return {
    fit,
    sourceWidth,
    sourceHeight,
    bounds: { ...bounds },
    drawRect,
  };
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
    source.y >= placement.sourceHeight
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
  const local = { x, y };
  return containsHalfOpen(bounds, local) &&
    containsHalfOpen(drawRectForPoint(placement, local), local)
    ? local
    : null;
}

/** Map a painted node-local coordinate to source image pixels. */
export function localToSourcePixel(
  placement: ImagePlacement,
  local: ImagePlacementPoint,
): ImagePlacementPoint | null {
  if (
    !Number.isFinite(local.x) ||
    !Number.isFinite(local.y) ||
    !containsHalfOpen(placement.bounds, local)
  ) {
    return null;
  }
  const { drawRect } = placement;
  let relativeX = local.x - drawRect.x;
  let relativeY = local.y - drawRect.y;
  if (placement.fit === 'tile') {
    relativeX = positiveModulo(relativeX, drawRect.w);
    relativeY = positiveModulo(relativeY, drawRect.h);
  } else if (!containsHalfOpen(drawRect, local)) {
    return null;
  }
  return {
    x: (relativeX / drawRect.w) * placement.sourceWidth,
    y: (relativeY / drawRect.h) * placement.sourceHeight,
  };
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
