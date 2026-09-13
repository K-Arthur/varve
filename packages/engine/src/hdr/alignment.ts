import { createRangeRaster } from '@varve/shared';
import {
  type HdrAlignmentOptions,
  type HdrAlignmentResult,
  type HdrDeghostOptions,
  type HdrDeghostResult,
  type HdrFrame,
  type HdrFrameTransform,
  HdrProcessingError,
} from './types';

const DEFAULT_PROXY_MAX_DIMENSION = 512;
const DEFAULT_MAX_TRANSLATION = 32;
const MAX_ALIGNMENT_INPUT_PIXELS = 64_000_000;
const MAX_PROXY_TRANSLATION = 12;
const RENDERED_MOTION_LOG_FLOOR = 0.35;
const RENDERED_MOTION_NEIGHBOR_SUPPORT = 2;

/**
 * Bounded exposure-robust translation alignment. The output coordinate system
 * is the selected reference frame; uncovered borders are alpha-zero coverage,
 * never black scene radiance. Perspective, rotation, rolling shutter, focus
 * breathing, and parallax are deliberately reported as unsupported warnings.
 */
export function alignBracketFrames(
  frames: readonly HdrFrame[],
  options: HdrAlignmentOptions,
): HdrAlignmentResult {
  validateAlignmentInputs(frames, options.referenceIndex);
  const first = frames[0]!.raster.contract;
  if (first.width * first.height > MAX_ALIGNMENT_INPUT_PIXELS) {
    throw new HdrProcessingError(
      `alignment input exceeds ${MAX_ALIGNMENT_INPUT_PIXELS.toLocaleString()} pixels`,
    );
  }
  const maxTranslation = options.maxTranslationPx ?? DEFAULT_MAX_TRANSLATION;
  const proxyMaxDimension = options.proxyMaxDimension ?? DEFAULT_PROXY_MAX_DIMENSION;
  if (!Number.isInteger(maxTranslation) || maxTranslation < 0 || maxTranslation > 256) {
    throw new HdrProcessingError('maxTranslationPx must be an integer from 0 through 256');
  }
  if (!Number.isInteger(proxyMaxDimension) || proxyMaxDimension < 32 || proxyMaxDimension > 2048) {
    throw new HdrProcessingError('proxyMaxDimension must be an integer from 32 through 2048');
  }

  const scale = Math.max(1, Math.ceil(Math.max(first.width, first.height) / proxyMaxDimension));
  const proxyWidth = Math.ceil(first.width / scale);
  const proxyHeight = Math.ceil(first.height / scale);
  const reference = frames[options.referenceIndex]!;
  const referenceLuma = buildNormalizedLuma(reference, scale);
  const transforms: HdrFrameTransform[] = [];
  const alignedFrames: HdrFrame[] = [];
  const warnings = [
    'alignment currently supports translation only; inspect rotation, parallax, and rolling-shutter motion before accepting',
  ];

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]!;
    const coverage = new Uint8Array(first.width * first.height);
    let dx = 0;
    let dy = 0;
    let score = 0;
    if (index === options.referenceIndex) {
      coverage.fill(1);
    } else {
      const candidateLuma = buildNormalizedLuma(frame, scale);
      const requestedProxyTranslation = Math.floor(maxTranslation / scale);
      const proxyTranslation = Math.min(MAX_PROXY_TRANSLATION, requestedProxyTranslation);
      const match = searchTranslation(
        referenceLuma,
        candidateLuma,
        proxyWidth,
        proxyHeight,
        proxyTranslation,
      );
      dx = match.dx * scale;
      dy = match.dy * scale;
      score = match.score;
      fillTranslationCoverage(coverage, first.width, first.height, dx, dy);
      if (score > 0.15) {
        warnings.push(`frame ${index + 1} has a weak translation match (${score.toFixed(3)})`);
      }
      if (proxyTranslation < requestedProxyTranslation) {
        warnings.push(
          `frame ${index + 1} alignment search was bounded to ${MAX_PROXY_TRANSLATION} proxy pixels`,
        );
      }
    }
    const raster = translateRaster(frame, dx, dy, coverage);
    alignedFrames.push({ ...frame, raster });
    transforms.push({ dx, dy, score, coverage });
  }
  return { frames: alignedFrames, transforms, warnings };
}

/**
 * Conservative reference-based deghosting. The chosen reference is always
 * retained; divergent non-reference samples are excluded from the merge. The
 * result is a mask, not an invented replacement image, so the caller can show
 * and override the decision before committing a master.
 */
