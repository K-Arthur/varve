import { linearToSrgbUnit, srgbToLinearUnit } from '@varve/shared';
import { gaussianKernel, normalizeBlurRadius } from './blur';

export interface UnsharpMaskOptions {
  amount: number;
  radius: number;
  threshold: number;
  luminanceOnly: boolean;
  protectAlpha: boolean;
  workingSpace: 'srgb' | 'linear-srgb';
}

const SCRATCH_BYTES = 16 * 1024 * 1024;
const BLOCK_HEIGHT = 64;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

function decodeTable(linear: boolean): Float64Array {
  return Float64Array.from({ length: 256 }, (_, i) =>
    linear ? srgbToLinearUnit(i / 255) : i / 255,
  );
}

function horizontalRows(
  source: ImageData,
  table: Float64Array,
  kernel: number[],
  left: number,
  top: number,
  width: number,
  rows: number,
): Float64Array {
  const buffer = new Float64Array(width * rows * 4);
  const support = (kernel.length - 1) / 2;
  for (let row = 0; row < rows; row++) {
    const y = Math.max(0, Math.min(source.height - 1, top + row));
    for (let x = 0; x < width; x++) {
      const offset = (row * width + x) * 4;
      for (let k = 0; k < kernel.length; k++) {
        const sx = Math.max(0, Math.min(source.width - 1, left + x + k - support));
        const input = (y * source.width + sx) * 4;
        const weight = (kernel[k]! * source.data[input + 3]!) / 255;
        buffer[offset] = buffer[offset]! + table[source.data[input]!]! * weight;
        buffer[offset + 1] = buffer[offset + 1]! + table[source.data[input + 1]!]! * weight;
        buffer[offset + 2] = buffer[offset + 2]! + table[source.data[input + 2]!]! * weight;
        buffer[offset + 3] = buffer[offset + 3]! + weight;
      }
    }
  }
  return buffer;
}

function writePixel(
  source: ImageData,
  output: Uint8ClampedArray,
  offset: number,
  blurred: readonly number[],
  table: Float64Array,
  options: UnsharpMaskOptions,
): void {
  const alpha = source.data[offset + 3]!;
  if (alpha === 0 || blurred[3]! <= 0) return;
  const r = table[source.data[offset]!]!,
    g = table[source.data[offset + 1]!]!,
    b = table[source.data[offset + 2]!]!;
  const weight = blurred[3]!;
  let dr = r - blurred[0]! / weight,
    dg = g - blurred[1]! / weight,
    db = b - blurred[2]! / weight;
  if (options.luminanceOnly) {
    const delta = LUMA[0] * dr + LUMA[1] * dg + LUMA[2] * db;
    dr = delta;
    dg = delta;
    db = delta;
  }
  const magnitude = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
  if (magnitude <= Math.max(options.threshold, 1e-12)) return;
  const factor = options.amount * (options.protectAlpha ? alpha / 255 : 1);
  const values = [r + factor * dr, g + factor * dg, b + factor * db];
  for (let c = 0; c < 3; c++) {
    const value = Math.max(0, Math.min(1, values[c]!));
    output[offset + c] = Math.round(
      255 * (options.workingSpace === 'linear-srgb' ? linearToSrgbUnit(value) : value),
    );
  }
}

/**
 * Straight RGBA8 → floating alpha-weighted blur/subtraction → straight RGBA8.
 * Radius retains the shared three-sigma support convention. Halo rows always
 * sample the original source, including across block boundaries. Scratch is
 * bounded to 16 MiB; no full-size floating image or quantized blur is created.
 */
export function applyUnsharpMask(source: ImageData, options: UnsharpMaskOptions): ImageData {
  const output = new Uint8ClampedArray(source.data);
  const radius = normalizeBlurRadius(options.radius);
  if (!Number.isFinite(options.amount) || options.amount <= 0 || radius === 0) {
    return new ImageData(output, source.width, source.height);
  }
  const safe = {
    ...options,
    amount: Math.min(40.96, options.amount),
    threshold: Number.isFinite(options.threshold) ? Math.max(0, options.threshold) : 0,
  };
  const table = decodeTable(options.workingSpace === 'linear-srgb');
  const kernel = gaussianKernel(radius);
  const support = (kernel.length - 1) / 2;
  const blockWidth = Math.max(
    1,
    Math.min(
      128,
      Math.floor(
        SCRATCH_BYTES / ((BLOCK_HEIGHT + 2 * support) * 4 * Float64Array.BYTES_PER_ELEMENT),
      ),
    ),
  );
  const blurred = [0, 0, 0, 0];
  for (let top = 0; top < source.height; top += BLOCK_HEIGHT) {
    const height = Math.min(BLOCK_HEIGHT, source.height - top);
    for (let left = 0; left < source.width; left += blockWidth) {
      const width = Math.min(blockWidth, source.width - left);
      const rows = horizontalRows(
        source,
        table,
        kernel,
        left,
        top - support,
        width,
        height + 2 * support,
      );
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          blurred.fill(0);
          for (let k = 0; k < kernel.length; k++) {
            const offset = ((y + k) * width + x) * 4;
            for (let c = 0; c < 4; c++) blurred[c] = blurred[c]! + rows[offset + c]! * kernel[k]!;
          }
          writePixel(
            source,
            output,
            ((top + y) * source.width + left + x) * 4,
            blurred,
            table,
            safe,
          );
        }
      }
    }
  }
  return new ImageData(output, source.width, source.height);
}
