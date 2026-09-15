/**
 * Bounded multi-window planning for fixed-input face detection.
 *
 * The bundled YuNet graph has a fixed 640x640 input, so a whole-image letterbox
 * downscales everything to the longer side's 640 px. Measured on rights-cleared
 * fixtures against the upstream OpenCV predictor (2026-09-15): that downscale
 * loses real faces — a 1920 px group scene dropped from 4/4 to 3/4 detections,
 * and a facade with three 11-15 px faces dropped from 3/3 to 0/3, while the
 * same content detected at native scale kept all of them. The fix is a
 * two-tier pyramid:
 *
 *   tier A — whole image letterboxed to 640. Produces the correct boxes for
 *            large faces (a tiled native pass fragments a 580 px face into a
 *            340 px partial box, measured), so tier A wins every overlap.
 *   tier B — bounded windows at (near-)native scale. Recovers small faces and
 *            faces the tier-A downscale pushed below the model's ~10 px
 *            detectability band. Windows are skipped when the tier-A scale is
 *            already native enough, so small images and thumbnails never pay
 *            for a tile pass.
 *
 * Both tiers stay bounded: the window grid is capped by `maxWindows`, and when
 * a full-size grid would exceed the cap the whole plan is downscaled until the
 * grid fits. Tier B therefore never runs below tier A's scale — it is always a
 * strict resolution gain or it is skipped.
 */
import { clipFaceDetectionToFrame, type YuNetFaceDetection } from '../inference/models/faceDetect';

export const FACE_WINDOW_TILE = 640;
export const FACE_WINDOW_OVERLAP = 0.25;
export const FACE_WINDOW_BUDGET = 24;
/** Tier A already runs at >= this fraction of native pixels: tiling adds nothing. */
export const FACE_WINDOW_NATIVE_ENOUGH = 0.75;

export interface FaceWindowPlanOptions {
  /** Window edge in model pixels. Defaults to the YuNet input size (640). */
  tileSize?: number;
  /** Fractional overlap between adjacent windows. Defaults to 0.25. */
  overlap?: number;
  /** Hard cap on the number of windows in the plan. Defaults to 24. */
  maxWindows?: number;
  /**
   * Skip tier B when the whole-image letterbox already runs at or above this
   * fraction of native pixels. Defaults to 0.75.
   */
  nativeEnoughScale?: number;
}

export interface FaceWindow {
  /** Left edge in pipeline space (see `FaceWindowPlan.scale`). */
  x: number;
  /** Top edge in pipeline space. */
  y: number;
  width: number;
  height: number;
}

export interface FaceWindowPlan {
  /**
   * Source pixels -> pipeline pixels. 1 means windows are cropped at native
   * resolution; < 1 means the source was downscaled once so the grid fits the
   * window budget (still strictly better than the tier-A letterbox scale).
   */
  scale: number;
  /** Source pixels -> tier-A model pixels (640 / max(width, height)). */
  globalScale: number;
  windows: readonly FaceWindow[];
  /** Non-null when tier B was deliberately skipped, with the reason. */
  skipReason: 'native-scale-already' | 'single-window' | null;
}

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * Crop one window out of an RGBA source without any canvas or resampling.
 * Window regions outside the source are zero-filled, which is the transparent
 * black the model's reference preprocessor pads with. Only valid when the
 * window plan runs at scale 1 (native pixels); the caller resamples first
 * otherwise.
 */
export function cropWindowRgba(source: RgbaImage, window: FaceWindow): RgbaImage {
  const width = Math.max(0, Math.floor(window.width));
  const height = Math.max(0, Math.floor(window.height));
  const data = new Uint8ClampedArray(width * height * 4);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row += 1) {
    const sourceY = window.y + row;
    if (sourceY < 0 || sourceY >= source.height) continue;
    const startX = Math.max(0, Math.min(source.width, window.x));
    const endX = Math.max(0, Math.min(source.width, window.x + width));
    if (endX <= startX) continue;
    const sourceStart = (sourceY * source.width + startX) * 4;
    const destinationStart = row * rowBytes + (startX - window.x) * 4;
    data.set(
      source.data.subarray(sourceStart, sourceStart + (endX - startX) * 4),
      destinationStart,
    );
  }
  return { data, width, height };
}

