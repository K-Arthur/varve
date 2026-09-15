/**
 * Bounded coverage-plane operations for selection refinement and matting.
 *
 * Every function here is pure, DOM-free, and takes/returns typed arrays so the
 * same code runs on the main thread, in workers, and under test with no
 * canvas dependency. Coverage is an 8-bit plane: 0 = outside, 255 = inside,
 * intermediate values = fractional coverage.
 *
 * Algorithm provenance:
 * - van Herk (1992) / Gil & Werman (1993) sliding-window min/max: at most
 *   three comparisons per sample, independent of the window radius.
 * - Felzenszwalb & Huttenlocher (2012) generalized distance transform: exact
 *   squared Euclidean distance in O(N) with a lower-envelope-of-parabolas pass.
 * - Separable Gaussian feathering (GIMP's `Selection.feather` is documented as
 *   a Gaussian blur).
 * - Grey-scale closing/opening for boundary smoothing; pixels whose 50%
 *   classification is unchanged keep their original coverage, so a convex
 *   hard selection is a true no-op rather than a blur.
 *
 * Border policy: out-of-plane samples are excluded from morphology (so a
 * selection touching the canvas edge is not eroded from that edge) and the
 * Gaussian re-normalizes at the border so a selection touching the plane edge
 * does not acquire an unexplained fade.
 */

export type MorphologyMode = 'dilate' | 'erode';
export type BorderPolicy = 'exclude' | 'clamp';
export type BorderPlacement = 'inside' | 'outside' | 'centered';

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * O(N) sliding-window box sum with a clamped (replicated) border.
 *
 * The output is the sum of `(2r+1)²` in-bounds samples around each pixel. This
 * is the statistic the guided filter needs; it replaces the previous
 * O(N·r²) nested loop. Accumulation is Float64 so large radii over
 * full-resolution planes stay exact for 8-bit inputs.
 */
export function boxSumPlane(
  src: Float32Array | Uint8Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, width * height));
  const scratch = new Float32Array(Math.max(0, width * height));
  if (out.length === 0) return out;
  boxSumInto(toFloat32(src), out, scratch, width, height, radius);
  return out;
}

function toFloat32(src: Float32Array | Uint8Array): Float32Array {
  if (src instanceof Float32Array) return src;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 1) out[i] = src[i]!;
  return out;
}

/**
 * Allocation-free O(N) box sum. `dst` and `scratch` must already be sized
 * `width * height`; the caller owns them so iterative solvers do not churn
 * typed arrays on every matrix-vector product.
 */
export function boxSumInto(
  src: Float32Array,
  dst: Float32Array,
  scratch: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.floor(radius));
  const n = width * height;
  if (n === 0) return;
  const horizontal = scratch;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x += 1) {
      sum += src[row + Math.min(width - 1, Math.max(0, x))] ?? 0;
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum;
      const add = Math.min(width - 1, Math.max(0, x + r + 1));
      const remove = Math.min(width - 1, Math.max(0, x - r));
      sum += (src[row + add] ?? 0) - (src[row + remove] ?? 0);
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) {
      sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x]!;
    }
    for (let y = 0; y < height; y += 1) {
      dst[y * width + x] = sum;
      const add = Math.min(height - 1, Math.max(0, y + r + 1));
      const remove = Math.min(height - 1, Math.max(0, y - r));
      sum += horizontal[add * width + x]! - horizontal[remove * width + x]!;
    }
  }
}

/** Mean of `(2r+1)²` samples, derived from the sliding box sum. */
export function boxMeanPlane(
  src: Float32Array | Uint8Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const sums = boxSumPlane(src, width, height, radius);
  const r = Math.max(0, Math.floor(radius));
  const area = (2 * r + 1) * (2 * r + 1);
  const out = new Float32Array(sums.length);
  for (let i = 0; i < sums.length; i += 1) out[i] = sums[i]! / area;
  return out;
}

/**
 * 1-D sliding-window extrema over a line, in place.
 *
 * The line is expected to already be padded by `size - 1` samples (with
 * neutral values for `'exclude'`, replicated edges for `'clamp'`), so every
 * output window is fully in range and no boundary special-casing is needed.
 */
