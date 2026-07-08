/**
 * Detect scenes that require structural compositing (masks, isolated groups).
 * Flat worker replay cannot handle these — main-thread replaySubtree is required.
 */
import type { Document, NodeId } from '@strata/scene';
import { isInIsolatedSubtree } from '@strata/scene';

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
    if (node.kind === 'frame' && node.children.length > 0 && node.clipContent !== false) {
      return true;
    }
    if (node.kind === 'group') {
      const needsFlatten =
        node.isolated === true ||
        (node.blendMode && node.blendMode !== 'normal' && node.blendMode !== 'passThrough') ||
        (node.opacity !== undefined && node.opacity < 1);
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
 * Image fills MUST be painted on the main thread: the OffscreenCanvas render
 * worker replays IR with `replayIr`, whose `paintImageFill` decodes sources via
 * `new Image()` — a constructor that does not exist in a Web Worker global
 * scope — against the main-thread `ImageCache` singleton, which the worker also
 * cannot see. So a worker-rendered frame silently drops every image. Callers use
 * this to keep image scenes on the main-thread renderer (which owns the cache).
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
