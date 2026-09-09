/**
 * Browser-local raster conversion.
 *
 * The browser decodes a checked image, paints it into an RGBA8 canvas, and
 * its own encoder produces the requested output. This is not an
 * ICC-preserving or animation-preserving transcoder; those losses are part of
 * the conversion plan shown to the user.
 */

import type { ImageFormatId } from './formatCapabilities';
import {
  type FormatCapability,
  formatForMime,
  getFormatCapability,
  mimeForFormat,
} from './formatCapabilities';
import { inspectImageSource, normalizeRasterBytes } from './image';
import { inspectRasterBytes, type RasterInspection } from './rasterInspection';

export const RASTER_CONVERSION_FORMATS = ['png', 'jpeg', 'webp', 'avif'] as const;
export type RasterConversionFormat = (typeof RASTER_CONVERSION_FORMATS)[number];

export interface RasterConversionOptions {
  outputFormat: RasterConversionFormat;
  /** Canvas quality, used by lossy encoders. Defaults to 0.92. */
  quality?: number;
  /** CSS color used when an alpha-capable source is flattened to JPEG. */
  background?: string;
  signal?: AbortSignal;
}

export type RasterConversionErrorCode =
  | 'aborted'
  | 'invalid-options'
  | 'unsupported-input'
  | 'unsupported-output'
  | 'decoder-unavailable'
  | 'encoder-unavailable'
  | 'background-required'
  | 'invalid-background'
  | 'decode-failed'
  | 'encode-failed';

export class RasterConversionError extends Error {
  readonly code: RasterConversionErrorCode;

  constructor(code: RasterConversionErrorCode, message: string) {
    super(message);
    this.name = 'RasterConversionError';
    this.code = code;
  }
}

export interface RasterConversionPlan {
  inputFormat: ImageFormatId;
  inputMimeType: string;
  outputFormat: RasterConversionFormat;
  outputMimeType: string;
  width: number;
  height: number;
  animation: RasterInspection['animation'];
  warnings: readonly string[];
  blockingIssues: readonly string[];
  /** True when a JPEG output needs a caller-selected matte color. */
  requiresBackground: boolean;
  /** Canvas conversion intentionally produces a normalized, metadata-light file. */
  metadataPolicy: 'normalized-rgba8';
}

export interface RasterConversionResult {
  bytes: Uint8Array;
  mimeType: string;
  format: RasterConversionFormat;
  width: number;
  height: number;
  warnings: readonly string[];
}

const OUTPUT_MIME: Record<RasterConversionFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};

function isRasterConversionFormat(value: string): value is RasterConversionFormat {
  return (RASTER_CONVERSION_FORMATS as readonly string[]).includes(value);
}

function outputCapability(format: RasterConversionFormat): FormatCapability {
  return getFormatCapability(format)!;
}

function sourceMayHaveAlpha(capability: FormatCapability): boolean {
  return capability.alpha !== 'none';
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RasterConversionError('aborted', 'Conversion was cancelled');
}

function clampQuality(quality: number | undefined): number {
  if (quality === undefined) return 0.92;
  if (!Number.isFinite(quality)) {
    throw new RasterConversionError('invalid-options', 'Quality must be a finite number');
  }
  return Math.min(1, Math.max(0.01, quality));
}

function validateCssColor(color: string): boolean {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('canvas');
  const context = probe.getContext('2d');
  if (!context) return false;
  context.fillStyle = '#000000';
  context.fillStyle = color;
  return context.fillStyle !== '#000000' || color.trim().toLowerCase() === '#000000';
}

