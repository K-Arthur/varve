/**
 * Container content previews for the Layers panel's 28×28 node thumbnail.
 *
 * Rows show an image preview for image-filled shapes, but frames and groups
 * fell back to a container outline or the type icon: a 1 000-node document
 * gave no visual way to tell two groups apart. This module computes a bounded,
 * simplified content layout for a container — the descendant leaves' bounds,
 * mapped into the container's own space and normalized into a unit box.
 *
 * Bounded on purpose (Thumbnail System: background thumbnail work must never
 * compete with canvas interaction):
 * - at most `MAX_CONTAINER_PREVIEW_NODES` leaf primitives are collected;
 * - `containerHasContent` early-exits on the first drawable leaf;
 * - the collector only runs for mounted rows (the virtualizer keeps that
 *   window small), and its result is cached by content signature.
 *
 * Deliberate simplifications, documented in the Layers preview profile:
 * axis-aligned bounds only (no curve flattening), solid fills only (gradients
 * and images use the fallback ink), live-boolean nodes contribute nothing,
 * and rotated children are represented by their transformed AABB.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { isContainer, nodeLocalBounds } from '@varve/scene';
import type { Affine, ManagedColorShim, Point } from '@varve/shared';
import { applyAffine, managedColorToRgba, multiplyAffine, tryInvertAffine } from '@varve/shared';
import type { ParentIndexCache } from '../../scene/parentIndexCache';
import { nodeWorldTransform } from '../../scene/world';

/** Hard budget for leaf primitives collected per container preview. */
export const MAX_CONTAINER_PREVIEW_NODES = 64;

/** Walk bound for `containerHasContent` before it gives up and reports false. */
const CONTENT_SCAN_LIMIT = 256;

export interface ContainerPreviewPrimitive {
  /** Fill colour as a CSS color string. */
  fill: string;
  /** Normalized bounds in a unit box: x/y in [0,1], w/h in (0,1]. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ContainerPreview {
  primitives: ContainerPreviewPrimitive[];
  /** True when the leaf budget was reached before the subtree was walked. */
  truncated: boolean;
}

export interface CollectContainerPreviewOptions {
  /** Maximum leaf primitives to collect. Defaults to the module budget. */
  maxNodes?: number;
  /** Colour for nodes with no solid fill (theme-aware ink from the caller). */
  fallbackFill?: string;
  /**
   * Cached parent index. Without it, every `nodeWorldTransform` call falls
   * back to an O(document) parent scan — measured at 41 ms per container on
   * an 11 k-node document, which is exactly the cost the row budget forbids.
   * The panel already builds this cache per document; always pass it.
   */
  parentCache?: ParentIndexCache | null;
}

const DEFAULT_FALLBACK_FILL = 'rgba(128, 128, 128, 0.55)';

/**
 * `nodeWorldTransform` takes a `Map<NodeId, NodeId>`, while the shared cache
 * stores `NodeId | null` (roots map to null). Build the non-null view once per
 * cache instance — never per collection — and let the WeakMap drop it with
 * the cache it mirrors.
 */
const parentIndexViews = new WeakMap<ParentIndexCache, Map<NodeId, NodeId>>();

function parentIndexFor(cache?: ParentIndexCache | null): Map<NodeId, NodeId> | undefined {
  if (!cache) return undefined;
  let view = parentIndexViews.get(cache);
  if (!view) {
    view = new Map();
    for (const [childId, parentId] of cache.parentMap) {
      if (parentId != null) view.set(childId, parentId);
    }
    parentIndexViews.set(cache, view);
  }
  return view;
}

function solidFillFor(node: SceneNode, fallback: string): string {
  const fill = 'fill' in node ? node.fill : undefined;
  if (fill) {
    const [r, g, b, a] = managedColorToRgba(fill as ManagedColorShim);
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  }
  const fills = 'fills' in node ? node.fills : undefined;
  const solid = fills?.find((f) => f.type === 'solid' && f.color);
  if (solid?.color) {
    const [r, g, b, a] = managedColorToRgba(solid.color as ManagedColorShim);
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  }
  return fallback;
}

/** True when the node can contribute a preview primitive. */
function isPreviewLeaf(node: SceneNode): boolean {
  return !isContainer(node) && node.kind !== 'adjustment';
}

/**
 * Cheap "would a preview draw anything?" probe for the row: early-exits on the
 * first visible leaf, bounded so an empty container with a huge hidden
 * subtree cannot stall a row render.
 */
