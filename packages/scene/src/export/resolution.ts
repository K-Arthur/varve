/**
 * Canonical resolution and effective-raster-resolution math.
 *
 * Varve scene geometry is expressed in a fixed 96 px/in reference space. That
 * reference is a design-space convention, not an intrinsic DPI on a frame.
 * Export resolution changes raster output dimensions; it never changes the
 * document geometry or the source pixels of a placed image.
 */

import type { Affine } from '@varve/shared';
import { nodeWorldTransform } from '../coordinateService';
import type { Document } from '../document';
import { getImageFill } from '../fills';
import type { ImageCropRect, ImageFit, ShapeNode } from '../types';
import { shapeHeight, shapeWidth } from '../types';
import type { ExportScale } from './model';

/** Fixed design-space reference used by physical document geometry. */
export const REFERENCE_PPI = 96;

export type PhysicalExportUnit = 'in' | 'mm' | 'cm';

export interface ResolvedExportScale {
  /** Multiplier applied to document-space bounds to produce raster pixels. */
  scaleFactor: number;
  /** Output density when the scale has physical semantics. */
  outputPpi?: number;
}

/** Convert a physical value into document-space pixels without using doc.dpi. */
export function physicalToDocumentPx(value: number, unit: PhysicalExportUnit): number {
  switch (unit) {
    case 'in':
      return value * REFERENCE_PPI;
    case 'mm':
      return (value * REFERENCE_PPI) / 25.4;
    case 'cm':
      return (value * REFERENCE_PPI) / 2.54;
  }
}

export function physicalSizeToOutputPixelDimensions(
  width: number,
  height: number,
  ppi: number,
): { width: number; height: number } {
  if (!Number.isFinite(ppi) || ppi <= 0) {
    throw new Error('Output PPI must be a positive finite number');
  }
  return {
    width: Math.max(1, Math.round(width * ppi)),
    height: Math.max(1, Math.round(height * ppi)),
  };
}

/** Resolve one canonical scale mode. `documentDpi` is deliberately ignored. */
export function resolveExportScale(
  scale: ExportScale,
  nominal: { width: number; height: number },
): ResolvedExportScale {
  const safeWidth = Math.max(1, nominal.width);
  const safeHeight = Math.max(1, nominal.height);

  switch (scale.mode) {
    case 'multiplier': {
      const scaleFactor = Math.max(1 / 16, scale.value);
      return { scaleFactor, outputPpi: REFERENCE_PPI * scaleFactor };
    }
    case 'width': {
      const target =
        scale.unit === 'px'
          ? scale.value
          : physicalToDocumentPx(scale.value, scale.unit as PhysicalExportUnit);
      const scaleFactor = Math.max(1 / 16, target / safeWidth);
      return {
        scaleFactor,
        outputPpi: scale.unit === 'px' ? undefined : REFERENCE_PPI * scaleFactor,
      };
    }
    case 'height': {
      const target =
        scale.unit === 'px'
          ? scale.value
          : physicalToDocumentPx(scale.value, scale.unit as PhysicalExportUnit);
      const scaleFactor = Math.max(1 / 16, target / safeHeight);
      return {
        scaleFactor,
        outputPpi: scale.unit === 'px' ? undefined : REFERENCE_PPI * scaleFactor,
      };
    }
    case 'resolution': {
      const scaleFactor = Math.max(1 / 16, scale.dpi / REFERENCE_PPI);
      return {
        // A physical export is pixels-per-inch over the fixed 96 px/in design
        // space. It must not be divided by document.dpi.
        scaleFactor,
        outputPpi: REFERENCE_PPI * scaleFactor,
      };
    }
  }
}

export function physicalSizeForDocumentBounds(bounds: { width: number; height: number }): {
  widthInches: number;
  heightInches: number;
} {
  return {
    widthInches: bounds.width / REFERENCE_PPI,
    heightInches: bounds.height / REFERENCE_PPI,
  };
}

export interface EffectiveRasterPpi {
  ppiX: number;
  ppiY: number;
  /** Conservative value used for warnings and production checks. */
  minimumPpi: number;
  /** Tile fills intentionally do not produce a single whole-object PPI. */
  available: boolean;
}

interface ImageResolutionInput {
  sourceWidth: number;
  sourceHeight: number;
  fit: ImageFit;
  bounds: { width: number; height: number };
  scale?: number;
  crop?: ImageCropRect;
  worldTransform?: Affine;
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;
}

