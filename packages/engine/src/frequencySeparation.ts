/**
 * Frequency separation — tone/colour vs texture decomposition on 8-bit RGBA.
 *
 * Contract
 * --------
 *   I = source bytes
 *   L = gaussian low-pass of I (RGB), alpha passthrough
 *   H = I − L                      (signed, integer per RGB channel)
 *   E = encode(H)                  (stored high band)
 *   R = decode(L, E)               (reconstruction)
 *
 * `R` reconstructs `I` for every pixel whose stored `L` and `E` are unedited.
 * The declared, measured tolerance of the 8-bit encoded representation is:
 *
 *   - `max |R − I| ≤ 1` per channel (hard bound),
 *   - `mean |R − I| ≤ 0.5` per channel (theoretical bound; ~0.5 on dense
 *     texture, exactly 0 on flat or piecewise-constant content, because even
 *     residuals round-trip exactly and only odd residuals can be off by one),
 *   - reconstruction clamps like ordinary compositing; it never wraps.
 *
 * The encoding is `E = clamp(round(H/2) + 128)` and the decode is
 * `H' = 2·(E − 128)`. Neutral detail is therefore exactly 128, so painting a
 * detail band with 50 % gray is a true no-op. The last LSB is the documented
 * price of an 8-bit working representation; Varve does not advertise a
 * 16-bit/float frequency-separation path, and this contract is what the UI
 * and tests hold the feature to.
 *
 * Working domain
 * --------------
 * Everything runs on sRGB-encoded bytes, matching the compositor's working
 * representation. Alpha is never part of the signed equation: the low band
 * carries the source coverage and the decode takes alpha from it, so the
 * result cannot double-attenuate through source-over compositing.
 *
 * Transfer function
 * -----------------
 * The blur itself is computed on *premultiplied* RGB (so hidden RGB under
 * transparent pixels cannot bleed into neighbours), un-premultiplied once, and
 * quantized once. No linear-light decoding is involved; a linear split would
 * change the artist-visible meaning of "tone" without improving reconstruction.
 *
 * Border handling: clamp-to-edge, matching `gaussianBlurSeparable` in this
 * package. Truncation: support = ceil(3σ), so `radius` is sigma in source px.
 */

export const FREQUENCY_SEPARATION_VERSION = 1;

export type FrequencySeparationMethod = 'gaussian';

export const FREQUENCY_SEPARATION_METHODS: readonly FrequencySeparationMethod[] = ['gaussian'];

/** Neutral value of the encoded detail band (50 % gray). */
export const DETAIL_NEUTRAL = 128;

export const MAX_FREQUENCY_SEPARATION_RADIUS = 2048;

export interface FrequencySeparationOptions {
  /** Gaussian sigma in source pixels. `0` is defined as no separation. */
  radius: number;
  method?: FrequencySeparationMethod;
}

/**
 * Normalize a method arriving from a document/plugin boundary. The public
 * type is intentionally narrow, but persisted JSON and IPC payloads are not
 * type-safe. Falling back to the only implemented method keeps the operation
 * honest: callers never receive a result labelled "median" when Gaussian was
 * actually run.
 */
export function normalizeFrequencySeparationMethod(value: unknown): FrequencySeparationMethod {
  return FREQUENCY_SEPARATION_METHODS.includes(value as FrequencySeparationMethod)
    ? (value as FrequencySeparationMethod)
    : 'gaussian';
}

export interface FrequencySeparationBands {
  low: ImageData;
  high: ImageData;
  /** Sigma actually applied after normalization. */
  sigma: number;
  /** Integer kernel support (ceil(3σ)). */
  support: number;
  method: FrequencySeparationMethod;
}

export function normalizeSeparationRadius(radius: number): number {
  if (!Number.isFinite(radius)) return 0;
  return Math.max(0, Math.min(MAX_FREQUENCY_SEPARATION_RADIUS, radius));
}

/** Encode one signed residual sample into a byte. `H = 0` → 128 exactly. */
export function encodeResidualChannel(h: number): number {
  return Math.max(0, Math.min(255, Math.round(h / 2) + DETAIL_NEUTRAL));
}

/** Decode one stored detail sample back into a signed residual. */
export function decodeResidualChannel(e: number): number {
  return 2 * (e - DETAIL_NEUTRAL);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function gaussianKernelForSigma(sigma: number): { kernel: Float64Array; support: number } {
  if (sigma <= 0.3) return { kernel: Float64Array.of(1), support: 0 };
  const support = Math.max(1, Math.ceil(3 * sigma));
  const size = 2 * support + 1;
  const kernel = new Float64Array(size);
  const denom = 2 * sigma * sigma;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - support;
    const v = Math.exp(-(x * x) / denom);
    kernel[i] = v;
    sum += v;
  }
  const inv = 1 / sum;
  for (let i = 0; i < size; i++) kernel[i] = kernel[i]! * inv;
  return { kernel, support };
}

/**
 * Separable gaussian low-pass over premultiplied RGB. Alpha is copied from the
 * source (never blurred) — see the module contract.
 */
