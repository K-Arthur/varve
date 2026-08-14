/**
 * Segmentation quality metrics — IoU, Dice, boundary F-score, and a
 * click-efficiency counter. All operate on binary source-pixel masks
 * (Uint8Array with 0/1 or 0/255 values) so they can be applied to any
 * backend's output without touching tensor formats.
 */

export interface SegmentationQualityMetrics {
  iou: number;
  dice: number;
  boundaryF: number;
}

function normalizeMask(mask: Uint8Array): Uint8Array {
  // Accept 0/1 or 0/255 encodings; treat any non-zero as foreground.
  let has255 = false;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 255) {
      has255 = true;
      break;
    }
  }
  if (!has255) return mask;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    out[i] = mask[i]! > 0 ? 1 : 0;
  }
  return out;
}

/** Intersection-over-union of two binary masks of equal length. */
export function maskIoU(predicted: Uint8Array, groundTruth: Uint8Array): number {
  assertSameLength(predicted, groundTruth);
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < predicted.length; i++) {
    const p = predicted[i]! > 0 ? 1 : 0;
    const g = groundTruth[i]! > 0 ? 1 : 0;
    if (p && g) intersection++;
    if (p || g) union++;
  }
  return union === 0 ? 1 : intersection / union;
}

/** Dice coefficient (F1 over pixels). */
export function maskDice(predicted: Uint8Array, groundTruth: Uint8Array): number {
  assertSameLength(predicted, groundTruth);
  let intersection = 0;
  let pCount = 0;
  let gCount = 0;
  for (let i = 0; i < predicted.length; i++) {
    const p = predicted[i]! > 0 ? 1 : 0;
    const g = groundTruth[i]! > 0 ? 1 : 0;
    if (p && g) intersection++;
    pCount += p;
    gCount += g;
  }
  return pCount + gCount === 0 ? 1 : (2 * intersection) / (pCount + gCount);
}

function boundaryPixels(mask: Uint8Array, width: number, height: number): Set<number> {
  const out = new Set<number>();
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]! > 0 ? 1 : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i]! <= 0) continue;
      if (at(x - 1, y) === 0 || at(x + 1, y) === 0 || at(x, y - 1) === 0 || at(x, y + 1) === 0) {
        out.add(i);
      }
    }
  }
  return out;
}

/**
 * Boundary F-score with a 1px tolerance: a predicted boundary pixel counts
 * as matched if any ground-truth boundary pixel is within Chebyshev
 * distance 1. Penalizes boundary noise more gently than exact-match while
 * still rewarding exact contours.
 */
export function boundaryFScore(
  predicted: Uint8Array,
  groundTruth: Uint8Array,
  width: number,
  height: number,
): number {
  assertSameLength(predicted, groundTruth);
  const pred = boundaryPixels(predicted, width, height);
  const gt = boundaryPixels(groundTruth, width, height);
  if (gt.size === 0) return pred.size === 0 ? 1 : 0;

  let matched = 0;
  for (const i of pred) {
    const x = i % width;
    const y = Math.floor(i / width);
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (gt.has(ny * width + nx)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) matched++;
  }

  const precision = pred.size === 0 ? 0 : matched / pred.size;
  const recall = matched / gt.size;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/** Full metric set over two masks. */
export function computeSegmentationQuality(
  predicted: Uint8Array,
  groundTruth: Uint8Array,
  width: number,
  height: number,
): SegmentationQualityMetrics {
  const p = normalizeMask(predicted);
  const g = normalizeMask(groundTruth);
  return {
    iou: maskIoU(p, g),
    dice: maskDice(p, g),
    boundaryF: boundaryFScore(p, g, width, height),
  };
}

/**
 * Run a corpus through a backend-agnostic predictor.
 *
 * `predict` receives the fixture image and prompts and returns a binary
 * source-pixel mask. This is the seam a real backend adapter (worker-backed
 * SAM2, a Candle backend, a mock) plugs into — see
 * docs/quality/object-selection-parity.md for the release gate procedure.
 */
export function evaluateCorpus(
  corpus: Array<{
    id: string;
    width: number;
    height: number;
    image: ImageData;
    prompts: unknown;
    oracleMask: Uint8Array;
  }>,
  predict: (fixture: {
    id: string;
    width: number;
    height: number;
    image: ImageData;
    prompts: unknown;
  }) => Uint8Array | Promise<Uint8Array>,
): Promise<Array<{ id: string; metrics: SegmentationQualityMetrics }>> {
  return Promise.all(
    corpus.map(async (fixture) => {
      const mask = await predict({
        id: fixture.id,
        width: fixture.width,
        height: fixture.height,
        image: fixture.image,
        prompts: fixture.prompts,
      });
      const metrics = computeSegmentationQuality(
        mask,
        fixture.oracleMask,
        fixture.width,
        fixture.height,
      );
      return { id: fixture.id, metrics };
    }),
  );
}

function assertSameLength(a: Uint8Array, b: Uint8Array): void {
  if (a.length !== b.length) {
    throw new Error(`Mask length mismatch: ${a.length} vs ${b.length}`);
  }
}
