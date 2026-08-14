// COMPLEXITY: 70 — boolean operation dispatch and clipPolygons main algorithm.

import type { PathPoint } from '@varve/engine';
import { type Affine, applyAffine, invertAffine } from '@varve/shared';
import type { Point2D, Run } from './boolean-geometry';
import {
  assembleContour,
  classifyRuns,
  cleanPolygon,
  ensureCCW,
  findIntersections,
  hasSelfIntersections,
  pointInPolygon,
  resolveSelfIntersections,
  shapeToPolygon,
  splitPolygons,
} from './boolean-geometry';
import { nodeWorldTransform } from './coordinateService';
import type { Document } from './document';
import { getParent } from './document';
import { addNode, reparentNode } from './document-nodes';
import { nextNodeId } from './node-id';
import type { Fill, NodeId, ShapeNode } from './types';

export type BooleanOpKind = 'union' | 'subtract' | 'intersect' | 'exclude';
export type { Point2D };

// ── Coordinate-space-aware operand conversion ────────────────────────────────

/**
 * Convert a set of shape nodes into WORLD-space operands for
 * {@link booleanOp}: each node's own transform is replaced with its composed
 * world transform, so polygons from different parents (artboards, groups,
 * pasteboard) are clipped in one common space instead of being mis-clipped
 * across unrelated local frames.
 */
export function shapeNodesInWorldSpace(
  doc: Document,
  nodes: ShapeNode[],
  parentIndex?: Map<NodeId, NodeId>,
): ShapeNode[] {
  return nodes.map((n) => ({
    ...n,
    transform: nodeWorldTransform(doc, n.id, parentIndex) as Affine,
  }));
}

/** The home (parent + sibling index) of a node — where a boolean result that
 *  replaces the node should be inserted so z-order is preserved. */
export function booleanAnchorForNode(
  doc: Document,
  nodeId: NodeId,
): { parentId: NodeId | null; index: number } {
  const parentId = getParent(doc, nodeId);
  if (parentId) {
    const parent = doc.nodes[parentId];
    if (parent && 'children' in parent) {
      return { parentId, index: Math.max(0, parent.children.indexOf(nodeId)) };
    }
  }
  return { parentId: null, index: Math.max(0, doc.rootChildren.indexOf(nodeId)) };
}

/**
 * Insert a boolean result at the anchor node's home, converting the result
 * geometry from world space into the anchor parent's local space.
 *
 * `booleanOp` produces polygon points in the operand transform space; with
 * world-space operands the points are world coordinates, so they must be
 * mapped into the destination parent frame before the node is stored —
 * otherwise the result teleports by the parent's translation (or is
 * mis-scaled/rotated inside a transformed parent).
 */
export function placeBooleanResult(
  doc: Document,
  result: ShapeNode,
  anchor: { parentId: NodeId | null; index: number },
  parentIndex?: Map<NodeId, NodeId>,
): { doc: Document; nodeId: NodeId } {
  const { id: newId, doc: d2 } = nextNodeId(doc);
  let newNode: ShapeNode = { ...result, id: newId };
  const localTransform: Affine = [1, 0, 0, 1, 0, 0];
  if (anchor.parentId) {
    const pWorld = nodeWorldTransform(d2, anchor.parentId, parentIndex);
    const pInv = invertAffine(pWorld);
    if (newNode.shape.kind === 'path') {
      const points = newNode.shape.points.map((p) => {
        const [x, y] = applyAffine(pInv, [p.x, p.y]);
        return { ...p, x, y };
      });
      newNode = { ...newNode, shape: { ...newNode.shape, points } };
    }
  }
  let d = addNode(d2, newNode);
  d = reparentNode(d, newId, anchor.parentId, anchor.index, localTransform);
  return { doc: d, nodeId: newId };
}

// ── Polygon boolean via segment walk (Vatti-style) ──────────────────────────

