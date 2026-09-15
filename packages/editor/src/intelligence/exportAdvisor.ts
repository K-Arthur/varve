import type { Document, SceneNode, ShapeNode } from '@varve/scene';
import { resolveNodeFills } from '@varve/scene';

export interface ExportSuggestion {
  format: 'image/png' | 'image/jpeg' | 'image/webp' | 'svg' | 'pdf';
  scale: number;
  quality?: number;
  suffix?: string;
  reason: string;
}

interface ImageFillInfo {
  src: string | undefined;
  isJpeg: boolean;
  isPng: boolean;
  isSvg: boolean;
  /** A placed raster (anything that is not an SVG source) — never a vector. */
  isRaster: boolean;
}

const DATA_URL_MIME = /^data:(image\/[a-z0-9.+-]+)[;,]/i;

function extensionOf(src: string): string | null {
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(src);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Classify the first visible image fill on a node.
 *
 * Imported artwork carries a data URL (`data:image/jpeg;base64,…`) rather than
 * a file path, so extension-only detection silently misread a placed photo as
 * a vector shape and advised "Vector path exports losslessly as SVG" for it.
 * Both encodings are checked here.
 */
function nodeHasImageSource(node: SceneNode): ImageFillInfo {
  const none: ImageFillInfo = {
    src: undefined,
    isJpeg: false,
    isPng: false,
    isSvg: false,
    isRaster: false,
  };
  if (node.kind !== 'shape') return none;
  const fills = resolveNodeFills(node);
  for (const fill of fills) {
    if (!fill.visible || fill.type !== 'image' || !fill.image?.src) continue;
    const src = fill.image.src;
    const mime = DATA_URL_MIME.exec(src)?.[1]?.toLowerCase() ?? null;
    const extension = extensionOf(src);
    const isJpeg = mime === 'image/jpeg' || extension === 'jpg' || extension === 'jpeg';
    const isPng = mime === 'image/png' || extension === 'png';
    const isSvg = mime === 'image/svg+xml' || extension === 'svg';
    return { src, isJpeg, isPng, isSvg, isRaster: !isSvg };
  }
  return none;
}

function isVectorNode(node: SceneNode): boolean {
  if (node.kind !== 'shape') return false;
  const shape = (node as ShapeNode).shape;
  return (
    shape.kind === 'rect' ||
    shape.kind === 'ellipse' ||
    shape.kind === 'circle' ||
    shape.kind === 'path' ||
    shape.kind === 'polygon' ||
    shape.kind === 'star' ||
    shape.kind === 'line' ||
    shape.kind === 'arrow'
  );
}

function isShapeNode(node: SceneNode): node is ShapeNode {
  return node.kind === 'shape';
}

function getShapeSize(node: SceneNode): { w: number; h: number } | null {
  if (node.kind === 'frame') {
    return { w: node.w, h: node.h };
  }
  if (isShapeNode(node)) {
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return { w: s.w, h: s.h };
      case 'ellipse':
        return { w: s.rx * 2, h: s.ry * 2 };
      case 'circle':
        return { w: s.r * 2, h: s.r * 2 };
      case 'polygon':
        return { w: s.radius * 2, h: s.radius * 2 };
      case 'star':
        return { w: s.outerRadius * 2, h: s.outerRadius * 2 };
    }
  }
  return null;
}

export function suggestExportFormat(node: SceneNode, doc: Document): ExportSuggestion {
  const image = nodeHasImageSource(node);
  const size = getShapeSize(node);

  if (image.src) {
    if (image.isJpeg) {
      return {
        format: 'image/jpeg',
        scale: 1,
        quality: 85,
        reason: 'Source is JPEG; re-encoding preserves format',
      };
    }
    if (image.isPng) {
      return { format: 'image/png', scale: 2, reason: 'PNG source with potential transparency' };
    }
    if (image.isSvg) {
      return { format: 'svg', scale: 1, reason: 'SVG source exports losslessly as SVG' };
    }
    // A placed raster whose container format is unknown (WebP, GIF, a
    // data-URL without a recognizable mime): raster output is still the right
    // default. Never advise SVG for it.
    if (size && size.w > 2000) {
      return {
        format: 'image/jpeg',
        scale: 1,
        quality: 80,
        reason: 'Large placed image benefits from JPEG compression',
      };
    }
    return { format: 'image/png', scale: 2, reason: 'Placed image exports as PNG by default' };
  }

  if (size && size.w > 2000) {
    return {
      format: 'image/jpeg',
      scale: 1,
      quality: 80,
      reason: 'Large canvas benefits from JPEG compression',
    };
  }

  if (node.kind === 'text') {
    return { format: 'svg', scale: 1, reason: 'Text outlines preserve fidelity in SVG' };
  }

  if (isVectorNode(node)) {
    return { format: 'svg', scale: 1, reason: 'Vector path exports losslessly as SVG' };
  }

  if (node.kind === 'frame' && node.children.length > 0) {
    const children = node.children
      .map((cId) => doc.nodes[cId])
      .filter((c): c is SceneNode => c != null);
    const hasImageFill = children.some((c) => {
      if (c.kind !== 'shape') return false;
      const fills = resolveNodeFills(c);
      return fills.some((f) => f.visible && f.type === 'image');
    });
    const allVectors = children.every((c) => isVectorNode(c) || c.kind === 'text');
    const allPaths = children.every(
      (c) => c.kind === 'shape' && (c as ShapeNode).shape.kind === 'path',
    );

    if (hasImageFill) {
      return { format: 'image/png', scale: 2, reason: 'Mixed content needs raster for fidelity' };
    }
    if (allVectors || allPaths) {
      return {
        format: 'svg',
        scale: 1,
        reason: 'Frame content is all vector; SVG preserves fidelity',
      };
    }
    return { format: 'image/png', scale: 2, reason: 'Mixed content needs raster for fidelity' };
  }

  return { format: 'image/png', scale: 1, reason: 'Default PNG export' };
}
