import {
  gamutMapToSrgb,
  linearSrgbToOklab,
  type ManagedColorShim,
  managedColorToRgba,
  oklabToOkLch,
  srgbToLinear,
} from '@strata/shared';

/**
 * Local ManagedColor alias matching scene's discriminated union. The union
 * itself lives in @strata/shared (ManagedColorShim) so palette extraction
 * accepts every variant the scene model can store.
 */
type ManagedColor = ManagedColorShim;

export interface PaletteResult {
  colors: ManagedColor[];
  coverage: number;
}

export interface HarmonyPalette {
  name: string;
  colors: ManagedColor[];
}

const QUANTIZE_STEPS = 12;
const DOWNSAMPLE_SIZE = 64;
const CHROMA_MAX = 0.4;

function quantize(v: number, steps: number): number {
  const q = Math.floor(v * steps);
  if (q >= steps) return steps - 1;
  if (q < 0) return 0;
  return q;
}

function chromaToBin(c: number): number {
  return quantize(Math.min(c, CHROMA_MAX) / CHROMA_MAX, QUANTIZE_STEPS);
}

function hueToBin(h: number): number {
  return quantize((h + Math.PI) / (2 * Math.PI), QUANTIZE_STEPS);
}

function binToChroma(cBin: number): number {
  return (cBin / QUANTIZE_STEPS) * CHROMA_MAX;
}

function binToHue(hBin: number): number {
  return (hBin / QUANTIZE_STEPS) * 2 * Math.PI - Math.PI;
}

interface HistogramBin {
  count: number;
  sumL: number;
  sumC: number;
  sumH: number;
  lBin: number;
  cBin: number;
  hBin: number;
}

interface Cuboid {
  lMin: number;
  lMax: number;
  cMin: number;
  cMax: number;
  hMin: number;
  hMax: number;
  count: number;
  sumL: number;
  sumC: number;
  sumH: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function downsample(data: ImageData, maxDim: number): ImageData {
  const { width, height } = data;
  if (width <= maxDim && height <= maxDim) return data;

  const scale = Math.min(maxDim / width, maxDim / height);
  const nw = Math.max(1, Math.round(width * scale));
  const nh = Math.max(1, Math.round(height * scale));
  const canvas = new OffscreenCanvas(nw, nh);
  const ctx = canvas.getContext('2d')!;
  const tmpCanvas = new OffscreenCanvas(width, height);
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.putImageData(data, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmpCanvas, 0, 0, nw, nh);
  return ctx.getImageData(0, 0, nw, nh);
}

function buildHistogram(data: ImageData): {
  bins: Map<string, HistogramBin>;
  total: number;
} {
  const bins = new Map<string, HistogramBin>();
  const pixels = data.data;
  let total = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const aVal = pixels[i + 3];

    if (aVal! < 128) continue;

    const linear: [number, number, number] = [srgbToLinear(r!), srgbToLinear(g!), srgbToLinear(b!)];
    const oklab = linearSrgbToOklab(linear);
    const lch = oklabToOkLch(oklab);

    const lBin = quantize(lch[0], QUANTIZE_STEPS);
    const cBin = chromaToBin(lch[1]);
    const hBin = hueToBin(lch[2]);
    const key = `${lBin},${cBin},${hBin}`;

    let bin = bins.get(key);
    if (!bin) {
      bin = { count: 0, sumL: 0, sumC: 0, sumH: 0, lBin, cBin, hBin };
      bins.set(key, bin);
    }
    bin.count++;
    bin.sumL += lch[0];
    bin.sumC += lch[1];
    bin.sumH += lch[2];
    total++;
  }

  return { bins, total };
}

