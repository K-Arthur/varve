import {
  contrastRatio,
  gamutMapToSrgb,
  linearSrgbToOklab,
  type ManagedColorShim,
  managedColorToRgba,
  oklabToOkLch,
  oklchToOkLab,
  relativeLuminance,
  srgbToLinear,
} from '@varve/shared';

/** Version of the numeric pipeline. Bump when output semantics change. */
export const PALETTE_ANALYSIS_VERSION = 2;
export const PALETTE_DEFAULT_COLOR_COUNT = 6;
export const PALETTE_MIN_COLOR_COUNT = 3;
export const PALETTE_MAX_COLOR_COUNT = 32;

/** Local ManagedColor alias that keeps the engine independent from @varve/scene. */
type ManagedColor = ManagedColorShim;

export type PaletteRole =
  | 'dominant'
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'neutral'
  | 'light-neutral'
  | 'dark-neutral';

export interface PaletteAnalysisConfig {
  colorCount: number;
  maxSamples: number;
  alphaThreshold: number;
  maxIterations: number;
  mergeDistance: number;
  seed: number;
}

export interface PaletteSourceInfo {
  assetId?: string;
  contentHash?: string;
  width: number;
  height: number;
  crop?: { x: number; y: number; w: number; h: number };
  colorProfile?: string;
}

export interface PaletteSwatch {
  id: string;
  color: ManagedColor;
  /** Oklab coordinates used for clustering, in the usual 0..1 / signed form. */
  oklab: readonly [number, number, number];
  /** Oklch coordinates used for display and role heuristics. */
  oklch: readonly [number, number, number];
  /** Number of sampled pixels assigned to the cluster before weighting. */
  population: number;
  /** Alpha-weighted share of participating pixels. */
  weight: number;
  roleCandidate: PaletteRole;
  origin: 'extracted';
  sourceClusterId: string;
}

export interface ContrastPair {
  foregroundId: string;
  backgroundId: string;
  foreground: ManagedColor;
  background: ManagedColor;
  ratio: number;
  passesAA: boolean;
  passesAAA: boolean;
  passesLargeTextAA: boolean;
  passesLargeTextAAA: boolean;
  criterion: 'WCAG 2.1';
}

export interface PaletteWarning {
  code: 'no-opaque-pairs' | 'no-meaningful-colors' | 'transparent-pixels-ignored';
  message: string;
}

export interface PaletteTimingInfo {
  samplingMs: number;
  clusteringMs: number;
  postprocessMs: number;
  totalMs: number;
}

export interface PalettePixelSource {
  width: number;
  height: number;
  /** RGBA bytes in row-major order. The array may be transferred to a worker. */
  data: ArrayLike<number>;
  source?: PaletteSourceInfo;
}

export interface PaletteAnalysis {
  version: number;
  source?: PaletteSourceInfo;
  config: PaletteAnalysisConfig;
  extracted: PaletteSwatch[];
  derived: {
    harmonies: HarmonyPalette[];
  };
  contrastPairs: ContrastPair[];
  warnings: PaletteWarning[];
  timings: PaletteTimingInfo;

  /** Compatibility fields used by the existing Inspector and actions. */
  colors: ManagedColor[];
  coverage: number;
}

/** Existing public name retained for callers that only need the result. */
export type PaletteResult = PaletteAnalysis;

export interface HarmonyPalette {
  name: string;
  colors: ManagedColor[];
  origin: 'derived';
  sourceColorId?: string;
}

const DEFAULT_CONFIG: Omit<PaletteAnalysisConfig, 'seed'> = {
  colorCount: PALETTE_DEFAULT_COLOR_COUNT,
  maxSamples: 4096,
  alphaThreshold: 0.08,
  maxIterations: 24,
  mergeDistance: 0.025,
};

const MAX_SAMPLE_COUNT = 16_384;

interface Point {
  rgb: [number, number, number];
  oklab: [number, number, number];
  alpha: number;
  weight: number;
  index: number;
}

