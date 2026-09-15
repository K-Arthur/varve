import { createRangeRaster, type RangeRaster, sanitizeRangeRasterInPlace } from '@varve/shared';
import {
  type RawActiveArea,
  type RawDevelopDiagnostics,
  RawDevelopmentError,
  type RawDevelopResult,
  type RawMosaic,
  type RawRecipe,
} from './types';

export const BASELINE_DNG_DECODER_ID = 'varve-dng-bayer-uncompressed/1';

/** Initial reversible recipe; no automatic brightness or hidden profile work. */
export function defaultRawRecipe(mosaic: RawMosaic): RawRecipe {
  const hasAsShot = mosaic.asShotNeutral !== undefined;
  return {
    version: 1,
    decoderId: BASELINE_DNG_DECODER_ID,
    profile: mosaic.colorMatrix1 || mosaic.colorMatrix2 ? 'camera-matrix' : 'srgb-d65',
    cameraMatrix: 'auto',
    whiteBalance: hasAsShot ? 'as-shot' : 'custom',
    ...(hasAsShot ? {} : { customMultipliers: [1, 1, 1] as const }),
    exposureStops: 0,
    blackPoint: 0,
    whitePoint: 1,
    highlights: 0,
    shadows: 0,
    noiseReduction: 0,
    captureSharpening: 0,
    outputSharpening: 0,
    lensCorrection: 'none',
    demosaic: 'bilinear-bayer',
    ...(mosaic.defaultCrop
      ? {
          crop: {
            top: mosaic.defaultCrop.y,
            left: mosaic.defaultCrop.x,
            bottom: mosaic.defaultCrop.y + mosaic.defaultCrop.height,
            right: mosaic.defaultCrop.x + mosaic.defaultCrop.width,
          },
        }
      : {}),
    orientation: mosaic.camera.orientation,
  };
}

/**
 * Develop a decoded sensor mosaic into a float32 scene-linear RGB raster.
 * This baseline supports one documented demosaic (bilinear Bayer), explicit
 * white balance, exposure, black/white controls, a conservative highlight and
 * shadow operator, and optional capture/output sharpening. Lens correction and
 * advanced demosaicing are intentionally reported as unsupported until their
 * profile/data contracts are wired.
 */
