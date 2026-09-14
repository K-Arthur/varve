/**
 * Model-free foreground/subject proposals.
 *
 * Zero model downloads required. The estimator separates a likely foreground
 * by flooding the image border through colour-continuous pixels; anything the
 * border flood cannot reach is proposed as a subject. Candidates are ranked
 * with an explicit, documented policy (coverage, centrality, edge alignment)
 * and returned as bounded analysis-resolution masks that callers map back to
 * source pixels.
 *
 * This is an estimate, not semantic recognition. It never claims to know what
 * an object is, it never uploads pixels, and it is deliberately cheap enough
 * for low-memory devices: analysis runs on a plane capped by
 * `analysisMaxDimension` (default 1024), so the working set stays in the low
 * megabytes even for very large images.
 */

export interface ForegroundSelectionResult {
  /** Binary mask: 255 = foreground, 0 = background */
  mask: Uint8Array;
  width: number;
  height: number;
  confidence: number;
}

export interface ForegroundProposalSource {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface ForegroundProposal {
  /** Binary mask at analysis resolution: 255 = proposed foreground. */
  mask: Uint8Array;
  /** Fraction of analysis pixels covered by this proposal (0..1). */
  coverage: number;
  /**
   * Ranking score (0..1) from the documented policy
   * `0.55 * coverageScore + 0.25 * centrality + 0.20 * edgeAlignment`.
   * It is a proposal-ranking score, not a probability and not semantic
   * confidence.
   */
  score: number;
  /** Normalized analysis-plane centroid (0..1). */
  centroid: { x: number; y: number };
  /** Fraction of boundary pixels that sit on a strong colour edge (0..1). */
  edgeAlignment: number;
}

export interface ForegroundProposalOptions {
  /** Longest analysis-plane edge. Default 1024. Lower is faster/coarser. */
  analysisMaxDimension?: number;
  /** Maximum number of proposals returned. Default 5. */
  maxCandidates?: number;
  /** Minimum component coverage of the analysis plane. Default 0.002. */
  minCoverage?: number;
}

export interface ForegroundProposalSet {
  /** Source dimensions the masks map back to. */
  width: number;
  height: number;
  /** Analysis plane the returned masks live in. */
  analysisWidth: number;
  analysisHeight: number;
  candidates: ForegroundProposal[];
  /** Present when `candidates` is empty, so callers can explain why. */
  emptyReason?: 'unsupported-source' | 'all-transparent' | 'no-subject';
}

const MIN_SAMPLE_ALPHA = 16;
const BOUNDARY_EDGE_STRENGTH = 48;
const MAX_LEAK_DISTANCE_FACTOR = 2.5;

function validSource(source: ForegroundProposalSource): boolean {
  return (
    Number.isInteger(source.width) &&
    Number.isInteger(source.height) &&
    source.width > 0 &&
    source.height > 0 &&
    source.data.length === source.width * source.height * 4
  );
}

/**
 * Select foreground using center-priority flood fill.
 * Best for images with a centered subject on a plain background.
 */
export function selectForegroundCenter(
  imageData: ImageData | ForegroundProposalSource,
): ForegroundSelectionResult {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);

  const edges = computeEdgeEnergy(data, width, height);

  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const centerIdx = cy * width + cx;