function cuboidFromBins(bins: HistogramBin[]): Cuboid {
  let lMin = Infinity;
  let lMax = -Infinity;
  let cMin = Infinity;
  let cMax = -Infinity;
  let hMin = Infinity;
  let hMax = -Infinity;
  let count = 0;
  let sumL = 0;
  let sumC = 0;
  let sumH = 0;

  if (bins.length === 0) {
    return {
      lMin: 0,
      lMax: 1,
      cMin: 0,
      cMax: CHROMA_MAX,
      hMin: -Math.PI,
      hMax: Math.PI,
      count: 0,
      sumL: 0,
      sumC: 0,
      sumH: 0,
    };
  }

  for (const bin of bins) {
    const l = bin.lBin / QUANTIZE_STEPS;
    const c = binToChroma(bin.cBin);
    const h = binToHue(bin.hBin);
    const binW = 1 / QUANTIZE_STEPS;
    lMin = Math.min(lMin, l);
    lMax = Math.max(lMax, l + binW);
    cMin = Math.min(cMin, c);
    cMax = Math.max(cMax, c + CHROMA_MAX / QUANTIZE_STEPS);
    hMin = Math.min(hMin, h);
    hMax = Math.max(hMax, h + (2 * Math.PI) / QUANTIZE_STEPS);
    count += bin.count;
    sumL += bin.sumL;
    sumC += bin.sumC;
    sumH += bin.sumH;
  }

  return { lMin, lMax, cMin, cMax, hMin, hMax, count, sumL, sumC, sumH };
}

/**
 * Get the axis value for a bin (in quantized steps) given an axis.
 */
function binAxisValue(bin: HistogramBin, axis: 'l' | 'c' | 'h'): number {
  if (axis === 'l') return bin.lBin;
  if (axis === 'c') return bin.cBin;
  return bin.hBin;
}

/**
 * Split bins into two groups along the median of the given axis.
 * Returns [left cuboid, left bins, right cuboid, right bins].
 */
function splitBinsByAxis(
  bins: HistogramBin[],
  axis: 'l' | 'c' | 'h',
): [Cuboid, HistogramBin[], Cuboid, HistogramBin[]] {
  const sorted = [...bins].sort((a, b) => binAxisValue(a, axis) - binAxisValue(b, axis));

  const total = bins.reduce((s, b) => s + b.count, 0);
  const half = total / 2;
  let cum = 0;
  let splitAt = 0;
  for (let i = 0; i < sorted.length; i++) {
    cum += sorted[i]?.count ?? 0;
    if (cum >= half) {
      splitAt = i + 1;
      break;
    }
  }
  if (splitAt >= sorted.length) {
    splitAt = Math.ceil(sorted.length / 2);
  }

  const leftBins = sorted.slice(0, splitAt);
  const rightBins = sorted.slice(splitAt);

  return [cuboidFromBins(leftBins), leftBins, cuboidFromBins(rightBins), rightBins];
}

/**
 * Find the axis with the largest range in a cuboid.
 */
function largestAxis(c: Cuboid): 'l' | 'c' | 'h' {
  const lRange = c.lMax - c.lMin;
  const cRange = c.cMax - c.cMin;
  const hRange = c.hMax - c.hMin;
  if (lRange >= cRange && lRange >= hRange) return 'l';
  if (cRange >= hRange) return 'c';
  return 'h';
}

function meanOklch(c: Cuboid): [number, number, number] {
  if (c.count === 0) return [0.5, 0, 0];
  return [c.sumL / c.count, c.sumC / c.count, c.sumH / c.count];
}

function oklchToManagedColor(lch: [number, number, number], alpha: number): ManagedColor {
  const [r, g, b] = gamutMapToSrgb(lch);
  return { space: 'rgb', r, g, b, a: alpha };
}

// ── Main extraction ──────────────────────────────────────────────────────

/**
 * Extract dominant colors from an image using median-cut quantization.
 */
