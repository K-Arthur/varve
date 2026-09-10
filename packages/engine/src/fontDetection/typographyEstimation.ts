/**
 * Typography feature estimation from text region images.
 *
 * Estimates supporting characteristics (serif, monospace, weight, italic, etc.)
 * from image statistics alone — no ML model needed.
 */

import type { QualityWarning, TypographyFeatures } from './fontDetectionTypes';

// ---------------------------------------------------------------------------
// Feature estimation
// ---------------------------------------------------------------------------

export function estimateTypographyFeatures(imageData: ImageData): TypographyFeatures {
  const { width, height, data } = imageData;

  const luminance = new Float32Array(width * height);
  let sumLum = 0;
  let minLum = 255;
  let maxLum = 0;

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    luminance[i] = lum;
    sumLum += lum;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  const meanLum = sumLum / (width * height);
  const contrast = maxLum - minLum;
  const strokeWidth = estimateStrokeWidth(luminance, width, height, meanLum);
  const xHeightRatio = estimateXHeightRatio(luminance, width, height, meanLum);
  const serif = detectSerifs(luminance, width, height, meanLum, strokeWidth);
  const monospace = detectMonospace(luminance, width, height, meanLum);
  const weightEstimate = estimateWeight(luminance, width, height, meanLum, strokeWidth);
  const italicAngle = estimateItalicAngle(luminance, width, height, meanLum);
  const category = determineCategory(serif, monospace, xHeightRatio);

  return {
    serif,
    monospace,
    weightEstimate,
    italicAngle,
    isItalic: Math.abs(italicAngle) > 5,
    xHeightRatio,
    contrast: contrast / 255,
    category,
  };
}

// ---------------------------------------------------------------------------
// Stroke width
// ---------------------------------------------------------------------------

function estimateStrokeWidth(
  luminance: Float32Array,
  width: number,
  height: number,
  threshold: number,
): number {
  let totalStrokeWidth = 0;
  let strokeCount = 0;

  const sampleRows = Math.max(3, Math.floor(height / 10));
  for (let s = 0; s < sampleRows; s++) {
    const y = Math.floor((height * (s + 0.5)) / sampleRows);
    let inStroke = false;
    let strokeStart = 0;

    for (let x = 0; x < width; x++) {
      const lum = luminance[y * width + x]!;
      const isDark = lum < threshold;

      if (isDark && !inStroke) {
        inStroke = true;
        strokeStart = x;
      } else if (!isDark && inStroke) {
        inStroke = false;
        const strokeWidth = x - strokeStart;
        if (strokeWidth > 1 && strokeWidth < width / 4) {
          totalStrokeWidth += strokeWidth;
          strokeCount++;
        }
      }
    }
  }

  return strokeCount > 0 ? totalStrokeWidth / strokeCount : 1;
}

// ---------------------------------------------------------------------------
// X-height ratio
// ---------------------------------------------------------------------------

function estimateXHeightRatio(
  luminance: Float32Array,
  width: number,
  height: number,
  threshold: number,
): number | null {
  if (height < 20) return null;

  let top = height;
  let bottom = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (luminance[y * width + x]! < threshold) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (bottom <= top) return null;
  return Math.min(1, (bottom - top) / height);
}

// ---------------------------------------------------------------------------
// Serif detection
// ---------------------------------------------------------------------------

function detectSerifs(
  luminance: Float32Array,
  width: number,
  height: number,
  threshold: number,
  strokeWidth: number,
): 'serif' | 'sans-serif' | 'unknown' {
  if (height < 20 || width < 20) return 'unknown';

  let serifCandidates = 0;
  let strokeEnds = 0;

  const sampleRows = Math.max(3, Math.floor(height / 8));
  for (let s = 0; s < sampleRows; s++) {
    const y = Math.floor((height * (s + 0.5)) / sampleRows);
    let inStroke = false;
    let strokeStart = 0;

    for (let x = 1; x < width - 1; x++) {
      const lum = luminance[y * width + x]!;
      const isDark = lum < threshold;

      if (isDark && !inStroke) {
        inStroke = true;
        strokeStart = x;
      } else if (!isDark && inStroke) {
        inStroke = false;
        strokeEnds++;
        const strokeLen = x - strokeStart;
        if (strokeLen > 2) {
          const midX = strokeStart + Math.floor(strokeLen / 2);
          const midDark = isVerticalDark(luminance, width, height, midX, y, threshold);
          const endDark = isVerticalDark(luminance, width, height, x - 1, y, threshold);
          if (endDark && midDark && strokeWidth > 2) {
            serifCandidates++;
          }
        }
      }
    }
  }

  if (strokeEnds < 4) return 'unknown';
  const ratio = serifCandidates / strokeEnds;
  return ratio > 0.3 ? 'serif' : 'sans-serif';
}

