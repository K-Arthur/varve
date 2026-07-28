/**
 * Local render-and-compare font matching.
 *
 * When the classifier is unavailable (or as a refinement step in hybrid mode),
 * this module renders the recognized text using candidate fonts and compares
 * visual structures via multiple signals.
 */

import type { RenderCompareScores } from './fontDetectionTypes';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RENDER_SIZE = 300;
const RENDER_PADDING = 20;
const SAMPLE_TEXT_FALLBACK = 'Aa Bb Cc 123';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderCompareRequest {
  sourceImageData: ImageData;
  families: string[];
  recognizedText?: string;
  weight?: number;
  italic?: boolean;
  signal?: AbortSignal;
}

export interface RenderCompareResult {
  scores: Map<string, number>;
  details: Map<string, RenderCompareScores>;
  failedFamilies: string[];
}

/**
 * Compare a source text crop against rendered samples of candidate families.
 */
export async function renderAndCompare(
  request: RenderCompareRequest,
): Promise<RenderCompareResult> {
  const {
    sourceImageData,
    families,
    recognizedText,
    weight = 400,
    italic = false,
    signal,
  } = request;

  const scores = new Map<string, number>();
  const details = new Map<string, RenderCompareScores>();
  const failedFamilies: string[] = [];

  const sourcePrep = prepareSource(sourceImageData);
  const text = recognizedText?.trim() || SAMPLE_TEXT_FALLBACK;

  for (const family of families) {
    if (signal?.aborted) break;

    try {
      const rendered = renderTextSample(family, text, weight, italic);
      const comparison = compareImages(sourcePrep, rendered);
      scores.set(family, comparison.compositeScore);
      details.set(family, comparison);
    } catch {
      failedFamilies.push(family);
    }
  }

  return { scores, details, failedFamilies };
}

// ---------------------------------------------------------------------------
// Source preparation
// ---------------------------------------------------------------------------

interface PreparedImage {
  mask: Uint8Array;
  width: number;
  height: number;
  strokeWidth: number;
  inkDensity: number;
}