interface Cluster {
  centroid: [number, number, number];
  alpha: number;
  population: number;
  weight: number;
  pointIndex: number;
}

interface SampleResult {
  points: Point[];
  hadTransparency: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeCount(value: number, max: number): number {
  return Math.max(1, Math.min(max, Math.round(Number.isFinite(value) ? value : 1)));
}

function hashSeed(source: PalettePixelSource, config: Omit<PaletteAnalysisConfig, 'seed'>): number {
  let hash = 2166136261 >>> 0;
  const data = source.data;
  const stride = Math.max(4, Math.floor(data.length / 1024));
  for (let i = 0; i < data.length; i += stride) {
    hash ^= Math.round(data[i] ?? 0) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= source.width;
  hash = Math.imul(hash, 16777619) >>> 0;
  hash ^= source.height;
  hash = Math.imul(hash, 16777619) >>> 0;
  hash ^= config.colorCount * 31 + config.maxSamples;
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state) >>> 0;
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function toOklab(r: number, g: number, b: number): [number, number, number] {
  return linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
}

function oklabDistanceSquared(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

function samplePixels(source: PalettePixelSource, config: PaletteAnalysisConfig): SampleResult {
  const { width, height, data } = source;
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return { points: [], hadTransparency: false };
  }

  const target = Math.min(config.maxSamples, width * height);
  const aspect = width / Math.max(1, height);
  const cols = Math.max(1, Math.min(width, Math.ceil(Math.sqrt(target * aspect))));
  const rows = Math.max(1, Math.min(height, Math.ceil(target / cols)));
  const cellCount = cols * rows;
  const representatives: Array<Point | undefined> = new Array(cellCount);
  const salient: Array<Point | undefined> = new Array(cellCount);
  let hadTransparency = false;

  // A bounded source normally comes from a 256px preview canvas. For direct
  // engine callers this stride keeps the salience scan bounded while still
  // giving every spatial cell a chance to contribute a high-chroma point.
  const scanStride = Math.max(1, Math.ceil(Math.sqrt((width * height) / (target * 3))));
  const consider = (
    x: number,
    y: number,
    bucket: Array<Point | undefined>,
    preferChroma: boolean,
  ) => {
    const offset = (y * width + x) * 4;
    const alphaByte = Number(data[offset + 3] ?? 0);
    const alpha = clamp(alphaByte / 255, 0, 1);
    if (alpha < config.alphaThreshold) {
      hadTransparency = true;
      return;
    }
    if (alpha < 0.98) hadTransparency = true;
    const r = clamp(Number(data[offset] ?? 0), 0, 255);
    const g = clamp(Number(data[offset + 1] ?? 0), 0, 255);
    const b = clamp(Number(data[offset + 2] ?? 0), 0, 255);
    const point: Point = {
      rgb: [r, g, b],
      oklab: toOklab(r, g, b),
      alpha,
      weight: alpha,
      index: y * width + x,
    };
    const cellX = Math.min(cols - 1, Math.floor((x * cols) / width));
    const cellY = Math.min(rows - 1, Math.floor((y * rows) / height));
    const cell = cellY * cols + cellX;
    const prior = bucket[cell];
    if (!prior) {
      bucket[cell] = point;
      return;
    }
    if (preferChroma) {
      const pointChroma = Math.hypot(point.oklab[1], point.oklab[2]);
      const priorChroma = Math.hypot(prior.oklab[1], prior.oklab[2]);
      if (pointChroma > priorChroma || (pointChroma === priorChroma && point.index < prior.index)) {
        bucket[cell] = point;
      }
    }
  };

  // One stable interior sample per cell preserves large regions and spatial
  // distribution. A second salience sample per cell keeps small saturated
  // accents from disappearing behind a large neutral background.
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows));
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((col * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / cols));
      consider(
        Math.min(x1 - 1, Math.floor((x0 + x1) / 2)),
        Math.min(y1 - 1, Math.floor((y0 + y1) / 2)),
        representatives,
        false,
      );
    }
  }

  for (let y = 0; y < height; y += scanStride) {
    for (let x = 0; x < width; x += scanStride) {
      consider(x, y, salient, true);
    }
  }

  const points: Point[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < cellCount; i += 1) {
    const representative = representatives[i];
    if (representative && !seen.has(representative.index)) {
      points.push(representative);
      seen.add(representative.index);
    }
    const accent = salient[i];
    if (accent && !seen.has(accent.index)) {
      points.push(accent);
      seen.add(accent.index);
    }
  }
  return { points: points.slice(0, config.maxSamples), hadTransparency };
}