function isVerticalDark(
  luminance: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  threshold: number,
): boolean {
  for (let dy = -2; dy <= 2; dy++) {
    const ny = y + dy;
    if (ny >= 0 && ny < height && x >= 0 && x < width) {
      if (luminance[ny * width + x]! < threshold) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Monospace detection
// ---------------------------------------------------------------------------

function detectMonospace(
  luminance: Float32Array,
  width: number,
  height: number,
  threshold: number,
): boolean | null {
  if (width < 40) return null;

  const columnDarkCount = new Uint32Array(width);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      if (luminance[y * width + x]! < threshold) count++;
    }
    columnDarkCount[x] = count;
  }

  const gapThreshold = height * 0.05;
  const gaps: number[] = [];
  for (let x = 0; x < width; x++) {
    if (columnDarkCount[x]! < gapThreshold) gaps.push(x);
  }

  if (gaps.length < 3) return null;

  const spacings: number[] = [];
  for (let i = 1; i < gaps.length; i++) {
    spacings.push(gaps[i]! - gaps[i - 1]!);
  }

  if (spacings.length < 2) return null;

  const mean = spacings.reduce((a, b) => a + b, 0) / spacings.length;
  const variance = spacings.reduce((sum, s) => sum + (s - mean) ** 2, 0) / spacings.length;
  const cv = Math.sqrt(variance) / mean;

  return cv < 0.3;
}

// ---------------------------------------------------------------------------
// Weight estimation
// ---------------------------------------------------------------------------

function estimateWeight(
  luminance: Float32Array,
  width: number,
  height: number,
  threshold: number,
  strokeWidth: number,
): number {
  let darkPixels = 0;
  for (let i = 0; i < width * height; i++) {
    if (luminance[i]! < threshold) darkPixels++;
  }

  const inkDensity = darkPixels / (width * height);
  const baseWeight = 100 + inkDensity * 800 + (strokeWidth - 1) * 80;
  return Math.max(100, Math.min(900, Math.round(baseWeight / 50) * 50));
}

// ---------------------------------------------------------------------------
// Italic angle
// ---------------------------------------------------------------------------

function estimateItalicAngle(
  luminance: Float32Array,
  width: number,
  height: number,
  threshold: number,
): number {
  if (height < 20 || width < 20) return 0;

  const rightEdges: Array<{ y: number; x: number }> = [];

  for (let y = 0; y < height; y++) {
    let rightmost = -1;
    for (let x = width - 1; x >= 0; x--) {
      if (luminance[y * width + x]! < threshold) {
        rightmost = x;
        break;
      }
    }
    if (rightmost >= 0) rightEdges.push({ y, x: rightmost });
  }

  if (rightEdges.length < 10) return 0;

  const n = rightEdges.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const { x, y } of rightEdges) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1) return 0;

  const slope = (n * sumXY - sumX * sumY) / denom;
  return Math.atan(slope) * (180 / Math.PI);
}

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

function determineCategory(
  serif: 'serif' | 'sans-serif' | 'unknown',
  monospace: boolean | null,
  xHeightRatio: number | null,
): 'body' | 'display' | 'script' | 'monospace' | 'unknown' {
  if (monospace) return 'monospace';
  if (xHeightRatio !== null && xHeightRatio > 0.7) return 'display';
  if (serif !== 'unknown') return 'body';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Quality warnings
// ---------------------------------------------------------------------------

export function generateQualityWarnings(imageData: ImageData, quality: number): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const { width, height } = imageData;

  if (Math.min(width, height) < 20) {
    warnings.push({
      code: 'crop-too-small',
      message: 'Text region is very small. Results may be unreliable.',
    });
  } else if (Math.min(width, height) < 40) {
    warnings.push({
      code: 'low-resolution',
      message: 'Low resolution crop. Consider a tighter, higher-quality capture.',
    });
  }

  if (quality < 0.3) {
    warnings.push({
      code: 'low-contrast',
      message: 'Low contrast between text and background. Results may be unreliable.',
    });
  }

  return warnings;
}
