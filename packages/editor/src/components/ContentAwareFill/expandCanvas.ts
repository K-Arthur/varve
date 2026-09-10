/**
 * Build the source frame used by Expand. The original pixels are copied to a
 * known offset and the new area is marked for generation; no resampling of
 * the source image is involved.
 */

export interface ExpandPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ExpandedGenerationInput {
  imageData: ImageData;
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  sourceOffsetX: number;
  sourceOffsetY: number;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sourceIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

/**
 * Prepare an expanded frame for an inpainting model.
 *
 * Newly exposed pixels are edge-clamped only as model context. They are all
 * covered by a 255 mask, so they can never leak into the accepted result
 * unless the provider returns them as generated pixels. The source region is
 * copied byte-for-byte and is always protected: Expand must not rewrite
 * existing content, even if a stale paint mask is still present in the UI.
 */
export function prepareExpandedGenerationInput(
  source: ImageData,
  sourceMask: Uint8Array,
  padding: ExpandPadding,
): ExpandedGenerationInput {
  if (
    source.width <= 0 ||
    source.height <= 0 ||
    sourceMask.length !== source.width * source.height ||
    !nonNegativeInteger(padding.top) ||
    !nonNegativeInteger(padding.right) ||
    !nonNegativeInteger(padding.bottom) ||
    !nonNegativeInteger(padding.left)
  ) {
    throw new Error('Expand source or padding is invalid');
  }

  const width = source.width + padding.left + padding.right;
  const height = source.height + padding.top + padding.bottom;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 16_777_216
  ) {
    throw new Error('Expand output dimensions are too large');
  }

  const imageData = new ImageData(width, height);
  const mask = new Uint8Array(width * height);
  const sourceX = padding.left;
  const sourceY = padding.top;

  for (let y = 0; y < height; y += 1) {
    const sourceLocalY = Math.max(0, Math.min(source.height - 1, y - sourceY));
    for (let x = 0; x < width; x += 1) {
      const sourceLocalX = Math.max(0, Math.min(source.width - 1, x - sourceX));
      const destination = sourceIndex(x, y, width);
      const context = sourceIndex(sourceLocalX, sourceLocalY, source.width);
      imageData.data[destination] = source.data[context]!;
      imageData.data[destination + 1] = source.data[context + 1]!;
      imageData.data[destination + 2] = source.data[context + 2]!;
      imageData.data[destination + 3] = source.data[context + 3]!;

      const insideSource =
        x >= sourceX && x < sourceX + source.width && y >= sourceY && y < sourceY + source.height;
      mask[y * width + x] = insideSource ? 0 : 255;
    }
  }

  return {
    imageData,
    mask,
    maskWidth: width,
    maskHeight: height,
    sourceOffsetX: sourceX,
    sourceOffsetY: sourceY,
  };
}