export function extractPalette(imageData: ImageData, colorCount: number = 6): PaletteResult {
  if (imageData.width === 0 || imageData.height === 0) {
    return { colors: [], coverage: 0 };
  }

  const downsampled = downsample(imageData, DOWNSAMPLE_SIZE);
  const { bins, total } = buildHistogram(downsampled);

  if (total === 0) {
    return { colors: [], coverage: 0 };
  }

  const allBins = [...bins.values()];
  const initial = cuboidFromBins(allBins);

  // Each region: bins array + enclosing cuboid
  const regions: { bins: HistogramBin[]; cuboid: Cuboid }[] = [{ bins: allBins, cuboid: initial }];

  while (regions.length < colorCount && regions.length < allBins.length) {
    // Pick the region with the most pixels
    let bestIdx = 0;
    let bestCount = 0;
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]!;
      if (r.cuboid.count > bestCount) {
        bestCount = r.cuboid.count;
        bestIdx = i;
      }
    }

    const region = regions[bestIdx]!;
    if (region.cuboid.count <= 1) break;

    const axis = largestAxis(region.cuboid);
    const [leftC, leftBins, rightC, rightBins] = splitBinsByAxis(region.bins, axis);

    // Replace the original region with the two new regions
    regions.splice(bestIdx, 1);

    if (leftC.count > 0) {
      regions.push({ bins: leftBins, cuboid: leftC });
    }
    if (rightC.count > 0) {
      regions.push({ bins: rightBins, cuboid: rightC });
    }
  }

  // Sort regions by pixel count descending
  regions.sort((a, b) => b.cuboid.count - a.cuboid.count);

  const topRegions = regions.slice(0, colorCount);
  const accounted = topRegions.reduce((s, r) => s + r.cuboid.count, 0);
  const coverage = total > 0 ? accounted / total : 0;

  return {
    colors: topRegions.map((r) => oklchToManagedColor(meanOklch(r.cuboid), 255)),
    coverage,
  };
}

// ── Harmony generation ──────────────────────────────────────────────────

function managedColorToOklch(color: ManagedColor): [number, number, number] {
  const [r, g, b] = managedColorToRgba(color);
  const linear: [number, number, number] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const oklab = linearSrgbToOklab(linear);
  return oklabToOkLch(oklab);
}

function getAlpha(color: ManagedColor): number {
  if ('a' in color) return (color as ManagedColorShim).a;
  return 255;
}

function rotateHueHarmony(name: string, color: ManagedColor, hueOffsets: number[]): HarmonyPalette {
  const lch = managedColorToOklch(color);
  const [L, C, H] = lch;
  const alpha = getAlpha(color);

  const colors = hueOffsets.map((offset) => {
    let newH = H + offset;
    newH = ((newH + Math.PI) % (2 * Math.PI)) - Math.PI;
    return oklchToManagedColor([L, C, newH], alpha);
  });

  return { name, colors };
}

/**
 * Generate a complementary (180 degree hue rotation) harmony palette.
 */
export function complementaryHarmony(color: ManagedColor): HarmonyPalette {
  return rotateHueHarmony('Complementary', color, [Math.PI]);
}

/**
 * Generate a triadic (+-120 degree hue rotation) harmony palette.
 */
export function triadicHarmony(color: ManagedColor): HarmonyPalette {
  return rotateHueHarmony('Triadic', color, [(2 * Math.PI) / 3, (4 * Math.PI) / 3]);
}

/**
 * Generate an analogous (+-30 degree hue rotation) harmony palette.
 */
export function analogousHarmony(color: ManagedColor): HarmonyPalette {
  return rotateHueHarmony('Analogous', color, [-Math.PI / 6, Math.PI / 6]);
}

/**
 * Generate a split-complementary (150/210 degree hue rotation) harmony palette.
 */
export function splitComplementaryHarmony(color: ManagedColor): HarmonyPalette {
  return rotateHueHarmony('Split Complementary', color, [(5 * Math.PI) / 6, (7 * Math.PI) / 6]);
}

/**
 * Generate a monochromatic harmony palette (same hue, varying lightness).
 */
export function monochromaticHarmony(color: ManagedColor): HarmonyPalette {
  const [r, g, b, a] = managedColorToRgba(color);
  const linear: [number, number, number] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const [L, C, H] = oklabToOkLch(linearSrgbToOklab(linear));
  const offsets = [0, -0.15, 0.15, -0.3, 0.3];
  const colors = offsets.map((dL) => {
    const newL = Math.max(0.05, Math.min(0.95, L + dL));
    return oklchToManagedColor([newL, C * (1 - Math.abs(dL) * 0.5), H], a);
  });
  return { name: 'Monochromatic', colors };
}