export interface FaceMergeOptions {
  /** IoU at or above which a candidate is suppressed. Defaults to 0.3. */
  nmsThreshold?: number;
  /**
   * Fraction of a candidate's own area that must lie inside an already-kept
   * box for it to be suppressed as a fragment. Defaults to 0.6.
   */
  containmentRatio?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Plan native-scale windows for a source image. Pure; callers own the actual
 * downscale/crop and must crop exactly `tileSize` squares (padding past the
 * edge with the model's padding colour), so every window reaches the model at
 * an identity letterbox.
 */
export function planFaceWindows(
  sourceWidth: number,
  sourceHeight: number,
  options: FaceWindowPlanOptions = {},
): FaceWindowPlan {
  const tileSize = Math.max(32, Math.floor(options.tileSize ?? FACE_WINDOW_TILE));
  const overlap = clamp(
    Number.isFinite(options.overlap) ? options.overlap! : FACE_WINDOW_OVERLAP,
    0,
    0.9,
  );
  const maxWindows = Math.max(1, Math.floor(options.maxWindows ?? FACE_WINDOW_BUDGET));
  const nativeEnoughScale = clamp(
    Number.isFinite(options.nativeEnoughScale)
      ? options.nativeEnoughScale!
      : FACE_WINDOW_NATIVE_ENOUGH,
    0,
    1,
  );

  const widthsOk = Number.isFinite(sourceWidth) && sourceWidth > 0;
  const heightsOk = Number.isFinite(sourceHeight) && sourceHeight > 0;
  const globalScale = widthsOk && heightsOk ? tileSize / Math.max(sourceWidth, sourceHeight) : 0;

  const empty = (skipReason: FaceWindowPlan['skipReason']): FaceWindowPlan => ({
    scale: 1,
    globalScale,
    windows: [],
    skipReason,
  });

  if (!widthsOk || !heightsOk) return empty('single-window');
  if (globalScale >= nativeEnoughScale) return empty('native-scale-already');

  const stride = Math.max(1, Math.round(tileSize * (1 - overlap)));

  // Downscale the whole source (once, in the caller) until the window grid
  // fits the budget. Never below the tier-A scale.
  let scale = 1;
  for (let guard = 0; guard < 64; guard += 1) {
    const scaledWidth = Math.max(1, Math.round(sourceWidth * scale));
    const scaledHeight = Math.max(1, Math.round(sourceHeight * scale));
    const columns = Math.max(1, Math.ceil(scaledWidth / stride));
    const rows = Math.max(1, Math.ceil(scaledHeight / stride));
    if (columns * rows <= maxWindows || scale <= globalScale) break;
    scale *= 0.85;
  }
  scale = Math.max(scale, globalScale > 0 ? globalScale : scale);

  const scaledWidth = Math.max(1, Math.round(sourceWidth * scale));
  const scaledHeight = Math.max(1, Math.round(sourceHeight * scale));

  const positions = (extent: number): number[] => {
    if (extent <= tileSize) return [0];
    const last = Math.max(0, extent - tileSize);
    const steps: number[] = [];
    for (let position = 0; position <= last; position += stride) steps.push(position);
    if (steps[steps.length - 1]! < last) steps.push(last);
    return steps;
  };

  const xs = positions(scaledWidth);
  const ys = positions(scaledHeight);
  if (xs.length * ys.length <= 1) return empty('single-window');

  const windows: FaceWindow[] = [];
  for (const y of ys) {
    for (const x of xs) {
      windows.push({ x, y, width: tileSize, height: tileSize });
    }
  }
  return { scale, globalScale, windows, skipReason: null };
}

/**
 * Remap a window-local detection into source space. Window crops are exactly
 * the model input size, so the worker's letterbox inside a window is identity;
 * `window.x`/`window.y` are in pipeline space (see `FaceWindowPlan.scale`).
 * Returns null when the mapped box falls entirely outside the source frame.
 */
export function mapWindowDetectionToSource(
  detection: YuNetFaceDetection,
  window: { x: number; y: number },
  scale: number,
  sourceWidth: number,
  sourceHeight: number,
): YuNetFaceDetection | null {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return clipFaceDetectionToFrame(
    {
      box: {
        x: (detection.box.x + window.x) / safeScale,
        y: (detection.box.y + window.y) / safeScale,
        width: detection.box.width / safeScale,
        height: detection.box.height / safeScale,
      },
      landmarks: detection.landmarks.map((landmark) => ({
        x: (landmark.x + window.x) / safeScale,
        y: (landmark.y + window.y) / safeScale,
      })),
      landmarksInFrame: [],
      score: detection.score,
    },
    sourceWidth,
    sourceHeight,
  );
}

function intersectionOverUnion(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

function containmentRatio(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(inner.x, outer.x);
  const y1 = Math.max(inner.y, outer.y);
  const x2 = Math.min(inner.x + inner.width, outer.x + outer.width);
  const y2 = Math.min(inner.y + inner.height, outer.y + outer.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area = inner.width * inner.height;
  return area <= 0 ? 0 : inter / area;
}

function byScoreDescending(a: YuNetFaceDetection, b: YuNetFaceDetection): number {
  return b.score - a.score;
}

/**
 * Combine the whole-image pass (primary) with the window pass (secondary).
 *
 * Primary boxes are authoritative where both tiers see the same face: the
 * native-scale pass correctly fragments faces larger than a window, and a
 * fragment must never displace an intact box. Secondary candidates are added
 * only when they are neither IoU-overlapping nor substantially contained in an
 * already-kept box, so the two nearby faces of a portrait are never merged and
 * a duplicate of a large face is never stacked.
 */
export function mergeFaceDetections(
  primary: readonly YuNetFaceDetection[],
  secondary: readonly YuNetFaceDetection[],
  options: FaceMergeOptions = {},
): YuNetFaceDetection[] {
  const nmsThreshold = Number.isFinite(options.nmsThreshold) ? options.nmsThreshold! : 0.3;
  const containment = Number.isFinite(options.containmentRatio) ? options.containmentRatio! : 0.6;

  const kept: YuNetFaceDetection[] = [];
  for (const candidate of [...primary].sort(byScoreDescending)) {
    if (
      kept.some((existing) => intersectionOverUnion(existing.box, candidate.box) >= nmsThreshold)
    ) {
      continue;
    }
    kept.push(candidate);
  }
  for (const candidate of [...secondary].sort(byScoreDescending)) {
    if (
      kept.some(
        (existing) =>
          intersectionOverUnion(existing.box, candidate.box) >= nmsThreshold ||
          containmentRatio(candidate.box, existing.box) >= containment,
      )
    ) {
      continue;
    }
    kept.push(candidate);
  }
  return kept;
}