export function developRaw(mosaic: RawMosaic, recipe: RawRecipe): RawDevelopResult {
  if (recipe.version !== 1 || recipe.decoderId !== BASELINE_DNG_DECODER_ID) {
    throw new RawDevelopmentError('RAW recipe is for an incompatible decoder revision');
  }
  if (recipe.demosaic !== 'bilinear-bayer') {
    throw new RawDevelopmentError(`demosaic method ${recipe.demosaic} is not supported`);
  }
  if (recipe.lensCorrection !== 'none') {
    throw new RawDevelopmentError(
      'lens correction is unavailable without a matching Lensfun profile',
    );
  }
  validateFiniteRecipe(recipe);
  const crop =
    recipe.crop ??
    (mosaic.defaultCrop
      ? {
          top: mosaic.defaultCrop.y,
          left: mosaic.defaultCrop.x,
          bottom: mosaic.defaultCrop.y + mosaic.defaultCrop.height,
          right: mosaic.defaultCrop.x + mosaic.defaultCrop.width,
        }
      : mosaic.activeArea);
  validateCrop(crop, mosaic.width, mosaic.height);
  const cropWidth = crop.right - crop.left;
  const cropHeight = crop.bottom - crop.top;
  const rotated =
    recipe.orientation === 5 ||
    recipe.orientation === 6 ||
    recipe.orientation === 7 ||
    recipe.orientation === 8;
  const width = rotated ? cropHeight : cropWidth;
  const height = rotated ? cropWidth : cropHeight;
  const raster = createRangeRaster({
    width,
    height,
    stride: width * 4,
    channelLayout: 'rgba',
    sampleType: 'float32',
    encoding: {
      model: 'rgb',
      primaries: 'srgb',
      transfer: 'linear',
      bitDepth: 'float32',
      alphaMode: 'straight',
      provenance: recipe.profile === 'camera-matrix' ? 'named' : 'user-assigned',
    },
    reference: 'scene-linear',
    referenceWhite: 1,
    alphaMode: 'straight',
    provenance: 'raw-development',
  });
  const multipliers = whiteBalanceMultipliers(mosaic, recipe);
  const selectedCameraMatrix =
    recipe.profile === 'camera-matrix' ? selectCameraMatrix(mosaic, recipe) : null;
  const cameraMatrix = selectedCameraMatrix
    ? cameraToSrgbMatrix(selectedCameraMatrix.matrix)
    : null;
  if (recipe.profile === 'camera-matrix' && !cameraMatrix) {
    throw new RawDevelopmentError(
      'camera-matrix profile selected but the DNG has no usable ColorMatrix',
    );
  }
  let sensorClippedPixels = 0;
  for (let y = crop.top; y < crop.bottom; y++) {
    for (let x = crop.left; x < crop.right; x++) {
      const sensorIndex = y * mosaic.width + x;
      const plane = mosaic.kind === 'bayer' ? bayerPlane(mosaic, x, y) : 0;
      const white = mosaic.whiteLevel[plane] ?? mosaic.whiteLevel[0] ?? 1;
      if (mosaic.pixels[sensorIndex]! >= white) sensorClippedPixels++;
    }
  }
  const exposure = 2 ** recipe.exposureStops;
  for (let outputY = 0; outputY < height; outputY++) {
    for (let outputX = 0; outputX < width; outputX++) {
      const source = orientedSourceCoordinate(outputX, outputY, crop, recipe.orientation);
      const sensorRgb =
        mosaic.kind === 'bayer'
          ? demosaicBayer(mosaic, source.x, source.y, multipliers)
          : [
              sensorValue(mosaic, source.x, source.y, 0),
              sensorValue(mosaic, source.x, source.y, 0),
              sensorValue(mosaic, source.x, source.y, 0),
            ];
      let rgb = cameraMatrix ? multiply3(cameraMatrix, sensorRgb) : sensorRgb;
      rgb = rgb.map((value) => applyTonalControls(value, recipe, exposure));
      const outputIndex = (outputY * width + outputX) * 4;
      raster.pixels[outputIndex] = rgb[0]!;
      raster.pixels[outputIndex + 1] = rgb[1]!;
      raster.pixels[outputIndex + 2] = rgb[2]!;
      raster.pixels[outputIndex + 3] = 1;
    }
  }
  if (recipe.noiseReduction > 0) applyNoiseReduction(raster, recipe.noiseReduction);
  if (recipe.captureSharpening > 0) applyUnsharp(raster, recipe.captureSharpening);
  if (recipe.outputSharpening > 0) applyUnsharp(raster, recipe.outputSharpening);
  const warnings = [...mosaic.warnings];
  if (
    selectedCameraMatrix &&
    recipe.cameraMatrix === 'auto' &&
    mosaic.colorMatrix1 &&
    mosaic.colorMatrix2 &&
    !mosaic.asShotNeutral
  ) {
    warnings.push(
      'automatic camera-matrix selection used the first available matrix because as-shot white balance is absent',
    );
  }
  if (!mosaic.asShotNeutral && recipe.whiteBalance === 'as-shot') {
    warnings.push('as-shot white balance requested but metadata is absent; neutral fallback used');
  }
  if (recipe.profile === 'srgb-d65' && !mosaic.colorMatrix1 && !mosaic.colorMatrix2) {
    warnings.push(
      'camera channels were assigned to an sRGB-D65 working profile by explicit fallback',
    );
  }
  if (recipe.noiseReduction > 0)
    warnings.push(
      'baseline noise reduction is RGB-domain and conservative; CFA denoising is not implemented',
    );
  if (recipe.captureSharpening > 0 || recipe.outputSharpening > 0)
    warnings.push('sharpening is a simple working-space kernel, not a camera-specific lens model');
  sanitizeRangeRasterInPlace(raster, { maxAbsRgb: 65504 });
  let outputClippedPixels = 0;
  for (let i = 0; i < width * height; i++) {
    if (
      raster.pixels[i * 4]! >= 1 ||
      raster.pixels[i * 4 + 1]! >= 1 ||
      raster.pixels[i * 4 + 2]! >= 1
    )
      outputClippedPixels++;
  }
  const diagnostics: RawDevelopDiagnostics = {
    decoderId: recipe.decoderId,
    profile: recipe.profile,
    ...(selectedCameraMatrix ? { cameraMatrix: selectedCameraMatrix.id } : {}),
    whiteBalanceSource:
      recipe.whiteBalance === 'as-shot' && mosaic.asShotNeutral
        ? 'as-shot'
        : recipe.whiteBalance === 'custom'
          ? 'custom'
          : 'fallback-neutral',
    sensorClippedPixels,
    outputClippedPixels,
    warnings,
  };
  return { raster, diagnostics };
}