function extremaLine(line: Float32Array, length: number, size: number, mode: MorphologyMode): void {
  const isMax = mode === 'dilate';
  const half = (size - 1) >> 1;
  const suffix = new Float32Array(length);
  const prefix = new Float32Array(length);
  for (let base = 0; base < length; base += size) {
    const end = Math.min(length - 1, base + size - 1);
    let acc = line[end]!;
    for (let i = end; i >= base; i -= 1) {
      const value = line[i]!;
      if (isMax ? value > acc : value < acc) acc = value;
      suffix[i] = acc;
    }
    acc = line[base]!;
    for (let i = base; i <= end; i += 1) {
      const value = line[i]!;
      if (isMax ? value > acc : value < acc) acc = value;
      prefix[i] = acc;
    }
  }
  for (let i = 0; i < length; i += 1) {
    const left = Math.max(0, i - half);
    const right = Math.min(length - 1, i + half);
    const a = suffix[left]!;
    const b = prefix[right]!;
    line[i] = isMax ? Math.max(a, b) : Math.min(a, b);
  }
}

/**
 * Separable sliding-window min/max (van Herk / Gil-Werman).
 *
 * `border: 'exclude'` ignores out-of-plane samples (the default for selection
 * growth so a canvas-edge selection is not eroded from the edge);
 * `border: 'clamp'` replicates the edge sample (the historical maskOps
 * behaviour).
 */
export function greyMorphPlane(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number,
  mode: MorphologyMode,
  border: BorderPolicy = 'exclude',
): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(Math.max(0, n));
  if (n === 0) return out;
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) {
    out.set(data.subarray(0, n));
    return out;
  }
  const size = 2 * r + 1;
  const neutral = mode === 'dilate' ? 0 : 255;
  const paddedWidth = width + 2 * r;
  const paddedHeight = height + 2 * r;
  // Uint8 storage: coverage is 8-bit, and a 50 MP plane padded for a large
  // radius would otherwise cost four times as much for no precision gain.
  const buffer = new Uint8Array(paddedWidth * paddedHeight);
  buffer.fill(neutral);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      buffer[(y + r) * paddedWidth + x + r] = data[y * width + x]!;
    }
  }
  if (border === 'clamp') {
    for (let y = 0; y < height; y += 1) {
      const row = (y + r) * paddedWidth;
      const first = data[y * width]!;
      const last = data[y * width + width - 1]!;
      for (let x = 0; x < r; x += 1) {
        buffer[row + x] = first;
        buffer[row + width + r + x] = last;
      }
    }
    for (let x = 0; x < paddedWidth; x += 1) {
      const first = buffer[x]!;
      const last = buffer[(height + r - 1) * paddedWidth + x]!;
      for (let y = 0; y < r; y += 1) buffer[y * paddedWidth + x] = first;
      for (let y = height + r; y < paddedHeight; y += 1) buffer[y * paddedWidth + x] = last;
    }
  }

  const line = new Float32Array(paddedWidth);
  for (let y = 0; y < paddedHeight; y += 1) {
    const row = y * paddedWidth;
    line.set(buffer.subarray(row, row + paddedWidth));
    extremaLine(line, paddedWidth, size, mode);
    buffer.set(line, row);
  }
  const column = new Float32Array(paddedHeight);
  for (let x = 0; x < paddedWidth; x += 1) {
    for (let y = 0; y < paddedHeight; y += 1) column[y] = buffer[y * paddedWidth + x]!;
    extremaLine(column, paddedHeight, size, mode);
    for (let y = 0; y < paddedHeight; y += 1) buffer[y * paddedWidth + x] = column[y]!;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = Math.max(
        0,
        Math.min(255, Math.round(buffer[(y + r) * paddedWidth + x + r]!)),
      );
    }
  }
  return out;
}

/** Grey-scale dilation (grow). Coverage values are preserved. */
export function growPlane(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number,
  border: BorderPolicy = 'exclude',
): Uint8Array {
  return greyMorphPlane(data, width, height, radius, 'dilate', border);
}

/** Grey-scale erosion (shrink). Coverage values are preserved. */
export function shrinkPlane(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number,
  border: BorderPolicy = 'exclude',
): Uint8Array {
  return greyMorphPlane(data, width, height, radius, 'erode', border);
}

/**
 * Exact squared Euclidean distance to the nearest non-zero sample using the
 * Felzenszwalb-Huttenlocher lower-envelope transform. `Infinity` when the
 * plane has no foreground at all. Float32 keeps a 16 MP plane well inside
 * memory while remaining exact for distances up to ~4096 px.
 */
