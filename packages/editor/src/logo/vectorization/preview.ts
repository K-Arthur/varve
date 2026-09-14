/**
 * Preview pipeline for vectorization: load → bound → prepare → trace → draw.
 *
 * Preview work happens at MAX_PREVIEW_DIM (1024px long edge) so interactive
 * slider changes stay cheap; the final Apply re-runs the same settings at
 * up to MAX_FINAL_DIM for quality. The source asset is never modified.
 *
 * Drawing rules enforced here (see `docs/agents/trace-research-2026-09-13.md`):
 * - The prepared raster is drawn through a bitmap canvas with `drawImage`;
 *   pixel-manipulation methods like `putImageData` ignore the transform and
 *   `globalAlpha` per the canvas spec and previously broke scaling/opacity.
 * - Artwork colors are independent of the UI theme. Theme colors are used
 *   only for the surrounding chrome; the preview shows the committed paint.
 * - Paths are traced with cubic handles exactly like scene replay, so the
 *   preview shows the geometry insertion will commit.
 */

import { dispatchTrace, type RasterTraceOptions } from '@varve/engine';
import { MAX_PREVIEW_DIM, prepareImageData } from './prepareSource';
import {
  buildDisplayPaths,
  type DisplayPath,
  displayPathPaint,
  traceDisplayPath,
} from './previewPaths';
import type { VectorizationSettings } from './settings';
import { toTraceOptions } from './settings';

/** Final trace resolution cap (matches the editor's existing trace cap). */
export const MAX_FINAL_DIM = 4096;

export interface PreviewPayload {
  /** Bounded source pixels before preparation (original appearance). */
  sourceImageData: ImageData;
  /** Prepared pixels actually handed to the trace provider. */
  imageData: ImageData;
  /** Raw provider result; insertion consumes this at final resolution. */
  result: import('@varve/engine').RasterTraceResult;
  /** Preview geometry, fitted exactly like insertion. */
  displayPaths: DisplayPath[];
  /** Dimensions of the prepared source used for the trace. */
  width: number;
  height: number;
  /** Original source dimensions before the preview/final bounding. */
  sourceWidth: number;
  sourceHeight: number;
  /** Provider that produced the result (reported by dispatch). */
  providerId?: string;
  omittedHoles: number;
}

export interface TraceRasterDimensions {
  width: number;
  height: number;
}

export type PreviewView = 'source' | 'prepared' | 'overlay' | 'vector';

export interface PreviewDrawOptions {
  view: PreviewView;
  /** Draw anchors and cubic handles as a diagnostic overlay. */
  showAnchors: boolean;
  /** 'fit' scales to the container width; `1` renders at source-pixel scale. */
  zoom: 'fit' | 1;
}

export const DEFAULT_PREVIEW_DRAW_OPTIONS: PreviewDrawOptions = {
  view: 'overlay',
  showAnchors: false,
  zoom: 'fit',
};

function boundedScale(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 1;
  return Math.max(1 / 16_384, numerator / denominator);
}

/**
 * Convert source-pixel settings into the pixel space actually handed to a
 * provider. Preview and memory-capped final traces operate on a downsampled
 * raster, but users configure cleanup and fitting in original-source pixels.
 * Scaling these values at the boundary preserves their meaning without
 * persisting a viewport or preview-specific setting.
 */
export function scaleSourcePixelTraceOptions(
  options: RasterTraceOptions,
  source: TraceRasterDimensions,
  raster: TraceRasterDimensions,
): RasterTraceOptions {
  const scaleX = boundedScale(raster.width, source.width);
  const scaleY = boundedScale(raster.height, source.height);
  // Use the smaller axis for distance tolerances so independently rounded
  // dimensions can never permit more source-space deviation than requested.
  const distanceScale = Math.min(scaleX, scaleY);
  const areaScale = scaleX * scaleY;
  return {
    ...options,
    ...(options.simplifyTolerance !== undefined
      ? { simplifyTolerance: options.simplifyTolerance * distanceScale }
      : {}),
    ...(options.maxError !== undefined ? { maxError: options.maxError * distanceScale } : {}),
    ...(options.centerlineWidth !== undefined
      ? { centerlineWidth: options.centerlineWidth * distanceScale }
      : {}),
    ...(options.centerlinePrune !== undefined
      ? { centerlinePrune: options.centerlinePrune * distanceScale }
      : {}),
    ...(options.minArea !== undefined
      ? { minArea: Math.max(1, Math.round(options.minArea * areaScale)) }
      : {}),
  };
}

/** Load the source image by its stored src (data URL or asset path). */
export async function loadSourceImage(
  src: string,
  signal: AbortSignal,
): Promise<import('@varve/engine').CachedImage> {
  const { getImageCache } = await import('@varve/engine');
  if (signal.aborted) throw new Error('cancelled');
  const image = await getImageCache().load(src);
  if (signal.aborted) throw new Error('cancelled');
  return image;
}

function imageDataFromSource(
  image: import('@varve/engine').CachedImage,
  maxDim: number,
  signal: AbortSignal,
  pixelArt: boolean,
): ImageData {
  const sourceWidth = Math.max(1, 'naturalWidth' in image ? image.naturalWidth : image.width);
  const sourceHeight = Math.max(1, 'naturalHeight' in image ? image.naturalHeight : image.height);
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas pixel processing is unavailable');
  if (pixelArt) {
    // Pixel-art mode must never smooth: hard pixel boundaries are the
    // feature. Nearest-neighbor scaling keeps the source grid intact.
    ctx.imageSmoothingEnabled = false;
  }
  ctx.drawImage(image, 0, 0, width, height);
  if (signal.aborted) throw new Error('cancelled');
  return ctx.getImageData(0, 0, width, height);
}

