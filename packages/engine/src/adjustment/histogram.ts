/**
 * Histogram computation module.
 *
 * Research basis: Photoshop Histogram displays luminance and per-channel
 * pixel value distributions with 256 bins. Used for Levels adjustments,
 * Curves display, and exposure analysis.
 *
 * Architecture: single pass over pixel data, accumulate counts into
 * 256-bin arrays for luminance, red, green, blue, and alpha channels.
 */

export interface Histogram {
  luminance: Uint32Array;
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  alpha: Uint32Array;
  /** Total number of pixels sampled. */
  totalPixels: number;
  /** Count of pixels with alpha > 0. */
  opaquePixels: number;
}

const BINS = 256;

function luminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

export function computeHistogram(imageData: ImageData): Histogram {
  const lum = new Uint32Array(BINS);
  const red = new Uint32Array(BINS);
  const green = new Uint32Array(BINS);
  const blue = new Uint32Array(BINS);
  const alpha = new Uint32Array(BINS);

  const data = imageData.data;
  const len = imageData.width * imageData.height;
  let opaquePixels = 0;

  for (let i = 0; i < len; i++) {
    const off = i * 4;
    const r = data[off]!;
    const g = data[off + 1]!;
    const b = data[off + 2]!;
    const a = data[off + 3]!;

    alpha[a]!++;
    // Empty backdrop pixels must not bias Levels/Curves toward black. Keep
    // their alpha count for diagnostics, but only include visible samples in
    // the RGB/luminance distributions used for tonal correction.
    if (a > 0) {
      const l = luminance(r, g, b);
      lum[l]!++;
      red[r]!++;
      green[g]!++;
      blue[b]!++;
      opaquePixels++;
    }
  }

  return {
    luminance: lum,
    red,
    green,
    blue,
    alpha,
    totalPixels: len,
    opaquePixels,
  };
}

export interface HistogramStats {
  mean: number;
  median: number;
  stdDev: number;
  percentile5: number;
  percentile95: number;
  blackClipped: number;
  whiteClipped: number;
}

export function computeHistogramStats(histogram: Uint32Array, totalPixels: number): HistogramStats {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let cumCount = 0;
  let median = 0;
  let medianFound = false;

  let sampleTotal = 0;
  for (let i = 0; i < BINS; i++) sampleTotal += histogram[i]!;
  if (sampleTotal === 0) sampleTotal = Math.max(0, totalPixels);

  for (let i = 0; i < BINS; i++) {
    const c = histogram[i]!;
    if (c > 0) {
      sum += i * c;
      sumSq += i * i * c;
      count += c;
    }
    cumCount += c;
    if (!medianFound && cumCount >= sampleTotal / 2) {
      median = i;
      medianFound = true;
    }
  }

  const mean = count > 0 ? sum / count : 0;
  const variance = count > 0 ? sumSq / count - mean * mean : 0;
  const stdDev = Math.sqrt(Math.max(0, variance));

  cumCount = 0;
  let p5 = 0;
  let p95 = 0;
  let p5Found = false;
  let p95Found = false;
  for (let i = 0; i < BINS; i++) {
    cumCount += histogram[i]!;
    if (!p5Found && cumCount >= sampleTotal * 0.05) {
      p5 = i;
      p5Found = true;
    }
    if (!p95Found && cumCount >= sampleTotal * 0.95) {
      p95 = i;
      p95Found = true;
    }
  }

  return {
    mean,
    median,
    stdDev,
    percentile5: p5,
    percentile95: p95,
    blackClipped: histogram[0]!,
    whiteClipped: histogram[255]!,
  };
}

export function autoLevelsParams(
  histogram: Histogram,
  clipPercent = 0.5,
): {
  inputBlack: number;
  inputWhite: number;
  gamma: number;
} {
  const total = histogram.opaquePixels;
  if (total <= 0) return { inputBlack: 0, inputWhite: 255, gamma: 1 };
  const clipCount = Math.round((total * clipPercent) / 100);

  let inputBlack = 0;
  let running = 0;
  for (let i = 0; i < BINS; i++) {
    running += histogram.luminance[i]!;
    if (running > clipCount) {
      inputBlack = i;
      break;
    }
  }

  running = 0;
  let inputWhite = 255;
  for (let i = BINS - 1; i >= 0; i--) {
    running += histogram.luminance[i]!;
    if (running > clipCount) {
      inputWhite = i;
      break;
    }
  }

  if (inputWhite <= inputBlack) {
    inputBlack = 0;
    inputWhite = 255;
  }

  return {
    inputBlack: Math.max(0, inputBlack - 2),
    inputWhite: Math.min(255, inputWhite + 2),
    gamma: Math.max(0.1, Math.min(10, (inputWhite - inputBlack) / 128)),
  };
}
