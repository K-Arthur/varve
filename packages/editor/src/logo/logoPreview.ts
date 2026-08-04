/**
 * Logo preview — non-destructive legibility and usage previews.
 *
 * The preview renders the selected artboard through the real export raster
 * pipeline once (512px base), then draws the base into per-size canvases at
 * exact target pixel dimensions with a canvas color filter. The source logo
 * is never mutated: everything here is presentation of a rendered snapshot.
 *
 * Sizes follow the logo-industry ladder (favicon 16 → social 128) and the
 * dialog exposes surfaces (light/dark/checkerboard) plus modes
 * (original/monochrome/grayscale/reversed) so users can check legibility,
 * contrast, and monochrome recognizability without touching the artwork.
 */
import type { Document, SceneNode } from '@varve/scene';

export type LogoPreviewMode = 'original' | 'monochrome' | 'grayscale' | 'reversed';
export type LogoSurfaceKind = 'light' | 'dark' | 'checker';

/** Small-size ladder shown in the preview dialog. */
export const LOGO_SMALL_SIZES = [16, 24, 32, 48, 64, 128] as const;

/** Base render size for the preview snapshot (px, longest side). */
export const LOGO_PREVIEW_BASE = 512;

/** CSS color for a preview surface, or null for a checkerboard. */
export function surfaceColor(surface: LogoSurfaceKind): string | null {
  switch (surface) {
    case 'light':
      return '#ffffff';
    case 'dark':
      return '#16181d';
    case 'checker':
      return null;
  }
}

/** Canvas filter string simulating the preview mode. */
export function previewFilter(mode: LogoPreviewMode): string {
  switch (mode) {
    case 'original':
      return 'none';
    case 'grayscale':
      return 'grayscale(1)';
    case 'monochrome':
      return 'grayscale(1) contrast(4)';
    case 'reversed':
      return 'invert(1)';
  }
}

export interface LogoPreviewImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/**
 * Render the artboard's artwork to a bitmap via the export raster pipeline.
 * Returns null when the node is missing or rendering fails. Cancellable via
 * the signal (stale renders are rejected by the caller before use).
 */
export async function renderLogoPreviewImage(
  node: SceneNode,
  doc: Document,
  engine: Parameters<typeof import('../components/SpecPanel/export').exportNodeAsRaster>[2],
  signal?: AbortSignal,
): Promise<LogoPreviewImage | null> {
  if (signal?.aborted) return null;
  const { exportNodeAsRaster } = await import('../components/SpecPanel/export');
  const result = await exportNodeAsRaster(node, doc, engine, {
    format: 'image/png',
    scale: LOGO_PREVIEW_BASE / Math.max(nodeWorldSize(node, doc), 1),
    transparency: true,
  });
  if (signal?.aborted) return null;
  const bitmap = await createImageBitmap(result.blob);
  if (signal?.aborted) {
    bitmap.close();
    return null;
  }
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

function nodeWorldSize(node: SceneNode, _doc: Document): number {
  const w = 'w' in node ? (node.w ?? 0) : 0;
  const h = 'h' in node ? (node.h ?? 0) : 0;
  return Math.max(w, h);
}