export function buildDeghostMasks(
  frames: readonly HdrFrame[],
  options: HdrDeghostOptions,
): HdrDeghostResult {
  validateAlignmentInputs(frames, options.referenceIndex);
  const threshold = options.differenceThreshold ?? 0.2;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new HdrProcessingError('differenceThreshold must be in (0, 1]');
  }
  const first = frames[0]!.raster.contract;
  const reference = frames[options.referenceIndex]!;
  const normalization = options.normalization ?? 'metadata';
  const referenceExposure = positiveExposure(reference);
  const validMasks = frames.map((frame) => {
    const mask = new Uint8Array(first.width * first.height);
    if (normalization === 'rendered-local-contrast' && frame !== reference) {
      return buildRenderedMotionMask(mask, frame, reference, threshold);
    }
    const referenceScale = 1 / referenceExposure;
    const frameScale = normalization === 'metadata' ? 1 / positiveExposure(frame) : 1;
    for (let y = 0; y < first.height; y++) {
      for (let x = 0; x < first.width; x++) {
        const index = y * first.width + x;
        const pixel = y * first.stride + x * 4;
        const alpha = frame.raster.pixels[pixel + 3]!;
        mask[index] = Number.isFinite(alpha) && alpha > 0 ? 1 : 0;
        if (mask[index] === 0 || frame === reference) continue;
        const referencePixel = y * reference.raster.contract.stride + x * 4;
        let difference = 0;
        let compared = false;
        for (let channel = 0; channel < 3; channel++) {
          const source = frame.raster.pixels[pixel + channel]! * frameScale;
          const target = reference.raster.pixels[referencePixel + channel]! * referenceScale;
          if (!Number.isFinite(source) || !Number.isFinite(target)) continue;
          const denominator = Math.max(0.01, Math.abs(target));
          difference = Math.max(difference, Math.abs(source - target) / denominator);
          compared = true;
        }
        if (compared && difference > threshold) mask[index] = 0;
      }
    }
    return mask;
  });
  const movingPixels = validMasks.reduce((total, mask, index) => {
    if (index === options.referenceIndex) return total;
    return total + mask.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
  }, 0);
  return {
    validMasks,
    movingPixels,
    warnings: [
      'deghosting excludes divergent non-reference samples; it does not reconstruct hidden motion detail',
      ...(normalization === 'rendered-local-contrast'
        ? [
            'rendered-input deghosting used an exposure-relative local-contrast and spatial consistency check; it is not camera response calibration',
          ]
        : []),
      ...(movingPixels > 0
        ? [`${movingPixels} non-reference samples were marked as motion candidates`]
        : []),
    ],
  };
}

function validateAlignmentInputs(frames: readonly HdrFrame[], referenceIndex: number): void {
  if (frames.length < 2) throw new HdrProcessingError('alignment requires at least two frames');
  if (!Number.isInteger(referenceIndex) || referenceIndex < 0 || referenceIndex >= frames.length) {
    throw new HdrProcessingError('referenceIndex must identify one reviewed frame');
  }
  const first = frames[0]!.raster.contract;
  if (first.width <= 0 || first.height <= 0)
    throw new HdrProcessingError('frame dimensions are invalid');
  for (const [index, frame] of frames.entries()) {
    const contract = frame.raster.contract;
    if (contract.width !== first.width || contract.height !== first.height) {
      throw new HdrProcessingError(`frame ${index + 1} dimensions do not match the reference`);
    }
  }
}

function buildNormalizedLuma(frame: HdrFrame, scale: number): Float32Array {
  const { width, height, stride } = frame.raster.contract;
  const proxyWidth = Math.ceil(width / scale);
  const proxyHeight = Math.ceil(height / scale);
  const result = new Float32Array(proxyWidth * proxyHeight);
  let total = 0;
  let count = 0;
  for (let y = 0; y < proxyHeight; y++) {
    for (let x = 0; x < proxyWidth; x++) {
      const sourceX = Math.min(width - 1, x * scale);
      const sourceY = Math.min(height - 1, y * scale);
      const offset = sourceY * stride + sourceX * 4;
      const red = Math.max(0, frame.raster.pixels[offset]!);
      const green = Math.max(0, frame.raster.pixels[offset + 1]!);
      const blue = Math.max(0, frame.raster.pixels[offset + 2]!);
      const luma = Math.max(1e-5, red * 0.2126 + green * 0.7152 + blue * 0.0722);
      result[y * proxyWidth + x] = Math.log(luma);
      total += luma;
      count++;
    }
  }
  const mean = Math.log(Math.max(1e-5, total / Math.max(1, count)));
  for (let index = 0; index < result.length; index++) result[index] = result[index]! - mean;
  return result;
}

function searchTranslation(
  reference: Float32Array,
  candidate: Float32Array,
  width: number,
  height: number,
  maxTranslation: number,
): { dx: number; dy: number; score: number } {
  let best = { dx: 0, dy: 0, score: Number.POSITIVE_INFINITY };
  for (let dy = -maxTranslation; dy <= maxTranslation; dy++) {
    for (let dx = -maxTranslation; dx <= maxTranslation; dx++) {
      let sum = 0;
      let count = 0;
      for (let y = Math.max(0, -dy); y < Math.min(height, height - dy); y++) {
        for (let x = Math.max(0, -dx); x < Math.min(width, width - dx); x++) {
          const a = reference[y * width + x]!;
          const b = candidate[(y + dy) * width + (x + dx)]!;
          const difference = a - b;
          sum += difference * difference;
          count++;
        }
      }
      if (count === 0) continue;
      const score = sum / count;
      if (
        score < best.score ||
        (score === best.score &&
          Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))
      ) {
        best = { dx, dy, score };
      }
    }
  }
  return best;
}

