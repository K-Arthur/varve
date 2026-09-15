export interface LetterboxGeometry {
  offsetX: number;
  offsetY: number;
  contentWidth: number;
  contentHeight: number;
}

/**
 * Compute the raster geometry shared by an image and its auxiliary mask.
 *
 * The scale is aspect-preserving, but the actual canvas placement must use
 * integer bounds. Drawing at fractional offsets and later rounding those
 * offsets during decode makes the model see one rectangle while the decoder
 * crops a neighbouring rectangle. Keep the rounded content size and integer
 * padding as the single contract for both tensors and their metadata.
 */
export function computeLetterboxGeometry(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): LetterboxGeometry {
  if (
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    !Number.isSafeInteger(targetWidth) ||
    !Number.isSafeInteger(targetHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new Error('Letterbox dimensions must be positive integers');
  }
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const contentWidth = Math.max(1, Math.min(targetWidth, Math.round(sourceWidth * scale)));
  const contentHeight = Math.max(1, Math.min(targetHeight, Math.round(sourceHeight * scale)));
  return {
    contentWidth,
    contentHeight,
    // Put any odd padding pixel on the bottom/right, making the crop origin
    // unambiguous and matching the diffusion-frame contract.
    offsetX: Math.floor((targetWidth - contentWidth) / 2),
    offsetY: Math.floor((targetHeight - contentHeight) / 2),
  };
}
