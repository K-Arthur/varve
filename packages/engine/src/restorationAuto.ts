/**
 * Auto / Recommended mode for the Enhance workflow.
 *
 * Deliberately cheap and explainable: a small set of classical estimators
 * (noise via Laplacian MAD, blur via Laplacian variance, JPEG blockiness
 * via the 8px-grid discontinuity ratio, resolution via dimensions). No
 * neural classifier decides which neural model to load. Every signal
 * carries a confidence and the recommendation is phrased in human terms;
 * low-confidence input yields "no specific restoration suggested".
 *
 * Thresholds are conservative by design: false negatives (saying nothing)
 * are safer than false positives (running a heavy model unnecessarily).
 */

export type RestorationSuggestion =
  | 'denoise'
  | 'deblur'
  | 'compression-restoration'
  | 'upscale'
  | 'none';

export interface AutoAnalysisSignal {
  level: 'none' | 'light' | 'moderate' | 'severe';
  confidence: number;
}

export interface AutoAnalysis {
  noise: AutoAnalysisSignal;
  blur: AutoAnalysisSignal;
  jpeg: AutoAnalysisSignal;
  /** Source is below the resolution threshold for the output size. */
  lowResolution: boolean;
  /** Human-readable findings, shown verbatim in the dialog. */
  findings: string[];
  recommendation: RestorationSuggestion[];
  /** Overall confidence that the recommendation is meaningful. */
  confidence: number;
}

const CONFIDENCE_LOW = 0.5;
const CONFIDENCE_HIGH = 0.8;

const SAMPLE_PATCHES = 64;
const PATCH_SIZE = 32;

function luminance(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    out[i] = 0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!;
  }
  return out;
}

function sampledPatches(lum: Float32Array, width: number, height: number): Float32Array[] {
  const patches: Float32Array[] = [];
  const stepX = Math.max(1, Math.floor(width / 8));
  const stepY = Math.max(1, Math.floor(height / 8));
  const size = Math.min(PATCH_SIZE, width, height);
  for (let py = 0; py < 8 && patches.length < SAMPLE_PATCHES; py++) {
    for (let px = 0; px < 8 && patches.length < SAMPLE_PATCHES; px++) {
      const ox = Math.min(px * stepX, width - size);
      const oy = Math.min(py * stepY, height - size);
      const patch = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          patch[y * size + x] = lum[(oy + y) * width + (ox + x)]!;
        }
      }
      patches.push(patch);
    }
  }
  return patches;
}

/** Robust noise estimate: MAD of the Laplacian, scaled to sigma. */
function estimateNoiseSigma(lum: Float32Array, width: number, height: number): number {
  const patches = sampledPatches(lum, width, height);
  const laplacians: number[] = [];
  for (const patch of patches) {
    const size = Math.sqrt(patch.length);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        const lap =
          patch[i + 1]! + patch[i - 1]! + patch[i + size]! + patch[i - size]! - 4 * patch[i]!;
        laplacians.push(lap);
      }
    }
  }
  laplacians.sort((a, b) => a - b);
  const median = laplacians[Math.floor(laplacians.length / 2)]!;
  const absDev = laplacians.map((v) => Math.abs(v - median));
  absDev.sort((a, b) => a - b);
  const mad = absDev[Math.floor(absDev.length / 2)]!;
  // sigma = MAD / 0.6745 (normal distribution); Laplacian kernel scales by 4.
  return (mad / 0.6745) * 0.25;
}

/** Blur estimate: variance of the Laplacian (lower = blurrier). */
function estimateBlurScore(lum: Float32Array, width: number, height: number): number {
  const patches = sampledPatches(lum, width, height);
  const scores: number[] = [];
  for (const patch of patches) {
    const size = Math.sqrt(patch.length);
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        const lap =
          patch[i + 1]! + patch[i - 1]! + patch[i + size]! + patch[i - size]! - 4 * patch[i]!;
        sum += lap;
        sumSq += lap * lap;
        count++;
      }
    }
    if (count === 0) continue;
    const mean = sum / count;
    scores.push(sumSq / count - mean * mean);
  }
  scores.sort((a, b) => a - b);
  return scores[Math.floor(scores.length / 2)]!;
}

