/**
 * Preview pipeline for vectorization: load → bound → prepare → trace → draw.
 *
 * Preview work happens at MAX_PREVIEW_DIM (1024px long edge) so interactive
 * slider changes stay cheap; the final Apply re-runs the same settings at
 * up to MAX_FINAL_DIM for quality. The source asset is never modified.
 */

import { dispatchTrace, type RasterTraceOptions, type RasterTraceResult } from '@varve/engine';
import { MAX_PREVIEW_DIM, prepareImageData } from './prepareSource';
import type { VectorizationSettings } from './settings';
import { toTraceOptions } from './settings';

/** Final trace resolution cap (matches the editor's existing trace cap). */
export const MAX_FINAL_DIM = 4096;

export interface PreviewPayload {
  imageData: ImageData;
  result: RasterTraceResult;
  /** Dimensions of the prepared source used for the trace. */
  width: number;
  height: number;
}

export interface TraceRasterDimensions {
  width: number;
  height: number;
}

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
  const prepared = prepareImageData(raw, settings.prep);
  const traceOptions = scaleSourcePixelTraceOptions(
    toTraceOptions(settings),
    { width: sourceWidth, height: sourceHeight },
    { width: prepared.width, height: prepared.height },
  );
  const result = await dispatchTrace(prepared, { ...traceOptions, onProgress }, signal);
  if (signal.aborted) throw new Error('cancelled');
  return {
    imageData: prepared,
    result,
    width: prepared.width,
    height: prepared.height,
  };
}

/** Draw prepared source + traced fill paths into a canvas (fit to width). */
export function drawPreview(
  canvas: HTMLCanvasElement,
  payload: PreviewPayload,
  backgroundColor: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const targetWidth = Math.max(1, canvas.clientWidth - 8);
  const scale = targetWidth / payload.width;
  canvas.width = Math.max(1, Math.round(payload.width * scale));
  canvas.height = Math.max(1, Math.round(payload.height * scale));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Open centerline strokes follow the theme text color so they stay visible
  // on both light and dark surfaces (rgba(0,0,0,0.9) vanished on dark).
  const themeStroke =
    getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary') ||
    '#1a1a1a';
  ctx.save();
  ctx.scale(scale, scale);
  // Prepared source at 40% so the traced fills remain readable on top.
  ctx.globalAlpha = 0.4;
  ctx.putImageData(payload.imageData, 0, 0);
  ctx.restore();

  for (const path of payload.result.paths) {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.beginPath();
    if (path.points.length > 0) {
      const first = path.points[0] as { x: number; y: number };
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < path.points.length; i += 1) {
        const p = path.points[i] as { x: number; y: number };
        ctx.lineTo(p.x, p.y);
      }
      for (const hole of path.holes ?? []) {
        if (hole.length === 0) continue;
        const h0 = hole[0] as { x: number; y: number };
        ctx.moveTo(h0.x, h0.y);
        for (let i = 1; i < hole.length; i += 1) {
          const p = hole[i] as { x: number; y: number };
          ctx.lineTo(p.x, p.y);
        }
      }
      if (path.closed) {
        ctx.closePath();
        const fill = path.fill ?? { r: 0, g: 0, b: 0, a: 255 };
        if (fill.a === 0) {
          // Centerline paths are open strokes; keep them visible as strokes.
          ctx.strokeStyle = themeStroke;
          ctx.lineWidth = path.strokeWidth ?? 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(${fill.r}, ${fill.g}, ${fill.b}, ${fill.a / 255})`;
          ctx.fill('evenodd');
        }
      } else {
        // Open centerline branch: stroke, never fill.
        ctx.strokeStyle = themeStroke;
        ctx.lineWidth = path.strokeWidth ?? 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