function clipPolygons(
  subject: Point2D[],
  clip: Point2D[],
  operation: 'intersect' | 'union' | 'subtract',
): Point2D[] | null {
  const cleanedSub = cleanPolygon(subject);
  const cleanedClip = cleanPolygon(clip);
  if (cleanedSub.length < 3 || cleanedClip.length < 3) return null;

  if (hasSelfIntersections(cleanedSub)) {
    const parts = resolveSelfIntersections(cleanedSub);
    for (const part of parts) {
      const result = clipPolygons(part, cleanedClip, operation);
      if (result) return result;
    }
    return null;
  }
  if (hasSelfIntersections(cleanedClip)) {
    const parts = resolveSelfIntersections(cleanedClip);
    for (const part of parts) {
      const result = clipPolygons(cleanedSub, part, operation);
      if (result) return result;
    }
    return null;
  }

  const sub = ensureCCW(cleanedSub);
  const clp = ensureCCW(cleanedClip);
  const xs = findIntersections(sub, clp);

  if (xs.length === 0) {
    const subFirst = sub[0];
    const subMidPt = sub[Math.floor(sub.length / 2)];
    const subMid =
      sub.length > 2 && subFirst && subMidPt
        ? {
            x: (subFirst.x + subMidPt.x) / 2,
            y: (subFirst.y + subMidPt.y) / 2,
          }
        : sub[0]!;
    const clipFirst = clp[0];
    const clipMidPt = clp[Math.floor(clp.length / 2)];
    const clipMid =
      clp.length > 2 && clipFirst && clipMidPt
        ? {
            x: (clipFirst.x + clipMidPt.x) / 2,
            y: (clipFirst.y + clipMidPt.y) / 2,
          }
        : clp[0]!;
    const subInsideClip = pointInPolygon(subMid, clp);
    const clipInsideSub = pointInPolygon(clipMid, sub);

    switch (operation) {
      case 'intersect':
        return null;
      case 'union': {
        if (subInsideClip) return [...clp];
        if (clipInsideSub) return [...sub];
        return [...sub, ...clp];
      }
      case 'subtract': {
        if (subInsideClip) return null;
        return [...sub];
      }
    }
  }

  const { subVerts, clipVerts } = splitPolygons(sub, clp, xs);
  const { subRuns, clipRuns } = classifyRuns(subVerts, clipVerts);

  const acceptInside = operation === 'intersect';
  const isSubtract = operation === 'subtract';

  const accepted: Run[] = [];

  for (const run of subRuns) {
    if (isSubtract ? !run.insideOther : run.insideOther === acceptInside) {
      accepted.push(run);
    }
  }

  for (const run of clipRuns) {
    if (isSubtract ? run.insideOther : run.insideOther === acceptInside) {
      if (isSubtract) run.verts.reverse();
      accepted.push(run);
    }
  }

  const result = assembleContour(accepted);
  if (result) return ensureCCW(result);
  return null;
}

// ── Result construction ─────────────────────────────────────────────────────

function makeResult(points: PathPoint[], closed: boolean, first: ShapeNode, id: string): ShapeNode {
  return {
    id,
    name: 'Boolean Result',
    kind: 'shape',
    order: first.order,
    visible: true,
    locked: false,
    opacity: first.opacity,
    blendMode: first.blendMode,
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    shape: { kind: 'path', points, closed, tolerance: 3 },
    fill: first.fill,
    fills: (first.fills?.length
      ? [...first.fills]
      : first.fill
        ? [
            {
              type: 'solid' as const,
              color: first.fill,
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            } as Fill,
          ]
        : []) as Fill[],
    strokes: [...(first.strokes ?? [])],
    effects: [...(first.effects ?? [])],
  };
}

let _idCounter = 0;
function freshId(): string {
  return `bool-${Date.now()}-${_idCounter++}`;
}

function polygonToPathPoints(poly: Point2D[]): PathPoint[] {
  return poly.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null }));
}

