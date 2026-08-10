/**
 * Preview pipeline for vectorization: load → bound → prepare → trace → draw.
 *
 * Preview work happens at MAX_PREVIEW_DIM (1024px long edge) so interactive
 * slider changes stay cheap; the final Apply re-runs the same settings at
 * up to MAX_FINAL_DIM for quality. The source asset is never modified.
 */

import { dispatchTrace, type RasterTraceResult } from '@varve/engine';
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

/** Load the source image by its stored src (data URL or asset path). */
export async function loadSourceImage(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  const { getImageCache } = await import('@varve/engine');
  if (signal.aborted) throw new Error('cancelled');
  const image = await getImageCache().load(src);
  if (signal.aborted) throw new Error('cancelled');
  return image;
}

function imageDataFromSource(
  image: HTMLImageElement,
  maxDim: number,
  signal: AbortSignal,
  pixelArt: boolean,
): ImageData {
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
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
): Promise<PreviewPayload> {
  const image = await loadSourceImage(src, signal);
  const raw = imageDataFromSource(image, maxDim, signal, settings.mode === 'pixel-art');
  const prepared = prepareImageData(raw, settings.prep);
  const result = await dispatchTrace(prepared, toTraceOptions(settings), signal);
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