function translateRaster(frame: HdrFrame, dx: number, dy: number, coverage: Uint8Array) {
  const input = frame.raster;
  const { width, height, stride } = input.contract;
  const output = createRangeRaster(
    { ...input.contract, stride: width * 4 },
    new Float32Array(width * height * 4),
  );
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const targetIndex = (y * width + x) * 4;
      if (coverage[y * width + x] === 0) {
        output.pixels[targetIndex + 3] = 0;
        continue;
      }
      const sourceX = x + dx;
      const sourceY = y + dy;
      const sourceIndex = sourceY * stride + sourceX * 4;
      output.pixels[targetIndex] = input.pixels[sourceIndex]!;
      output.pixels[targetIndex + 1] = input.pixels[sourceIndex + 1]!;
      output.pixels[targetIndex + 2] = input.pixels[sourceIndex + 2]!;
      output.pixels[targetIndex + 3] = input.pixels[sourceIndex + 3]!;
    }
  }
  return output;
}

function fillTranslationCoverage(
  mask: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): void {
  for (let y = Math.max(0, -dy); y < Math.min(height, height - dy); y++) {
    for (let x = Math.max(0, -dx); x < Math.min(width, width - dx); x++) {
      mask[y * width + x] = 1;
    }
  }
}

function positiveExposure(frame: HdrFrame): number {
  return Number.isFinite(frame.exposureTimeSeconds) && frame.exposureTimeSeconds! > 0
    ? frame.exposureTimeSeconds!
    : 1;
}

function buildRenderedMotionMask(
  mask: Uint8Array,
  frame: HdrFrame,
  reference: HdrFrame,
  threshold: number,
): Uint8Array {
  const { width, height, stride } = frame.raster.contract;
  const candidates = new Uint8Array(width * height);
  const minimumLogDifference = Math.max(RENDERED_MOTION_LOG_FLOOR, threshold);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const pixel = y * stride + x * 4;
      const alpha = frame.raster.pixels[pixel + 3]!;
      mask[index] = Number.isFinite(alpha) && alpha > 0 ? 1 : 0;
      if (mask[index] === 0) continue;
      const referencePixel = y * reference.raster.contract.stride + x * 4;
      const sourceLuma = luminance(frame.raster.pixels, pixel);
      const targetLuma = luminance(reference.raster.pixels, referencePixel);
      if (
        !Number.isFinite(sourceLuma) ||
        !Number.isFinite(targetLuma) ||
        sourceLuma <= 0.003 ||
        targetLuma <= 0.003 ||
        sourceLuma >= 0.995 ||
        targetLuma >= 0.995
      ) {
        continue;
      }
      const sourceFeature = localContrastFeature(frame, x, y);
      const targetFeature = localContrastFeature(reference, x, y);
      const residual = Math.abs(sourceFeature - targetFeature);
      if (residual > minimumLogDifference) candidates[index] = 1;
    }
  }

  // A response mismatch caused by quantisation/noise is commonly isolated.
  // Require local support before excluding a sample; real subject movement
  // generally produces a contiguous edge or region. Border coverage remains
  // valid unless the decoder/alignment already marked it unavailable.
  for (let y = 1; y + 1 < height; y++) {
    for (let x = 1; x + 1 < width; x++) {
      const index = y * width + x;
      if (candidates[index] === 0) continue;
      let support = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (offsetX === 0 && offsetY === 0) continue;
          support += candidates[(y + offsetY) * width + x + offsetX]!;
        }
      }
      if (support >= RENDERED_MOTION_NEIGHBOR_SUPPORT) mask[index] = 0;
    }
  }
  return mask;
}

function localContrastFeature(frame: HdrFrame, x: number, y: number): number {
  const { width, height } = frame.raster.contract;
  const centerX = Math.max(0, Math.min(width - 1, x));
  const centerY = Math.max(0, Math.min(height - 1, y));
  const center = logLuminanceAt(frame, centerX, centerY);
  const neighborhood =
    center +
    logLuminanceAt(frame, centerX - 1, centerY) +
    logLuminanceAt(frame, centerX + 1, centerY) +
    logLuminanceAt(frame, centerX, centerY - 1) +
    logLuminanceAt(frame, centerX, centerY + 1);
  return center - neighborhood / 5;
}

function logLuminanceAt(frame: HdrFrame, x: number, y: number): number {
  const { width, height, stride } = frame.raster.contract;
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  return Math.log(Math.max(1e-4, luminance(frame.raster.pixels, clampedY * stride + clampedX * 4)));
}

function luminance(pixels: Float32Array, offset: number): number {
  return Math.max(
    0,
    pixels[offset]! * 0.2126 + pixels[offset + 1]! * 0.7152 + pixels[offset + 2]! * 0.0722,
  );
}