function simplifyPolygon(poly: Point2D[]): Point2D[] {
  if (poly.length < 3) return poly;
  const result: Point2D[] = [poly[0]!];
  for (let i = 1; i < poly.length - 1; i++) {
    const prev = result[result.length - 1]!;
    const curr = poly[i]!;
    const next = poly[i + 1]!;
    const cross = Math.abs(
      (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x),
    );
    if (cross > 0.5) result.push(curr);
  }
  result.push(poly[poly.length - 1]!);
  return result;
}

function dedupePoly(poly: Point2D[]): Point2D[] {
  if (poly.length < 2) return poly;
  const result: Point2D[] = [poly[0]!];
  for (let i = 1; i < poly.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = poly[i]!;
    if (Math.abs(curr.x - prev.x) > 1e-8 || Math.abs(curr.y - prev.y) > 1e-8) {
      result.push(curr);
    }
  }
  return result;
}

export function booleanOp(kind: BooleanOpKind, nodes: ShapeNode[]): ShapeNode {
  if (nodes.length === 0) throw new Error('booleanOp requires at least one node');
  const first = nodes[0]!;
  const id = freshId();

  const polygons = nodes.map((n) => shapeToPolygon(n.shape, n.transform));

  switch (kind) {
    case 'union': {
      let result = polygons[0]!;
      for (let i = 1; i < polygons.length; i++) {
        const clipped = clipPolygons(result, polygons[i]!, 'union');
        if (!clipped || clipped.length < 3) {
          result = [...result, ...polygons[i]!];
        } else {
          result = clipped;
        }
      }
      const deduped = dedupePoly(result);
      const simplified = simplifyPolygon(deduped);
      return makeResult(polygonToPathPoints(simplified), true, first, id);
    }

    case 'intersect': {
      if (polygons.length < 2) {
        return makeResult(polygonToPathPoints(polygons[0]!), true, first, id);
      }
      let result = polygons[0]!;
      for (let i = 1; i < polygons.length; i++) {
        const clipped = clipPolygons(result, polygons[i]!, 'intersect');
        if (!clipped || clipped.length < 3) {
          const origin = result[0] || { x: 0, y: 0 };
          return makeResult(
            [{ x: origin.x, y: origin.y, handleIn: null, handleOut: null }],
            true,
            first,
            id,
          );
        }
        result = clipped;
      }
      const deduped = dedupePoly(result);
      const simplified = simplifyPolygon(deduped);
      return makeResult(polygonToPathPoints(simplified), true, first, id);
    }

    case 'subtract': {
      if (polygons.length < 2) {
        return makeResult(polygonToPathPoints(polygons[0]!), true, first, id);
      }
      let result = polygons[0]!;
      for (let i = 1; i < polygons.length; i++) {
        const clipped = clipPolygons(result, polygons[i]!, 'subtract');
        if (clipped && clipped.length >= 3) result = clipped;
      }
      const deduped = dedupePoly(result);
      const simplified = simplifyPolygon(deduped);
      return makeResult(polygonToPathPoints(simplified), true, first, id);
    }

    case 'exclude': {
      if (polygons.length < 2) {
        return makeResult(polygonToPathPoints(polygons[0]!), true, first, id);
      }
      let ab = polygons[0]!;
      for (let i = 1; i < polygons.length; i++) {
        const c = clipPolygons(ab, polygons[i]!, 'subtract');
        if (c && c.length >= 3) ab = c;
      }
      let ba = polygons[polygons.length - 1]!;
      for (let i = polygons.length - 2; i >= 0; i--) {
        const c = clipPolygons(ba, polygons[i]!, 'subtract');
        if (c && c.length >= 3) ba = c;
      }
      const unionResult = clipPolygons(ab, ba, 'union');
      const result = unionResult && unionResult.length >= 3 ? unionResult : [...ab, ...ba];
      const deduped = dedupePoly(result);
      const simplified = simplifyPolygon(deduped);
      return makeResult(polygonToPathPoints(simplified), true, first, id);
    }
  }
}