export function squaredEDT(binary: Uint8Array, width: number, height: number): Float32Array {
  const n = width * height;
  const out = new Float32Array(Math.max(0, n));
  if (n === 0) return out;
  out.fill(Number.POSITIVE_INFINITY);

  const distance1d = (f: Float32Array, length: number, target: Float32Array) => {
    const v = new Int32Array(length);
    const z = new Float64Array(length + 1);
    let seed = -1;
    for (let q = 0; q < length; q += 1) {
      if (Number.isFinite(f[q]!)) {
        seed = q;
        break;
      }
    }
    if (seed < 0) {
      for (let q = 0; q < length; q += 1) target[q] = Number.POSITIVE_INFINITY;
      return;
    }
    let k = 0;
    v[0] = seed;
    z[0] = Number.NEGATIVE_INFINITY;
    z[1] = Number.POSITIVE_INFINITY;
    for (let q = seed + 1; q < length; q += 1) {
      if (!Number.isFinite(f[q]!)) continue;
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k -= 1;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Number.POSITIVE_INFINITY;
    }
    k = 0;
    for (let q = 0; q < length; q += 1) {
      while (z[k + 1]! < q) k += 1;
      const delta = q - v[k]!;
      target[q] = delta * delta + f[v[k]!]!;
    }
  };

  const line = new Float32Array(Math.max(width, height));
  const pass = new Float32Array(Math.max(width, height));
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      line[y] = binary[y * width + x] ? 0 : Number.POSITIVE_INFINITY;
    }
    distance1d(line, height, pass);
    for (let y = 0; y < height; y += 1) out[y * width + x] = pass[y]!;
  }
  for (let y = 0; y < height; y += 1) {
    line.set(out.subarray(y * width, y * width + width));
    distance1d(line.subarray(0, width), width, pass);
    out.set(pass.subarray(0, width), y * width);
  }
  return out;
}

export interface SignedDistanceField {
  /** Signed distance to the 50% contour in pixels; negative inside. */
  signed: Float32Array;
  /** True when the thresholded plane contains both foreground and background. */
  hasBoundary: boolean;
}

/**
 * Signed distance field of the 50% contour of a coverage plane.
 *
 * `signed` is negative inside the selection and positive outside; zero is the
 * pixel-center contour. The sign convention matches the matting/trimap code.
 */
export function signedDistancePlane(
  data: Uint8Array,
  width: number,
  height: number,
  threshold = 128,
): SignedDistanceField {
  const n = width * height;
  const signed = new Float32Array(Math.max(0, n));
  if (n === 0) return { signed, hasBoundary: false };
  const insideMask = new Uint8Array(n);
  let insideCount = 0;
  for (let i = 0; i < n; i += 1) {
    if ((data[i] ?? 0) >= threshold) {
      insideMask[i] = 1;
      insideCount += 1;
    }
  }
  const hasBoundary = insideCount > 0 && insideCount < n;
  if (!hasBoundary) return { signed, hasBoundary };
  const outsideMask = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) outsideMask[i] = insideMask[i] ? 0 : 1;
  const insideDist = squaredEDT(insideMask, width, height);
  const outsideDist = squaredEDT(outsideMask, width, height);
  for (let i = 0; i < n; i += 1) {
    signed[i] = Math.sqrt(insideDist[i] ?? 0) - Math.sqrt(outsideDist[i] ?? 0);
  }
  return { signed, hasBoundary };
}

/**
 * Separable Gaussian blur of a coverage plane with edge-lock normalization.
 *
 * The kernel is sampled at sigma (`radius = ceil(3·sigma)`); out-of-plane taps
 * are dropped and each pixel is divided by the weight actually collected, so a
 * selection touching the plane edge does not fade there. `sigma <= 0` returns
 * an exact copy.
 */
export function gaussianBlurPlane(
  data: Uint8Array,
  width: number,
  height: number,
  sigma: number,
): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(Math.max(0, n));
  if (n === 0) return out;
  const s = Math.max(0, Number.isFinite(sigma) ? sigma : 0);
  if (!(s > 0)) {
    out.set(data.subarray(0, n));
    return out;
  }
  const radius = Math.max(1, Math.ceil(s * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const value = Math.exp(-(i * i) / (2 * s * s));
    kernel[i + radius] = value;
    total += value;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] = kernel[i]! / total;

  const temp = new Float64Array(n);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let weight = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = x + k;
        if (sx < 0 || sx >= width) continue;
        const w = kernel[k + radius]!;
        sum += (data[row + sx] ?? 0) * w;
        weight += w;
      }
      temp[row + x] = weight > 0 ? sum / weight : data[row + x]!;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      let weight = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = y + k;
        if (sy < 0 || sy >= height) continue;
        const w = kernel[k + radius]!;
        sum += temp[sy * width + x]! * w;
        weight += w;
      }
      const value = weight > 0 ? sum / weight : temp[y * width + x]!;
      out[y * width + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return out;
}

