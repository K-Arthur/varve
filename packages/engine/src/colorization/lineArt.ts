/**
 * Deterministic line-art colorization from user hints.
 *
 * The source line art supplies barriers (dark strokes plus an optional
 * gap-closing radius); user hint pixels are the only color seeds. Every
 * non-barrier pixel is assigned to its nearest hint by geodesic distance, so
 * color cannot cross linework, and pixels that no hint can reach stay
 * transparent. Line strokes and their antialiased edges are composited over
 * the fill, which preserves the original drawing instead of claiming that the
 * engine "understands" the image.
 *
 * This is intentionally not a learned model: no download, no account, and no
 * claim about semantic regions. A hint image at a different resolution is
 * sampled in source coordinates, matching the mask contract used elsewhere.
 */

export interface LineArtOptions {
  /** Luminance below which a pixel is linework. 0..1, default 0.5. */
  lineThreshold?: number;
  /** Barrier dilation radius in working pixels, closing small gaps. 0..8. */
  gapClose?: number;
  /** Working-resolution cap for the geodesic assignment. 64..4096. */
  maxDimension?: number;
  /** Hint alpha below which a hint pixel is ignored. 0..1, default 0.5. */
  hintAlphaThreshold?: number;
}

export interface LineArtStats {
  /** Fraction of reachable (non-line) pixels assigned to a hint. */
  filledFraction: number;
  /** Fraction of reachable pixels no hint could reach. */
  unassignedFraction: number;
  /** Number of usable hint pixels. */
  seedCount: number;
  /** Working resolution used for region assignment. */
  workingWidth: number;
  workingHeight: number;
}

export interface LineArtResult {
  image: ImageData;
  stats: LineArtStats;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteParameter(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Nearest-neighbour sample of the hint image in source coordinates. */
function sampleHintIndex(
  hints: ImageData,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  const hintX = Math.min(
    hints.width - 1,
    Math.max(0, Math.floor(((sourceX + 0.5) * hints.width) / sourceWidth)),
  );
  const hintY = Math.min(
    hints.height - 1,
    Math.max(0, Math.floor(((sourceY + 0.5) * hints.height) / sourceHeight)),
  );
  return hintY * hints.width + hintX;
}

/** Box-downsample a single-channel plane (pure JS; no DOM dependency). */
function downsamplePlane(
  plane: Float32Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  if (width === targetWidth && height === targetHeight) {
    return new Float32Array(plane);
  }
  const out = new Float32Array(targetWidth * targetHeight);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil((x + 1) * scaleX)));
      let sum = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          sum += plane[sy * width + sx] ?? 0;
          count += 1;
        }
      }
      out[y * targetWidth + x] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/** Nearest-neighbour upsample of a label map. */
function upsampleLabels(
  labels: Int32Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Int32Array {
  if (width === targetWidth && height === targetHeight) {
    return new Int32Array(labels);
  }
  const out = new Int32Array(targetWidth * targetHeight);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * scaleY));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * scaleX));
      out[y * targetWidth + x] = labels[sy * width + sx] ?? -1;
    }
  }
  return out;
}

/**
 * Dilate barriers by up to `radius` working pixels with a two-pass chamfer
 * distance transform (3-4 approximation). This closes pinholes and small
 * stroke gaps without a destructive blur of the artwork.
 */
function dilateBarriers(
  barrier: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  radius: number,
): Uint8Array<ArrayBuffer> {
  if (radius <= 0) return barrier;
  const distance = new Float32Array(width * height);
  const INF = 1e9;
  for (let i = 0; i < distance.length; i += 1) distance[i] = barrier[i] ? 0 : INF;
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      let best = distance[i] ?? INF;
      if (x > 0) best = Math.min(best, (distance[i - 1] ?? INF) + 1);
      if (y > 0) {
        best = Math.min(best, (distance[i - width] ?? INF) + 1);
        if (x > 0) best = Math.min(best, (distance[i - width - 1] ?? INF) + diagonal);
        if (x < width - 1) best = Math.min(best, (distance[i - width + 1] ?? INF) + diagonal);
      }
      distance[i] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      let best = distance[i] ?? INF;
      if (x < width - 1) best = Math.min(best, (distance[i + 1] ?? INF) + 1);
      if (y < height - 1) {
        best = Math.min(best, (distance[i + width] ?? INF) + 1);
        if (x < width - 1) best = Math.min(best, (distance[i + width + 1] ?? INF) + diagonal);
        if (x > 0) best = Math.min(best, (distance[i + width - 1] ?? INF) + diagonal);
      }
      distance[i] = best;
    }
  }
  const out = new Uint8Array(barrier.length);
  for (let i = 0; i < out.length; i += 1) out[i] = (distance[i] ?? INF) <= radius ? 1 : 0;
  return out;
}

