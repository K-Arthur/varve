/**
 * Canonical raster export post-processing pipeline (Strata export pipeline
 * rebuild). Orchestrates the typed stage contracts in a fixed order so every
 * raster encoder follows the same pipeline:
 *
 *   resize → sharpen → colour convert → dither/palette → (encode → metadata)
 *
 * Ordering rationale (documented for parity across preview/export/print):
 *  1. Resize happens first, in the chosen working space, so sharpen radius is
 *     expressed in final output pixels and never re-filtered by a later scale.
 *  2. Sharpening is applied after the final resize (single resize pass,
 *     single sharpen pass — no accidental double filtering).
 *  3. Colour conversion runs on the final pixels so out-of-gamut clipping is
 *     applied once, at the destination profile, not before resampling.
 *  4. Dithering/quantization is last because it works on already-converted
 *     values; dithering before colour conversion would diffuse error in the
 *     wrong colour space.
 *  5. Metadata is applied at encode time by the caller (`applyMetadataPolicy`).
 *
 * Every stage is optional; `undefined` stages are skipped. `runRasterPipeline`
 * always returns an ImageData plus a diagnostics log describing what ran and
 * why (used for auto-selection visibility and honest preflight).
 */

import type {
  ColorConversionOptions,
  DitherOptions,
  ExportWorkingSpace,
  RasterResizeOptions as ResizeOptions,
  SharpenOptions,
} from '@varve/shared';
import { ditherImageData } from './dither';
import { quantizeToPalette } from './palette';
import { type ResampleResult, resampleImageData } from './resample';
import { sharpenImageData } from './sharpen';

export interface RasterPipelineOptions {
  /** Stage 1: resample. Requires explicit target dimensions to act. */
  resize?: ResizeOptions & { targetWidth: number; targetHeight: number };
  /** Stage 2: output sharpening. */
  sharpen?: SharpenOptions;
  /** Stage 3: destination colour conversion (profile-aware). */
  colorConversion?: ColorConversionOptions & {
    /** Backend implementation; the pipeline supplies the pixels. */
    convert: (pixels: ImageData, intent: ColorConversionOptions) => Promise<ImageData>;
  };
  /** Stage 4a: technical dithering / bit-depth. */
  dither?: DitherOptions;
  /** Stage 4b: palette quantization (median cut). */
  paletteSize?: number;
  /** Callbacks for diagnostics (cancellation, progress). */
  signal?: AbortSignal;
}

export interface RasterPipelineResult {
  imageData: ImageData;
  log: string[];
  /** True when the resize stage actually changed dimensions. */
  resized: boolean;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Export pipeline aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Run the canonical raster pipeline. Returns the input image untouched (a
 * copy) when no stage applies, so callers can skip re-encoding work.
 */
export async function runRasterPipeline(
  source: ImageData,
  options: RasterPipelineOptions = {},
): Promise<RasterPipelineResult> {
  const log: string[] = [];
  let current = source;

  // Stage 1: resize.
  const resize = options.resize;
  if (resize && (resize.targetWidth !== source.width || resize.targetHeight !== source.height)) {
    assertNotAborted(options.signal);
    const resampleOptions = {
      algorithm: resize.algorithm,
      workingSpace: resize.workingSpace,
      pixelArt: resize.pixelArt,
      integerScale: resize.integerScale,
      maxPixels: resize.maxPixels,
      tileHeight: resize.tileHeight,
    };
    const resampled: ResampleResult = resampleImageData(
      current,
      resize.targetWidth,
      resize.targetHeight,
      resampleOptions,
    );
    log.push(
      `resize ${current.width}x${current.height} → ${resampled.imageData.width}x${resampled.imageData.height} (${resampled.algorithm})`,
    );
    log.push(...resampled.resolutionLog);
    current = resampled.imageData;
  }

  // Stage 2: sharpen (after final resize).
  if (options.sharpen && options.sharpen.mode !== 'none') {
    assertNotAborted(options.signal);
    const sharpened = sharpenImageData(current, {
      mode: options.sharpen.mode,
      amount: options.sharpen.amount,
      radius: options.sharpen.radius,
      threshold: options.sharpen.threshold,
      luminanceOnly: options.sharpen.luminanceOnly,
      protectAlpha: options.sharpen.protectAlpha,
      workingSpace: options.sharpen.workingSpace,
    });
    if (sharpened.applied) {
      log.push(
        `sharpen (${options.sharpen.mode}, amount ${options.sharpen.amount}, radius ${options.sharpen.radius})`,
      );
      current = sharpened.imageData;
    }
  }

  // Stage 3: colour conversion.
  if (options.colorConversion) {
    assertNotAborted(options.signal);
    const converted = await options.colorConversion.convert(current, options.colorConversion);
    log.push(
      `colour ${options.colorConversion.operation} via ${options.colorConversion.sourceProfile} → ${options.colorConversion.destinationProfile ?? 'unmanaged'} (${options.colorConversion.renderingIntent})`,
    );
    current = converted;
  }

  // Stage 4a: dither / quantization.
  if (options.dither && options.dither.algorithm !== 'none') {
    assertNotAborted(options.signal);
    const dithered = ditherImageData(current, {
      algorithm: options.dither.algorithm,
      strength: options.dither.strength,
      targetBitDepth: options.dither.targetBitDepth,
      serpentine: options.dither.serpentine,
      seed: options.dither.seed,
      channelMode: options.dither.channelMode,
      alphaThreshold: options.dither.alphaThreshold,
    });
    log.push(
      `dither ${options.dither.algorithm} @ ${options.dither.targetBitDepth}bit (${dithered.distinctColors} colours, seed ${options.dither.seed})`,
    );
    current = dithered.imageData;
  }

  // Stage 4b: palette quantization.
  if (options.paletteSize && options.paletteSize > 0) {
    assertNotAborted(options.signal);
    const paletted = quantizeToPalette(current, {
      paletteSize: options.paletteSize,
      alphaThreshold: options.dither?.alphaThreshold ?? 0,
    });
    log.push(
      `palette ${paletted.palette.length / 4} colours${paletted.transparentIndex ? ' + transparent index' : ''}`,
    );
    current = paletted.imageData;
  }

  return {
    imageData: current,
    log,
    resized: current.width !== source.width || current.height !== source.height,
  };
}

/** Default working space used when a stage omits one. */
export const DEFAULT_PIPELINE_WORKING_SPACE: ExportWorkingSpace = 'srgb';