/** Run the full preview: load → bound → prepare → trace. Cancellable. */
export async function runPreviewTrace(
  src: string,
  settings: VectorizationSettings,
  signal: AbortSignal,
  maxDim: number = MAX_PREVIEW_DIM,
  onProgress?: (stage: string, progress: number) => void,
): Promise<PreviewPayload> {
  const image = await loadSourceImage(src, signal);
  const sourceWidth = Math.max(1, 'naturalWidth' in image ? image.naturalWidth : image.width);
  const sourceHeight = Math.max(1, 'naturalHeight' in image ? image.naturalHeight : image.height);
  const raw = imageDataFromSource(image, maxDim, signal, settings.mode === 'pixel-art');
  const prepared = prepareImageData(raw, settings.prep, {
    threshold: settings.threshold,
    alphaThreshold: settings.alphaThreshold,
  });
  const traceOptions = scaleSourcePixelTraceOptions(
    toTraceOptions(settings),
    { width: sourceWidth, height: sourceHeight },
    { width: prepared.width, height: prepared.height },
  );
  const result = await dispatchTrace(prepared, { ...traceOptions, onProgress }, signal);
  if (signal.aborted) throw new Error('cancelled');
  const displayPaths = buildDisplayPaths(result, {
    cornerAngle: traceOptions.cornerAngle ?? settings.cornerAngle,
    maxError: traceOptions.maxError ?? settings.maxError,
  });
  return {
    sourceImageData: raw,
    imageData: prepared,
    result,
    displayPaths,
    width: prepared.width,
    height: prepared.height,
    sourceWidth,
    sourceHeight,
    ...(result.providerId ? { providerId: result.providerId } : {}),
    omittedHoles: result.omittedHoles,
  };
}

interface SourceCanvasEntry {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

const sourceCanvasCache = new WeakMap<ImageData, SourceCanvasEntry>();

function sourceCanvasFor(imageData: ImageData): SourceCanvasEntry {
  const cached = sourceCanvasCache.get(imageData);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.putImageData(imageData, 0, 0);
  const entry = { canvas, ctx };
  sourceCanvasCache.set(imageData, entry);
  return entry;
}

function drawAnchors(
  ctx: CanvasRenderingContext2D,
  paths: readonly DisplayPath[],
  pixelScale: number,
): void {
  const anchorRadius = Math.max(1.5, 3 / pixelScale);
  const handleWidth = Math.max(0.5, 1 / pixelScale);
  ctx.save();
  ctx.strokeStyle = 'rgba(219, 39, 119, 0.9)';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = handleWidth;
  for (const path of paths) {
    for (const ring of [path.points, ...(path.holes ?? [])]) {
      for (const point of ring) {
        if (point.handleIn) {
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(point.x + point.handleIn[0], point.y + point.handleIn[1]);
          ctx.stroke();
        }
        if (point.handleOut) {
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(point.x + point.handleOut[0], point.y + point.handleOut[1]);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.rect(
          point.x - anchorRadius,
          point.y - anchorRadius,
          anchorRadius * 2,
          anchorRadius * 2,
        );
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/**
 * Draw the prepared/source raster and traced geometry into the preview canvas.
 *
 * The canvas is intentionally left transparent outside painted regions so the
 * host's checkerboard shows through; that keeps artwork colors independent of
 * the UI theme.
 */
export function drawPreview(
  canvas: HTMLCanvasElement,
  payload: PreviewPayload,
  options: PreviewDrawOptions = DEFAULT_PREVIEW_DRAW_OPTIONS,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  const fitWidth = Math.max(1, (canvas.clientWidth || payload.width) - 8);
  const scale = options.zoom === 1 ? 1 : Math.max(0.01, fitWidth / payload.width);
  const pixelWidth = Math.max(1, Math.round(payload.width * scale));
  const pixelHeight = Math.max(1, Math.round(payload.height * scale));
  canvas.width = Math.max(1, Math.round(pixelWidth * dpr));
  canvas.height = Math.max(1, Math.round(pixelHeight * dpr));
  canvas.style.width = options.zoom === 1 ? `${payload.width}px` : '100%';
  canvas.style.height = 'auto';
  canvas.style.imageRendering = options.zoom === 1 ? 'pixelated' : 'auto';

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.imageSmoothingEnabled = scale < 1;

  const raster = options.view === 'source' ? payload.sourceImageData : payload.imageData;
  if (options.view !== 'vector') {
    const { canvas: rasterCanvas } = sourceCanvasFor(raster);
    ctx.save();
    ctx.globalAlpha = options.view === 'overlay' ? 0.4 : 1;
    ctx.drawImage(rasterCanvas, 0, 0);
    ctx.restore();
  }

  if (options.view !== 'source' && options.view !== 'prepared') {
    for (const path of payload.displayPaths) {
      const paint = displayPathPaint(path);
      ctx.beginPath();
      traceDisplayPath(ctx, path);
      if (paint.kind === 'stroke') {
        ctx.strokeStyle = paint.style;
        const width = path.strokeWidth ?? 2;
        ctx.lineWidth = path.closed ? width : Math.max(width, 1 / scale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      } else {
        ctx.fillStyle = paint.style;
        ctx.fill('evenodd');
      }
    }
    if (options.showAnchors) drawAnchors(ctx, payload.displayPaths, scale);
  }
}