function validateFiniteRecipe(recipe: RawRecipe): void {
  const finiteValues = [
    recipe.exposureStops,
    recipe.blackPoint,
    recipe.whitePoint,
    recipe.highlights,
    recipe.shadows,
    recipe.noiseReduction,
    recipe.captureSharpening,
    recipe.outputSharpening,
  ];
  if (finiteValues.some((value) => !Number.isFinite(value)))
    throw new RawDevelopmentError('RAW recipe contains a non-finite control');
  if (recipe.whitePoint <= recipe.blackPoint)
    throw new RawDevelopmentError('RAW white point must be greater than black point');
  if (
    recipe.noiseReduction < 0 ||
    recipe.noiseReduction > 1 ||
    recipe.captureSharpening < 0 ||
    recipe.captureSharpening > 1 ||
    recipe.outputSharpening < 0 ||
    recipe.outputSharpening > 1
  ) {
    throw new RawDevelopmentError('RAW detail controls must be in the range 0-1');
  }
  if (recipe.customMultipliers?.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RawDevelopmentError('custom white-balance multipliers must be positive and finite');
  }
}

function validateCrop(crop: RawActiveArea, width: number, height: number): void {
  if (
    !Number.isInteger(crop.top) ||
    !Number.isInteger(crop.left) ||
    !Number.isInteger(crop.bottom) ||
    !Number.isInteger(crop.right) ||
    crop.top < 0 ||
    crop.left < 0 ||
    crop.bottom <= crop.top ||
    crop.right <= crop.left ||
    crop.bottom > height ||
    crop.right > width
  ) {
    throw new RawDevelopmentError('RAW crop is outside the decoded sensor area');
  }
}

function whiteBalanceMultipliers(mosaic: RawMosaic, recipe: RawRecipe): [number, number, number] {
  if (recipe.whiteBalance === 'custom')
    return [...(recipe.customMultipliers ?? [1, 1, 1])] as [number, number, number];
  if (!mosaic.asShotNeutral || mosaic.asShotNeutral.length < 3) return [1, 1, 1];
  const inverse = mosaic.asShotNeutral.slice(0, 3).map((value) => 1 / Math.max(1e-8, value));
  return [inverse[0]!, inverse[1]!, inverse[2]!];
}

function bayerPlane(mosaic: RawMosaic, x: number, y: number): number {
  const pattern = mosaic.cfaPattern!;
  const patternX = ((x % 2) + 2) % 2;
  const patternY = ((y % 2) + 2) % 2;
  return pattern[patternY * 2 + patternX]!;
}

function sensorValue(mosaic: RawMosaic, x: number, y: number, plane: number): number {
  const clampedX = Math.max(0, Math.min(mosaic.width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(mosaic.height - 1, Math.round(y)));
  const index = clampedY * mosaic.width + clampedX;
  const actualPlane = mosaic.kind === 'bayer' ? bayerPlane(mosaic, clampedX, clampedY) : plane;
  const black = mosaic.blackLevel[actualPlane] ?? mosaic.blackLevel[0] ?? 0;
  const white = mosaic.whiteLevel[actualPlane] ?? mosaic.whiteLevel[0] ?? 1;
  return (mosaic.pixels[index]! - black) / Math.max(1e-8, white - black);
}

function demosaicBayer(
  mosaic: RawMosaic,
  x: number,
  y: number,
  multipliers: readonly number[],
): [number, number, number] {
  const rgb: [number, number, number] = [0, 0, 0];
  const currentPlane = bayerPlane(mosaic, x, y);
  for (let channel = 0; channel < 3; channel++) {
    if (currentPlane === channel) {
      rgb[channel] = sensorValue(mosaic, x, y, channel) * multipliers[channel]!;
      continue;
    }
    let sum = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (bayerPlane(mosaic, x + dx, y + dy) !== channel) continue;
        sum += sensorValue(mosaic, x + dx, y + dy, channel);
        count++;
      }
    }
    rgb[channel] =
      (count > 0 ? sum / count : sensorValue(mosaic, x, y, channel)) * multipliers[channel]!;
  }
  return rgb;
}

