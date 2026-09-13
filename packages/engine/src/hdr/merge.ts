import {
  createRangeRaster,
  type RangeRaster,
  type RangeRasterContract,
  sanitizeRangeRasterInPlace,
} from '@varve/shared';
import {
  type HdrFrame,
  type HdrMergeOptions,
  type HdrMergeResult,
  HdrProcessingError,
} from './types';

const MAX_BRACKET_FRAMES = 12;

/**
 * Reconstruct scene-linear radiance from consistently developed linear
 * captures. This intentionally requires exposure times: adjacent filenames,
 * timestamps, or a single-image tone-map are not a radiance calibration.
 */
export function mergeRadianceBracket(
  frames: readonly HdrFrame[],
  options: HdrMergeOptions,
): HdrMergeResult {
  validateFrames(frames, 'radiance');
  const missingExposureValues = frames.filter(
    (frame) => !Number.isFinite(frame.exposureTimeSeconds) || frame.exposureTimeSeconds! <= 0,
  ).length;
  if (missingExposureValues > 0) {
    throw new HdrProcessingError(
      `${missingExposureValues} bracket frame(s) lack a positive exposure time; provide values explicitly`,
    );
  }
  if (
    !Number.isInteger(options.referenceIndex) ||
    options.referenceIndex < 0 ||
    options.referenceIndex >= frames.length
  ) {
    throw new HdrProcessingError('referenceIndex must identify one selected bracket frame');
  }
  const first = frames[0]!.raster;
  const saturationThreshold = options.saturationThreshold ?? 0.995;
  const minimumWeight = options.minimumWeight ?? 1e-5;
  if (
    !Number.isFinite(saturationThreshold) ||
    saturationThreshold <= 0 ||
    saturationThreshold > 1
  ) {
    throw new HdrProcessingError('saturationThreshold must be in (0, 1]');
  }
  if (!Number.isFinite(minimumWeight) || minimumWeight < 0) {
    throw new HdrProcessingError('minimumWeight must be non-negative');
  }
  if (options.validMasks && options.validMasks.length !== frames.length) {
    throw new HdrProcessingError('validMasks must provide one mask for every frame');
  }
  validateMaskLengths(options.validMasks, first.contract.width * first.contract.height);

  const raster = createRangeRaster(makeOutputContract(first, 'hdr-radiance'));
  const validMask = new Uint8Array(first.contract.width * first.contract.height);
  let invalidPixels = 0;
  let saturatedSamples = 0;

  for (let y = 0; y < first.contract.height; y++) {
    for (let x = 0; x < first.contract.width; x++) {
      const outputIndex = (y * first.contract.width + x) * 4;
      let anyValid = false;
      for (let channel = 0; channel < 3; channel++) {
        let weightedRadiance = 0;
        let totalWeight = 0;
        for (const [frameIndex, frame] of frames.entries()) {
          const inputIndex = y * frame.raster.contract.stride + x * 4;
          if (options.validMasks?.[frameIndex]?.[y * first.contract.width + x] === 0) continue;
          const value = frame.raster.pixels[inputIndex + channel]!;
          const alpha = frame.raster.pixels[inputIndex + 3]!;
          if (!Number.isFinite(value) || !Number.isFinite(alpha) || alpha <= 0 || value < 0)
            continue;
          if (value >= saturationThreshold) {
            saturatedSamples++;
            continue;
          }
          const weight = alpha * radianceSampleWeight(value, saturationThreshold);
          if (weight <= minimumWeight) continue;
          weightedRadiance += (value / frame.exposureTimeSeconds!) * weight;
          totalWeight += weight;
        }
        if (totalWeight > minimumWeight) {
          raster.pixels[outputIndex + channel] = weightedRadiance / totalWeight;
          anyValid = true;
        } else {
          raster.pixels[outputIndex + channel] = 0;
        }
      }
      raster.pixels[outputIndex + 3] = anyValid ? 1 : 0;
      if (anyValid) validMask[y * first.contract.width + x] = 1;
      else invalidPixels++;
    }
  }
  const sanitization = sanitizeRangeRasterInPlace(raster);
  const warnings: string[] = [];
  if (saturatedSamples > 0) {
    warnings.push(`${saturatedSamples} sensor-channel samples were excluded as clipped`);
  }
  if (sanitization.replacedNonFinite > 0) {
    warnings.push('non-finite merge output was replaced at the processing boundary');
  }
  if (invalidPixels > 0) warnings.push(`${invalidPixels} pixels have no valid exposure coverage`);
  return {
    raster,
    validMask,
    diagnostics: {
      method: 'radiance',
      frameCount: frames.length,
      invalidPixels,
      saturatedSamples,
      missingExposureValues: 0,
      warnings,
    },
  };
}

