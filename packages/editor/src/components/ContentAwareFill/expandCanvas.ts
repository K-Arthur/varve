/**
 * Build the source frame used by Expand. The original pixels are copied to a
 * known offset and the new area is marked for generation; no resampling of
 * the source image is involved.
 *
 * Geometry, validation, and the coverage mask are owned by the engine's
 * expansion plan so the dialog, this helper, and the pipeline cannot drift.
 */

import { buildExpandedFrame, computeExpandPlan } from '@varve/engine';

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
  sourceMask: Uint8Array | undefined,
  padding: ExpandPadding,
): ExpandedGenerationInput {
  if (source.width <= 0 || source.height <= 0) {
    throw new Error('Expand source is invalid');
  }
  if (sourceMask && sourceMask.length !== source.width * source.height) {
    throw new Error('Expand source mask dimensions are invalid');
  }
  const result = computeExpandPlan(source.width, source.height, padding);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  const frame = buildExpandedFrame(source, result.plan);
  return {
    imageData: frame.imageData,
    mask: frame.mask,
    maskWidth: frame.width,
    maskHeight: frame.height,
    sourceOffsetX: result.plan.sourceOffsetX,
    sourceOffsetY: result.plan.sourceOffsetY,
  };
}