/**
 * Antialias a boundary without broadening it beyond one pixel.
 *
 * Only pixels whose 3×3 neighborhood straddles the 50% contour are replaced
 * with a binomial [1 2 1]/4 separable average; everything else is copied
 * byte-for-byte. The plane border is never invented as a boundary.
 */
export function antialiasPlane(data: Uint8Array, width: number, height: number): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(Math.max(0, n));
  if (n === 0) return out;
  const binary = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) binary[i] = (data[i] ?? 0) >= 128 ? 1 : 0;
  const weightX = [1, 2, 1] as const;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const here = binary[i]!;
      let same = 0;
      let other = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (binary[ny * width + nx] === here) same += 1;
          else other += 1;
        }
      }
      // Only a genuine in-plane transition between classes is antialiased.
      if (!(same > 0 && other > 0)) {
        out[i] = data[i]!;
        continue;
      }
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const wy = weightX[dy + 1]!;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const w = weightX[dx + 1]! * wy;
          sum += (data[ny * width + nx] ?? 0) * w;
          weight += w;
        }
      }
      out[i] = weight > 0 ? Math.round(sum / weight) : data[i]!;
    }
  }
  return out;
}

/** Hard ring coverage around the 50% contour. */
export function borderPlane(
  data: Uint8Array,
  width: number,
  height: number,
  band: number,
  placement: BorderPlacement = 'centered',
): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(Math.max(0, n));
  const w = finiteNonNegative(band);
  if (n === 0 || w <= 0) return out;
  const field = signedDistancePlane(data, width, height);
  if (!field.hasBoundary) return out;
  const half = w / 2;
  for (let i = 0; i < n; i += 1) {
    const s = field.signed[i]!;
    let inside = false;
    if (placement === 'centered') inside = Math.abs(s) <= half;
    else if (placement === 'inside') inside = s <= 0 && s >= -w;
    else inside = s >= 0 && s <= w;
    out[i] = inside ? 255 : 0;
  }
  return out;
}

/**
 * Translate the coverage profile along the local boundary normal.
 *
 * Positive `amount` expands the selection, negative contracts it. The profile
 * is resampled from the source plane with bilinear interpolation and clamped
 * coordinates, which preserves the existing soft transition instead of
 * replacing it with a hard edge. `amount === 0` is byte-exact.
 */
export function shiftEdgePlane(
  data: Uint8Array,
  width: number,
  height: number,
  amount: number,
): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(Math.max(0, n));
  const shift = Number.isFinite(amount) ? amount : 0;
  if (n === 0) return out;
  if (shift === 0) {
    out.set(data.subarray(0, n));
    return out;
  }
  const field = signedDistancePlane(data, width, height);
  if (!field.hasBoundary) {
    out.set(data.subarray(0, n));
    return out;
  }
  const sample = (px: number, py: number): number => {
    const cx = Math.min(width - 1, Math.max(0, px));
    const cy = Math.min(height - 1, Math.max(0, py));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = cx - x0;
    const ty = cy - y0;
    const top = (data[y0 * width + x0] ?? 0) * (1 - tx) + (data[y0 * width + x1] ?? 0) * tx;
    const bottom = (data[y1 * width + x0] ?? 0) * (1 - tx) + (data[y1 * width + x1] ?? 0) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const s = field.signed[i]!;
      if (Math.abs(s) > Math.abs(shift) + 2) {
        out[i] = data[i]!;
        continue;
      }
      const left = field.signed[y * width + Math.max(0, x - 1)]!;
      const right = field.signed[y * width + Math.min(width - 1, x + 1)]!;
      const up = field.signed[Math.max(0, y - 1) * width + x]!;
      const down = field.signed[Math.min(height - 1, y + 1) * width + x]!;
      let gx = (right - left) / 2;
      let gy = (down - up) / 2;
      const length = Math.hypot(gx, gy);
      if (length > 1e-6) {
        gx /= length;
        gy /= length;
      } else {
        gx = 0;
        gy = 0;
      }
      // Move the boundary outward for a positive shift: sample the source
      // inward along the outward normal.
      out[i] = Math.max(0, Math.min(255, Math.round(sample(x - gx * shift, y - gy * shift))));
    }
  }
  return out;
}

/**
 * Steepen the coverage transition with a level remap around 0.5.
 * `amount` is clamped to [0,1]; 0 copies, 1 thresholds at 0.5 (removes grey).
 */
export function contrastPlane(data: Uint8Array, amount: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, data.length));
  const a = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
  if (a <= 0) {
    out.set(data);
    return out;
  }
  const t = a * 0.5;
  const span = 1 - a;
  for (let i = 0; i < data.length; i += 1) {
    const value = (data[i] ?? 0) / 255;
    const mapped = span <= 0 ? (value >= 0.5 ? 1 : 0) : (value - t) / span;
    out[i] = Math.max(0, Math.min(255, Math.round(mapped * 255)));
  }
  return out;
}