function prepareSource(imageData: ImageData): PreparedImage {
  const { width, height, data } = imageData;
  const threshold = computeOtsuThreshold(data, width, height);

  const mask = new Uint8Array(width * height);
  let inkPixels = 0;

  for (let i = 0; i < width * height; i++) {
    const lum = data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114;
    if (lum < threshold) {
      mask[i] = 1;
      inkPixels++;
    }
  }

  const strokeWidth = estimateStrokeWidthFromMask(mask, width, height);

  return {
    mask,
    width,
    height,
    strokeWidth,
    inkDensity: inkPixels / (width * height),
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

function renderTextSample(
  family: string,
  text: string,
  weight: number,
  italic: boolean,
): PreparedImage {
  const canvas = createCanvas(RENDER_SIZE, RENDER_SIZE);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);

  const style = italic ? 'italic' : 'normal';
  const fontSize = computeRenderFontSize(ctx, text, family, weight);
  ctx.font = `${style} ${weight} ${fontSize}px "${family}", sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, RENDER_SIZE / 2, RENDER_SIZE / 2);

  const imageData = ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE);
  return prepareSource(imageData);
}

function computeRenderFontSize(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  family: string,
  weight: number,
): number {
  let min = 8;
  let max = RENDER_SIZE - 2 * RENDER_PADDING;
  let best = 24;

  while (min <= max) {
    const mid = Math.floor((min + max) / 2);
    ctx.font = `${weight} ${mid}px "${family}", sans-serif`;
    const metrics = ctx.measureText(text);

    if (metrics.width < RENDER_SIZE - 2 * RENDER_PADDING) {
      best = mid;
      min = mid + 1;
    } else {
      max = mid - 1;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Image comparison
// ---------------------------------------------------------------------------

function compareImages(source: PreparedImage, rendered: PreparedImage): RenderCompareScores {
  const targetW = 64;
  const targetH = 64;

  const sourceNorm = resizeMask(source.mask, source.width, source.height, targetW, targetH);
  const renderedNorm = resizeMask(rendered.mask, rendered.width, rendered.height, targetW, targetH);

  const silhouetteOverlap = computeIoU(sourceNorm, renderedNorm, targetW, targetH);
  const strokeWidthSimilarity = computeStrokeSimilarity(source.strokeWidth, rendered.strokeWidth);
  const charWidthRatio = computeWidthRatioSimilarity(sourceNorm, renderedNorm, targetW, targetH);
  const xHeightDelta = computeXHeightDelta(sourceNorm, renderedNorm, targetW, targetH);

  const compositeScore =
    silhouetteOverlap * 0.35 +
    strokeWidthSimilarity * 0.25 +
    (1 - Math.min(1, xHeightDelta)) * 0.2 +
    charWidthRatio * 0.2;

  return {
    silhouetteOverlap: round3(silhouetteOverlap),
    strokeWidthSimilarity: round3(strokeWidthSimilarity),
    xHeightDelta: round3(xHeightDelta),
    charWidthRatio: round3(charWidthRatio),
    compositeScore: round3(compositeScore),
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function computeIoU(a: Uint8Array, b: Uint8Array, width: number, height: number): number {
  let intersection = 0;
  let union = 0;

  for (let i = 0; i < width * height; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (ai && bi) intersection++;
    if (ai || bi) union++;
  }

  return union > 0 ? intersection / union : 0;
}

function computeStrokeSimilarity(source: number, rendered: number): number {
  if (source <= 0 || rendered <= 0) return 0;
  return Math.min(source, rendered) / Math.max(source, rendered);
}

function computeWidthRatioSimilarity(
  source: Uint8Array,
  rendered: Uint8Array,
  width: number,
  height: number,
): number {
  const sourceProfile = horizontalProjection(source, width, height);
  const renderedProfile = horizontalProjection(rendered, width, height);
  return cosineSimilarity(sourceProfile, renderedProfile);
}

function computeXHeightDelta(
  source: Uint8Array,
  rendered: Uint8Array,
  width: number,
  height: number,
): number {
  const sourceProfile = verticalProjection(source, width, height);
  const renderedProfile = verticalProjection(rendered, width, height);
  return 1 - cosineSimilarity(sourceProfile, renderedProfile);
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

function horizontalProjection(mask: Uint8Array, width: number, height: number): Float64Array {
  const profile = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      if (mask[y * width + x]) count++;
    }
    profile[x] = count;
  }
  return profile;
}

function verticalProjection(mask: Uint8Array, width: number, height: number): Float64Array {
  const profile = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) count++;
    }
    profile[y] = count;
  }
  return profile;
}

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Mask operations
// ---------------------------------------------------------------------------

function resizeMask(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.floor((x / dstW) * srcW);
      const srcY = Math.floor((y / dstH) * srcH);
      out[y * dstW + x] = mask[srcY * srcW + srcX]!;
    }
  }
  return out;
}

function estimateStrokeWidthFromMask(mask: Uint8Array, width: number, height: number): number {
  let totalWidth = 0;
  let count = 0;

  const step = Math.max(1, Math.floor(height / 10));
  for (let y = 0; y < height; y += step) {
    let inStroke = false;
    let strokeStart = 0;

    for (let x = 0; x < width; x++) {
      const isDark = mask[y * width + x];

      if (isDark && !inStroke) {
        inStroke = true;
        strokeStart = x;
      } else if (!isDark && inStroke) {
        inStroke = false;
        const w = x - strokeStart;
        if (w > 1 && w < width / 3) {
          totalWidth += w;
          count++;
        }
      }
    }
  }

  return count > 0 ? totalWidth / count : 1;
}

// ---------------------------------------------------------------------------
// Otsu's threshold
// ---------------------------------------------------------------------------

function computeOtsuThreshold(data: Uint8ClampedArray, width: number, height: number): number {
  const histogram = new Uint32Array(256);
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    const lum = Math.round(
      data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114,
    );
    histogram[lum] = (histogram[lum] ?? 0) + 1;
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i]!;
  }

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t]!;
    if (wB === 0) continue;

    const wF = pixelCount - wB;
    if (wF === 0) break;

    sumB += t * histogram[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
}

// ---------------------------------------------------------------------------
// Canvas utilities
// ---------------------------------------------------------------------------

function createCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  throw new Error('No canvas available');
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