/**
 * Binary min-heap over parallel typed arrays. Avoids per-relaxation object
 * allocation so a full-resolution propagation stays bounded.
 */
class TypedMinHeap {
  private indices: Int32Array;
  private distances: Float32Array;
  private count = 0;

  constructor(capacity = 1024) {
    const size = Math.max(16, capacity);
    this.indices = new Int32Array(size);
    this.distances = new Float32Array(size);
  }

  push(index: number, distance: number): void {
    if (this.count === this.indices.length) this.grow();
    let child = this.count;
    this.indices[child] = index;
    this.distances[child] = distance;
    this.count += 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if ((this.distances[parent] ?? 0) <= (this.distances[child] ?? 0)) break;
      const tmpIndex = this.indices[parent] ?? 0;
      const tmpDistance = this.distances[parent] ?? 0;
      this.indices[parent] = this.indices[child] ?? 0;
      this.distances[parent] = this.distances[child] ?? 0;
      this.indices[child] = tmpIndex;
      this.distances[child] = tmpDistance;
      child = parent;
    }
  }

  pop(): { index: number; distance: number } | null {
    if (this.count === 0) return null;
    const index = this.indices[0] ?? 0;
    const distance = this.distances[0] ?? 0;
    this.count -= 1;
    if (this.count > 0) {
      this.indices[0] = this.indices[this.count] ?? 0;
      this.distances[0] = this.distances[this.count] ?? 0;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.count && (this.distances[left] ?? 0) < (this.distances[smallest] ?? 0)) {
          smallest = left;
        }
        if (right < this.count && (this.distances[right] ?? 0) < (this.distances[smallest] ?? 0)) {
          smallest = right;
        }
        if (smallest === parent) break;
        const tmpIndex = this.indices[parent] ?? 0;
        const tmpDistance = this.distances[parent] ?? 0;
        this.indices[parent] = this.indices[smallest] ?? 0;
        this.distances[parent] = this.distances[smallest] ?? 0;
        this.indices[smallest] = tmpIndex;
        this.distances[smallest] = tmpDistance;
        parent = smallest;
      }
    }
    return { index, distance };
  }

  private grow(): void {
    const nextIndices = new Int32Array(this.indices.length * 2);
    const nextDistances = new Float32Array(this.distances.length * 2);
    nextIndices.set(this.indices);
    nextDistances.set(this.distances);
    this.indices = nextIndices;
    this.distances = nextDistances;
  }
}

