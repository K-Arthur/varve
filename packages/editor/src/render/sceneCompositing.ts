/**
 * Detect scenes that require structural compositing (masks, isolated groups).
 * Flat worker replay cannot handle these — main-thread replaySubtree is required.
 */
import type { Document, NodeId } from '@varve/scene';
import { isInIsolatedSubtree } from '@varve/scene';

let _prevDoc: Document | null = null;
let _prevResult = false;

export function sceneNeedsStructuralCompositing(doc: Document): boolean {
  if (_prevDoc === doc) return _prevResult;
  _prevDoc = doc;
  _prevResult = computeNeedsStructuralCompositing(doc);
  return _prevResult;
}

function computeNeedsStructuralCompositing(doc: Document): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (!node) continue;
    if ('mask' in node && node.mask?.visible) return true;
    if (
      'effects' in node &&
      node.effects.some((effect) => effect.visible && effect.mask && effect.mask.visible !== false)
    ) {
      return true;
    }
    if (
      node.kind === 'adjustment' &&
      node.visible !== false &&
      (node.adjustments ?? []).some((adjustment) => adjustment.visible && adjustment.opacity > 0)
    ) {
      return true;
    }
    if (
      node.kind !== 'adjustment' &&
      node.visible !== false &&
      (node.smartFilters ?? []).some((filter) => filter.visible && filter.opacity > 0)
    ) {
      // Leaf filters can be replayed directly on their RenderItem, but a
      // container filter must see the already-composited subtree. Routing the
      // scene through structural replay gives groups/frames the same isolated
      // surface semantics as their existing group effects.
      if (node.kind === 'group' || node.kind === 'frame') return true;
    }
    if (node.kind === 'frame' && node.children.length > 0 && node.clipContent !== false) {
      return true;
    }
    if (node.kind === 'group') {
      const hasVisibleEffects = node.effects.some((effect) => effect.visible);
      const needsFlatten =
        node.isolated === true ||
        (node.blendMode && node.blendMode !== 'normal' && node.blendMode !== 'passThrough') ||
        (node.opacity !== undefined && node.opacity < 1) ||
        hasVisibleEffects ||
        (node.smartFilters ?? []).some((filter) => filter.visible && filter.opacity > 0);
      if (needsFlatten && node.children.length > 0) return true;
    }
  }
  return false;
}

/**
 * Check if a node should be dimmed during isolation mode.
 *
 * When isolation is active, nodes outside the isolated subtree are rendered
 * at reduced opacity (0.3) to visually indicate they are not selectable.
 *
 * @param nodeId - The node to check
 * @param isolatedNodeId - The root of the isolated subtree (null if no isolation)
 * @param doc - The document
 * @returns true if the node should be dimmed (i.e., is outside the isolated subtree)
 */
export function shouldDimNode(
  nodeId: NodeId,
  isolatedNodeId: NodeId | null,
  doc: Document,
): boolean {
  if (!isolatedNodeId) return false; // No isolation active, no dimming
  return !isInIsolatedSubtree(nodeId, isolatedNodeId, doc);
}

let _prevImgDoc: Document | null = null;
let _prevImgResult = false;

/**
 * Does the scene contain any raster image fill?
 *
 * Image fills use Structured Clone ImageBitmap transport once ImageCache
 * has loaded every src (`sceneCanUseWorkerRenderer`). Until then, callers
 * keep the main-thread renderer.
 *
 * Memoised on the document reference like `sceneNeedsStructuralCompositing`.
 */
export function sceneHasImageFills(doc: Document): boolean {
  if (_prevImgDoc === doc) return _prevImgResult;
  _prevImgDoc = doc;
  _prevImgResult = computeHasImageFills(doc);
  return _prevImgResult;
}

function computeHasImageFills(doc: Document): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (!node) continue;
    const fills = (node as { fills?: Array<{ type?: string; visible?: boolean }> }).fills;
    if (!fills) continue;
    for (const fill of fills) {
      if (fill?.type === 'image' && fill.visible !== false) return true;
    }
  }
  return false;
}

function sceneHasUnsupportedWorkerRasterResources(doc: Document): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (!node) continue;
    const fills = (
      node as { fills?: Array<{ type?: string; visible?: boolean; image?: { assetId?: string } }> }
    ).fills;
    if (fills?.some((fill) => fill?.type === 'pattern' && fill.visible !== false)) return true;
    if (
      node.kind === 'shape' &&
      node.backgroundRemoval?.maskDataUrl &&
      fills?.some((fill) => fill?.type === 'image' && fill.visible !== false)
    ) {
      return true;
    }
    // Animated-media fills render on the main thread: their frames arrive
    // asynchronously through the session frame cache (bitmap promotion +
    // reframe contract), which the worker transport does not carry.
    if (
      fills?.some(
        (fill) =>
          fill?.type === 'image' &&
          fill.visible !== false &&
          fill.image?.assetId !== undefined &&
          doc.assets?.[fill.image.assetId]?.animated !== undefined,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Image src URLs on visible image fills in the document. */
export function imageFillSrcsInDocument(doc: Document): string[] {
  const srcs = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (!node) continue;
    const fills = (
      node as { fills?: Array<{ type?: string; visible?: boolean; image?: { src?: string } }> }
    ).fills;
    if (!fills) continue;
    for (const fill of fills) {
      if (fill?.type === 'image' && fill.visible !== false && fill.image?.src) {
        srcs.add(fill.image.src);
      }
    }
  }
  return [...srcs];
}

/**
 * True when the render worker can replay this scene — including image fills
 * once every src is loaded in ImageCache (Structured Clone ImageBitmap transport).
 */
export function sceneCanUseWorkerRenderer(
  doc: Document,
  isImageLoaded: (src: string) => boolean,
): boolean {
  // Pattern tiles are not included in the worker transfer contract, and
  // background-removal masks require DOM-canvas compositing in replay.ts.
  // Reject those scenes instead of silently producing different pixels.
  if (sceneHasUnsupportedWorkerRasterResources(doc)) return false;
  if (!sceneHasImageFills(doc)) return true;
  for (const src of imageFillSrcsInDocument(doc)) {
    if (!isImageLoaded(src)) return false;
  }
  return true;
}
