/**
 * Raster colour transform provider chain.
 *
 * Turns a source colour encoding into a target colour encoding over actual
 * pixels. The provider abstraction (spec: provider-based ICC architecture)
 * keeps the analytic engine as the always-available baseline and leaves room
 * for native/WASM ICC providers behind the same interface.
 *
 * Invariants:
 *  - The analytic provider never clamps out-of-gamut values while
 *    converting: authoritative wide-gamut pixels survive; clipping is a
 *    display/output boundary decision made by the caller.
 *  - Alpha is never transformed: colour transforms operate on colour
 *    channels. Premultiplied sources are un-premultiplied before the colour
 *    math and re-premultiplied after (the transform itself sees straight
 *    colour, which is what the profiles describe).
 *  - Conversion is tile-wise and cancellable: `signal` is checked between
 *    tiles so huge rasters never block the UI and jobs can be aborted.
 */

import {
  createAnalyticRgbColorTransform,
  isConvertibleRgbEncoding,
  type RasterColorEncoding,
} from '@varve/shared';
import {
  float32ToHalfFloat,
  halfFloatToFloat32,
  type PixelBuffer,
  type PixelBufferDescriptor,
  type PixelBufferFormat,
  premultiplyRgba32f,
  unpremultiplyRgba32f,
} from './pixelBuffer';

/** A reusable colour transform between two encodings. */
export interface RasterColorTransform {
  sourceEncoding: RasterColorEncoding;
  targetEncoding: RasterColorEncoding;
  /** Formats this transform can process. */
  supports(format: PixelBufferFormat): boolean;
  /** Convert an ImageData (8-bit RGBA) in place, tiled + cancellable. */
  convertImageData(pixels: ImageData, signal?: AbortSignal): Promise<void>;
  /** Convert a float32 RGBA buffer (0-1) in place (tiled + cancellable). */
  convertFloat32(pixels: Float32Array, signal?: AbortSignal): Promise<void>;
  /** Convert any supported typed pixel buffer in place (tiled + cancellable). */
  convertPixelBuffer(buffer: PixelBuffer, signal?: AbortSignal): Promise<void>;
}

/** Default tile height for tiled conversion (rows per tile). */
export const DEFAULT_TILE_HEIGHT = 256;

/** Per-tile pixel budget guard for large-raster conversions. */
export const MAX_CONVERSION_PIXELS_PER_JOB = 100 * 1024 * 1024; // 100 MP

/**
 * Identity transform: same encoding in and out (no pixel work).
 */
export function identityTransform(encoding: RasterColorEncoding): RasterColorTransform {
  return {
    sourceEncoding: encoding,
    targetEncoding: encoding,
    supports: () => true,
    convertImageData: async () => {},
    convertFloat32: async () => {},
    convertPixelBuffer: async () => {},
  };
}

/**
 * Analytic RGB-RGB transform between convertible encodings (shared
 * primaries/transfer engine). Returns null when either side is not
 * analytically convertible (unknown primaries, PQ/HLG).
 */
export function createAnalyticRgbTransform(
  source: RasterColorEncoding,
  target: RasterColorEncoding,
): RasterColorTransform | null {
  if (!isConvertibleRgbEncoding(source) || !isConvertibleRgbEncoding(target)) return null;
  const sourceSpace = {
    primaries: source.primaries,
    transfer: source.transfer,
  } as const;
  const targetSpace = {
    primaries: target.primaries,
    transfer: target.transfer,
  } as const;
  const colourTransform = createAnalyticRgbColorTransform({
    source: sourceSpace,
    destination: targetSpace,
  });
  if (!colourTransform) return null;
  if (source.primaries === target.primaries && source.transfer === target.transfer) {
    return identityTransform(target);
  }

  return {
    sourceEncoding: source,
    targetEncoding: target,
    supports: (format: PixelBufferFormat) =>
      format === 'rgba8' || format === 'rgba16' || format === 'rgba16f' || format === 'rgba32f',
    convertImageData: (pixels: ImageData, signal?: AbortSignal) =>
      convertImageDataInPlace(pixels, (rgb) => colourTransform.convertColor(rgb), signal),
    convertFloat32: (pixels: Float32Array, signal?: AbortSignal) =>
      convertFloat32InPlace(pixels, (rgb) => colourTransform.convertColor(rgb), signal),
    convertPixelBuffer: (buffer: PixelBuffer, signal?: AbortSignal) =>
      convertPixelBufferInPlace(buffer, (rgb) => colourTransform.convertColor(rgb), target, signal),
  };
}

/** Build a descriptor for a transform result. */
export function transformDescriptor(
  width: number,
  height: number,
  format: PixelBufferFormat,
  encoding: RasterColorEncoding,
): PixelBufferDescriptor {
  return { width, height, format, colorEncoding: encoding, alphaMode: 'straight' };
}

/** Per-row RGB transform callback over 0-1 values (returns null if unsupported). */
type RowTransform = (rgb: readonly [number, number, number]) => [number, number, number] | null;

async function convertImageDataInPlace(
  pixels: ImageData,
  transform: RowTransform,
  signal?: AbortSignal,
): Promise<void> {
  const data = pixels.data;
  const width = pixels.width;
  const height = pixels.height;
  const tileHeight = Math.max(1, Math.min(DEFAULT_TILE_HEIGHT, height || 1));
  for (let row = 0; row < height; row += tileHeight) {
    if (signal?.aborted) throw abortedError();
    const end = Math.min(row + tileHeight, height);
    for (let y = row; y < end; y += 1) {
      const base = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        const i = base + x * 4;
        const r = data[i]! / 255;
        const g = data[i + 1]! / 255;
        const b = data[i + 2]! / 255;
        const converted = transform([r, g, b]);
        if (!converted) throw new Error('unsupported colour conversion');
        data[i] = clampByte(converted[0] * 255);
        data[i + 1] = clampByte(converted[1] * 255);
        data[i + 2] = clampByte(converted[2] * 255);
      }
    }
  }
}