function chooseInitialCenters(points: Point[], k: number, seed: number): number[] {
  if (points.length <= k) return points.map((_point, index) => index);
  const random = seededRandom(seed);
  const selected = new Set<number>();
  const centers: number[] = [];
  const first = Math.floor(random() * points.length);
  selected.add(first);
  centers.push(first);

  while (centers.length < k) {
    let total = 0;
    const distances = points.map((point, index) => {
      if (selected.has(index)) return 0;
      let nearest = Infinity;
      for (const centerIndex of centers) {
        nearest = Math.min(nearest, oklabDistanceSquared(point.oklab, points[centerIndex]!.oklab));
      }
      const score = nearest * point.weight;
      total += score;
      return score;
    });
    if (total <= 0) break;
    let threshold = random() * total;
    let chosen = 0;
    for (let i = 0; i < distances.length; i += 1) {
      threshold -= distances[i]!;
      if (threshold <= 0 && !selected.has(i)) {
        chosen = i;
        break;
      }
    }
    if (selected.has(chosen)) {
      chosen = points.findIndex((_point, index) => !selected.has(index));
    }
    if (chosen < 0) break;
    selected.add(chosen);
    centers.push(chosen);
  }
  return centers;
}

function runKMeans(points: Point[], k: number, config: PaletteAnalysisConfig): Cluster[] {
  const initialIndices = chooseInitialCenters(points, k, config.seed);
  const centers = initialIndices.map(
    (index) => [...points[index]!.oklab] as [number, number, number],
  );
  const assignments = new Array<number>(points.length).fill(0);

  for (let iteration = 0; iteration < config.maxIterations; iteration += 1) {
    let changed = false;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex]!;
      let best = 0;
      let bestDistance = Infinity;
      for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
        const distance = oklabDistanceSquared(point.oklab, centers[centerIndex]!);
        if (distance < bestDistance || (distance === bestDistance && centerIndex < best)) {
          best = centerIndex;
          bestDistance = distance;
        }
      }
      if (assignments[pointIndex] !== best) changed = true;
      assignments[pointIndex] = best;
    }

    const sums = centers.map(() => ({
      l: 0,
      a: 0,
      b: 0,
      alpha: 0,
      weight: 0,
      population: 0,
      farthest: -1,
      farthestDistance: -1,
    }));
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex]!;
      const cluster = sums[assignments[pointIndex]!]!;
      cluster.l += point.oklab[0] * point.weight;
      cluster.a += point.oklab[1] * point.weight;
      cluster.b += point.oklab[2] * point.weight;
      cluster.alpha += point.alpha * point.weight;
      cluster.weight += point.weight;
      cluster.population += 1;
      const distance = oklabDistanceSquared(point.oklab, centers[assignments[pointIndex]!]!);
      if (distance > cluster.farthestDistance) {
        cluster.farthestDistance = distance;
        cluster.farthest = pointIndex;
      }
    }

    let maxShift = 0;
    for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
      const sum = sums[centerIndex]!;
      if (sum.weight === 0) {
        const replacement = points[sum.farthest >= 0 ? sum.farthest : centerIndex % points.length]!;
        centers[centerIndex] = [...replacement.oklab];
        continue;
      }
      const next: [number, number, number] = [
        sum.l / sum.weight,
        sum.a / sum.weight,
        sum.b / sum.weight,
      ];
      maxShift = Math.max(maxShift, Math.sqrt(oklabDistanceSquared(centers[centerIndex]!, next)));
      centers[centerIndex] = next;
    }
    if (!changed || maxShift < 0.0001) break;
  }

  const clusters = centers.map(
    (centroid, index): Cluster => ({
      centroid,
      alpha: 0,
      population: 0,
      weight: 0,
      pointIndex: index,
    }),
  );
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex]!;
    const cluster = clusters[assignments[pointIndex]!]!;
    cluster.population += 1;
    cluster.weight += point.weight;
    cluster.alpha += point.alpha * point.weight;
    cluster.pointIndex = Math.min(cluster.pointIndex, point.index);
  }
  for (const cluster of clusters) {
    cluster.alpha = cluster.weight > 0 ? cluster.alpha / cluster.weight : 1;
  }
  return clusters.filter((cluster) => cluster.population > 0);
}

