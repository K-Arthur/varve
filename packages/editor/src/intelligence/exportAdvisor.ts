import type { Document, SceneNode, ShapeNode } from '@strata/scene';
import { resolveNodeFills } from '@strata/scene';

export interface ExportSuggestion {
  format: 'image/png' | 'image/jpeg' | 'image/webp' | 'svg' | 'pdf';
  scale: number;
  quality?: number;
  suffix?: string;
  reason: string;
}

function nodeHasImageSource(node: SceneNode): { src: string | undefined; isJpeg: boolean } {
  if (node.kind !== 'shape') return { src: undefined, isJpeg: false };
  const fills = resolveNodeFills(node);
  for (const fill of fills) {
    if (fill.visible && fill.type === 'image' && fill.image?.src) {
      const src = fill.image.src;
      const isJpeg = /\.jpe?g$/i.test(src);
      return { src, isJpeg };
    }
  }
  return { src: undefined, isJpeg: false };
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
  const { src, isJpeg } = nodeHasImageSource(node);
  const size = getShapeSize(node);

  if (src && isJpeg) {
    return {
      format: 'image/jpeg',
      scale: 1,
      quality: 85,
      reason: 'Source is JPEG; re-encoding preserves format',
    };
  }

  if (src?.endsWith('.png')) {
    return { format: 'image/png', scale: 2, reason: 'PNG source with potential transparency' };
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
    const children = node.children.map((cId) => doc.nodes[cId]).filter(Boolean);
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

  const _parentId = Object.entries(doc.nodes).find(
    ([, n]) => 'children' in n && (n as { children: unknown }).children === node.id,
  )?.[0];

  return { format: 'image/png', scale: 1, reason: 'Default PNG export' };
}
