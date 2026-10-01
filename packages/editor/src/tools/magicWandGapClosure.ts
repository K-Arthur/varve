import { linearSrgbToOklab, srgbToLinearUnit } from '@varve/shared';

const MAX_GAP_CLOSURE_RADIUS = 8;
const MAX_GAP_CLOSURE_PIXELS = 16_777_216;
const LINES_PER_YIELD = 128;
const SAMPLES_PER_YIELD = 65_536;

export interface GapClosureImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface GapClosureOptions {
  readonly target: { readonly r: number; readonly g: number; readonly b: number };
  /** Same OKLab distance and feather reach used by areaSelectionFromColorRange. */
  readonly reach: number;
  /** Radius in sample pixels. Square closing bridges gaps no wider than about 2r. */
  readonly radius: number;
  readonly signal?: AbortSignal;
}

export type GapClosureResult = 'unchanged' | 'closed' | 'cancelled';

function toOklab(r: number, g: number, b: number): [number, number, number] {
  return linearSrgbToOklab([
    srgbToLinearUnit(r / 255),
    srgbToLinearUnit(g / 255),
    srgbToLinearUnit(b / 255),
  ]);
}

function distanceToOklab(
  target: readonly [number, number, number],
  red: number,
  green: number,
  blue: number,
): number {
  const r = srgbToLinearUnit(red / 255);
  const g = srgbToLinearUnit(green / 255);
  const b = srgbToLinearUnit(blue / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const chroma = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.sqrt((target[0] - lightness) ** 2 + (target[1] - a) ** 2 + (target[2] - chroma) ** 2);
}

function morphologyValue(
  input: Uint8Array,
  offset: number,
  coordinate: number,
  stride: number,
  lineLength: number,
  dilate: boolean,
): number {
  if (coordinate < 0 || coordinate >= lineLength) return dilate ? 0 : 1;
  return input[offset + coordinate * stride] ?? 0;
}

async function morphAxis(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  dilate: boolean,
  signal?: AbortSignal,
): Promise<boolean> {
  const lineCount = horizontal ? height : width;
  const lineLength = horizontal ? width : height;
  const windowSize = radius * 2 + 1;

  for (let lineStart = 0; lineStart < lineCount; lineStart += LINES_PER_YIELD) {
    if (signal?.aborted) return false;
    const lineEnd = Math.min(lineCount, lineStart + LINES_PER_YIELD);
    for (let line = lineStart; line < lineEnd; line += 1) {
      const lineOffset = horizontal ? line * width : line;
      const stride = horizontal ? 1 : width;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        count += morphologyValue(input, lineOffset, offset, stride, lineLength, dilate);
      }
      for (let coordinate = 0; coordinate < lineLength; coordinate += 1) {
        const index = lineOffset + coordinate * stride;
        output[index] = dilate ? Number(count > 0) : Number(count === windowSize);
        count +=
          morphologyValue(input, lineOffset, coordinate + radius + 1, stride, lineLength, dilate) -
          morphologyValue(input, lineOffset, coordinate - radius, stride, lineLength, dilate);
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return !signal?.aborted;
}

/** Close short non-matching barriers before a visible-artwork contiguous fill. */
export async function closeMagicWandGaps(
  image: GapClosureImage,
  options: GapClosureOptions,
): Promise<GapClosureResult> {
  const { width, height, data } = image;
  const radius = Number.isFinite(options.radius)
    ? Math.round(Math.max(0, Math.min(MAX_GAP_CLOSURE_RADIUS, options.radius)))
    : 0;
  if (
    radius === 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > Math.floor(MAX_GAP_CLOSURE_PIXELS / height) ||
    !Number.isFinite(options.reach) ||
    options.reach < 0 ||
    data.length !== width * height * 4
  ) {
    return options.signal?.aborted ? 'cancelled' : 'unchanged';
  }
  if (options.signal?.aborted) return 'cancelled';

  const count = width * height;
  // Three byte-per-sample planes cap temporary workspace at 48 MiB for the
  // 16-megapixel artwork sampler; source RGBA is reused rather than copied.
  const matching = new Uint8Array(count);
  const barrier = new Uint8Array(count);
  const scratch = new Uint8Array(count);
  const targetLab = toOklab(options.target.r, options.target.g, options.target.b);
  for (let start = 0; start < count; start += SAMPLES_PER_YIELD) {
    if (options.signal?.aborted) return 'cancelled';
    const end = Math.min(count, start + SAMPLES_PER_YIELD);
    for (let index = start; index < end; index += 1) {
      const offset = index * 4;
      const alpha = (data[offset + 3] ?? 0) / 255;
      if (alpha > 0) {
        const distance = distanceToOklab(
          targetLab,
          data[offset] ?? 0,
          data[offset + 1] ?? 0,
          data[offset + 2] ?? 0,
        );
        matching[index] = Number(distance <= options.reach);
      }
      barrier[index] = Number(matching[index] === 0);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  if (
    !(await morphAxis(barrier, scratch, width, height, radius, true, true, options.signal)) ||
    !(await morphAxis(scratch, barrier, width, height, radius, false, true, options.signal)) ||
    !(await morphAxis(barrier, scratch, width, height, radius, true, false, options.signal)) ||
    !(await morphAxis(scratch, barrier, width, height, radius, false, false, options.signal))
  ) {
    return 'cancelled';
  }

  let changed = false;
  for (let start = 0; start < count; start += SAMPLES_PER_YIELD) {
    if (options.signal?.aborted) return 'cancelled';
    const end = Math.min(count, start + SAMPLES_PER_YIELD);
    for (let index = start; index < end; index += 1) {
      // Only turn formerly matching pixels into the repaired barrier. Original
      // dark/non-matching artwork remains byte-for-byte untouched.
      if (matching[index] === 1 && barrier[index] === 1) {
        data[index * 4 + 3] = 0;
        changed = true;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return options.signal?.aborted ? 'cancelled' : changed ? 'closed' : 'unchanged';
}
