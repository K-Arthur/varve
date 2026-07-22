/**
 * Depth-aware effects — zero model download required.
 *
 * Uses heuristic depth estimation (edge energy + center bias) to
 * approximate depth-of-field blur, fog, and depth grading.
 * Can be enhanced with Depth-Anything-V2 when the model is available.
 */

export interface DepthMap {
  /** Per-pixel depth values (0 = far, 255 = near) */
  data: Uint8Array;
  width: number;
  height: number;
}

export interface DepthEffectOptions {
  /** Blur strength for DOF effect (0-20px) */
  blurStrength: number;
  /** Focal plane depth (0-255, where focus is sharpest) */
  focalDepth: number;
  /** Focal depth range (how much around focal plane is in focus) */
  focalRange: number;
}

/**
 * Compute a depth map using edge energy + center bias.
 * Near = high edge contrast + close to center.
 * Far = low edge contrast + close to edges.
 */
export function computeHeuristicDepth(imageData: ImageData): DepthMap {
  const { data, width, height } = imageData;
  const depth = new Uint8Array(width * height);

  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Edge energy at this pixel
      const edgeVal = computePixelEdge(data, x, y, width, height);

      // Center bias (closer to center = nearer)
      const centerDist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const centerBias = 1 - centerDist / maxDist;

      // Combine: edges = depth boundaries, center = foreground bias
      const depthVal = centerBias * 0.6 + (edgeVal / 255) * 0.4;
      depth[idx] = Math.round(Math.max(0, Math.min(255, depthVal * 255)));
    }
  }

  return { data: depth, width, height };
}

/**
 * Apply depth-of-field blur to an image using the depth map.
 * Near = sharp, Far = blurred.
 */
export function applyDepthOfField(
  imageData: ImageData,
  depthMap: DepthMap,
  options: DepthEffectOptions,
): ImageData {
  const { data, width, height } = imageData;
  const output = new Uint8ClampedArray(data.length);

  const { blurStrength, focalDepth, focalRange } = options;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const depth = depthMap.data[idx]!;
      const outIdx = idx * 4;

      // How far from focal plane (0 = in focus, 1 = max blur)
      const depthDiff = Math.abs(depth - focalDepth) / focalRange;
      const blurAmount = Math.min(1, Math.max(0, depthDiff)) * blurStrength;

      if (blurAmount < 0.5) {
        // In focus — copy original
        output[outIdx] = data[outIdx]!;
        output[outIdx + 1] = data[outIdx + 1]!;
        output[outIdx + 2] = data[outIdx + 2]!;
        output[outIdx + 3] = data[outIdx + 3]!;
      } else {
        // Blurred — sample a wider area (simplified)
        const sampleSize = Math.max(1, Math.round(blurAmount));
        const blurred = sampleBlurred(data, x, y, width, height, sampleSize);
        output[outIdx] = blurred[0];
        output[outIdx + 1] = blurred[1];
        output[outIdx + 2] = blurred[2];
        output[outIdx + 3] = data[outIdx + 3]!;
      }
    }
  }

  return new ImageData(output, width, height);
}

/**
 * Apply depth-based fog/haze: farther pixels get lighter and desaturated.
 */
export function applyDepthFog(
  imageData: ImageData,
  depthMap: DepthMap,
  fogColor: [number, number, number] = [200, 210, 220],
  fogStrength = 0.3,
): ImageData {
  const { data, width, height } = imageData;
  const output = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const depth = depthMap.data[idx]!;
      const outIdx = idx * 4;

      // Far = more fog (depth 0 = far = full fog)
      const fogFactor = (1 - depth / 255) * fogStrength;

      output[outIdx] = Math.round(data[outIdx]! * (1 - fogFactor) + fogColor[0] * fogFactor);
      output[outIdx + 1] = Math.round(data[outIdx + 1]! * (1 - fogFactor) + fogColor[1] * fogFactor);
      output[outIdx + 2] = Math.round(data[outIdx + 2]! * (1 - fogFactor) + fogColor[2] * fogFactor);
      output[outIdx + 3] = data[outIdx + 3]!;
    }
  }

  return new ImageData(output, width, height);
}

// ── Helpers ────────────────────────────────────────────────

function computePixelEdge(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) return 0;

  const idx = (y * width + x) * 4;
  const left = (y * width + (x - 1)) * 4;
  const right = (y * width + (x + 1)) * 4;
  const up = ((y - 1) * width + x) * 4;
  const down = ((y + 1) * width + x) * 4;

  const gx =
    -data[left]! + data[right]! - data[left + 1]! + data[right + 1]! - data[left + 2]! + data[right + 2]!;
  const gy =
    -data[up]! + data[down]! - data[up + 1]! + data[down + 1]! - data[up + 2]! + data[down + 2]!;

  return Math.min(255, Math.round(Math.sqrt(gx * gx + gy * gy) / 3));
}

function sampleBlurred(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;

      const idx = (sy * width + sx) * 4;
      r += data[idx]!;
      g += data[idx + 1]!;
      b += data[idx + 2]!;
      count++;
    }
  }

  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}