export function lineArtColorize(
  source: ImageData,
  hints: ImageData | undefined,
  options: LineArtOptions = {},
): LineArtResult {
  const { width, height, data } = source;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Line-art source dimensions must be positive integers');
  }
  if (!hints) throw new Error('Line-art colorization requires a hint image');
  if (
    !Number.isSafeInteger(hints.width) ||
    !Number.isSafeInteger(hints.height) ||
    hints.width <= 0 ||
    hints.height <= 0
  ) {
    throw new Error('Hint image dimensions must be positive integers');
  }
  if (data.length < width * height * 4) {
    throw new Error('Line-art source data is shorter than its dimensions');
  }

  const lineThreshold = clamp(finiteParameter('lineThreshold', options.lineThreshold ?? 0.5), 0, 1);
  const gapClose = clamp(finiteParameter('gapClose', options.gapClose ?? 1), 0, 8);
  const maxDimension = clamp(
    Math.round(finiteParameter('maxDimension', options.maxDimension ?? 2048)),
    64,
    4096,
  );
  const hintAlphaThreshold = clamp(
    finiteParameter('hintAlphaThreshold', options.hintAlphaThreshold ?? 0.5),
    0,
    1,
  );

  // Full-resolution ink coverage and source alpha. Ink is the distance below
  // the paper threshold, gated by source alpha so transparent paper is never
  // mistaken for linework.
  const pixelCount = width * height;
  const coverage = new Float32Array(pixelCount);
  const sourceAlpha = new Uint8ClampedArray(pixelCount);
  const inkScale = Math.max(0.05, lineThreshold);
  for (let i = 0; i < pixelCount; i += 1) {
    const index = i * 4;
    const alpha = data[index + 3] ?? 255;
    const lum = luminance(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0);
    const ink = clamp((lineThreshold - lum) / inkScale, 0, 1);
    coverage[i] = ink * (alpha / 255);
    sourceAlpha[i] = alpha;
  }

  const longest = Math.max(width, height);
  const scale = longest > maxDimension ? maxDimension / longest : 1;
  const workingWidth = Math.max(1, Math.round(width * scale));
  const workingHeight = Math.max(1, Math.round(height * scale));
  const workingCoverage = downsamplePlane(coverage, width, height, workingWidth, workingHeight);

  // Barrier mask at working resolution: solid linework plus gap closing.
  let barrier = new Uint8Array(workingWidth * workingHeight);
  for (let i = 0; i < barrier.length; i += 1) {
    barrier[i] = (workingCoverage[i] ?? 0) >= 0.5 ? 1 : 0;
  }
  barrier = dilateBarriers(barrier, workingWidth, workingHeight, gapClose);

  // Seeds from the hint image, sampled in source coordinates. Working pixels
  // that map to the same hint pixel share one seed, so a low-resolution hint
  // does not fan out into duplicate regions.
  const seedColors: Array<[number, number, number]> = [];
  const seedByHintPixel = new Map<number, number>();
  const labels = new Int32Array(workingWidth * workingHeight).fill(-1);
  const distance = new Float32Array(workingWidth * workingHeight).fill(Number.POSITIVE_INFINITY);
  const heap = new TypedMinHeap(1024);
  for (let y = 0; y < workingHeight; y += 1) {
    for (let x = 0; x < workingWidth; x += 1) {
      const i = y * workingWidth + x;
      if (barrier[i]) continue;
      const sourceX = Math.min(width - 1, Math.floor(((x + 0.5) * width) / workingWidth));
      const sourceY = Math.min(height - 1, Math.floor(((y + 0.5) * height) / workingHeight));
      const hintPixel = sampleHintIndex(hints, sourceX, sourceY, width, height);
      const hintIndex = hintPixel * 4;
      const alpha = (hints.data[hintIndex + 3] ?? 0) / 255;
      if (alpha < hintAlphaThreshold) continue;
      let label = seedByHintPixel.get(hintPixel);
      if (label === undefined) {
        label = seedColors.length;
        seedByHintPixel.set(hintPixel, label);
        seedColors.push([
          hints.data[hintIndex] ?? 0,
          hints.data[hintIndex + 1] ?? 0,
          hints.data[hintIndex + 2] ?? 0,
        ]);
      }
      labels[i] = label;
      distance[i] = 0;
      heap.push(i, 0);
    }
  }

  // Geodesic nearest-seed assignment (8-connected, Euclidean step costs).
  const diagonal = Math.SQRT2;
  for (;;) {
    const entry = heap.pop();
    if (!entry) break;
    const { index, distance: current } = entry;
    if (current > (distance[index] ?? Number.POSITIVE_INFINITY)) continue;
    const x = index % workingWidth;
    const y = (index - x) / workingWidth;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= workingWidth || ny >= workingHeight) continue;
        const neighbor = ny * workingWidth + nx;
        if (barrier[neighbor]) continue;
        const step = dx !== 0 && dy !== 0 ? diagonal : 1;
        const candidate = current + step;
        if (candidate < (distance[neighbor] ?? Number.POSITIVE_INFINITY)) {
          distance[neighbor] = candidate;
          labels[neighbor] = labels[index] ?? -1;
          heap.push(neighbor, candidate);
        }
      }
    }
  }

  const workingLabels = upsampleLabels(labels, workingWidth, workingHeight, width, height);

  // Composite: opaque hint fill with the original strokes over it. Pixels
  // with no reachable hint keep the original stroke where ink exists and stay
  // transparent on paper, so an unfilled region is an explicit hole rather
  // than a white rectangle.
  const out = new ImageData(width, height);
  let reachable = 0;
  let filled = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const index = i * 4;
    const lineCoverage = coverage[i] ?? 0;
    const alpha = sourceAlpha[i] ?? 255;
    const label = workingLabels[i] ?? -1;
    const fill = label >= 0 ? seedColors[label] : undefined;
    if (lineCoverage < 0.5) {
      reachable += 1;
      if (fill) filled += 1;
    }
    if (!fill) {
      if (lineCoverage > 0) {
        // Preserve the original stroke and its antialiased edge exactly.
        out.data[index] = data[index] ?? 0;
        out.data[index + 1] = data[index + 1] ?? 0;
        out.data[index + 2] = data[index + 2] ?? 0;
        out.data[index + 3] = alpha;
      } else {
        out.data[index] = 0;
        out.data[index + 1] = 0;
        out.data[index + 2] = 0;
        out.data[index + 3] = 0;
      }
      continue;
    }
    const lineAlpha = (lineCoverage * alpha) / 255;
    out.data[index] = Math.round((data[index] ?? 0) * lineAlpha + fill[0] * (1 - lineAlpha));
    out.data[index + 1] = Math.round(
      (data[index + 1] ?? 0) * lineAlpha + fill[1] * (1 - lineAlpha),
    );
    out.data[index + 2] = Math.round(
      (data[index + 2] ?? 0) * lineAlpha + fill[2] * (1 - lineAlpha),
    );
    out.data[index + 3] = 255;
  }

  return {
    image: out,
    stats: {
      filledFraction: reachable > 0 ? filled / reachable : 0,
      unassignedFraction: reachable > 0 ? 1 - filled / reachable : 0,
      seedCount: seedColors.length,
      workingWidth,
      workingHeight,
    },
  };
}