function lowPassImageData(source: ImageData, sigma: number): ImageData {
  const w = source.width;
  const h = source.height;
  const low = new Uint8ClampedArray(w * h * 4);
  const src = source.data;
  const { kernel, support } = gaussianKernelForSigma(sigma);
  if (support === 0) {
    // Identity low pass: copy RGB and alpha unchanged.
    low.set(src);
    return new ImageData(low, w, h);
  }

  // Premultiplied float working buffer (straight RGB would bleed hidden
  // colour out of transparent pixels).
  const premul = new Float32Array(w * h * 4);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3]! / 255;
    premul[i] = src[i]! * a;
    premul[i + 1] = src[i + 1]! * a;
    premul[i + 2] = src[i + 2]! * a;
    premul[i + 3] = a;
  }

  const tmp = new Float32Array(premul.length);
  // Horizontal.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < kernel.length; k++) {
        const sx = Math.max(0, Math.min(w - 1, x + k - support));
        const index = (row + sx) * 4;
        const weight = kernel[k]!;
        r += premul[index]! * weight;
        g += premul[index + 1]! * weight;
        b += premul[index + 2]! * weight;
        a += premul[index + 3]! * weight;
      }
      const out = (row + x) * 4;
      tmp[out] = r;
      tmp[out + 1] = g;
      tmp[out + 2] = b;
      tmp[out + 3] = a;
    }
  }
  // Vertical.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < kernel.length; k++) {
        const sy = Math.max(0, Math.min(h - 1, y + k - support));
        const index = (sy * w + x) * 4;
        const weight = kernel[k]!;
        r += tmp[index]! * weight;
        g += tmp[index + 1]! * weight;
        b += tmp[index + 2]! * weight;
        a += tmp[index + 3]! * weight;
      }
      const out = (y * w + x) * 4;
      premul[out] = r;
      premul[out + 1] = g;
      premul[out + 2] = b;
      premul[out + 3] = a;
    }
  }

  // Un-premultiply once, keep source alpha.
  for (let i = 0; i < src.length; i += 4) {
    const a = premul[i + 3]!;
    const sourceAlpha = src[i + 3]!;
    if (sourceAlpha === 0 || a <= 1e-8) {
      low[i] = 0;
      low[i + 1] = 0;
      low[i + 2] = 0;
      low[i + 3] = sourceAlpha;
      continue;
    }
    const inv = 1 / a;
    low[i] = clampByte(premul[i]! * inv);
    low[i + 1] = clampByte(premul[i + 1]! * inv);
    low[i + 2] = clampByte(premul[i + 2]! * inv);
    low[i + 3] = sourceAlpha;
  }

  return new ImageData(low, w, h);
}

/**
 * Split an RGBA buffer into low (tone/colour) and high (texture) bands.
 * The high band is the *encoded* residual (neutral 128) ready to be persisted
 * as an ordinary tile map.
 */
export function decomposeFrequencyBands(
  source: ImageData,
  options: FrequencySeparationOptions,
): FrequencySeparationBands {
  const sigma = normalizeSeparationRadius(options.radius);
  const method = normalizeFrequencySeparationMethod(options.method);
  const low = lowPassImageData(source, sigma);
  const high = new Uint8ClampedArray(source.data.length);
  const src = source.data;
  const lowPixels = low.data;
  for (let i = 0; i < src.length; i += 4) {
    const sourceAlpha = src[i + 3]!;
    high[i + 3] = sourceAlpha;
    if (sourceAlpha === 0) {
      high[i] = DETAIL_NEUTRAL;
      high[i + 1] = DETAIL_NEUTRAL;
      high[i + 2] = DETAIL_NEUTRAL;
      continue;
    }
    high[i] = encodeResidualChannel(src[i]! - lowPixels[i]!);
    high[i + 1] = encodeResidualChannel(src[i + 1]! - lowPixels[i + 1]!);
    high[i + 2] = encodeResidualChannel(src[i + 2]! - lowPixels[i + 2]!);
  }
  return {
    low,
    high: new ImageData(high, source.width, source.height),
    sigma,
    support: sigma <= 0.3 ? 0 : Math.max(1, Math.ceil(3 * sigma)),
    method,
  };
}

/**
 * Recombine stored bands exactly as the renderer will: signed RGB sum with a
 * single clamp, alpha from the low band.
 */
export function reconstructFrequencyBands(low: ImageData, high: ImageData): ImageData {
  if (low.width !== high.width || low.height !== high.height) {
    throw new RangeError(
      `Frequency bands must have matching dimensions; received ${low.width}×${low.height} and ${high.width}×${high.height}`,
    );
  }
  const w = low.width;
  const h = low.height;
  const out = new Uint8ClampedArray(w * h * 4);
  const l = low.data;
  const e = high.data;
  for (let i = 0; i < out.length; i += 4) {
    const alpha = l[i + 3]!;
    out[i + 3] = alpha;
    if (alpha === 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      continue;
    }
    out[i] = clampByte(l[i]! + decodeResidualChannel(e[i] ?? DETAIL_NEUTRAL));
    out[i + 1] = clampByte(l[i + 1]! + decodeResidualChannel(e[i + 1] ?? DETAIL_NEUTRAL));
    out[i + 2] = clampByte(l[i + 2]! + decodeResidualChannel(e[i + 2] ?? DETAIL_NEUTRAL));
  }
  return new ImageData(out, w, h);
}

export interface ReconstructionError {
  max: number;
  mean: number;
  pixelsOff: number;
  totalPixels: number;
}

/**
 * Measure |R − I| over an unedited decomposition. This is the oracle used by
 * tests and the dialog's quality readout; it is not part of rendering.
 */
export function measureReconstruction(
  source: ImageData,
  low: ImageData,
  high: ImageData,
): ReconstructionError {
  const reconstructed = reconstructFrequencyBands(low, high);
  const a = source.data;
  const b = reconstructed.data;
  let max = 0;
  let sum = 0;
  let off = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      const diff = Math.abs(a[i + c]! - b[i + c]!);
      if (diff > 0) off++;
      if (diff > max) max = diff;
      sum += diff;
      count++;
    }
  }
  return { max, mean: count > 0 ? sum / count : 0, pixelsOff: off, totalPixels: count };
}