  const centerColor = getPixelColor(data, cx, cy, width);
  const visited = new Uint8Array(width * height);
  // Index-based queue: `Array.prototype.shift` is O(n) and turns a full-image
  // flood fill into quadratic work on low-memory devices.
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail++] = centerIdx;
  visited[centerIdx] = 1;

  const colorThreshold = estimateColorThreshold(data, width, height);
  const edgeThreshold = 120;

  let foregroundPixels = 0;

  while (head < tail) {
    const current = queue[head++]!;
    const x = current % width;
    const y = (current - x) / width;
    mask[current] = 255;
    foregroundPixels++;

    const neighbours = [
      x > 0 ? current - 1 : -1,
      x < width - 1 ? current + 1 : -1,
      y > 0 ? current - width : -1,
      y < height - 1 ? current + width : -1,
    ];

    for (const nIdx of neighbours) {
      if (nIdx < 0 || visited[nIdx]) continue;
      visited[nIdx] = 1;
      const neighborColor = getPixelColor(
        data,
        nIdx % width,
        (nIdx - (nIdx % width)) / width,
        width,
      );

      // Strong edge = stop
      if ((edges[nIdx] ?? 0) > edgeThreshold) continue;

      // Color similar to center = foreground
      const diff = colorDistance(centerColor, neighborColor);
      if (diff < colorThreshold) {
        queue[tail++] = nIdx;
      }
    }
  }

  const totalPixels = width * height;
  const coverage = foregroundPixels / totalPixels;
  const confidence = computeConfidence(coverage, edges, mask, width, height);

  return { mask, width, height, confidence };
}

/**
 * Compute a simple weighted saliency map (center bias + color contrast).
 */
export function computeSaliencyMap(imageData: ImageData | ForegroundProposalSource): Uint8Array {
  const { data, width, height } = imageData;
  const saliency = new Uint8Array(width * height);

  const meanColor = computeMeanColor(data, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixel = getPixelColor(data, x, y, width);
      const colorContrast = colorDistance(meanColor, pixel);
      const centerDist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const centerBias = 1 - centerDist / maxDist;

      // Saliency = center bias * 0.5 + color contrast * 0.5
      const value = centerBias * 0.5 + Math.min(1, colorContrast / 128) * 0.5;
      saliency[idx] = Math.round(value * 255);
    }
  }

  return saliency;
}

/**
 * Propose likely foreground subjects without a prompt.
 *
 * The border flood only traverses colour-continuous pixels and is bounded by
 * a global similarity gate, so a smooth gradient background is consumed while
 * a distinct subject is not. Enclosed background-coloured regions (for
 * example a ring's hole or a white logo detail) stay inside the proposal
 * rather than being punched out automatically; callers can remove them with
 * the refinement tools.
 */