function applyTonalControls(value: number, recipe: RawRecipe, exposure: number): number {
  let output = (value - recipe.blackPoint) / (recipe.whitePoint - recipe.blackPoint);
  output *= exposure;
  if (recipe.shadows > 0 && output < 0.25)
    output += (0.25 - output) * Math.min(1, recipe.shadows) * 0.35;
  if (recipe.highlights > 0 && output > 0.75)
    output = 0.75 + (output - 0.75) / (1 + recipe.highlights * 3);
  return output;
}

function applyNoiseReduction(raster: RangeRaster, amount: number): void {
  const { width, height, stride } = raster.contract;
  const source = new Float32Array(raster.pixels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            sum += source[ny * stride + nx * 4 + channel]!;
            count++;
          }
        }
        raster.pixels[index + channel] =
          source[index + channel]! * (1 - amount * 0.25) + (sum / count) * amount * 0.25;
      }
    }
  }
}

function applyUnsharp(raster: RangeRaster, amount: number): void {
  const { width, height, stride } = raster.contract;
  const source = new Float32Array(raster.pixels);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const blur =
          (source[(y - 1) * stride + x * 4 + channel]! +
            source[(y + 1) * stride + x * 4 + channel]! +
            source[y * stride + (x - 1) * 4 + channel]! +
            source[y * stride + (x + 1) * 4 + channel]!) /
          4;
        raster.pixels[index + channel] =
          source[index + channel]! + (source[index + channel]! - blur) * amount * 0.5;
      }
    }
  }
}

function orientedSourceCoordinate(
  outputX: number,
  outputY: number,
  crop: RawActiveArea,
  orientation: RawRecipe['orientation'],
): { x: number; y: number } {
  const w = crop.right - crop.left;
  const h = crop.bottom - crop.top;
  switch (orientation) {
    case 2:
      return { x: crop.right - 1 - outputX, y: crop.top + outputY };
    case 3:
      return { x: crop.right - 1 - outputX, y: crop.bottom - 1 - outputY };
    case 4:
      return { x: crop.left + outputX, y: crop.bottom - 1 - outputY };
    case 5:
      return { x: crop.left + outputY, y: crop.top + outputX };
    case 6:
      return { x: crop.left + outputY, y: crop.bottom - 1 - outputX };
    case 7:
      return { x: crop.right - 1 - outputY, y: crop.bottom - 1 - outputX };
    case 8:
      return { x: crop.right - 1 - outputY, y: crop.top + outputX };
    default:
      return { x: crop.left + Math.min(outputX, w - 1), y: crop.top + Math.min(outputY, h - 1) };
  }
}

function cameraToSrgbMatrix(colorMatrix: number[] | undefined): number[] | null {
  if (!colorMatrix || colorMatrix.length < 9) return null;
  const inverse = invert3(colorMatrix.slice(0, 9));
  if (!inverse) return null;
  // DNG ColorMatrix values map XYZ to reference-camera native values. The
  // inverse therefore maps camera values to XYZ D50. sRGB's matrix below is
  // D65-referenced, so adapt D50 to D65 before the output transform. Keeping
  // this explicit prevents a silent D50/D65 white-point mismatch.
  const d50ToD65 = [
    0.9554734, -0.0230985, 0.0632593, -0.0283697, 1.0099955, 0.0210414, 0.012314, -0.0205077,
    1.3303659,
  ];
  const xyzToSrgb = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057];
  return multiply3x3(xyzToSrgb, multiply3x3(d50ToD65, inverse));
}