export interface CleanupOptions {
  /** Remove 4-connected islands strictly smaller than this many pixels. */
  minIslandArea?: number;
  /** Fill 4-connected holes (not touching the plane border) up to this area. */
  maxHoleArea?: number;
  /** Coverage threshold separating foreground from background. */
  threshold?: number;
}

/**
 * Remove small islands and fill small enclosed holes, preserving the coverage
 * values of every retained pixel. Components are collected with an explicit
 * stack, so no recursion depth or per-pixel allocation is involved.
 */
export function cleanupPlane(
  data: Uint8Array,
  width: number,
  height: number,
  options: CleanupOptions = {},
): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(data.subarray(0, Math.min(n, data.length)));
  if (n === 0) return out;
  const minIsland = Math.floor(finiteNonNegative(options.minIslandArea ?? 0));
  const maxHole = Math.floor(finiteNonNegative(options.maxHoleArea ?? 0));
  if (minIsland <= 0 && maxHole <= 0) return out;
  const threshold = Math.max(
    1,
    Math.min(254, Number.isFinite(options.threshold) ? options.threshold! : 128),
  );
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const component = new Int32Array(n);
  const inside = (i: number) => (data[i] ?? 0) >= threshold;
  const flood = (seed: number, wantInside: boolean): { size: number; border: boolean } => {
    let top = 0;
    let size = 0;
    let touchesBorder = false;
    stack[top++] = seed;
    visited[seed] = 1;
    while (top > 0) {
      const cur = stack[--top]!;
      component[size++] = cur;
      const x = cur % width;
      const y = (cur - x) / width;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) touchesBorder = true;
      for (let k = 0; k < 4; k += 1) {
        const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (visited[ni] || inside(ni) !== wantInside) continue;
        visited[ni] = 1;
        stack[top++] = ni;
      }
    }
    return { size, border: touchesBorder };
  };

  if (maxHole > 0) {
    for (let seed = 0; seed < n; seed += 1) {
      if (visited[seed] || inside(seed)) continue;
      const { size, border } = flood(seed, false);
      if (!border && size <= maxHole) {
        for (let i = 0; i < size; i += 1) out[component[i]!] = 255;
      }
    }
    visited.fill(0);
  }
  if (minIsland > 0) {
    for (let seed = 0; seed < n; seed += 1) {
      if (visited[seed] || !inside(seed)) continue;
      const { size } = flood(seed, true);
      if (size < minIsland) {
        for (let i = 0; i < size; i += 1) out[component[i]!] = 0;
      }
    }
  }
  return out;
}

/**
 * Morphological open+close boundary smoothing.
 *
 * The 50% shape is closed then opened with a square radius-`radius` element,
 * which removes small gaps, spikes, and boundary noise without blurring.
 * Pixels whose 50% classification is unchanged keep their original coverage,
 * so a convex hard selection is a true no-op and existing soft transitions
 * inside or outside the smoothed shape are preserved.
 */
export function smoothShapePlane(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(Math.max(0, n));
  const r = Math.floor(finiteNonNegative(radius));
  if (n === 0) return out;
  if (r === 0) {
    out.set(data.subarray(0, n));
    return out;
  }
  const binary = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) binary[i] = (data[i] ?? 0) >= 128 ? 255 : 0;
  // Closing fills gaps, opening removes protrusions, both with exact square
  // morphology; the result is a membership plane at the 50% level.
  const closed = greyMorphPlane(
    greyMorphPlane(binary, width, height, r, 'dilate'),
    width,
    height,
    r,
    'erode',
  );
  const smoothed = greyMorphPlane(
    greyMorphPlane(closed, width, height, r, 'erode'),
    width,
    height,
    r,
    'dilate',
  );
  for (let i = 0; i < n; i += 1) {
    const original = binary[i]! >= 128;
    const next = smoothed[i]! >= 128;
    if (original === next) out[i] = data[i]!;
    else out[i] = next ? 255 : 0;
  }
  return out;
}

/** Binary membership at a coverage threshold. */
export function coverageThreshold(data: Uint8Array, threshold = 0.5): Uint8Array {
  const out = new Uint8Array(Math.max(0, data.length));
  const cut = Math.max(0, Math.min(1, threshold)) * 255;
  for (let i = 0; i < data.length; i += 1) out[i] = (data[i] ?? 0) >= cut ? 255 : 0;
  return out;
}
