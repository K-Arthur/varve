/**
 * Export preflight for gradient-map adjustments.
 *
 * SVG and PDF cannot represent a live gradient map, so the affected subtree is
 * rasterized. That preserves appearance but loses editability — surface this
 * to the user before/during export rather than silently flattening.
 */
import type { Document, SceneNode } from '@strata/scene';

/** True when the node (or its subtree) carries a gradient-map adjustment. */
export function subtreeHasGradientMap(node: SceneNode, doc: Document): boolean {
  if (node.kind === 'adjustment') {
    const adjustments = (node as { adjustments?: { kind: string }[] }).adjustments ?? [];
    if (adjustments.some((a) => a.kind === 'gradientMap')) return true;
  }
  const children = 'children' in node && Array.isArray(node.children) ? node.children : [];
  for (const childId of children as string[]) {
    const child = doc.nodes[childId];
    if (child && subtreeHasGradientMap(child, doc)) return true;
  }
  return false;
}

/**
 * Collect preflight warnings for exporting a node subtree. For SVG/PDF the
 * gradient map forces raster flattening; for raster targets it is native.
 */
export function collectGradientMapFlattenWarnings(
  node: SceneNode,
  doc: Document,
  format: 'svg' | 'pdf' | 'raster',
): string[] {
  if (format === 'raster') return [];
  if (!subtreeHasGradientMap(node, doc)) return [];
  return [
    format === 'svg'
      ? 'This export flattens gradient-map effects to raster images, so the affected layers lose editability in the SVG output.'
      : 'This export flattens gradient-map effects to raster images, so the affected layers lose editability in the PDF output.',
  ];
}
