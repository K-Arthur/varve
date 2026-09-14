/**
 * Neutral (identity) FilterIR detection.
 *
 * A filter whose parameters are at their neutral values must not alter the
 * rendered pixels. Running it anyway costs intermediate surfaces and, for
 * partially transparent antialiased edge pixels, a premultiplied
 * `getImageData`/`putImageData` round-trip that can shift a channel by one
 * quantization step — so resetting a control would not return the canvas to
 * its original bytes.
 *
 * The predicate is deliberately conservative: only kinds whose neutral is
 * unambiguous are listed, and a filter is only treated as identity at full
 * opacity with normal blending. A neutral filter under a non-normal blend or
 * reduced opacity still changes the backdrop, so it is never skipped.
 */

import type { FilterIR } from './types';

const EPSILON = 1e-9;

function near(value: number | undefined, target: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value - target) <= EPSILON;
}

function isFullNormal(filter: FilterIR): boolean {
  const opacity = filter.opacity ?? 1;
  return (
    opacity >= 1 - EPSILON && (filter.blendMode === undefined || filter.blendMode === 'normal')
  );
}

/** True when the filter is a provable no-op for normal full-opacity compositing. */
export function isIdentityFilter(filter: FilterIR): boolean {
  if (!isFullNormal(filter)) return false;

  switch (filter.kind) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
    case 'hueRotate':
    case 'sepia':
    case 'grayscale':
    case 'invert':
    case 'temperature':
    case 'tint':
    case 'vibrance':
      return near(filter.value, 0);
    case 'exposure':
      return near(filter.value, 0) && near(filter.offset, 0) && near(filter.gammaCorrection, 1);
    case 'shadowHighlight':
      return near(filter.shadows, 0) && near(filter.highlights, 0);
    case 'levels':
      return (
        near(filter.inputShadows, 0) &&
        near(filter.inputMidtones, 1) &&
        near(filter.inputHighlights, 255) &&
        near(filter.outputShadows, 0) &&
        near(filter.outputHighlights, 255)
      );
    case 'blur':
      return filter.radius <= EPSILON;
    case 'motionBlur':
      return near(filter.distance, 0);
    case 'mosaic':
      return filter.blockSize <= 1;
    case 'microDetail':
    case 'definition':
    case 'atmosphere':
    case 'dehaze':
      return near(filter.amount, 0);
    case 'edgeFalloff':
    case 'grain':
    case 'softBloom':
      return near(filter.strength, 0);
    case 'opacity':
      return near(filter.value, 1);
    default:
      // Curves, selective colour, channel mixer, LUTs, and every effect whose
      // neutral is not a simple scalar keep the existing compositing path.
      return false;
  }
}

/** Drop provably neutral entries from a filter chain without reordering. */
export function withoutIdentityFilters(filters: readonly FilterIR[]): FilterIR[] {
  return filters.filter((filter) => !isIdentityFilter(filter));
}
