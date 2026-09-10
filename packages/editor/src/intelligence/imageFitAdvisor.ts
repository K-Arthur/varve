import type { ImageFit } from '@varve/scene';

export type FitSuggestion = 'cover' | 'contain' | 'fill' | 'crop';

export interface ImageFitResult {
  fit: FitSuggestion;
  reason: string;
}

const AR_TOLERANCE = 0.05;

export function fromFitSuggestion(fit: FitSuggestion): ImageFit {
  switch (fit) {
    case 'cover':
      return 'fill';
    case 'contain':
      return 'fit';
    case 'fill':
      return 'stretch';
    case 'crop':
      return 'crop';
    default:
      return 'fill';
  }
}

export function toFitSuggestion(fit: ImageFit): FitSuggestion {
  switch (fit) {
    case 'fill':
      return 'cover';
    case 'fit':
      return 'contain';
    case 'stretch':
      return 'fill';
    case 'tile':
      return 'crop';
    case 'crop':
      return 'crop';
    default:
      return 'cover';
  }
}

export function suggestFit(
  imageW: number,
  imageH: number,
  frameW: number,
  frameH: number,
  hasTransparency?: boolean,
  existingFit?: ImageFit,
): ImageFitResult {
  if (existingFit) {
    return { fit: toFitSuggestion(existingFit), reason: 'Respecting existing image fit setting' };
  }

  if (!Number.isFinite(imageW) || !Number.isFinite(imageH) || imageW <= 0 || imageH <= 0) {
    return { fit: 'fill', reason: 'Dimensions not yet loaded; will re-evaluate' };
  }

  if (hasTransparency) {
    return { fit: 'crop', reason: 'Transparency benefits from cropping to the shape mask' };
  }

  const imageAr = imageW / imageH;
  const frameAr = frameW / frameH;
  const arDiff = Math.abs(imageAr / frameAr - 1);

  if (arDiff <= AR_TOLERANCE) {
    return { fit: 'fill', reason: 'Near-perfect aspect ratio match' };
  }

  if (imageAr > frameAr) {
    return { fit: 'cover', reason: 'Image is wider; cover crops overflow' };
  }

  return { fit: 'contain', reason: 'Image is taller; contain preserves content' };
}
