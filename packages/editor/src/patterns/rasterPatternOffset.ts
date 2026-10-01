export const MAX_RASTER_PATTERN_OFFSET_PIXELS = 16_000_000;

export interface RasterOffsetPlacement {
  x: number;
  y: number;
}

/** Positions of the four periodic source copies needed to fill one offset cell. */
export function rasterPatternOffsetPlacements(
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): RasterOffsetPlacement[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Raster tile dimensions must be positive integers.');
  }
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    throw new Error('Raster tile offsets must be finite pixel values.');
  }
  if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY)) {
    throw new Error('Raster tile offsets must use whole pixels.');
  }
  if (width * height > MAX_RASTER_PATTERN_OFFSET_PIXELS) {
    throw new Error('Raster tile is too large to offset safely (maximum 16 megapixels).');
  }

  const x = ((offsetX % width) + width) % width;
  const y = ((offsetY % height) + height) % height;
  return [
    { x: x - width, y: y - height },
    { x, y: y - height },
    { x: x - width, y },
    { x, y },
  ];
}

/**
 * Shift an embedded raster source by whole pixels and wrap its existing texels
 * across both axes. This changes phase; it does not synthesize seam content.
 */
export async function createOffsetRasterTileDataUrl(
  sourceDataUrl: string,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  environment: {
    createImage: () => HTMLImageElement;
    createCanvas: () => HTMLCanvasElement;
  } = {
    createImage: () => new Image(),
    createCanvas: () => document.createElement('canvas'),
  },
): Promise<string> {
  const placements = rasterPatternOffsetPlacements(width, height, offsetX, offsetY);
  if (!sourceDataUrl.startsWith('data:image/')) {
    throw new Error('Raster tile data is missing or is not embedded.');
  }

  const image = environment.createImage();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Raster tile could not be decoded for offset editing.'));
    image.src = sourceDataUrl;
  });
  if (image.naturalWidth !== width || image.naturalHeight !== height) {
    throw new Error('Raster tile dimensions changed before offset editing.');
  }

  const canvas = environment.createCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('A 2D canvas is unavailable for raster offset editing.');
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  for (const placement of placements) {
    context.drawImage(image, placement.x, placement.y, width, height);
  }

  let output: string;
  try {
    output = canvas.toDataURL('image/png');
  } catch {
    throw new Error('The offset tile could not be encoded as PNG.');
  }
  if (!output.startsWith('data:image/png;base64,')) {
    throw new Error('The offset tile could not be encoded as PNG.');
  }
  return output;
}