function mergeClusters(clusters: Cluster[], threshold: number): Cluster[] {
  const merged: Cluster[] = [];
  for (const cluster of clusters) {
    const existing = merged.find(
      (candidate) =>
        Math.sqrt(oklabDistanceSquared(candidate.centroid, cluster.centroid)) < threshold,
    );
    if (!existing) {
      merged.push({ ...cluster, centroid: [...cluster.centroid] as [number, number, number] });
      continue;
    }
    const total = existing.weight + cluster.weight;
    const ratio = total > 0 ? cluster.weight / total : 0.5;
    existing.centroid = [
      existing.centroid[0] + (cluster.centroid[0] - existing.centroid[0]) * ratio,
      existing.centroid[1] + (cluster.centroid[1] - existing.centroid[1]) * ratio,
      existing.centroid[2] + (cluster.centroid[2] - existing.centroid[2]) * ratio,
    ];
    existing.alpha = existing.alpha + (cluster.alpha - existing.alpha) * ratio;
    existing.population += cluster.population;
    existing.weight = total;
    existing.pointIndex = Math.min(existing.pointIndex, cluster.pointIndex);
  }
  return merged;
}

function colorFromOklab(oklab: readonly [number, number, number], alpha: number): ManagedColor {
  const [r, g, b] = gamutMapToSrgb(oklabToOkLch([...oklab] as [number, number, number]));
  return { space: 'rgb', r, g, b, a: Math.round(clamp(alpha, 0, 1) * 255) };
}

function roleForCluster(cluster: Cluster, index: number, totalWeight: number): PaletteRole {
  const [l, a, b] = cluster.centroid;
  const chroma = Math.hypot(a, b);
  const normalizedWeight = totalWeight > 0 ? cluster.weight / totalWeight : 0;
  if (chroma < 0.035) {
    if (l > 0.82) return 'light-neutral';
    if (l < 0.28) return 'dark-neutral';
    return 'neutral';
  }
  if (index === 0) return 'dominant';
  if (chroma > 0.08 && normalizedWeight < 0.45) return 'accent';
  if (index === 1) return 'primary';
  return 'secondary';
}

function makeSwatches(clusters: Cluster[], totalWeight: number): PaletteSwatch[] {
  return clusters.map((cluster, index) => {
    const oklab = [...cluster.centroid] as [number, number, number];
    const oklch = oklabToOkLch(oklab);
    return {
      id: `extracted-${index + 1}`,
      color: colorFromOklab(oklab, cluster.alpha),
      oklab,
      oklch,
      population: cluster.population,
      weight: totalWeight > 0 ? cluster.weight / totalWeight : 0,
      roleCandidate: roleForCluster(cluster, index, totalWeight),
      origin: 'extracted',
      sourceClusterId: `cluster-${index + 1}`,
    };
  });
}

function swatchOklchToColor(lch: readonly [number, number, number], alpha: number): ManagedColor {
  return colorFromOklab(oklchToOkLab([lch[0], lch[1], lch[2]]), alpha);
}

function managedColorToOklch(color: ManagedColor): [number, number, number] {
  const [r, g, b] = managedColorToRgba(color);
  return oklabToOkLch(toOklab(r, g, b));
}

