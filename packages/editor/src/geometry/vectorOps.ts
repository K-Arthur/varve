/**
 * Vector operations for logo construction — pure, editor-agnostic geometry
 * helpers that turn engine primitives (offsetPath, expandStroke, roundCorners)
 * and scene node plumbing into composable operations.
 *
 * Design rules:
 * - All functions are pure: given a Document + node ids, they return a new
 *   Document (or null when inapplicable). No side effects, no undo handling —
 *   callers own transactions.
 * - Path-space operations (offset/expand/round/simplify) run in LOCAL
 *   coordinates (node.shape.points are local; the node transform is
 *   untouched), so transformed, rotated, and grouped nodes behave correctly.
 * - Mirror/radial duplication composes the transformation in WORLD space by
 *   conjugating through the parent chain (newOwn = P^-1 * M * P * T), which
 *   works at any nesting depth, including inside artboard frames.
 * - Duplication never descends into a selected subtree twice (only topmost
 *   selected nodes are duplicated; their descendants travel with them).
 */

import type { Shape } from '@varve/engine';
import { cubicBezierPoint, expandStroke, offsetPath, roundCorners } from '@varve/engine';
import type { Document, Fill, NodeId, SceneNode, ShapeNode, Stroke } from '@varve/scene';
import { addNode } from '@varve/scene';
import type { Affine, Point } from '@varve/shared';
import { invertAffine, multiplyAffine, rotateDeg, scaleXY, translate } from '@varve/shared';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';
import { fitPathToBeziers, simplifyPoints } from '../tools/fitting';

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

// ---------------------------------------------------------------------------
// Shape -> path conversion
// ---------------------------------------------------------------------------

const KAPPA = 0.5522847498;

export interface PathPointLike {
  x: number;
  y: number;
  handleIn: [number, number] | null;
  handleOut: [number, number] | null;
}

function bezierEllipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotationRad: number,
): { points: PathPointLike[]; closed: boolean } {
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const rot = (x: number, y: number): [number, number] => [
    cx + x * cos - y * sin,
    cy + x * sin + y * cos,
  ];
  const p1 = rot(rx, 0);
  const p2 = rot(0, ry);
  const p3 = rot(-rx, 0);
  const p4 = rot(0, -ry);
  const hx = rx * KAPPA;
  const hy = ry * KAPPA;
  const h1a = rot(rx, hy);
  const h1b = rot(hx, ry);
  const h2a = rot(-hx, ry);
  const h2b = rot(-rx, hy);
  const h3a = rot(-rx, -hy);
  const h3b = rot(-hx, -ry);
  const h4a = rot(hx, -ry);
  const h4b = rot(rx, -hy);
  const mk = (x: number, y: number): PathPointLike => ({ x, y, handleIn: null, handleOut: null });
  const withIn = (p: PathPointLike, dx: number, dy: number): PathPointLike => ({
    ...p,
    handleIn: [p.x - dx, p.y - dy],
  });
  const withOut = (p: PathPointLike, dx: number, dy: number): PathPointLike => ({
    ...p,
    handleOut: [dx - p.x, dy - p.y],
  });
  const a = mk(p1[0], p1[1]);
  const b = withOut(withIn(mk(p2[0], p2[1]), h1b[0], h1b[1]), h2a[0], h2a[1]);
  const c = withOut(withIn(mk(p3[0], p3[1]), h2b[0], h2b[1]), h3a[0], h3a[1]);
  const d = withOut(withIn(mk(p4[0], p4[1]), h3b[0], h3b[1]), h4a[0], h4a[1]);
  const e = withIn(mk(p1[0], p1[1]), h4b[0], h4b[1]);
  void h1a;
  return {
    points: [a, b, c, d, e],
    closed: true,
  };
}

/**
 * Convert any parametric shape into a PathPoint ring (cubic bezier form).
 * Paths pass through unchanged. Returns null for shapes that cannot be
 * represented as a single outline (e.g. empty paths).
 */
