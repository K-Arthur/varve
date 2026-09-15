/**
 * Geometry shared by depth previews and their pickers.
 *
 * A preview is a contained rendition of the map. The canvas may be smaller
 * than the map, but it must never silently stretch one axis, crop the map, or
 * map a click in a contain bar to the nearest edge pixel.
 */

export interface DepthPreviewLayout {
  mapWidth: number;
  mapHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
}

function positiveDimension(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return value;
}

/** Return integer canvas dimensions that contain the complete map. */
export function containDepthPreview(
  mapWidth: number,
  mapHeight: number,
  maxWidth = 300,
  maxHeight = 200,
): DepthPreviewLayout {
  positiveDimension(mapWidth, 'Depth map width');
  positiveDimension(mapHeight, 'Depth map height');
  positiveDimension(maxWidth, 'Preview width');
  positiveDimension(maxHeight, 'Preview height');

  const scale = Math.min(1, maxWidth / mapWidth, maxHeight / mapHeight);
  const canvasWidth = Math.max(1, Math.round(mapWidth * scale));
  const canvasHeight = Math.max(1, Math.round(mapHeight * scale));
  const drawScale = Math.min(canvasWidth / mapWidth, canvasHeight / mapHeight);
  const drawWidth = mapWidth * drawScale;
  const drawHeight = mapHeight * drawScale;

  return {
    mapWidth,
    mapHeight,
    canvasWidth,
    canvasHeight,
    drawX: (canvasWidth - drawWidth) / 2,
    drawY: (canvasHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
  };
}

/**
 * Map a pointer in the displayed canvas back to a map pixel.
 *
 * `rect` is the CSS-space bounding box; layout coordinates are converted from
 * CSS pixels to canvas pixels before the contain bars are tested.
 */
export function depthPreviewPointToMap(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  layout: DepthPreviewLayout,
): { x: number; y: number } | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;

  const x = ((clientX - rect.left) / rect.width) * layout.canvasWidth;
  const y = ((clientY - rect.top) / rect.height) * layout.canvasHeight;
  if (
    x < layout.drawX ||
    y < layout.drawY ||
    x >= layout.drawX + layout.drawWidth ||
    y >= layout.drawY + layout.drawHeight
  ) {
    return null;
  }

  return {
    x: Math.min(
      layout.mapWidth - 1,
      Math.max(0, Math.floor(((x - layout.drawX) / layout.drawWidth) * layout.mapWidth)),
    ),
    y: Math.min(
      layout.mapHeight - 1,
      Math.max(0, Math.floor(((y - layout.drawY) / layout.drawHeight) * layout.mapHeight)),
    ),
  };
}