export function proposeForegroundSubjects(
  source: ForegroundProposalSource,
  options: ForegroundProposalOptions = {},
): ForegroundProposalSet {
  if (!validSource(source)) {
    return {
      width: Math.max(0, source.width | 0),
      height: Math.max(0, source.height | 0),
      analysisWidth: 0,
      analysisHeight: 0,
      candidates: [],
      emptyReason: 'unsupported-source',
    };
  }

  const maxDimension = Math.max(32, Math.floor(options.analysisMaxDimension ?? 1024));
  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
  const aw = Math.max(1, Math.round(source.width * scale));
  const ah = Math.max(1, Math.round(source.height * scale));
  const plane = samplePlane(source, aw, ah);

  const base: ForegroundProposalSet = {
    width: source.width,
    height: source.height,
    analysisWidth: aw,
    analysisHeight: ah,
    candidates: [],
  };

  const total = aw * ah;
  const alphaPlane = plane.alpha;
  let visiblePixels = 0;
  for (let i = 0; i < total; i++) {
    if (alphaPlane[i]! >= MIN_SAMPLE_ALPHA) visiblePixels++;
  }
  if (visiblePixels === 0) return { ...base, emptyReason: 'all-transparent' };

  const borderModel = computeBorderModel(plane, aw, ah);
  if (!borderModel) return { ...base, emptyReason: 'all-transparent' };

  const reached = floodBackground(plane, aw, ah, borderModel);
  const foreground = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    foreground[i] = reached[i] === 0 && alphaPlane[i]! >= MIN_SAMPLE_ALPHA ? 1 : 0;
  }

  const edgeEnergy = computeEdgeEnergy(plane.rgba, aw, ah);
  const minArea = Math.max(32, Math.round(total * (options.minCoverage ?? 0.002)));

  const borderComponents = labelComponents(foreground, aw, ah).filter(
    (component) => component.pixelCount >= minArea && component.pixelCount <= total * 0.98,
  );

  // A subject that touches the image border is consumed by the border flood.
  // The center flood covers the complementary case (a centred subject on a
  // plain or gradient background), so both strategies contribute proposals
  // and near-duplicates are dropped.
  const centerSelection = selectForegroundCenter({ data: plane.rgba, width: aw, height: ah });
  const centerComponents = labelComponents(centerSelection.mask, aw, ah).filter(
    (component) => component.pixelCount >= minArea && component.pixelCount <= total * 0.98,
  );

  const borderCovered = new Uint8Array(total);
  for (const component of borderComponents) {
    for (const index of component.pixels) borderCovered[index] = 1;
  }
  const novelCenterComponents = centerComponents.filter((component) => {
    let overlap = 0;
    for (const index of component.pixels) {
      if (borderCovered[index]) overlap++;
    }
    return overlap / component.pixelCount <= 0.7;
  });

  const components = [...borderComponents, ...novelCenterComponents]
    .sort((a, b) => b.pixelCount - a.pixelCount)
    .slice(0, Math.max(1, Math.floor(options.maxCandidates ?? 5)));

  if (components.length === 0) return { ...base, emptyReason: 'no-subject' };

  const cx = aw / 2;
  const cy = ah / 2;
  const maxCenterDistance = Math.sqrt(cx * cx + cy * cy);

  const candidates: ForegroundProposal[] = components.map((component) => {
    const coverage = component.pixelCount / total;
    const centroid = {
      x: component.sumX / component.pixelCount / aw,
      y: component.sumY / component.pixelCount / ah,
    };
    const centroidDistance = Math.hypot(centroid.x * aw - cx, centroid.y * ah - cy);
    const centrality = maxCenterDistance > 0 ? 1 - centroidDistance / maxCenterDistance : 1;

    let boundary = 0;
    let aligned = 0;
    for (const index of component.pixels) {
      const x = index % aw;
      const y = (index - x) / aw;
      const hasBackgroundNeighbour =
        (x > 0 && foreground[index - 1] === 0) ||
        (x < aw - 1 && foreground[index + 1] === 0) ||
        (y > 0 && foreground[index - aw] === 0) ||
        (y < ah - 1 && foreground[index + aw] === 0);
      if (!hasBackgroundNeighbour) continue;
      boundary++;
      if ((edgeEnergy[index] ?? 0) > BOUNDARY_EDGE_STRENGTH) aligned++;
    }
    const edgeAlignment = boundary > 0 ? aligned / boundary : 0;
    const coverageScore = Math.min(1, coverage / 0.25);
    const score = Math.max(
      0,
      Math.min(1, 0.55 * coverageScore + 0.25 * centrality + 0.2 * edgeAlignment),
    );

    const mask = new Uint8Array(total);
    for (const index of component.pixels) mask[index] = 255;
    return { mask, coverage, score, centroid, edgeAlignment };
  });

  return { ...base, candidates };
}

/** Nearest-neighbour map of an analysis-resolution proposal into source pixels. */
export function mapProposalMaskToSource(
  mask: Uint8Array,
  analysisWidth: number,
  analysisHeight: number,
  width: number,
  height: number,
): Uint8Array | null {
  if (
    !Number.isInteger(analysisWidth) ||
    !Number.isInteger(analysisHeight) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    analysisWidth <= 0 ||
    analysisHeight <= 0 ||
    width <= 0 ||
    height <= 0 ||
    mask.length !== analysisWidth * analysisHeight
  ) {
    return null;
  }
  if (analysisWidth === width && analysisHeight === height) return mask.slice();
  const out = new Uint8Array(width * height);
  const scaleX = analysisWidth / width;
  const scaleY = analysisHeight / height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(analysisHeight - 1, Math.floor(y * scaleY));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(analysisWidth - 1, Math.floor(x * scaleX));
      out[y * width + x] = mask[sy * analysisWidth + sx]!;
    }
  }
  return out;
}

// ── Internal analysis ──────────────────────────────────────

