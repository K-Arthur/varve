/**
 * Editor-space geometry for non-destructive Boolean groups.
 *
 * Scene Boolean resolution intentionally works in document-world space so it
 * is portable across consumers. The editor adds page/pasteboard placement on
 * top of that coordinate system. Keeping the small correction here prevents
 * page placement from being applied twice (or not at all) by render, bounds,
 * and hit-test code.
 */

import {
  type Document,
  type NodeId,
  resolveLiveBooleanShape,
  type ShapeNode,
  nodeWorldTransform as sceneNodeWorldTransform,
} from '@varve/scene';
import {
  type Affine,
  applyAffine,
  multiplyAffine,
  type Rect,
  tryInvertAffine,
} from '@varve/shared';

export interface ResolvedPlacedLiveBoolean {
  shape: ShapeNode;
  /** Maps the resolved document-world path into editor placed-world space. */
  transform: Affine;
}

/**
 * Resolve a Boolean shape with the page-placement correction used by the
 * editor. `placedGroupWorld` must be the editor's world transform for the
 * Boolean group (including its containing page placement).
 */
export function resolvePlacedLiveBoolean(
  document: Document,
  nodeId: NodeId,
  placedGroupWorld: Affine,
  parentIndex?: Map<NodeId, NodeId>,
): ResolvedPlacedLiveBoolean | null {
  const shape = resolveLiveBooleanShape(document, nodeId);
  if (!shape) return null;
  const documentGroupWorld = sceneNodeWorldTransform(document, nodeId, parentIndex);
  const inverseDocumentWorld = tryInvertAffine(documentGroupWorld);
  if (!inverseDocumentWorld) return null;
  return {
    shape,
    transform: multiplyAffine(placedGroupWorld, inverseDocumentWorld),
  };
}

/** Bounds of a resolved Boolean's compound path in editor placed-world space. */
export function placedLiveBooleanBounds(resolved: ResolvedPlacedLiveBoolean): Rect | null {
  if (resolved.shape.shape.kind !== 'path') return null;
  const rings = resolved.shape.shape.contours?.length
    ? resolved.shape.shape.contours
    : [resolved.shape.shape.points, ...(resolved.shape.shape.holes ?? [])];
  const points = rings.flat();
  if (points.length === 0) return null;

  const transformed = points.map((point) => applyAffine(resolved.transform, [point.x, point.y]));
  const xs = transformed.map(([x]) => x);
  const ys = transformed.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
