/**
 * Subtree rasterization for SVG/PDF export.
 *
 * When an adjustment node uses filters that cannot be represented natively
 * (colorHalftone, gradientMap, tritone, halftone, curves, levels, etc.),
 * the export pipeline rasterizes the affected subtree and embeds the image
 * while keeping unaffected nodes as vectors.
 *
 * Architecture:
 *   1. Identify the target subtree (adjustment scope targets).
 *   2. Compute the bounding box in world coords, expanded for filter
 *      neighbourhood sampling (blur, halftone cell radius).
 *   3. Render only those nodes to an offscreen canvas at export resolution.
 *   4. Apply the filter stack via applyFilterWithCompositing.
 *   5. Encode as PNG (or JPEG for print) data URL for SVG embedding, or
 *      raw RGBA for PDF.
 */

import { totalEffectExpansion } from './adjustmentPipeline';
import { applyFilterWithCompositing } from './filterCompositor';
import { createRasterSurface, type RasterSurface } from './rasterSurface';
import type { FilterIR } from './types';

/**
 * Encode a RasterCanvas to a PNG data URL (async path).
 */
async function surfaceToDataUrl(canvas: RasterSurface['canvas']): Promise<string> {
  if (typeof (canvas as HTMLCanvasElement).toDataURL === 'function') {
    return (canvas as HTMLCanvasElement).toDataURL('image/png');
  }
  const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to encode PNG from OffscreenCanvas'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Encode a RasterCanvas to a PNG data URL (synchronous path, HTMLCanvasElement only).
 */
function surfaceToDataUrlSync(canvas: RasterSurface['canvas']): string {
  if (typeof (canvas as HTMLCanvasElement).toDataURL === 'function') {
    return (canvas as HTMLCanvasElement).toDataURL('image/png');
  }
  throw new Error('Synchronous PNG encoding requires an HTMLCanvasElement');
}

export interface ExportRasterOptions {
  /** Export scale factor (e.g., 2 for @2x). */
  scale: number;
  /** Target width in CSS pixels (before scale). */
  cssWidth: number;
  /** Target height in CSS pixels (before scale). */
  cssHeight: number;
  /** Document DPI for print exports. */
  dpi?: number;
  /** Background color as [r,g,b,a]. Default transparent. */
  backgroundColor?: readonly [number, number, number, number];
}

export interface SubtreeRasterization {
  /** Base64-encoded PNG data URL (for SVG embedding). */
  dataUrl: string;
  /** Width in pixels at export resolution. */
  pixelWidth: number;
  /** Height in pixels at export resolution. */
  pixelHeight: number;
  /** CSS dimensions of the rasterized region. */
  cssWidth: number;
  cssHeight: number;
}

/**
 * Rasterize a subtree (defined by its bounding box) with a filter stack
 * applied, and return the result as a PNG data URL for SVG/PDF embedding.
 *
 * The caller provides the rendering function because CanvasArea owns the
 * actual replay logic; this helper handles only the offscreen canvas setup,
 * filter application, and encoding.
 *
 * @param cssWidth  - Subtree width in CSS pixels
 * @param cssHeight - Subtree height in CSS pixels
 * @param filters   - FilterIR stack to apply
 * @param renderTarget - Function that renders the base subtree content
 *                       onto the given canvas context
 * @param opts      - Export options (scale, DPI, background)
 */
export async function exportRasterizedSubtree(
  cssWidth: number,
  cssHeight: number,
  filters: FilterIR[],
  renderTarget: (ctx: CanvasRenderingContext2D) => void,
  opts: ExportRasterOptions,
): Promise<SubtreeRasterization> {
  const scale = Math.max(0.01, opts.scale);
  const pixelWidth = Math.max(1, Math.round(cssWidth * scale));
  const pixelHeight = Math.max(1, Math.round(cssHeight * scale));

  // Expand bounds for filter neighbourhood sampling
  const [expL, expT, expR, expB] = totalEffectExpansion(filters);
  const expandedCssW = cssWidth + expL + expR;
  const expandedCssH = cssHeight + expT + expB;
  const expPixelW = Math.max(1, Math.round(expandedCssW * scale));
  const expPixelH = Math.max(1, Math.round(expandedCssH * scale));

  // Create offscreen surface with expanded bounds
  let surface: RasterSurface;
  try {
    surface = createRasterSurface(expPixelW, expPixelH);
  } catch {
    // Fallback: createRasterSurface may throw for very large exports
    const fallbackW = Math.min(expPixelW, 4096);
    const fallbackH = Math.min(expPixelH, 4096);
    surface = createRasterSurface(fallbackW, fallbackH);
  }

  const { context, canvas } = surface;

  // Paint background if specified
  const bg = opts.backgroundColor;
  if (bg && bg[3]! > 0) {
    context.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3]! / 255})`;
    context.fillRect(0, 0, expPixelW, expPixelH);
  }

  // Render base content (shifted by expansion offset)
  context.save();
  context.translate(expL * scale, expT * scale);
  context.scale(scale, scale);
  renderTarget(context as CanvasRenderingContext2D);
  context.restore();

  // Apply filter stack at full export quality — never interactive preview
  // quality (see docs/architecture/live-effects-system.md).
  if (filters.length > 0) {
    applyFilterWithCompositing(context as CanvasRenderingContext2D, filters, expPixelW, expPixelH, {
      quality: 'export',
    });
  }

  // Encode to PNG data URL
  const dataUrl = await surfaceToDataUrl(canvas);

  return {
    dataUrl,
    pixelWidth,
    pixelHeight,
    cssWidth,
    cssHeight,
  };
}

/**
 * Synchronous version for cases where Web APIs are unavailable or
 * async is not feasible. Returns a data URL directly.
 */
export function exportRasterizedSubtreeSync(
  cssWidth: number,
  cssHeight: number,
  filters: FilterIR[],
  renderTarget: (ctx: CanvasRenderingContext2D) => void,
  opts: ExportRasterOptions,
): SubtreeRasterization {
  const scale = Math.max(0.01, opts.scale);
  const pixelWidth = Math.max(1, Math.round(cssWidth * scale));
  const pixelHeight = Math.max(1, Math.round(cssHeight * scale));

  const [expL, expT, expR, expB] = totalEffectExpansion(filters);
  const expandedCssW = cssWidth + expL + expR;
  const expandedCssH = cssHeight + expT + expB;
  const expPixelW = Math.max(1, Math.round(expandedCssW * scale));
  const expPixelH = Math.max(1, Math.round(expandedCssH * scale));

  let surface: RasterSurface;
  try {
    surface = createRasterSurface(expPixelW, expPixelH);
  } catch {
    surface = createRasterSurface(Math.min(expPixelW, 4096), Math.min(expPixelH, 4096));
  }

  const { context, canvas } = surface;

  const bg = opts.backgroundColor;
  if (bg && bg[3]! > 0) {
    context.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3]! / 255})`;
    context.fillRect(0, 0, expPixelW, expPixelH);
  }

  context.save();
  context.translate(expL * scale, expT * scale);
  context.scale(scale, scale);
  renderTarget(context as CanvasRenderingContext2D);
  context.restore();

  if (filters.length > 0) {
    applyFilterWithCompositing(context as CanvasRenderingContext2D, filters, expPixelW, expPixelH, {
      quality: 'export',
    });
  }

  const dataUrl = surfaceToDataUrlSync(canvas);

  return {
    dataUrl,
    pixelWidth,
    pixelHeight,
    cssWidth,
    cssHeight,
  };
}