interface SamplingPlane {
  width: number;
  height: number;
  /** Interleaved RGBA for the analysis grid (alpha kept for edge/visibility checks). */
  rgba: Uint8ClampedArray;
  alpha: Uint8Array;
}

function samplePlane(
  source: ForegroundProposalSource,
  width: number,
  height: number,
): SamplingPlane {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const alpha = new Uint8Array(width * height);
  const scaleX = source.width / width;
  const scaleY = source.height / height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(source.height - 1, Math.floor(y * scaleY));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(source.width - 1, Math.floor(x * scaleX));
      const src = (sy * source.width + sx) * 4;
      const dst = (y * width + x) * 4;
      rgba[dst] = source.data[src]!;
      rgba[dst + 1] = source.data[src + 1]!;
      rgba[dst + 2] = source.data[src + 2]!;
      rgba[dst + 3] = source.data[src + 3]!;
      alpha[y * width + x] = source.data[src + 3]!;
    }
  }
  return { width, height, rgba, alpha };
}

interface BorderModel {
  median: [number, number, number];
  colorThreshold: number;
  adjacencyThreshold: number;
  leakBound: number;
}

function computeBorderModel(
  plane: SamplingPlane,
  width: number,
  height: number,
): BorderModel | null {
  const samples: Array<[number, number, number]> = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  for (let x = 0; x < width; x += step) {
    for (const y of [0, height - 1]) {
      const index = y * width + x;
      if (plane.alpha[index]! < MIN_SAMPLE_ALPHA) continue;
      samples.push(pixelOf(plane, index));
    }
  }
  for (let y = 0; y < height; y += step) {
    for (const x of [0, width - 1]) {
      const index = y * width + x;
      if (plane.alpha[index]! < MIN_SAMPLE_ALPHA) continue;
      samples.push(pixelOf(plane, index));
    }
  }
  if (samples.length === 0) return null;

  const median: [number, number, number] = [
    medianOf(samples.map((sample) => sample[0])),
    medianOf(samples.map((sample) => sample[1])),
    medianOf(samples.map((sample) => sample[2])),
  ];
  let spread = 0;
  for (const sample of samples) spread += colorDistance(sample, median);
  spread /= samples.length;

  const colorThreshold = clamp(spread * 1.5 + 12, 16, 96);
  return {
    median,
    colorThreshold,
    adjacencyThreshold: clamp(spread * 1.5 + 16, 20, 110),
    leakBound: colorThreshold * MAX_LEAK_DISTANCE_FACTOR,
  };
}

