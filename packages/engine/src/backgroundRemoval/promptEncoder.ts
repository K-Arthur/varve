/**
 * SAM-style prompt encoder for refining existing ONNX masks with
 * click-point and bounding-box prompts — pure typed-array ops,
 * safe in both main-thread and Worker contexts.
 *
 * Instead of running actual SAM inference, this module takes an existing
 * raw mask (e.g. from U^2-Net or BiRefNet) and applies heuristic prompt
 * refinement: positive clicks keep the connected FG component at the
 * point, negative clicks remove it, and box prompts constrain the mask
 * to a region.
 */

import { findConnectedComponents } from './maskOps';

export interface ClickPoint {
  /** 0-based pixel coordinate */
  x: number;
  y: number;
  type: 'positive' | 'negative';
}

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SegmentationPrompt =
  | { kind: 'click'; point: ClickPoint }
  | { kind: 'box'; box: BoundingBox };

const FG_THRESHOLD = 128;
const NEIGHBORS_8: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Label FG pixels (≥ FG_THRESHOLD) into 8-connected components.
 * Returns a flat Int32Array where `labels[y * w + x]` is the component
 * ID (0 = background), and the total number of components found.
 */
function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; componentCount: number } {
  const labels = new Int32Array(width * height);
  let nextId = 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if ((mask[i] ?? 0) < FG_THRESHOLD || labels[i] !== 0) continue;

      const stack: number[] = [i];
      labels[i] = nextId;

      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cy = Math.floor(cur / width);
        const cx = cur - cy * width;

        for (const [dx, dy] of NEIGHBORS_8) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if ((mask[ni] ?? 0) < FG_THRESHOLD || labels[ni] !== 0) continue;
          labels[ni] = nextId;
          stack.push(ni);
        }
      }
      nextId++;
    }
  }

  return { labels, componentCount: nextId - 1 };
}

/**
 * Refine a raw mask using an array of click points.
 *
 * - **positive** clicks keep only the FG component connected to the point
 * - **negative** clicks remove the FG component connected to the point
 * - points that land on background pixels are silently ignored
 */
export function encodeClickPrompts(
  mask: Uint8Array,
  width: number,
  height: number,
  points: ClickPoint[],
): Uint8Array<ArrayBuffer> {
  if (width <= 0 || height <= 0 || mask.length === 0 || points.length === 0) {
    return mask.slice();
  }

  const { labels, componentCount } = labelComponents(mask, width, height);

  if (componentCount === 0) {
    return mask.slice();
  }

  // Map clicks to component IDs
  const keepIds = new Set<number>();
  const removeIds = new Set<number>();

  for (const point of points) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const label = labels[y * width + x] ?? 0;
    if (label === 0) continue; // Point lands on background — no-op

    if (point.type === 'positive') {
      keepIds.add(label);
    } else {
      removeIds.add(label);
    }
  }

  const result = new Uint8Array(mask.length);

  if (keepIds.size > 0) {
    // Keep only positively-selected components
    for (let i = 0; i < mask.length; i++) {
      if (keepIds.has(labels[i] ?? 0)) {
        result[i] = mask[i] ?? 0;
      }
    }
  } else {
    // No positive clicks — preserve current FG for negative subtraction
    for (let i = 0; i < mask.length; i++) {
      result[i] = mask[i] ?? 0;
    }
  }

  // Remove negatively-selected components
  if (removeIds.size > 0) {
    for (let i = 0; i < mask.length; i++) {
      if (removeIds.has(labels[i] ?? 0)) {
        result[i] = 0;
      }
    }
  }

  return result;
}

/**
 * Constrain a mask to within a bounding box.
 *
 * 1. Zero out all pixels strictly outside the box.
 * 2. Run connected components on the remaining FG pixels.
 * 3. Keep only the largest component (eliminates noise fragments).
 */
export function encodeBoxPrompt(
  mask: Uint8Array,
  width: number,
  height: number,
  box: BoundingBox,
): Uint8Array<ArrayBuffer> {
  if (width <= 0 || height <= 0 || mask.length === 0) {
    return mask.slice();
  }

  if (box.w <= 0 || box.h <= 0) {
    return mask.slice();
  }

  // Step 1: zero everything outside the box
  const clamped = new Uint8Array(mask);
  const x1 = Math.round(box.x);
  const y1 = Math.round(box.y);
  const x2 = Math.min(width, Math.round(box.x + box.w));
  const y2 = Math.min(height, Math.round(box.y + box.h));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < x1 || x >= x2 || y < y1 || y >= y2) {
        clamped[y * width + x] = 0;
      }
    }
  }

  // Step 2: find components inside the box
  const components = findConnectedComponents(clamped, width, height);
  if (components.length === 0) return clamped;

  // Step 3: keep only the largest component
  const largestId = components[0]?.id;
  if (largestId === undefined) return clamped;

  // Manual filter: zero out pixels not in the largest component
  const { labels } = labelComponents(clamped, width, height);
  const result = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if ((labels[i] ?? 0) === largestId) {
      result[i] = clamped[i] ?? 0;
    }
  }
  return result;
}

/**
 * Orchestrate multiple prompts against a mask.
 *
 * Processing order (matching SAM's behaviour):
 * 1. Box prompt first (constrains the region)
 * 2. Click prompts (positive then negative on the constrained region)
 */
export function applyPrompts(
  mask: Uint8Array,
  width: number,
  height: number,
  prompts: SegmentationPrompt[],
): Uint8Array<ArrayBuffer> {
  if (prompts.length === 0) {
    return mask.slice() as Uint8Array<ArrayBuffer>;
  }

  let current: Uint8Array<ArrayBuffer> = mask.slice() as Uint8Array<ArrayBuffer>;

  // Box prompt first
  const boxPrompt = prompts.find((p) => p.kind === 'box');
  if (boxPrompt && boxPrompt.kind === 'box') {
    current = encodeBoxPrompt(current, width, height, boxPrompt.box);
  }

  // Click prompts
  const clickPoints = prompts
    .filter((p): p is { kind: 'click'; point: ClickPoint } => p.kind === 'click')
    .map((p) => p.point);

  if (clickPoints.length > 0) {
    current = encodeClickPrompts(current, width, height, clickPoints);
  }

  return current;
}