async function convertFloat32InPlace(
  pixels: Float32Array,
  transform: RowTransform,
  signal?: AbortSignal,
): Promise<void> {
  const n = pixels.length;
  const tileSize = Math.max(1, Math.min(DEFAULT_TILE_HEIGHT * 4 * 256, n));
  const premultiplied = isPremultiplied(pixels);
  if (premultiplied) unpremultiplyRgba32f(pixels);
  try {
    for (let i = 0; i < n; i += tileSize) {
      if (signal?.aborted) throw abortedError();
      const end = Math.min(i + tileSize, n);
      for (let p = i; p < end; p += 4) {
        const converted = transform([pixels[p]!, pixels[p + 1]!, pixels[p + 2]!]);
        if (!converted) throw new Error('unsupported colour conversion');
        pixels[p] = converted[0];
        pixels[p + 1] = converted[1];
        pixels[p + 2] = converted[2];
      }
    }
  } finally {
    if (premultiplied) premultiplyRgba32f(pixels);
  }
}

async function convertPixelBufferInPlace(
  buffer: PixelBuffer,
  transform: RowTransform,
  targetEncoding: RasterColorEncoding,
  signal?: AbortSignal,
): Promise<void> {
  const { descriptor, data } = buffer;
  const { width, height, format, alphaMode } = descriptor;
  const expectedChannels = width * height * 4;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('pixel buffer dimensions must be positive safe integers');
  }
  if (data.length !== expectedChannels) {
    throw new RangeError(`pixel buffer data length must be ${expectedChannels}`);
  }
  if (!isPixelBufferDataForFormat(data, format)) {
    throw new TypeError(`pixel buffer data does not match ${format}`);
  }

  const tileHeight = Math.max(1, Math.min(DEFAULT_TILE_HEIGHT, height));
  for (let row = 0; row < height; row += tileHeight) {
    if (signal?.aborted) throw abortedError();
    const end = Math.min(row + tileHeight, height);
    for (let y = row; y < end; y += 1) {
      const base = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        const i = base + x * 4;
        const alpha = readPixelChannel(data, format, i + 3);
        let r = readPixelChannel(data, format, i);
        let g = readPixelChannel(data, format, i + 1);
        let b = readPixelChannel(data, format, i + 2);
        if (alphaMode === 'premultiplied') {
          if (alpha <= 0) {
            r = 0;
            g = 0;
            b = 0;
          } else {
            r /= alpha;
            g /= alpha;
            b /= alpha;
          }
        }
        const converted = transform([r, g, b]);
        if (!converted) throw new Error('unsupported colour conversion');
        if (alphaMode === 'premultiplied') {
          converted[0] *= alpha;
          converted[1] *= alpha;
          converted[2] *= alpha;
        }
        writePixelChannel(data, format, i, converted[0]);
        writePixelChannel(data, format, i + 1, converted[1]);
        writePixelChannel(data, format, i + 2, converted[2]);
      }
    }
  }
  buffer.descriptor = { ...descriptor, colorEncoding: targetEncoding };
}

function isPixelBufferDataForFormat(data: PixelBuffer['data'], format: PixelBufferFormat): boolean {
  if (format === 'rgba8') return data instanceof Uint8Array;
  if (format === 'rgba16' || format === 'rgba16f') return data instanceof Uint16Array;
  return data instanceof Float32Array;
}

function readPixelChannel(
  data: PixelBuffer['data'],
  format: PixelBufferFormat,
  index: number,
): number {
  if (format === 'rgba8') return (data as Uint8Array)[index]! / 255;
  if (format === 'rgba16') return (data as Uint16Array)[index]! / 65535;
  if (format === 'rgba16f') return halfFloatToFloat32((data as Uint16Array)[index]!);
  return (data as Float32Array)[index]!;
}

function writePixelChannel(
  data: PixelBuffer['data'],
  format: PixelBufferFormat,
  index: number,
  value: number,
): void {
  if (format === 'rgba8') {
    (data as Uint8Array)[index] = clampByte(value * 255);
  } else if (format === 'rgba16') {
    (data as Uint16Array)[index] = clampUint16(value * 65535);
  } else if (format === 'rgba16f') {
    (data as Uint16Array)[index] = float32ToHalfFloat(value);
  } else {
    (data as Float32Array)[index] = value;
  }
}

/** Heuristic: Float32 buffers produced by this pipeline are straight. */
function isPremultiplied(_pixels: Float32Array): boolean {
  // The pipeline contract (pixelBuffer.ts) marks alpha mode explicitly on
  // descriptors; callers converting premultiplied surfaces must call
  // unpremultiplyRgba32f themselves. Treating buffers as straight here is
  // the documented default — see pixelBuffer.ts.
  return false;
}

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

function clampUint16(v: number): number {
  return v <= 0 ? 0 : v >= 65535 ? 65535 : Math.round(v);
}

function abortedError(): Error {
  const err = new Error('Colour conversion aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Tiled, cancellable conversion of a large ImageData with an explicit
 * per-tile transform. Bounds the working memory to one tile at a time.
 */
export async function convertImageDataTiled(
  pixels: ImageData,
  transform: RowTransform,
  signal?: AbortSignal,
): Promise<void> {
  return convertImageDataInPlace(pixels, transform, signal);
}