/** Build the user-visible conversion contract without touching the decoder. */
export function planRasterConversion(
  bytes: Uint8Array,
  options: Pick<RasterConversionOptions, 'outputFormat' | 'background'>,
): RasterConversionPlan {
  const inspection = inspectRasterBytes(bytes);
  const inputFormat = formatForMime(inspection.mimeType);
  if (!inputFormat) {
    throw new RasterConversionError(
      'unsupported-input',
      `Varve cannot identify the raster MIME type ${inspection.mimeType}`,
    );
  }

  if (!isRasterConversionFormat(options.outputFormat)) {
    throw new RasterConversionError(
      'unsupported-output',
      `Varve cannot encode ${String(options.outputFormat)} in the local raster converter`,
    );
  }

  const source = getFormatCapability(inputFormat);
  const target = outputCapability(options.outputFormat);
  if (!source || source.kind !== 'raster' || source.import.level === 'unsupported') {
    throw new RasterConversionError(
      'unsupported-input',
      `${inputFormat.toUpperCase()} is not an accepted raster conversion input`,
    );
  }
  if (!target.export.available) {
    throw new RasterConversionError(
      'unsupported-output',
      `${target.label} has no local Varve encoder`,
    );
  }

  const requiresBackground =
    options.outputFormat === 'jpeg' && sourceMayHaveAlpha(source) && !options.background;
  const warnings: string[] = [
    'The browser canvas normalizes pixels to an RGBA8 working surface; embedded ICC, EXIF, DPI, and other source metadata are not copied to the output.',
  ];
  const blockingIssues: string[] = [];

  if (inspection.animation === 'animated') {
    warnings.push('This source is animated; conversion exports the first decoded frame only.');
  }
  if (inputFormat === 'tiff') {
    warnings.push('TIFF conversion uses the first IFD and is flattened to a browser raster.');
  }
  if (target.export.lossy) {
    warnings.push(
      `${target.label} is lossy; choose PNG when pixel fidelity or transparency matters.`,
    );
  }
  if (requiresBackground)
    blockingIssues.push('Choose a background color before converting to JPEG.');
  if (options.outputFormat === 'jpeg' && options.background) {
    warnings.push(`Transparency is flattened against ${options.background}.`);
  }

  return {
    inputFormat,
    inputMimeType: inspection.mimeType,
    outputFormat: options.outputFormat,
    outputMimeType: OUTPUT_MIME[options.outputFormat],
    width: inspection.width,
    height: inspection.height,
    animation: inspection.animation,
    warnings,
    blockingIssues,
    requiresBackground,
    metadataPolicy: 'normalized-rgba8',
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function decodeBitmap(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<{
  bitmap: ImageBitmap;
  inspection: RasterInspection;
  displayedWidth: number;
  displayedHeight: number;
}> {
  assertNotAborted(signal);
  if (typeof createImageBitmap !== 'function') {
    throw new RasterConversionError(
      'decoder-unavailable',
      'This runtime does not provide the orientation-aware local image decoder required for conversion',
    );
  }

  const inspection = inspectRasterBytes(bytes);
  const decodeBytes = inspection.mimeType === 'image/tiff' ? normalizeRasterBytes(bytes) : bytes;
  const source = inspectImageSource(bytes);
  const decodeInspection = inspectRasterBytes(decodeBytes);
  const blob = new Blob([toArrayBuffer(decodeBytes)], { type: decodeInspection.mimeType });
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    assertNotAborted(signal);
    return {
      bitmap,
      inspection,
      displayedWidth: source.displayedWidth,
      displayedHeight: source.displayedHeight,
    };
  } catch (error) {
    if (error instanceof RasterConversionError) throw error;
    throw new RasterConversionError(
      'decode-failed',
      error instanceof Error ? `Image decode failed: ${error.message}` : 'Image decode failed',
    );
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
  signal?: AbortSignal,
): Promise<Blob> {
  assertNotAborted(signal);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(
            new RasterConversionError('encode-failed', `The ${mimeType} encoder returned no data`),
          );
          return;
        }
        if (blob.type.toLowerCase() !== mimeType) {
          reject(
            new RasterConversionError(
              'encoder-unavailable',
              `This runtime did not provide a ${mimeType} encoder`,
            ),
          );
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

/** Convert one checked raster using the active browser/runtime codecs. */
export async function convertRasterBytes(
  bytes: Uint8Array,
  options: RasterConversionOptions,
): Promise<RasterConversionResult> {
  assertNotAborted(options.signal);
  const quality = clampQuality(options.quality);
  const plan = planRasterConversion(bytes, options);
  if (plan.blockingIssues.length > 0) {
    throw new RasterConversionError('background-required', plan.blockingIssues[0]!);
  }
  if (
    options.outputFormat === 'jpeg' &&
    options.background &&
    !validateCssColor(options.background)
  ) {
    throw new RasterConversionError(
      'invalid-background',
      'The JPEG background is not a valid CSS color',
    );
  }

  const decoded = await decodeBitmap(bytes, options.signal);
  const canvas = document.createElement('canvas');
  canvas.width = decoded.displayedWidth;
  canvas.height = decoded.displayedHeight;
  const context = canvas.getContext('2d', { alpha: options.outputFormat !== 'jpeg' });
  if (!context) {
    decoded.bitmap.close();
    throw new RasterConversionError('encoder-unavailable', 'The runtime has no 2D canvas encoder');
  }

  try {
    if (options.outputFormat === 'jpeg') {
      context.fillStyle = options.background!;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(decoded.bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, plan.outputMimeType, quality, options.signal);
    const output = new Uint8Array(await blob.arrayBuffer());
    assertNotAborted(options.signal);
    return {
      bytes: output,
      mimeType: plan.outputMimeType,
      format: plan.outputFormat,
      width: canvas.width,
      height: canvas.height,
      warnings: plan.warnings,
    };
  } finally {
    decoded.bitmap.close();
  }
}

export function mimeForRasterConversionFormat(format: RasterConversionFormat): string {
  return mimeForFormat(format) ?? OUTPUT_MIME[format];
}