export function containerHasContent(
  doc: Pick<Document, 'nodes'>,
  container: SceneNode,
  scanLimit = CONTENT_SCAN_LIMIT,
): boolean {
  if (!isContainer(container)) return false;
  const stack: NodeId[] = [...container.children].reverse();
  let scanned = 0;
  while (stack.length > 0 && scanned < scanLimit) {
    const id = stack.pop();
    if (id === undefined) break;
    scanned += 1;
    const node = doc.nodes[id];
    if (!node || node.visible === false) continue;
    if (isContainer(node)) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const child = node.children[i];
        if (child !== undefined) stack.push(child);
      }
      continue;
    }
    if (isPreviewLeaf(node) && nodeLocalBounds(node)) return true;
  }
  return false;
}

function aabbOfTransformedBounds(
  bounds: { x: number; y: number; w: number; h: number },
  m: Affine,
) {
  const corners: Point[] = [
    applyAffine(m, [bounds.x, bounds.y]),
    applyAffine(m, [bounds.x + bounds.w, bounds.y]),
    applyAffine(m, [bounds.x, bounds.y + bounds.h]),
    applyAffine(m, [bounds.x + bounds.w, bounds.y + bounds.h]),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/**
 * Collect a bounded content layout for a frame/group, normalized to a unit
 * box with the aspect ratio preserved and centered. Returns null when the
 * container has no drawable descendants.
 */
export function collectContainerPreview(
  doc: Pick<Document, 'nodes'>,
  containerId: NodeId,
  options: CollectContainerPreviewOptions = {},
): ContainerPreview | null {
  const container = doc.nodes[containerId];
  if (!container || !isContainer(container)) return null;
  const maxNodes = Math.max(1, options.maxNodes ?? MAX_CONTAINER_PREVIEW_NODES);
  const fallback = options.fallbackFill ?? DEFAULT_FALLBACK_FILL;
  const parentIndex = parentIndexFor(options.parentCache);

  const containerWorld = nodeWorldTransform(doc as Document, containerId, parentIndex);
  const inverse = tryInvertAffine(containerWorld);
  if (!inverse) return null;

  const raw: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
  const stack: NodeId[] = [...container.children].reverse();
  let truncated = false;

  while (stack.length > 0) {
    if (raw.length >= maxNodes) {
      truncated = true;
      break;
    }
    const id = stack.pop();
    if (id === undefined) break;
    const node = doc.nodes[id];
    if (!node || node.visible === false) continue;
    if (isContainer(node)) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const child = node.children[i];
        if (child !== undefined) stack.push(child);
      }
      continue;
    }
    if (!isPreviewLeaf(node)) continue;
    const local = nodeLocalBounds(node);
    if (!local || local.w <= 0 || local.h <= 0) continue;
    const world = nodeWorldTransform(doc as Document, id, parentIndex);
    const inContainer = multiplyAffine(inverse, world);
    const box = aabbOfTransformedBounds(local, inContainer);
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || box.w <= 0 || box.h <= 0) continue;
    raw.push({ ...box, fill: solidFillFor(node, fallback) });
  }

  if (raw.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of raw) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  const unionW = maxX - minX;
  const unionH = maxY - minY;
  if (!Number.isFinite(unionW) || !Number.isFinite(unionH) || unionW <= 0 || unionH <= 0) {
    return null;
  }

  // Preserve aspect: the larger side fills the unit box, the smaller centers.
  const scale = 1 / Math.max(unionW, unionH);
  const offsetX = (1 - unionW * scale) / 2;
  const offsetY = (1 - unionH * scale) / 2;
  const primitives = raw.map((p) => ({
    fill: p.fill,
    x: offsetX + (p.x - minX) * scale,
    y: offsetY + (p.y - minY) * scale,
    w: p.w * scale,
    h: p.h * scale,
  }));

  return { primitives, truncated };
}

/**
 * Stable content signature for the thumbnail cache key. Rounded so sub-pixel
 * jitter does not thrash the cache; identical layouts collapse to one key.
 */
export function containerPreviewSignature(preview: ContainerPreview): string {
  const parts = preview.primitives.map(
    (p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.w.toFixed(3)},${p.h.toFixed(3)},${p.fill}`,
  );
  return `${preview.truncated ? 't' : ''}${parts.join(';')}`;
}