/**
 * Display-referred exposure fusion. Unlike mergeRadianceBracket, this does
 * not use exposure times and must not be described as recovered scene
 * radiance. Inputs must already be linearized display values in [0, 1].
 */
export function fuseDisplayBracket(
  frames: readonly HdrFrame[],
  options: Pick<HdrMergeOptions, 'referenceIndex' | 'validMasks'> = { referenceIndex: 0 },
): HdrMergeResult {
  validateFrames(frames, 'exposure-fusion');
  const first = frames[0]!.raster;
  if (frames.some((frame) => frame.raster.contract.reference === 'scene-linear')) {
    throw new HdrProcessingError(
      'exposure fusion expects display-referred inputs; use radiance merging for scene-linear captures',
    );
  }
  if (
    !Number.isInteger(options.referenceIndex) ||
    options.referenceIndex < 0 ||
    options.referenceIndex >= frames.length
  ) {
    throw new HdrProcessingError('referenceIndex must identify one selected bracket frame');
  }
  if (options.validMasks && options.validMasks.length !== frames.length) {
    throw new HdrProcessingError('validMasks must provide one mask for every frame');
  }
  validateMaskLengths(options.validMasks, first.contract.width * first.contract.height);
  const raster = createRangeRaster(
    makeOutputContract(first, 'hdr-exposure-fusion', 'display-linear'),
  );
  const validMask = new Uint8Array(first.contract.width * first.contract.height);
  let invalidPixels = 0;

  for (let y = 0; y < first.contract.height; y++) {
    for (let x = 0; x < first.contract.width; x++) {
      const outputIndex = (y * first.contract.width + x) * 4;
      let totalWeight = 0;
      for (const [frameIndex, frame] of frames.entries()) {
        const inputIndex = y * frame.raster.contract.stride + x * 4;
        if (options.validMasks?.[frameIndex]?.[y * first.contract.width + x] === 0) continue;
        const alpha = frame.raster.pixels[inputIndex + 3]!;
        const red = frame.raster.pixels[inputIndex]!;
        const green = frame.raster.pixels[inputIndex + 1]!;
        const blue = frame.raster.pixels[inputIndex + 2]!;
        if (!Number.isFinite(alpha) || alpha <= 0) continue;
        if (![red, green, blue].every((value) => Number.isFinite(value))) continue;
        const luminance = Math.max(0, Math.min(1, red * 0.2126 + green * 0.7152 + blue * 0.0722));
        const wellExposed = Math.exp(-((luminance - 0.5) ** 2) / (2 * 0.2 ** 2));
        const weight = Math.max(1e-4, alpha * wellExposed);
        for (let channel = 0; channel < 3; channel++) {
          raster.pixels[outputIndex + channel] =
            raster.pixels[outputIndex + channel]! +
            frame.raster.pixels[inputIndex + channel]! * weight;
        }
        totalWeight += weight;
      }
      if (totalWeight > 0) {
        for (let channel = 0; channel < 3; channel++) {
          raster.pixels[outputIndex + channel] =
            raster.pixels[outputIndex + channel]! / totalWeight;
        }
        raster.pixels[outputIndex + 3] = 1;
        validMask[y * first.contract.width + x] = 1;
      } else {
        invalidPixels++;
      }
    }
  }
  sanitizeRangeRasterInPlace(raster, { maxAbsRgb: 1 });
  return {
    raster,
    validMask,
    diagnostics: {
      method: 'exposure-fusion',
      frameCount: frames.length,
      invalidPixels,
      saturatedSamples: 0,
      missingExposureValues: 0,
      warnings: [
        'display-referred exposure fusion does not reconstruct calibrated scene radiance',
        ...(invalidPixels > 0 ? [`${invalidPixels} pixels have no valid exposure coverage`] : []),
      ],
    },
  };
}