function selectCameraMatrix(
  mosaic: RawMosaic,
  recipe: RawRecipe,
): { id: 'color-matrix-1' | 'color-matrix-2'; matrix: number[] } | null {
  const requested = recipe.cameraMatrix ?? 'auto';
  if (requested === 'color-matrix-1' && mosaic.colorMatrix1) {
    return { id: 'color-matrix-1', matrix: mosaic.colorMatrix1 };
  }
  if (requested === 'color-matrix-2' && mosaic.colorMatrix2) {
    return { id: 'color-matrix-2', matrix: mosaic.colorMatrix2 };
  }
  if (requested !== 'auto') return null;
  if (mosaic.colorMatrix1 && mosaic.colorMatrix2) {
    const firstScore = cameraMatrixNeutralDistance(
      mosaic.colorMatrix1,
      mosaic.calibrationIlluminant1,
      mosaic.asShotNeutral,
    );
    const secondScore = cameraMatrixNeutralDistance(
      mosaic.colorMatrix2,
      mosaic.calibrationIlluminant2,
      mosaic.asShotNeutral,
    );
    if (Number.isFinite(secondScore) && secondScore < firstScore) {
      return { id: 'color-matrix-2', matrix: mosaic.colorMatrix2 };
    }
    return { id: 'color-matrix-1', matrix: mosaic.colorMatrix1 };
  }
  if (mosaic.colorMatrix1) return { id: 'color-matrix-1', matrix: mosaic.colorMatrix1 };
  if (mosaic.colorMatrix2) return { id: 'color-matrix-2', matrix: mosaic.colorMatrix2 };
  return null;
}

function cameraMatrixNeutralDistance(
  colorMatrix: readonly number[],
  illuminant: number | undefined,
  asShotNeutral: readonly number[] | undefined,
): number {
  if (!illuminant || !asShotNeutral || asShotNeutral.length < 3) return Number.POSITIVE_INFINITY;
  const xyz = calibrationIlluminantXyz(illuminant);
  if (!xyz) return Number.POSITIVE_INFINITY;
  const predicted = multiply3(colorMatrix, xyz);
  if (predicted.some((value) => !Number.isFinite(value) || value <= 0))
    return Number.POSITIVE_INFINITY;
  const predictedNormal = predicted.map((value) => value / predicted[1]!);
  const targetNormal = asShotNeutral.slice(0, 3).map((value) => value / asShotNeutral[1]!);
  return predictedNormal.reduce(
    (sum, value, index) =>
      sum + Math.log(Math.max(1e-8, value) / Math.max(1e-8, targetNormal[index]!)) ** 2,
    0,
  );
}

function calibrationIlluminantXyz(code: number): [number, number, number] | null {
  // The DNG fixture and the common two-illuminant camera profile use the EXIF
  // Standard Light A (17) and D65 (21). Unknown illuminants are not guessed.
  if (code === 17) return [1.0985, 1, 0.3558];
  if (code === 21) return [0.95047, 1, 1.08883];
  return null;
}

function multiply3(matrix: readonly number[], vector: readonly number[]): [number, number, number] {
  return [
    matrix[0]! * vector[0]! + matrix[1]! * vector[1]! + matrix[2]! * vector[2]!,
    matrix[3]! * vector[0]! + matrix[4]! * vector[1]! + matrix[5]! * vector[2]!,
    matrix[6]! * vector[0]! + matrix[7]! * vector[1]! + matrix[8]! * vector[2]!,
  ];
}

function multiply3x3(first: readonly number[], second: readonly number[]): number[] {
  const output = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      for (let k = 0; k < 3; k++) {
        const index = row * 3 + column;
        output[index] = output[index]! + first[row * 3 + k]! * second[k * 3 + column]!;
      }
    }
  }
  return output;
}

function invert3(matrix: readonly number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant =
    a! * (e! * i! - f! * h!) - b! * (d! * i! - f! * g!) + c! * (d! * h! - e! * g!);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return null;
  return [
    (e! * i! - f! * h!) / determinant,
    (c! * h! - b! * i!) / determinant,
    (b! * f! - c! * e!) / determinant,
    (f! * g! - d! * i!) / determinant,
    (a! * i! - c! * g!) / determinant,
    (c! * d! - a! * f!) / determinant,
    (d! * h! - e! * g!) / determinant,
    (b! * g! - a! * h!) / determinant,
    (a! * e! - b! * d!) / determinant,
  ];
}