export function shapeToPathPoints(
  shape: Shape,
): { points: PathPointLike[]; closed: boolean } | null {
  switch (shape.kind) {
    case 'path':
      return shape.points.length === 0
        ? null
        : { points: shape.points.map((p) => ({ ...p })), closed: shape.closed };
    case 'rect': {
      const x0 = shape.x;
      const y0 = shape.y;
      const x1 = shape.x + shape.w;
      const y1 = shape.y + shape.h;
      const corner = (x: number, y: number): PathPointLike => ({
        x,
        y,
        handleIn: null,
        handleOut: null,
      });
      return {
        points: [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)],
        closed: true,
      };
    }
    case 'ellipse':
      return bezierEllipsePoints(shape.cx, shape.cy, shape.rx, shape.ry, 0);
    case 'circle':
      return bezierEllipsePoints(shape.cx, shape.cy, shape.r, shape.r, 0);
    case 'polygon': {
      const points: PathPointLike[] = [];
      for (let i = 0; i < shape.sides; i++) {
        const a = (2 * Math.PI * i) / shape.sides - Math.PI / 2 + shape.rotation;
        points.push({
          x: shape.cx + shape.radius * Math.cos(a),
          y: shape.cy + shape.radius * Math.sin(a),
          handleIn: null,
          handleOut: null,
        });
      }
      return { points, closed: true };
    }
    case 'star': {
      const points: PathPointLike[] = [];
      const n = shape.points * 2;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * i) / shape.points - Math.PI / 2 + shape.rotation;
        const r = i % 2 === 0 ? shape.outerRadius : shape.innerRadius;
        points.push({
          x: shape.cx + r * Math.cos(a),
          y: shape.cy + r * Math.sin(a),
          handleIn: null,
          handleOut: null,
        });
      }
      return { points, closed: true };
    }
    case 'line':
    case 'arrow': {
      const [x0, y0] = shape.from;
      const [x1, y1] = shape.to;
      return {
        points: [
          { x: x0, y: y0, handleIn: null, handleOut: null },
          { x: x1, y: y1, handleIn: null, handleOut: null },
        ],
        closed: false,
      };
    }
    default:
      return null;
  }
}

/** Replace a shape node's geometry with path geometry. Preserves holes and
 *  fill rule from path sources; parametric kinds become `kind: 'path'`. */
export function asPathShape(shape: Shape): Shape | null {
  if (shape.kind === 'path') return shape;
  const converted = shapeToPathPoints(shape);
  if (!converted) return null;
  return {
    kind: 'path',
    points: converted.points.map((p) => ({
      x: p.x,
      y: p.y,
      handleIn: p.handleIn,
      handleOut: p.handleOut,
    })),
    closed: converted.closed,
    tolerance: 2,
    holes: undefined,
    fillRule: 'evenodd',
  };
}

// ---------------------------------------------------------------------------
// Local-space path operations
// ---------------------------------------------------------------------------

/**
 * Expand a node's strokes into filled path geometry (outline conversion).
 * The expanded ring is painted with the stroke paint; any previous fills are
 * dropped (they would sit inside the ring hole). Returns null when the node
 * has no expandable stroke or no path geometry.
 */
export function expandStrokeNode(node: ShapeNode): ShapeNode | null {
  const shape = asPathShape(node.shape);
  if (shape?.kind !== 'path') return null;
  if (shape.points.length < 2) return null;
  const stroke = node.strokes?.find((s) => s.visible && s.weight > 0);
  if (!stroke) return null;
  const expanded = expandStroke(shape.points, shape.closed, [stroke.weight], stroke.cap ?? 'round');
  if (expanded.length < 3) return null;
  const expandedShape: Shape = {
    kind: 'path',
    points: expanded,
    closed: true,
    tolerance: shape.tolerance,
    holes: undefined,
    fillRule: 'evenodd',
  };
  return {
    ...node,
    shape: expandedShape,
    fills: [resolveStrokeFill(stroke)],
    strokes: [],
  };
}