function validateFrames(frames: readonly HdrFrame[], method: 'radiance' | 'exposure-fusion'): void {
  if (frames.length < 2)
    throw new HdrProcessingError(`${method} requires at least two reviewed frames`);
  if (frames.length > MAX_BRACKET_FRAMES) {
    throw new HdrProcessingError(
      `bracket frame count exceeds the ${MAX_BRACKET_FRAMES}-frame safety limit`,
    );
  }
  const first = frames[0]!.raster.contract;
  if (first.width <= 0 || first.height <= 0)
    throw new HdrProcessingError('bracket dimensions must be positive');
  if (first.encoding.model !== 'rgb' && first.encoding.model !== 'gray') {
    throw new HdrProcessingError('bracket input must declare RGB or gray channel semantics');
  }
  if (method === 'radiance' && first.encoding.transfer !== 'linear') {
    throw new HdrProcessingError(
      'radiance merging requires consistently developed linear input; encoded JPEG values are not sensor radiance',
    );
  }
  for (const [index, frame] of frames.entries()) {
    const contract = frame.raster.contract;
    if (contract.width !== first.width || contract.height !== first.height) {
      throw new HdrProcessingError(
        `frame ${index + 1} dimensions do not match the reviewed bracket`,
      );
    }
    if (contract.channelLayout !== 'rgba')
      throw new HdrProcessingError(`frame ${index + 1} is not RGBA`);
    if (contract.encoding.model !== first.encoding.model) {
      throw new HdrProcessingError(`frame ${index + 1} has different channel semantics`);
    }
    if (contract.encoding.transfer !== first.encoding.transfer) {
      throw new HdrProcessingError(`frame ${index + 1} has a different transfer function`);
    }
    if (
      contract.encoding.primaries !== first.encoding.primaries ||
      contract.encoding.provenance !== first.encoding.provenance ||
      contract.reference !== first.reference ||
      Math.abs(contract.referenceWhite - first.referenceWhite) > 1e-6
    ) {
      throw new HdrProcessingError(
        `frame ${index + 1} has a different working-space reference or color provenance`,
      );
    }
    if (method === 'radiance' && contract.encoding.transfer !== 'linear') {
      throw new HdrProcessingError(
        `frame ${index + 1} is not linear sensor/developed data; encoded display values cannot be merged as radiance`,
      );
    }
    for (let y = 0; y < contract.height; y++) {
      for (let x = 0; x < contract.width; x++) {
        const row = y * contract.stride + x * 4;
        if (
          ![0, 1, 2, 3].every((channel) => Number.isFinite(frame.raster.pixels[row + channel]!))
        ) {
          throw new HdrProcessingError(`frame ${index + 1} contains non-finite pixels`);
        }
        if (method === 'exposure-fusion') {
          for (let channel = 0; channel < 3; channel++) {
            const value = frame.raster.pixels[row + channel]!;
            if (value < 0 || value > 1) {
              throw new HdrProcessingError(
                `frame ${index + 1} contains values outside the display-fusion range 0-1`,
              );
            }
          }
        }
      }
    }
  }
}

function validateMaskLengths(
  masks: readonly Uint8Array[] | undefined,
  expectedLength: number,
): void {
  if (!masks) return;
  const invalidIndex = masks.findIndex((mask) => mask.length !== expectedLength);
  if (invalidIndex >= 0) {
    throw new HdrProcessingError(
      `valid mask ${invalidIndex + 1} has the wrong length; expected one byte per pixel`,
    );
  }
}

function radianceSampleWeight(value: number, saturationThreshold: number): number {
  const normalized = value / saturationThreshold;
  const distanceFromWhite = Math.abs(normalized - 0.5) * 2;
  return Math.max(0.05, 1 - Math.min(1, distanceFromWhite));
}

function makeOutputContract(
  input: RangeRaster,
  provenance: RangeRasterContract['provenance'],
  reference: RangeRasterContract['reference'] = 'scene-linear',
): RangeRasterContract {
  return {
    ...input.contract,
    stride: input.contract.width * 4,
    sampleType: 'float32',
    encoding: {
      ...input.contract.encoding,
      transfer: 'linear',
      bitDepth: 'float32',
      alphaMode: 'straight',
    },
    reference,
    alphaMode: 'straight',
    provenance,
  };
}
