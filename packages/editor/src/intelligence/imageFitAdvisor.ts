export type FitSuggestion = 'fill' | 'fit' | 'stretch' | 'tile';

export interface ImageFitResult {
  fit: FitSuggestion;
  reason: string;
}

const AR_TOLERANCE = 0.05;

export function suggestFit(
  imageW: number,
  imageH: number,
  frameW: number,
  frameH: number,
  hasTransparency?: boolean,
): ImageFitResult {
  if (!Number.isFinite(imageW) || !Number.isFinite(imageH) || imageW <= 0 || imageH <= 0) {
    return { fit: 'stretch', reason: 'Dimensions not yet loaded; will re-evaluate' };
  }

  if (hasTransparency) {
    return { fit: 'tile', reason: 'Transparency benefits from tiling/mask' };
  }

  const imageAr = imageW / imageH;
  const frameAr = frameW / frameH;
  const arDiff = Math.abs(imageAr / frameAr - 1);

  if (arDiff <= AR_TOLERANCE) {
    return { fit: 'stretch', reason: 'Near-perfect aspect ratio match' };
  }

  if (imageAr > frameAr) {
    return { fit: 'fill', reason: 'Image is wider; fill crops overflow' };
  }

  return { fit: 'fit', reason: 'Image is taller; fit preserves content' };
}