function floodBackground(
  plane: SamplingPlane,
  width: number,
  height: number,
  model: BorderModel,
): Uint8Array {
  const total = width * height;
  const reached = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const seed = (index: number) => {
    if (reached[index]) return;
    if (plane.alpha[index]! < MIN_SAMPLE_ALPHA) return;
    if (colorDistance(pixelOf(plane, index), model.median) > model.colorThreshold) return;
    reached[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (head < tail) {
    const current = queue[head++]!;
    const x = current % width;
    const y = (current - x) / width;
    const currentColor = pixelOf(plane, current);
    const neighbours = [
      x > 0 ? current - 1 : -1,
      x < width - 1 ? current + 1 : -1,
      y > 0 ? current - width : -1,
      y < height - 1 ? current + width : -1,
    ];
    for (const next of neighbours) {
      if (next < 0 || reached[next]) continue;
      if (plane.alpha[next]! < MIN_SAMPLE_ALPHA) continue;
      const nextColor = pixelOf(plane, next);
      if (colorDistance(currentColor, nextColor) > model.adjacencyThreshold) continue;
      if (colorDistance(nextColor, model.median) > model.leakBound) continue;
      reached[next] = 1;
      queue[tail++] = next;
    }
  }

  return reached;
}

interface LabeledComponent {
  pixelCount: number;
  sumX: number;
  sumY: number;
  pixels: number[];
}

function labelComponents(
  foreground: Uint8Array,
  width: number,
  height: number,
): LabeledComponent[] {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const components: LabeledComponent[] = [];

  for (let start = 0; start < total; start++) {
    if (foreground[start] === 0 || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const component: LabeledComponent = { pixelCount: 0, sumX: 0, sumY: 0, pixels: [] };

    while (head < tail) {
      const current = queue[head++]!;
      const x = current % width;
      const y = (current - x) / width;
      component.pixelCount++;
      component.sumX += x;
      component.sumY += y;
      component.pixels.push(current);
      const neighbours = [
        x > 0 ? current - 1 : -1,
        x < width - 1 ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y < height - 1 ? current + width : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && foreground[next] !== 0 && visited[next] === 0) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    components.push(component);
  }

  return components;
}

// ── Helpers ────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function pixelOf(plane: SamplingPlane, index: number): [number, number, number] {
  const base = index * 4;
  return [plane.rgba[base]!, plane.rgba[base + 1]!, plane.rgba[base + 2]!];
}

function getPixelColor(
  data: Uint8ClampedArray | Uint8Array,
  x: number,
  y: number,
  width: number,
): [number, number, number] {
  const idx = (y * width + x) * 4;
  return [data[idx]!, data[idx + 1]!, data[idx + 2]!];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function computeMeanColor(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = width * height;
  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    r += data[idx]!;
    g += data[idx + 1]!;
    b += data[idx + 2]!;
  }
  return [r / count, g / count, b / count];
}

function computeEdgeEnergy(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const left = (y * width + (x - 1)) * 4;
      const right = (y * width + (x + 1)) * 4;
      const up = ((y - 1) * width + x) * 4;
      const down = ((y + 1) * width + x) * 4;

      const gx =
        -data[left]! +
        data[right]! -
        data[left + 1]! +
        data[right + 1]! -
        data[left + 2]! +
        data[right + 2]!;
      const gy =
        -data[up]! +
        data[down]! -
        data[up + 1]! +
        data[down + 1]! -
        data[up + 2]! +
        data[down + 2]!;

      const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy) / 3);
      edges[y * width + x] = Math.round(magnitude);
    }
  }

  return edges;
}

function estimateColorThreshold(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): number {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const centerColor = getPixelColor(data, cx, cy, width);

  // Deterministic stride sample of the image (no Math.random) so identical
  // inputs produce identical thresholds.
  const diffs: number[] = [];
  const sampleCount = Math.min(100, width * height);
  const stride = Math.max(1, Math.floor((width * height) / sampleCount));
  for (let i = 0; i < width * height; i += stride) {
    const sx = i % width;
    const sy = (i - sx) / width;
    const pixel = getPixelColor(data, sx, sy, width);
    diffs.push(colorDistance(centerColor, pixel));
  }
  if (diffs.length === 0) return 50;

  diffs.sort((a, b) => a - b);
  // Use median as adaptive threshold, with min 30 and max 80
  const median = diffs[Math.floor(diffs.length / 2)] ?? 50;
  return Math.max(30, Math.min(80, median));
}

function computeConfidence(
  coverage: number,
  edges: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
): number {
  // Too much or too little coverage = low confidence
  if (coverage < 0.05 || coverage > 0.95) return 0.1;
  if (coverage > 0.8) return 0.4;

  // Check if mask boundaries align with edges = higher confidence
  let edgeAlignCount = 0;
  let boundaryCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const isFg = mask[idx] === 255;
      const hasNeighborBg =
        mask[idx - 1] === 0 ||
        mask[idx + 1] === 0 ||
        mask[idx - width] === 0 ||
        mask[idx + width] === 0;

      if (isFg && hasNeighborBg) {
        boundaryCount++;
        if ((edges[idx] ?? 0) > 60) edgeAlignCount++;
      }
    }
  }

  const edgeAlign = boundaryCount > 0 ? edgeAlignCount / boundaryCount : 0;
  return Math.min(0.9, 0.3 + edgeAlign * 0.4);
}
