import type { PathPoint } from '@varve/engine';
import {
  type Document,
  isLiveBooleanNode,
  nodeWorldTransform,
  resolveLiveBooleanShape,
  type SceneNode,
  type ShapeNode,
} from '@varve/scene';
import { type Affine, applyAffine, tryInvertAffine } from '@varve/shared';

/** Apply an affine to a path point, including its optional tangent handles. */
function transformPathPoint(point: PathPoint, transform: Affine): PathPoint {
  const next: PathPoint = {
    ...point,
    x: applyAffine(transform, [point.x, point.y])[0],
    y: applyAffine(transform, [point.x, point.y])[1],
  };
  const transformHandle = (handle: readonly [number, number]): [number, number] => {
    return [
      transform[0] * handle[0] + transform[2] * handle[1],
      transform[1] * handle[0] + transform[3] * handle[1],
    ] as [number, number];
  };
  if (point.handleIn) next.handleIn = transformHandle(point.handleIn);
  if (point.handleOut) next.handleOut = transformHandle(point.handleOut);
  return next;
}

/**
 * Return a live Boolean's resolved path in the group's object-local space.
 *
 * The scene resolver intentionally returns world-space geometry so rendering,
 * hit testing, and snapping share one authoritative result. Code exporters
 * still need a hierarchical path, however: converting back through the
 * group's world inverse lets the normal SVG transform stack apply ancestors
 * exactly once.
 */
export function resolveLiveBooleanForExport(node: SceneNode, document: Document): ShapeNode | null {
  if (!isLiveBooleanNode(node)) return null;
  const resolved = resolveLiveBooleanShape(document, node.id);
  if (resolved?.shape.kind !== 'path') return null;

  const inverse = tryInvertAffine(nodeWorldTransform(document, node.id));
  if (!inverse) return null;
  const path = resolved.shape;
  const localPoints = path.points.map((point) => transformPathPoint(point, inverse));
  const localHoles = path.holes?.map((ring) =>
    ring.map((point) => transformPathPoint(point, inverse)),
  );

  // The resolved shape carries the first operand's paint, while the live
  // group owns compositing and effects. Copy the latter onto the synthetic
  // shape so export preserves the group's appearance without re-emitting its
  // source operands.
  return {
    ...resolved,
    id: node.id,
    name: node.name,
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    blendMode: node.blendMode,
    transform: node.transform,
    rotation: node.rotation,
    effects: node.effects,
    mask: node.mask,
    shape: {
      ...path,
      points: localPoints,
      ...(localHoles ? { holes: localHoles } : {}),
    },
  };
}
