/**
 * Heuristic foreground object selection.
 *
 * Zero model downloads required — uses simple image analysis:
 * - Center-priority saliency (center-weighted energy)
 * - Flood-fill from center
 * - Edge-aware boundary refinement (Sobel-based)
 *
 * Falls back gracefully when SAM2 or BiRefNet are not available.
 * All operations run on the calling thread (ImageData level).
 */

export interface ForegroundSelectionResult {
  /** Binary mask: 255 = foreground, 0 = background */
  mask: Uint8Array;
  width: number;
  height: number;
  confidence: number;
}

/**
 * Select foreground using center-priority flood fill.
 * Best for images with a centered subject on a plain background.
 */
export function selectForegroundCenter(
  imageData: ImageData,
): ForegroundSelectionResult {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);

  // Compute edge energy (simplified Sobel)
  const edges = computeEdgeEnergy(data, width, height);

  // Flood fill from center
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const centerIdx = cy * width + cx;

  // Use color distance + edge barrier for flood fill
  const centerColor = getPixelColor(data, cx, cy, width);
  const visited = new Uint8Array(width * height);
  const queue: Array<{ x: number; y: number }> = [{ x: cx, y: cy }];
  visited[centerIdx] = 1;

  // Adaptive thresholds
  const colorThreshold = estimateColorThreshold(data, width, height);
  const edgeThreshold = 120;

  let foregroundPixels = 0;

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    const idx = y * width + x;
    mask[idx] = 255;
    foregroundPixels++;

    // Check 4-connected neighbors
    const neighbors = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (const n of neighbors) {
      if (n.x < 0 || n.x >= width || n.y < 0 || n.y >= height) continue;
      const nIdx = n.y * width + n.x;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;

      // Strong edge = stop
      if (edges[nIdx] > edgeThreshold) continue;

      // Color similar to center = foreground
      const pixelColor = getPixelColor(data, n.x, n.y, width);
      const diff = colorDistance(centerColor, pixelColor);
      if (diff < colorThreshold) {
        queue.push(n);
      }
    }
  }

  const totalPixels = width * height;
  const coverage = foregroundPixels / totalPixels;
  const confidence = computeConfidence(coverage, edges, mask, width, height);

  return { mask, width, height, confidence };
}

/**
 * Select foreground using simple border detection + center crop.
 * Fast fallback when flood fill fails (e.g., complex backgrounds).
 */
export function selectForegroundBorder(
  imageData: ImageData,
): ForegroundSelectionResult {
  const { width, height } = imageData;
  const mask = new Uint8Array(width * height);

  // Assume center 60% is foreground
  const marginX = Math.floor(width * 0.2);
  const marginY = Math.floor(height * 0.2);

  for (let y = marginY; y < height - marginY; y++) {
    for (let x = marginX; x < width - marginX; x++) {
      mask[y * width + x] = 255;
    }
  }

  return { mask, width, height, confidence: 0.3 };
}

/**
 * Compute a simple weighted saliency map (center bias + color contrast).
 */
export function computeSaliencyMap(imageData: ImageData): Uint8Array {
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

// ── Helpers ────────────────────────────────────────────────

function getPixelColor(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
): [number, number, number] {
  const idx = (y * width + x) * 4;
  return [data[idx]!, data[idx + 1]!, data[idx + 2]!];
}

function colorDistance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function computeMeanColor(
  data: Uint8ClampedArray,
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
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const left = (y * width + (x - 1)) * 4;
      const right = (y * width + (x + 1)) * 4;
      const up = ((y - 1) * width + x) * 4;
      const down = ((y + 1) * width + x) * 4;

      const gx =
        -data[left]! + data[right]! - data[left + 1]! + data[right + 1]! - data[left + 2]! + data[right + 2]!;
      const gy =
        -data[up]! + data[down]! - data[up + 1]! + data[down + 1]! - data[up + 2]! + data[down + 2]!;

      const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy) / 3);
      edges[y * width + x] = Math.round(magnitude);
    }
  }

  return edges;
}

function estimateColorThreshold(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const centerColor = getPixelColor(data, cx, cy, width);

  // Sample 100 random pixels to estimate background color variance
  const diffs: number[] = [];
  const sampleCount = Math.min(100, width * height);
  for (let i = 0; i < sampleCount; i++) {
    const sx = Math.floor(Math.random() * width);
    const sy = Math.floor(Math.random() * height);
    const pixel = getPixelColor(data, sx, sy, width);
    diffs.push(colorDistance(centerColor, pixel));
  }

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
        if (edges[idx] > 60) edgeAlignCount++;
      }
    }
  }

  const edgeAlign = boundaryCount > 0 ? edgeAlignCount / boundaryCount : 0;
  return Math.min(0.9, 0.3 + edgeAlign * 0.4);
}
