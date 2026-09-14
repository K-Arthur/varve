export type SelectionHealthMode = 'fill' | 'remove' | 'replace' | 'expand';

export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionHealth {
  width: number;
  height: number;
  /** Number of pixels with any mask coverage. */
  coveredPixels: number;
  /** Number of pixels at or above the provider hard-edit threshold. */
  hardPixels: number;
  coverage: number;
  hardCoverage: number;
  componentCount: number;
  largestComponentPixels: number;
  bounds: SelectionBounds | null;
  touchesEdge: boolean;
  blockingReason: string | null;
  warnings: string[];
}

const HARD_THRESHOLD = 128;
const MIN_EDIT_PIXELS = 4;
const BROAD_SELECTION_COVERAGE = 0.9;

/**
 * Return whether a source-sized mask can be resized into the current preview
 * without changing the selected object's geometry. A small tolerance covers
 * integer rounding while rejecting masks from a different crop or source.
 */
export function maskMatchesSourceGeometry(
  maskWidth: number,
  maskHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  tolerance = 0.05,
): boolean {
  if (
    !Number.isInteger(maskWidth) ||
    !Number.isInteger(maskHeight) ||
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    maskWidth <= 0 ||
    maskHeight <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return false;
  }
  return Math.abs(Math.log(maskWidth / maskHeight / (sourceWidth / sourceHeight))) <= tolerance;
}

function emptyBounds(): SelectionBounds | null {
  return null;
}

/**
 * Inspect the actual one-channel edit mask before it reaches an inference
 * provider. This cannot decide semantic intent, but it catches the geometry
 * errors that make a correct model edit the wrong area: empty/tiny masks,
 * near-full-frame masks, disconnected regions, and masks that run out of the
 * available context at an image edge.
 */
export function analyzeSelectionHealth(
  mask: Uint8Array,
  width: number,
  height: number,
  mode: SelectionHealthMode,
): SelectionHealth {
  const validDimensions =
    Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
  const pixelCount = validDimensions ? width * height : 0;
  const validMask = validDimensions && mask.length === pixelCount;
  if (!validMask) {
    return {
      width: Math.max(0, width),
      height: Math.max(0, height),
      coveredPixels: 0,
      hardPixels: 0,
      coverage: 0,
      hardCoverage: 0,
      componentCount: 0,
      largestComponentPixels: 0,
      bounds: emptyBounds(),
      touchesEdge: false,
      blockingReason: 'The edit mask dimensions do not match the preview.',
      warnings: [],
    };
  }

  let coveredPixels = 0;
  let hardPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let touchesEdge = false;
  const hard = new Uint8Array(pixelCount);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = mask[y * width + x] ?? 0;
      if (value > 0) {
        coveredPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      }
      if (value > HARD_THRESHOLD) {
        hard[indexFor(x, y, width)] = 1;
        hardPixels += 1;
      }
    }
  }

  const componentSizes: number[] = [];
  const queue = new Int32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    if (hard[index] === 0) continue;
    hard[index] = 0;
    let head = 0;
    let tail = 0;
    let size = 0;
    queue[tail++] = index;
    while (head < tail) {
      const current = queue[head++]!;
      size += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbours = [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour >= 0 && hard[neighbour] === 1) {
          hard[neighbour] = 0;
          queue[tail++] = neighbour;
        }
      }
    }
    componentSizes.push(size);
  }

  const coverage = coveredPixels / pixelCount;
  const hardCoverage = hardPixels / pixelCount;
  const bounds =
    maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  const largestComponentPixels = componentSizes.reduce(
    (largest, size) => Math.max(largest, size),
    0,
  );
  const warnings: string[] = [];
  let blockingReason: string | null = null;

  if (mode !== 'expand' && coveredPixels === 0) {
    blockingReason = 'Select pixels to define the edit region.';
  } else if (mode !== 'expand' && coveredPixels < MIN_EDIT_PIXELS) {
    blockingReason =
      'The edit region is too small; select at least four pixels or paint a larger area.';
  }
  if (mode !== 'expand' && coverage >= BROAD_SELECTION_COVERAGE) {
    warnings.push(
      'The mask covers almost the entire image; the model has little surrounding context.',
    );
  }
  if (mode !== 'expand' && componentSizes.length > 1) {
    warnings.push(
      `The mask contains ${componentSizes.length} separate regions; verify each region is intentional.`,
    );
  }
  if (mode !== 'expand' && touchesEdge) {
    warnings.push('The mask touches the image edge; context is limited on that side.');
  }
  if (mode !== 'expand' && coveredPixels > 0 && hardPixels === 0) {
    warnings.push(
      'The mask contains only soft coverage; verify the visible overlay before generating.',
    );
  }

  return {
    width,
    height,
    coveredPixels,
    hardPixels,
    coverage,
    hardCoverage,
    componentCount: componentSizes.length,
    largestComponentPixels,
    bounds,
    touchesEdge,
    blockingReason,
    warnings,
  };
}

function indexFor(x: number, y: number, width: number): number {
  return y * width + x;
}

export function emptySelectionHealth(mode: SelectionHealthMode = 'remove'): SelectionHealth {
  const health = analyzeSelectionHealth(new Uint8Array([0]), 1, 1, mode);
  return {
    ...health,
    width: 0,
    height: 0,
    bounds: null,
    blockingReason: mode === 'expand' ? null : 'Select pixels to define the edit region.',
  };
}