function getAlpha(color: ManagedColor): number {
  return clamp((color.a ?? 255) / 255, 0, 1);
}

function rotateHueHarmony(
  name: string,
  color: ManagedColor,
  hueOffsets: number[],
  sourceColorId?: string,
): HarmonyPalette {
  const [l, c, h] = managedColorToOklch(color);
  const colors = hueOffsets.map((offset) =>
    swatchOklchToColor([l, c, ((h + offset + Math.PI) % (2 * Math.PI)) - Math.PI], getAlpha(color)),
  );
  return { name, colors, origin: 'derived', ...(sourceColorId ? { sourceColorId } : {}) };
}

export function complementaryHarmony(color: ManagedColor): HarmonyPalette {
  return rotateHueHarmony('Complementary', color, [Math.PI]);
}

export function triadicHarmony(color: ManagedColor): HarmonyPalette {
  return rotateHueHarmony('Triadic', color, [(2 * Math.PI) / 3, (4 * Math.PI) / 3]);
}

export function analogousHarmony(color: ManagedColor): HarmonyPalette {
  return rotateHueHarmony('Analogous', color, [-Math.PI / 6, Math.PI / 6]);
}

export function splitComplementaryHarmony(color: ManagedColor): HarmonyPalette {
  return rotateHueHarmony('Split Complementary', color, [(5 * Math.PI) / 6, (7 * Math.PI) / 6]);
}

export function monochromaticHarmony(color: ManagedColor): HarmonyPalette {
  const [l, c, h] = managedColorToOklch(color);
  const colors = [-0.24, -0.12, 0.12, 0.24].map((delta) =>
    swatchOklchToColor(
      [clamp(l + delta, 0.04, 0.96), c * (1 - Math.abs(delta) * 0.45), h],
      getAlpha(color),
    ),
  );
  return { name: 'Monochromatic', colors, origin: 'derived' };
}

function buildHarmonies(primary: PaletteSwatch | undefined): HarmonyPalette[] {
  if (!primary) return [];
  return [
    complementaryHarmony(primary.color),
    analogousHarmony(primary.color),
    triadicHarmony(primary.color),
    splitComplementaryHarmony(primary.color),
    monochromaticHarmony(primary.color),
  ].map((harmony) => ({ ...harmony, sourceColorId: primary.id }));
}

function buildContrastPairs(swatches: PaletteSwatch[]): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  for (const foreground of swatches) {
    if (getAlpha(foreground.color) < 0.98) continue;
    const [fr, fg, fb] = managedColorToRgba(foreground.color);
    for (const background of swatches) {
      if (foreground.id === background.id || getAlpha(background.color) < 0.98) continue;
      const [br, bg, bb] = managedColorToRgba(background.color);
      const ratio = contrastRatio(relativeLuminance(fr, fg, fb), relativeLuminance(br, bg, bb));
      if (ratio < 3) continue;
      pairs.push({
        foregroundId: foreground.id,
        backgroundId: background.id,
        foreground: foreground.color,
        background: background.color,
        ratio,
        passesAA: ratio >= 4.5,
        passesAAA: ratio >= 7,
        passesLargeTextAA: ratio >= 3,
        passesLargeTextAAA: ratio >= 4.5,
        criterion: 'WCAG 2.1',
      });
    }
  }
  return pairs.sort((a, b) => b.ratio - a.ratio).slice(0, 12);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Analyze bounded RGBA pixels with deterministic seeded K-Means++ in Oklab. */
