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
import { createRasterSurface, fitRasterDimensions, type RasterSurface } from './rasterSurface';
import { applyRasterizationTransform } from './rasterTransform';
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
  /** Width of the encoded raster surface in pixels. */
  pixelWidth: number;
  /** Height of the encoded raster surface in pixels. */
  pixelHeight: number;
  /** Requested encoded-surface width before the shared memory guard. */
  requestedPixelWidth: number;
  /** Requested encoded-surface height before the shared memory guard. */
  requestedPixelHeight: number;
  /**
   * Non-empty only when the export was reduced by the raster surface safety
   * policy. Callers must surface this instead of labelling the asset with the
   * originally requested density.
   */
  constrainedBy: Array<'dimension' | 'area'>;
  /** CSS dimensions of the rasterized region. */
  cssWidth: number;
  cssHeight: number;
}

interface ResolvedSubtreeRasterDimensions {
  expandedCssWidth: number;
  expandedCssHeight: number;
  expandedLeft: number;
  expandedTop: number;
  requestedPixelWidth: number;
  requestedPixelHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  constrainedBy: Array<'dimension' | 'area'>;
}

/**
 * Resolve the filter-expanded source bounds and output surface together.
 * Allocation always uses the shared policy, preserving aspect ratio under a
 * guard instead of retrying at unrelated fixed dimensions.
 */
function resolveSubtreeRasterDimensions(
  cssWidth: number,
  cssHeight: number,
  filters: FilterIR[],
  scale: number,
): ResolvedSubtreeRasterDimensions {
  const [expandedLeft, expandedTop, expandedRight, expandedBottom] = totalEffectExpansion(filters);
  const expandedCssWidth = cssWidth + expandedLeft + expandedRight;
  const expandedCssHeight = cssHeight + expandedTop + expandedBottom;
  const requestedPixelWidth = Math.max(1, Math.round(expandedCssWidth * scale));
  const requestedPixelHeight = Math.max(1, Math.round(expandedCssHeight * scale));
  const fitted = fitRasterDimensions(requestedPixelWidth, requestedPixelHeight);

  return {
    expandedCssWidth,
    expandedCssHeight,
    expandedLeft,
    expandedTop,
    requestedPixelWidth,
    requestedPixelHeight,
    pixelWidth: fitted.width,
    pixelHeight: fitted.height,
    constrainedBy: fitted.constrainedBy,
  };
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
  const dimensions = resolveSubtreeRasterDimensions(cssWidth, cssHeight, filters, scale);
  const surface = createRasterSurface(dimensions.pixelWidth, dimensions.pixelHeight);

  const { context, canvas } = surface;
  const outputWidth = canvas.width;
  const outputHeight = canvas.height;

  // Paint background if specified
  const bg = opts.backgroundColor;
  if (bg && bg[3]! > 0) {
    context.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3]! / 255})`;
    context.fillRect(0, 0, outputWidth, outputHeight);
  }

  // Render base content (shifted by expansion offset)
  context.save();
  applyRasterizationTransform(
    context,
    {
      x: -dimensions.expandedLeft,
      y: -dimensions.expandedTop,
      width: dimensions.expandedCssWidth,
      height: dimensions.expandedCssHeight,
    },
    { width: outputWidth, height: outputHeight },
  );
  renderTarget(context as CanvasRenderingContext2D);
  context.restore();

  // Apply filter stack at full export quality — never interactive preview
  // quality (see docs/architecture/live-effects-system.md).
  if (filters.length > 0) {
    applyFilterWithCompositing(
      context as CanvasRenderingContext2D,
      filters,
      outputWidth,
      outputHeight,
      {
        quality: 'export',
      },
    );
  }

  // Encode to PNG data URL
  const dataUrl = await surfaceToDataUrl(canvas);

  return {
    dataUrl,
    pixelWidth: outputWidth,
    pixelHeight: outputHeight,
    requestedPixelWidth: dimensions.requestedPixelWidth,
    requestedPixelHeight: dimensions.requestedPixelHeight,
    constrainedBy: dimensions.constrainedBy,
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
  const dimensions = resolveSubtreeRasterDimensions(cssWidth, cssHeight, filters, scale);
  const surface = createRasterSurface(dimensions.pixelWidth, dimensions.pixelHeight);

  const { context, canvas } = surface;
  const outputWidth = canvas.width;
  const outputHeight = canvas.height;

  const bg = opts.backgroundColor;
  if (bg && bg[3]! > 0) {
    context.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3]! / 255})`;
    context.fillRect(0, 0, outputWidth, outputHeight);
  }

  context.save();
  applyRasterizationTransform(
    context,
    {
      x: -dimensions.expandedLeft,
      y: -dimensions.expandedTop,
      width: dimensions.expandedCssWidth,
      height: dimensions.expandedCssHeight,
    },
    { width: outputWidth, height: outputHeight },
  );
  renderTarget(context as CanvasRenderingContext2D);
  context.restore();

  if (filters.length > 0) {
    applyFilterWithCompositing(
      context as CanvasRenderingContext2D,
      filters,
      outputWidth,
      outputHeight,
      {
        quality: 'export',
      },
    );
  }

  const dataUrl = surfaceToDataUrlSync(canvas);

  return {
    dataUrl,
    pixelWidth: outputWidth,
    pixelHeight: outputHeight,
    requestedPixelWidth: dimensions.requestedPixelWidth,
    requestedPixelHeight: dimensions.requestedPixelHeight,
    constrainedBy: dimensions.constrainedBy,
    cssWidth,
    cssHeight,
  };
}