function resolveStrokeFill(stroke: Stroke): Fill {
  if (stroke.gradient) {
    return {
      type: 'gradient',
      gradient: stroke.gradient,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
  }
  return {
    type: 'solid',
    color: stroke.color,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

/** Offset a node's path outline by `distance` (positive outward). */
export function offsetPathNode(
  node: ShapeNode,
  distance: number,
  joinStyle: 'miter' | 'round' | 'bevel' = 'round',
  miterLimit = 4,
): ShapeNode | null {
  if (!Number.isFinite(distance) || Math.abs(distance) < 0.01) return node;
  const shape = asPathShape(node.shape);
  if (shape?.kind !== 'path') return null;
  if (shape.points.length < 2) return null;
  const points = offsetPath(shape.points, shape.closed, distance, joinStyle, miterLimit);
  if (points.length < 2) return null;
  return {
    ...node,
    shape: {
      ...shape,
      points,
    },
  };
}

/** Round the corners of a path with a fixed radius. */
export function roundCornersNode(node: ShapeNode, radius: number): ShapeNode | null {
  if (!Number.isFinite(radius) || radius <= 0) return node;
  const shape = asPathShape(node.shape);
  if (shape?.kind !== 'path') return null;
  if (shape.points.length < 2) return null;
  const points = roundCorners(shape.points, shape.closed, radius);
  if (points.length < 2) return null;
  return { ...node, shape: { ...shape, points } };
}

const BEZIER_SAMPLES_PER_SEG = 8;

function pathToPolyline(points: PathPointLike[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i === 0) {
      out.push({ x: p.x, y: p.y });
      continue;
    }
    const prev = points[i - 1]!;
    const hOut = prev.handleOut ?? [0, 0];
    const hIn = p.handleIn ?? [0, 0];
    for (let s = 1; s <= BEZIER_SAMPLES_PER_SEG; s++) {
      const t = s / BEZIER_SAMPLES_PER_SEG;
      const pt = cubicBezierPoint(
        {
          p0: { x: prev.x, y: prev.y },
          p1: { x: prev.x + hOut[0], y: prev.y + hOut[1] },
          p2: { x: p.x + hIn[0], y: p.y + hIn[1] },
          p3: { x: p.x, y: p.y },
        },
        t,
      );
      out.push({ x: pt.x, y: pt.y });
    }
  }
  return out;
}

/**
 * Simplify a path: sample bezier segments to a polyline, run Ramer-Douglas-
 * Peucker, then refit with least-squares cubic bezier segments (Schneider).
 * `tolerance` is in local units; larger values remove more detail.
 */
export function simplifyPathNode(node: ShapeNode, tolerance: number): ShapeNode | null {
  if (!Number.isFinite(tolerance) || tolerance <= 0) return null;
  const shape = asPathShape(node.shape);
  if (shape?.kind !== 'path') return null;
  if (shape.points.length < 3) return null;
  const polyline = pathToPolyline(shape.points);
  if (polyline.length < 3) return null;
  const simplified = simplifyPoints(polyline, tolerance);
  if (simplified.length < 2) return null;
  const fitted = fitPathToBeziers(simplified);
  return {
    ...node,
    shape: {
      ...shape,
      points: fitted.map((p) => ({
        x: p.x,
        y: p.y,
        handleIn: p.handleIn,
        handleOut: p.handleOut,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// World-space duplicate transforms
// ---------------------------------------------------------------------------

/** World-space mirror matrix around the vertical (x) or horizontal (y) axis
 *  through a given center point. */
export function mirrorTransform(center: Point, axis: 'horizontal' | 'vertical'): Affine {
  const [cx, cy] = center;
  if (axis === 'vertical') {
    return multiplyAffine(multiplyAffine(translate(cx, cy), scaleXY(-1, 1)), translate(-cx, -cy));
  }
  return multiplyAffine(multiplyAffine(translate(cx, cy), scaleXY(1, -1)), translate(-cx, -cy));
}

/** World-space rotation matrix around a center point. */
export function rotateAroundTransform(center: Point, angleDeg: number): Affine {
  const [cx, cy] = center;
  return multiplyAffine(
    multiplyAffine(translate(cx, cy), rotateDeg(angleDeg)),
    translate(-cx, -cy),
  );
}

/** Compose a world-space operation M onto a node's own transform at any
 *  nesting depth: newOwn = P^-1 * M * P * T. */
export function composeWorldTransform(
  ownTransform: Affine,
  parentWorld: Affine,
  worldOp: Affine,
): Affine {
  const parentInv = invertAffine(parentWorld);
  return multiplyAffine(
    multiplyAffine(multiplyAffine(parentInv, worldOp), parentWorld),
    ownTransform,
  );
}

/** Topmost selected nodes: drop any node whose ancestor is also selected, so
 *  subtree operations apply exactly once. */
export function topmostSelected(doc: Document, ids: NodeId[]): NodeId[] {
  const idSet = new Set(ids);
  const parents = buildParentMap(doc);
  return ids.filter((id) => {
    let p = parents.get(id);
    while (p) {
      if (idSet.has(p)) return false;
      p = parents.get(p);
    }
    return true;
  });
}

function buildParentMap(doc: Document): Map<NodeId, NodeId> {
  const map = new Map<NodeId, NodeId>();
  for (const node of Object.values(doc.nodes)) {
    if ('children' in node) {
      for (const childId of node.children) map.set(childId, node.id);
    }
  }
  return map;
}

export interface DuplicateResult {
  doc: Document;
  addedIds: NodeId[];
}

function cloneSubtreeNodes(
  doc: Document,
  rootId: NodeId,
): { nodes: SceneNode[]; rootNewId: NodeId; nextId: number } {
  const idMap = new Map<NodeId, NodeId>();
  const nodes: SceneNode[] = [];
  let counter = doc.nextId;
  const clone = (id: NodeId): NodeId => {
    const node = doc.nodes[id];
    if (!node) return id;
    const existing = idMap.get(id);
    if (existing) return existing;
    const newId = `n${counter}`;
    counter += 1;
    idMap.set(id, newId);
    let cloned: SceneNode = { ...node, id: newId };
    if ('children' in cloned) {
      cloned = {
        ...cloned,
        children: cloned.children.map((c) => {
          const newChildId = clone(c);
          idMap.set(c, newChildId);
          return newChildId;
        }),
      };
    }
    nodes.push(cloned);
    return newId;
  };
  const newRootId = clone(rootId);
  // Children must be added to the document before parents, so reverse order
  // (deepest first) is the correct insertion sequence for addNode.
  nodes.reverse();
  return { nodes, rootNewId: newRootId, nextId: counter };
}

function insertSiblingAfter(
  doc: Document,
  parentId: NodeId,
  nodeId: NodeId,
  afterId: NodeId,
): Document {
  const parent = doc.nodes[parentId];
  if (!parent || !('children' in parent)) return doc;
  const children = [...parent.children];
  const idx = children.indexOf(nodeId);
  if (idx === -1) return doc;
  children.splice(idx, 1);
  const afterIdx = children.indexOf(afterId);
  children.splice(afterIdx + 1, 0, nodeId);
  return { ...doc, nodes: { ...doc.nodes, [parentId]: { ...parent, children } } };
}

/**
 * Duplicate the topmost selected nodes, applying a world-space transform
 * (mirror or rotation) to each duplicate's root. Originals are kept;
 * duplicates are inserted directly after their source, preserving z-order,
 * and returned so the caller can select them.
 */
export function duplicateWithTransform(
  doc: Document,
  ids: NodeId[],
  worldOp: Affine,
): DuplicateResult | null {
  const topIds = topmostSelected(doc, ids);
  if (topIds.length === 0) return null;
  const parents = buildParentMap(doc);
  let d = doc;
  const addedIds: NodeId[] = [];
  for (const id of topIds) {
    const node = d.nodes[id];
    if (!node) continue;
    const parentId = parents.get(id) ?? null;
    const parentWorld = parentId ? nodeWorldTransform(d, parentId) : IDENTITY;
    const newOwn = composeWorldTransform(node.transform as Affine, parentWorld, worldOp);
    const { nodes, rootNewId, nextId } = cloneSubtreeNodes(d, id);
    d = { ...d, nextId };
    for (const cloned of nodes) {
      d = addNode(d, cloned);
    }
    const rootClone = d.nodes[rootNewId];
    if (rootClone) {
      d = {
        ...d,
        nodes: { ...d.nodes, [rootNewId]: { ...rootClone, transform: newOwn } },
      };
    }
    if (parentId) {
      d = insertSiblingAfter(d, parentId, rootNewId, id);
    }
    addedIds.push(rootNewId);
  }
  return { doc: d, addedIds };
}

/** World-space center of the union of the given nodes' bounds. */
export function selectionCenter(doc: Document, ids: NodeId[]): Point | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const b = nodeWorldBounds(doc, id);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** World-space center of a single node's bounds (used for radial centers). */
export function nodeCenter(doc: Document, id: NodeId): Point | null {
  const b = nodeWorldBounds(doc, id);
  if (!b) return null;
  return [b.x + b.w / 2, b.y + b.h / 2];
}

export type { Affine };