export function analyzePalette(
  source: PalettePixelSource,
  options: Partial<PaletteAnalysisConfig> = {},
): PaletteAnalysis {
  const totalStart = now();
  const baseConfig = {
    ...DEFAULT_CONFIG,
    ...options,
    colorCount: normalizeCount(
      options.colorCount ?? DEFAULT_CONFIG.colorCount,
      PALETTE_MAX_COLOR_COUNT,
    ),
    maxSamples: normalizeCount(options.maxSamples ?? DEFAULT_CONFIG.maxSamples, MAX_SAMPLE_COUNT),
    alphaThreshold: clamp(options.alphaThreshold ?? DEFAULT_CONFIG.alphaThreshold, 0, 1),
    maxIterations: normalizeCount(options.maxIterations ?? DEFAULT_CONFIG.maxIterations, 64),
    mergeDistance: Math.max(0, options.mergeDistance ?? DEFAULT_CONFIG.mergeDistance),
  };
  const config: PaletteAnalysisConfig = {
    ...baseConfig,
    seed: options.seed ?? hashSeed(source, baseConfig),
  };

  const sampleStart = now();
  const sampled = samplePixels(source, config);
  const points = sampled.points;
  const samplingMs = now() - sampleStart;
  if (points.length === 0) {
    return {
      version: PALETTE_ANALYSIS_VERSION,
      ...(source.source ? { source: source.source } : {}),
      config,
      extracted: [],
      derived: { harmonies: [] },
      contrastPairs: [],
      warnings: [
        {
          code: 'no-meaningful-colors',
          message: 'No pixels above the transparency threshold were found.',
        },
      ],
      timings: { samplingMs, clusteringMs: 0, postprocessMs: 0, totalMs: now() - totalStart },
      colors: [],
      coverage: 0,
    };
  }

  const clusteringStart = now();
  const clusters = runKMeans(points, Math.min(config.colorCount, points.length), config);
  const clusteringMs = now() - clusteringStart;

  const postprocessStart = now();
  const merged = mergeClusters(
    clusters.sort((a, b) => b.weight - a.weight || a.pointIndex - b.pointIndex),
    config.mergeDistance,
  ).sort((a, b) => b.weight - a.weight || a.pointIndex - b.pointIndex);
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  const extracted = makeSwatches(merged, totalWeight);
  const primary =
    extracted.find((swatch) => swatch.roleCandidate === 'primary') ??
    extracted.find((swatch) => swatch.roleCandidate === 'accent') ??
    extracted[0];
  const contrastPairs = buildContrastPairs(extracted);
  const warnings: PaletteWarning[] = [];
  if (sampled.hadTransparency) {
    warnings.push({
      code: 'transparent-pixels-ignored',
      message: 'Transparent and partially transparent pixels were alpha-weighted or ignored.',
    });
  }
  if (extracted.every((swatch) => getAlpha(swatch.color) < 0.98)) {
    warnings.push({
      code: 'no-opaque-pairs',
      message: 'Contrast pairs require opaque colors or a known compositing background.',
    });
  } else if (contrastPairs.length === 0) {
    warnings.push({
      code: 'no-opaque-pairs',
      message: 'No extracted colors form a 3:1 or stronger contrast pair.',
    });
  }
  const postprocessMs = now() - postprocessStart;

  return {
    version: PALETTE_ANALYSIS_VERSION,
    ...(source.source ? { source: source.source } : {}),
    config,
    extracted,
    derived: { harmonies: buildHarmonies(primary) },
    contrastPairs,
    warnings,
    timings: { samplingMs, clusteringMs, postprocessMs, totalMs: now() - totalStart },
    colors: extracted.map((swatch) => swatch.color),
    coverage:
      totalWeight > 0 ? merged.reduce((sum, cluster) => sum + cluster.weight, 0) / totalWeight : 0,
  };
}

/** Compatibility wrapper for the original engine API. */
export function extractPalette(
  imageData: ImageData,
  colorCount = DEFAULT_CONFIG.colorCount,
): PaletteAnalysis {
  return analyzePalette(
    {
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
    },
    { colorCount },
  );
}

/** Convenience entry point for workers and non-DOM tests. */
export function extractPaletteFromRgba(
  width: number,
  height: number,
  data: ArrayLike<number>,
  colorCount = DEFAULT_CONFIG.colorCount,
  source?: PaletteSourceInfo,
): PaletteAnalysis {
  return analyzePalette({ width, height, data, source }, { colorCount });
}