function validCrop(
  crop: ImageCropRect | undefined,
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  if (!crop) return { width: sourceWidth, height: sourceHeight };
  const x = Math.max(0, Math.min(sourceWidth, crop.x));
  const y = Math.max(0, Math.min(sourceHeight, crop.y));
  const right = Math.max(x, Math.min(sourceWidth, crop.x + crop.w));
  const bottom = Math.max(y, Math.min(sourceHeight, crop.y + crop.h));
  return {
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

/**
 * Compute effective PPI from the same image-fill placement semantics used by
 * replay: source sample pixels divided by its displayed physical size.
 */
export function effectiveRasterPpi(input: ImageResolutionInput): EffectiveRasterPpi {
  const sourceWidth = positive(input.sourceWidth, 1);
  const sourceHeight = positive(input.sourceHeight, 1);
  if (input.fit === 'tile') {
    return { ppiX: 0, ppiY: 0, minimumPpi: 0, available: false };
  }

  const boundsWidth = positive(input.bounds.width, 1);
  const boundsHeight = positive(input.bounds.height, 1);
  const scale = positive(input.scale, 1);
  let drawWidth: number;
  let drawHeight: number;

  if (input.fit === 'crop') {
    drawWidth = sourceWidth * scale;
    drawHeight = sourceHeight * scale;
  } else if (input.fit === 'stretch') {
    drawWidth = boundsWidth;
    drawHeight = boundsHeight;
  } else {
    const sourceAspect = sourceWidth / sourceHeight;
    const boundsAspect = boundsWidth / boundsHeight;
    if (input.fit === 'fit') {
      if (sourceAspect > boundsAspect) {
        drawWidth = boundsWidth;
        drawHeight = boundsWidth / sourceAspect;
      } else {
        drawHeight = boundsHeight;
        drawWidth = boundsHeight * sourceAspect;
      }
    } else if (sourceAspect > boundsAspect) {
      drawHeight = boundsHeight;
      drawWidth = boundsHeight * sourceAspect;
    } else {
      drawWidth = boundsWidth;
      drawHeight = boundsWidth / sourceAspect;
    }
    drawWidth *= scale;
    drawHeight *= scale;
  }

  const crop = validCrop(input.crop, sourceWidth, sourceHeight);
  const sampleWidth = Math.max(1e-9, drawWidth * (crop.width / sourceWidth));
  const sampleHeight = Math.max(1e-9, drawHeight * (crop.height / sourceHeight));
  const transform = input.worldTransform ?? ([1, 0, 0, 1, 0, 0] as Affine);
  // Basis-vector lengths preserve the effect of rotation while accounting
  // for nested and non-uniform transforms. Translation and image flips do not
  // change density.
  const worldScaleX = Math.hypot(transform[0], transform[1]);
  const worldScaleY = Math.hypot(transform[2], transform[3]);
  const displayedWidth = sampleWidth * Math.max(1e-9, worldScaleX);
  const displayedHeight = sampleHeight * Math.max(1e-9, worldScaleY);
  const ppiX = crop.width / (displayedWidth / REFERENCE_PPI);
  const ppiY = crop.height / (displayedHeight / REFERENCE_PPI);
  return { ppiX, ppiY, minimumPpi: Math.min(ppiX, ppiY), available: true };
}

/** Resolve effective PPI for one placed image, including asset metadata and parent transforms. */
export function effectiveRasterPpiForNode(
  doc: Document,
  node: ShapeNode,
): EffectiveRasterPpi | null {
  const fill = getImageFill(node);
  const image = fill?.image;
  if (!image) return null;
  const asset = image.assetId ? doc.assets?.[image.assetId] : undefined;
  const sourceWidth = asset?.naturalWidth ?? asset?.metadata?.pixelWidth ?? image.imageWidth;
  const sourceHeight = asset?.naturalHeight ?? asset?.metadata?.pixelHeight ?? image.imageHeight;
  if (!sourceWidth || !sourceHeight) return null;
  return effectiveRasterPpi({
    sourceWidth,
    sourceHeight,
    fit: image.fit,
    bounds: { width: shapeWidth(node.shape), height: shapeHeight(node.shape) },
    scale: image.scale,
    crop: image.crop,
    worldTransform: nodeWorldTransform(doc, node.id),
  });
}
