/**
 * Orientation detection for OCR preprocessing.
 *
 * Uses a heuristic approach based on text region analysis rather than a
 * dedicated cls model: after detection, we analyze the aspect ratios and
 * distribution of detected text regions to determine the correct orientation.
 *
 * If detection finds mostly wide regions (width >> height), the image is
 * likely upright. If it finds mostly tall regions (height >> width), the
 * image is likely rotated 90 or 270 degrees.
 *
 * Falls back to a simple histogram-of-gradients approach when detection
 * yields too few regions.
 *
 * Research basis: PaddleOCR orientation classification, Tesseract OSD.
 */
import type { OrientationResult } from './types';

/**
 * Minimum aspect ratio for a region to be considered "wide" (text-like
 * in normal orientation).
 */
const WIDE_ASPECT_THRESHOLD = 1.5;

/**
 * Minimum aspect ratio for a region to be considered "tall" (text-like
 * when rotated 90 degrees).
 */
const TALL_ASPECT_THRESHOLD = 0.67;

/**
 * Minimum number of regions needed for the region-based heuristic.
 * Below this, fall back to the gradient-based approach.
 */
const MIN_REGIONS_FOR_HEURISTIC = 3;

/**
 * Detect the orientation of text in an image using analysis of detected
 * text region shapes and distribution.
 *
 * @param regions - Detected text regions (x, y, width, height in pixels).
 * @param imageWidth - Width of the source image.
 * @param imageHeight - Height of the source image.
 * @returns Detected orientation with confidence.
 */
export function detectOrientationFromRegions(
  regions: ReadonlyArray<{ width: number; height: number; x: number; y: number }>,
  imageWidth: number,
  imageHeight: number,
): OrientationResult {
  if (regions.length === 0) {
    return { angle: 0, confidence: 0 };
  }

  let wideCount = 0;
  let tallCount = 0;
  let topHeavy = 0;
  let bottomHeavy = 0;
  let leftHeavy = 0;
  let rightHeavy = 0;

  const midY = imageHeight / 2;
  const midX = imageWidth / 2;

  for (const r of regions) {
    if (r.width <= 0 || r.height <= 0) continue;

    const aspect = r.width / r.height;
    if (aspect >= WIDE_ASPECT_THRESHOLD) {
      wideCount++;
    } else if (aspect <= TALL_ASPECT_THRESHOLD) {
      tallCount++;
    }

    // Distribution analysis
    const centerY = r.y + r.height / 2;
    const centerX = r.x + r.width / 2;
    if (centerY < midY) topHeavy++;
    else bottomHeavy++;
    if (centerX < midX) leftHeavy++;
    else rightHeavy++;
  }

  const total = regions.length;
  const wideRatio = total > 0 ? wideCount / total : 0;
  const tallRatio = total > 0 ? tallCount / total : 0;

  // If not enough regions, fall back to gradient-based analysis
  if (total < MIN_REGIONS_FOR_HEURISTIC) {
    return { angle: 0, confidence: 0.1 };
  }

  // Most regions are wide → image is likely upright (0°)
  if (wideRatio > 0.5 && tallRatio < 0.2) {
    return { angle: 0, confidence: Math.min(0.9, 0.5 + wideRatio * 0.4) };
  }

  // Most regions are tall → image is rotated 90° or 270°
  if (tallRatio > 0.5 && wideRatio < 0.2) {
    // Determine between 90° and 270° by distribution
    if (leftHeavy > rightHeavy * 1.5) {
      return { angle: 90, confidence: Math.min(0.85, 0.5 + tallRatio * 0.35) };
    }
    if (rightHeavy > leftHeavy * 1.5) {
      return { angle: 270, confidence: Math.min(0.85, 0.5 + tallRatio * 0.35) };
    }
    // Default to 90° if distribution is ambiguous
    return { angle: 90, confidence: Math.min(0.7, 0.4 + tallRatio * 0.3) };
  }

  // Mixed or ambiguous: use distribution-based fallback
  if (topHeavy > bottomHeavy * 2) {
    // Text concentrated at the top is normal for 0°
    return { angle: 0, confidence: 0.5 };
  }
  if (bottomHeavy > topHeavy * 2) {
    // Text concentrated at the bottom may indicate 180° rotation
    return { angle: 180, confidence: 0.4 };
  }

  return { angle: 0, confidence: 0.3 };
}

/**
 * Detect orientation from raw pixel data using gradient histogram analysis.
 * This is a fallback when text region analysis produces too few regions.
 *
 * Analyzes the distribution of strong edges in 4 directions to estimate
 * the dominant text orientation.
 */
export function detectOrientationFromPixels(imageData: ImageData): OrientationResult {
  const { width, height, data } = imageData;
  const gray = new Float32Array(width * height);

  // Convert to grayscale
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!;
  }

  // Compute horizontal and vertical gradient magnitudes
  let horizontalStrength = 0;
  let verticalStrength = 0;
  let sampleCount = 0;

  const step = Math.max(1, Math.floor(Math.max(width, height) / 200));

  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const idx = y * width + x;
      const gx = gray[idx + 1]! - gray[idx - 1]!;
      const gy = gray[idx + width]! - gray[idx - width]!;
      horizontalStrength += Math.abs(gx);
      verticalStrength += Math.abs(gy);
      sampleCount++;
    }
  }

  if (sampleCount === 0) return { angle: 0, confidence: 0 };

  const hNorm = horizontalStrength / sampleCount;
  const vNorm = verticalStrength / sampleCount;

  // Text typically has stronger vertical edges (stroke edges) in upright orientation
  // But horizontal edges from text baselines are also common.
  // If horizontal gradients dominate, the image may be rotated 90°.
  const ratio = hNorm > 0 ? vNorm / hNorm : 0;

  if (ratio > 1.8) {
    return { angle: 0, confidence: Math.min(0.6, 0.3 + ratio * 0.1) };
  }
  if (ratio < 0.5) {
    return { angle: 90, confidence: Math.min(0.5, 0.3 + (1 - ratio) * 0.2) };
  }

  return { angle: 0, confidence: 0.2 };
}

/**
 * Rotate an ImageData by 90, 180, or 270 degrees.
 */
export function rotateImageData(source: ImageData, angle: 0 | 90 | 180 | 270): ImageData {
  if (angle === 0) return source;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  if (angle === 180) {
    canvas.width = source.width;
    canvas.height = source.height;
    ctx.translate(source.width, source.height);
    ctx.rotate(Math.PI);
  } else {
    canvas.width = source.height;
    canvas.height = source.width;
    ctx.translate(angle === 90 ? source.height : 0, angle === 270 ? source.width : 0);
    ctx.rotate((angle * Math.PI) / 180);
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = source.width;
  tempCanvas.height = source.height;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.putImageData(source, 0, 0);

  ctx.drawImage(tempCanvas, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Map coordinates back through a rotation. Given a point in the rotated
 * image, return its coordinates in the original (pre-rotation) image.
 */
export function mapCoordsThroughRotation(
  x: number,
  y: number,
  width: number,
  height: number,
  origWidth: number,
  origHeight: number,
  angle: 0 | 90 | 180 | 270,
): { x: number; y: number; width: number; height: number } {
  switch (angle) {
    case 0:
      return { x, y, width, height };
    case 90:
      return {
        x: origWidth - y - height,
        y: x,
        width: height,
        height: width,
      };
    case 180:
      return {
        x: origWidth - x - width,
        y: origHeight - y - height,
        width,
        height,
      };
    case 270:
      return {
        x: y,
        y: origHeight - x - width,
        width: height,
        height: width,
      };
  }
}