/**
 * JPEG blockiness: discontinuity ratio at 8px multiples vs neighbouring
 * offsets along both axes (classic BNI, averaged over sampled rows).
 */
function estimateJpegBlockiness(lum: Float32Array, width: number, height: number): number {
  // Per-axis accumulators: the horizontal ratio (x%8 classification) is
  // always unbiased regardless of which rows are sampled, so it carries the
  // primary signal.  The vertical ratio is only meaningful when enough
  // off-grid (y%8 !== 0) rows are sampled — when rowStep is a multiple of
  // 8, every sampled row falls on the grid and the vertical off-grid
  // accumulator is near zero, so we skip that axis to avoid dividing by
  // near-zero and inflating the result on smooth gradients.
  //
  // At y=0 the vertical comparison reads lum[-width+x] which is undefined
  // (NaN).  Without the y>0 guard, gridDiscontinuity is poisoned to NaN
  // for every image, permanently disabling the JPEG signal.
  let gridH = 0;
  let offGridH = 0;
  let gridV = 0;
  let offGridV = 0;
  const rowStep = Math.max(1, Math.floor(height / 24));
  for (let y = 0; y < height; y += rowStep) {
    for (let x = 8; x < width - 8; x++) {
      const d = Math.abs(lum[y * width + x]! - lum[y * width + x - 1]!);
      if (x % 8 === 0) gridH += d;
      else offGridH += d;
    }
    if (y > 0) {
      for (let x = 8; x < width - 8; x++) {
        const d = Math.abs(lum[y * width + x]! - lum[(y - 1) * width + x]!);
        if (y % 8 === 0) gridV += d;
        else offGridV += d;
      }
    }
  }
  const ratios: number[] = [];
  if (offGridH > 0) ratios.push(gridH / offGridH);
  if (offGridV > 0) ratios.push(gridV / offGridV);
  return ratios.length === 0 ? 0 : ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

function levelFor(
  value: number,
  light: number,
  moderate: number,
  severe: number,
): AutoAnalysisSignal['level'] {
  if (value >= severe) return 'severe';
  if (value >= moderate) return 'moderate';
  if (value >= light) return 'light';
  return 'none';
}

/** Inverted thresholds: lower value = worse (blur score). */
function levelForInverted(
  value: number,
  light: number,
  moderate: number,
  severe: number,
): AutoAnalysisSignal['level'] {
  if (value <= severe) return 'severe';
  if (value <= moderate) return 'moderate';
  if (value <= light) return 'light';
  return 'none';
}

function confidenceFor(level: AutoAnalysisSignal['level'], gapRatio: number): number {
  if (level === 'none') return CONFIDENCE_LOW;
  // How far the signal is past its threshold decides confidence.
  return Math.min(1, CONFIDENCE_HIGH + gapRatio * 0.25);
}

export interface AnalyzeOptions {
  /** Minimum dimension (short edge) that counts as non-low-resolution. */
  lowResolutionShortEdge?: number;
}

export function analyzeImageForRestoration(
  source: ImageData,
  options: AnalyzeOptions = {},
): AutoAnalysis {
  const shortEdge = Math.min(source.width, source.height);
  const lowResolutionShortEdge = options.lowResolutionShortEdge ?? 900;
  const lowResolution = shortEdge < lowResolutionShortEdge;

  // Below ~96px the patch-based estimators see icon edges as noise/blur;
  // only the resolution signal is meaningful at that size.
  const tooSmallForSignals = shortEdge < 96;

  const lum = luminance(source.data, source.width, source.height);
  const noiseSigma = tooSmallForSignals ? 0 : estimateNoiseSigma(lum, source.width, source.height);
  const blurScore = tooSmallForSignals
    ? Infinity
    : estimateBlurScore(lum, source.width, source.height);
  const blockiness = tooSmallForSignals
    ? 1
    : estimateJpegBlockiness(lum, source.width, source.height);

  // Thresholds: tuned on the synthetic corpus (docs/quality/
  // image-enhancement-benchmark.md). Conservative by design.
  const noiseLevel = levelFor(noiseSigma, 2.2, 4.5, 8);
  const blurLevel = levelForInverted(blurScore, 60, 18, 6);
  const jpegLevel = levelFor(blockiness, 1.12, 1.25, 1.45);

  const findings: string[] = [];
  const recommendation: RestorationSuggestion[] = [];

  if (noiseLevel !== 'none') {
    findings.push(
      noiseLevel === 'severe' || noiseLevel === 'moderate'
        ? 'Moderate-to-severe noise'
        : 'Light noise',
    );
    recommendation.push('denoise');
  }
  if (blurLevel !== 'none' && blurLevel !== 'light') {
    findings.push(blurLevel === 'severe' ? 'Heavy blur' : 'Noticeable blur');
    recommendation.push('deblur');
  }
  if (jpegLevel !== 'none') {
    findings.push(
      jpegLevel === 'severe' || jpegLevel === 'moderate'
        ? 'Moderate-to-severe compression artifacts'
        : 'Light compression artifacts',
    );
    recommendation.push('compression-restoration');
  }
  if (lowResolution) {
    findings.push(`Low source resolution (${source.width} by ${source.height}px)`);
    recommendation.push('upscale');
  }

  // Confidence: strongest signal wins, capped by disagreement.
  const signalConfidences = [
    confidenceFor(noiseLevel, (noiseSigma - 2.2) / 8),
    confidenceFor(blurLevel, (60 - blurScore) / 60),
    confidenceFor(jpegLevel, (blockiness - 1.12) / 0.5),
  ];
  const maxConfidence = Math.max(...signalConfidences, lowResolution ? 0.75 : 0);
  const hasStrongSignal =
    noiseLevel !== 'none' || blurLevel !== 'none' || jpegLevel !== 'none' || lowResolution;
  const confidence = hasStrongSignal ? maxConfidence : 0;

  // Lightweight pixel-art heuristic: limited palette, sharp edges, and
  // low-resolution are characteristic of UI/pixel-art assets that must not
  // be routed through photographic denoise/deblur. This does not trigger a
  // separate recommendation — it is surfaced as a hint for the caller to
  // prefer the pixel-art enlargement path.
  const isLikelyPixelArt = (() => {
    if (shortEdge > 128) return false;
    // Palette size via quantized sampling (first 1024 pixels).
    const seen = new Set<number>();
    const sampleCount = Math.min(1024, source.width * source.height);
    for (let i = 0; i < sampleCount; i++) {
      const idx = (i * 4) % source.data.length;
      const r = source.data[idx]! >> 4;
      const g = source.data[idx + 1]! >> 4;
      const b = source.data[idx + 2]! >> 4;
      seen.add((r << 8) | (g << 4) | b);
      if (seen.size > 64) break;
    }
    return seen.size <= 32;
  })();

  // If likely pixel-art, we add a finding that callers can surface as a
  // mode hint; we do not override the resolution recommendation.
  if (isLikelyPixelArt && lowResolution) {
    findings.push('Limited palette suggests pixel art — consider Pixel Art mode');
  }

  return {
    noise: { level: noiseLevel, confidence: signalConfidences[0]! },
    blur: { level: blurLevel, confidence: signalConfidences[1]! },
    jpeg: { level: jpegLevel, confidence: signalConfidences[2]! },
    lowResolution,
    findings,
    recommendation: hasStrongSignal ? recommendation : ['none'],
    confidence,
  };
}

/** Human-readable recommendation line for the dialog. */
export function recommendationLabel(recommendation: RestorationSuggestion[]): string {
  if (recommendation.length === 0 || recommendation[0] === 'none') {
    return 'No specific restoration suggested';
  }
  const parts: string[] = [];
  if (recommendation.includes('compression-restoration'))
    parts.push('clean up compression artifacts');
  if (recommendation.includes('denoise')) parts.push('denoise');
  if (recommendation.includes('deblur')) parts.push('deblur');
  if (recommendation.includes('upscale')) parts.push('upscale');
  return parts.join(' + ');
}
