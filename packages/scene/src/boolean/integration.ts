// Integration layer: bridges the new boolean engine with Varve's scene model.
//
// This module handles:
//   - ShapeNode → polygon conversion (with compound path / holes support)
//   - World-space normalization
//   - Result placement back into the document
//   - Style inheritance from operands
//   - Multi-contour result serialization into Varve's PathPoint format

import type { PathPoint } from '@varve/engine';
import { type Affine, applyAffine, invertAffine } from '@varve/shared';
import { nodeWorldTransform } from '../coordinateService';
import type { Document } from '../document';
import { getParent } from '../document';
import { addNode, reparentNode } from '../document-nodes';
import { nextNodeId } from '../node-id';
import type { Fill, NodeId, ShapeNode } from '../types';
import { type BooleanOpType, type BooleanResult, booleanNormalizedRegions } from './engine';
import type { Point2D, Region2D } from './region';
import { signedArea } from './region';

// ── Shape → Polygon conversion ──────────────────────────────────────────────

function pointToChordDistanceSq(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }
  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx;
  return (cross * cross) / lengthSq;
}

/** Squared Hausdorff-style control-polygon distance to the cubic chord. */
function flatnessSq(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D): number {
  return Math.max(pointToChordDistanceSq(p1, p0, p3), pointToChordDistanceSq(p2, p0, p3));
}

function curveTolerance(points: readonly Point2D[]): number {
  if (points.length === 0) return 1e-9;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const coordinateMagnitude = Math.max(
    1,
    ...points.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y))),
  );
  // The approximation bound is relative to the local path scale, with only a
  // floating-point safety floor. It is not a fixed document-unit tolerance.
  return Math.max(diagonal * 1e-4, Number.EPSILON * coordinateMagnitude * 64);
}

type CornerRadius = number | readonly [number, number, number, number];

const IDENTITY_TRANSFORM = [1, 0, 0, 1, 0, 0] as const;

/** Conservative upper bound for how much an affine can stretch a vector. */
function affineScaleBound(
  transform: readonly [number, number, number, number, number, number],
): number {
  return Math.max(1, Math.hypot(transform[0], transform[1], transform[2], transform[3]));
}

function arcSegmentCount(
  radius: number,
  sweep: number,
  transform: readonly [number, number, number, number, number, number],
): number {
  const worldRadius = Math.abs(radius) * affineScaleBound(transform);
  if (worldRadius === 0) return 0;
  // Keep the committed polygon within 1e-4 of the local feature scale, with a
  // 0.01 world-unit ceiling so a large transformed primitive does not retain a
  // visibly coarse boundary. This is an approximation budget, not an exactness
  // claim; generated-vertex limits still guard pathological inputs.
  const maxChordError = Math.min(worldRadius * 1e-4, 0.01);
  const halfAngle = Math.acos(Math.max(-1, 1 - maxChordError / worldRadius));
  if (!(halfAngle > 0)) return 1;
  return Math.max(1, Math.ceil(Math.abs(sweep) / (2 * halfAngle)));
}

function ellipseSegmentCount(
  rx: number,
  ry: number,
  transform: readonly [number, number, number, number, number, number] = IDENTITY_TRANSFORM,
): number {
  const radius = Math.max(Math.abs(rx), Math.abs(ry));
  if (radius === 0) return 0;
  return Math.max(8, arcSegmentCount(radius, 2 * Math.PI, transform));
}

function cornerRadii(
  cornerRadius: CornerRadius,
  w: number,
  h: number,
): [number, number, number, number] | null {
  const authored = (
    typeof cornerRadius === 'number'
      ? [cornerRadius, cornerRadius, cornerRadius, cornerRadius]
      : [...cornerRadius]
  ) as [number, number, number, number];
  if (authored.some((radius) => !Number.isFinite(radius))) return null;
  const xReversed = w < 0;
  const yReversed = h < 0;
  const physical =
    xReversed && yReversed
      ? [authored[2], authored[3], authored[0], authored[1]]
      : xReversed
        ? [authored[1], authored[0], authored[3], authored[2]]
        : yReversed
          ? [authored[3], authored[2], authored[1], authored[0]]
          : authored;
  const maxRadius = Math.min(Math.abs(w), Math.abs(h)) / 2;
  let [tl, tr, br, bl] = physical.map((radius) => Math.max(0, Math.min(radius, maxRadius))) as [
    number,
    number,
    number,
    number,
  ];
  const clampPair = (a: number, b: number, length: number): [number, number] => {
    if (a + b <= length) return [a, b];
    const scale = length / (a + b);
    return [a * scale, b * scale];
  };
  [tl, tr] = clampPair(tl, tr, Math.abs(w));
  [tr, br] = clampPair(tr, br, Math.abs(h));
  [br, bl] = clampPair(br, bl, Math.abs(w));
  [bl, tl] = clampPair(bl, tl, Math.abs(h));
  return [tl, tr, br, bl];
}

function roundedRectanglePolygon(
  x: number,
  y: number,
  w: number,
  h: number,
  cornerRadius: CornerRadius,
  transform: readonly [number, number, number, number, number, number],
): Point2D[] {
  if (!(Math.abs(w) > 0 && Math.abs(h) > 0)) return [];
  const radii = cornerRadii(cornerRadius, w, h);
  if (!radii) return [];
  const [tl, tr, br, bl] = radii;
  const x0 = Math.min(x, x + w);
  const x1 = Math.max(x, x + w);
  const y0 = Math.min(y, y + h);
  const y1 = Math.max(y, y + h);
  const points: Point2D[] = [];
  const push = (point: Point2D): void => {
    const previous = points[points.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-12) {
      points.push(point);
    }
  };
  const appendArc = (cx: number, cy: number, radius: number, start: number, end: number): void => {
    if (radius <= 0) return;
    const count = arcSegmentCount(radius, end - start, transform);
    for (let index = 1; index <= count; index++) {
      const angle = start + ((end - start) * index) / count;
      push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    }
  };

  push({ x: x0 + tl, y: y0 });
  push({ x: x1 - tr, y: y0 });
  appendArc(x1 - tr, y0 + tr, tr, -Math.PI / 2, 0);
  push({ x: x1, y: y1 - br });
  appendArc(x1 - br, y1 - br, br, 0, Math.PI / 2);
  push({ x: x0 + bl, y: y1 });
  appendArc(x0 + bl, y1 - bl, bl, Math.PI / 2, Math.PI);
  push({ x: x0, y: y0 + tl });
  appendArc(x0 + tl, y0 + tl, tl, Math.PI, (3 * Math.PI) / 2);
  return points;
}

function sampleCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  tolerance: number,
  depth = 0,
): Point2D[] {
  if (flatnessSq(p0, p1, p2, p3) <= tolerance * tolerance) return [p0, p3];
  // A bounded fallback still contributes a point on the curve. Returning only
  // the endpoint chord at the recursion limit used to turn long handles and
  // cusps into an unreported straight segment.
  if (depth >= 24) {
    const u = 0.5;
    const v = 1 - u;
    return [
      p0,
      {
        x: v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x,
        y: v * v * v * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u * u * u * p3.y,
      },
      p3,
    ];
  }
  const mid = (a: Point2D, b: Point2D) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const m0 = mid(p0, p1);
  const m1 = mid(p1, p2);
  const m2 = mid(p2, p3);
  const m3 = mid(m0, m1);
  const m4 = mid(m1, m2);
  const m5 = mid(m3, m4);
  const left = sampleCubicBezier(p0, m0, m3, m5, tolerance, depth + 1);
  const right = sampleCubicBezier(m5, m4, m2, p3, tolerance, depth + 1);
  return [...left.slice(0, -1), ...right];
}

function applyAffineToPt(
  p: Point2D,
  t: readonly [number, number, number, number, number, number],
): Point2D {
  return { x: t[0] * p.x + t[2] * p.y + t[4], y: t[1] * p.x + t[3] * p.y + t[5] };
}

/** Convert PathPoint[] with optional handles to a sampled polygon. */
export function pathPointsToPolygon(
  points: PathPoint[],
  closed: boolean,
  transform: readonly [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0],
): Point2D[] {
  if (points.length < 2) {
    return points.map((point) => applyAffineToPt({ x: point.x, y: point.y }, transform));
  }
  const transformVector = (vector: [number, number]): Point2D => ({
    x: transform[0] * vector[0] + transform[2] * vector[1],
    y: transform[1] * vector[0] + transform[3] * vector[1],
  });
  const transformed = points.map((point) => ({
    anchor: applyAffineToPt({ x: point.x, y: point.y }, transform),
    handleIn: point.handleIn ? transformVector(point.handleIn) : null,
    handleOut: point.handleOut ? transformVector(point.handleOut) : null,
  }));
  const tolerance = curveTolerance(
    transformed.flatMap((point) => [
      point.anchor,
      ...(point.handleIn
        ? [{ x: point.anchor.x + point.handleIn.x, y: point.anchor.y + point.handleIn.y }]
        : []),
      ...(point.handleOut
        ? [{ x: point.anchor.x + point.handleOut.x, y: point.anchor.y + point.handleOut.y }]
        : []),
    ]),
  );
  const result: Point2D[] = [];
  for (let i = 0; i < transformed.length; i++) {
    const curr = transformed[i]!;
    const next = transformed[(i + 1) % transformed.length]!;
    if (i === transformed.length - 1 && !closed) break;
    const p0 = curr.anchor;
    const p3 = next.anchor;
    if (curr.handleOut || next.handleIn) {
      const p1 = curr.handleOut
        ? { x: curr.anchor.x + curr.handleOut.x, y: curr.anchor.y + curr.handleOut.y }
        : p0;
      const p2 = next.handleIn
        ? { x: next.anchor.x + next.handleIn.x, y: next.anchor.y + next.handleIn.y }
        : p3;
      // Bound the approximation against the segment's own scale as well as
      // the whole path's. A small curved feature inside a very large path
      // must not be flattened to a chord just because the path's diagonal is
      // large; the per-segment budget keeps local error local without
      // claiming an error bound after the recursion/vertex caps are hit.
      const segmentTolerance = Math.min(tolerance, curveTolerance([p0, p1, p2, p3]));
      const sampled = sampleCubicBezier(p0, p1, p2, p3, segmentTolerance);
      for (let j = 0; j < sampled.length - 1; j++) result.push(sampled[j]!);
    } else {
      result.push(p0);
    }
  }
  return result;
}

/**
 * Convert a ShapeNode to a polygon (array of Point2D) in the given transform space.
 * Handles all shape kinds: rect, ellipse, circle, polygon, star, path, etc.
 * For path shapes with holes, returns the outer polygon only (holes handled separately).
 */
export function shapeToPolygon(
  shape: ShapeNode['shape'],
  transform: readonly [number, number, number, number, number, number],
  cornerRadius?: CornerRadius,
): Point2D[] {
  let poly: Point2D[];
  switch (shape.kind) {
    case 'rect':
    case 'table':
      poly = cornerRadius
        ? roundedRectanglePolygon(shape.x, shape.y, shape.w, shape.h, cornerRadius, transform)
        : [
            { x: shape.x, y: shape.y },
            { x: shape.x + shape.w, y: shape.y },
            { x: shape.x + shape.w, y: shape.y + shape.h },
            { x: shape.x, y: shape.y + shape.h },
          ];
      break;
    case 'ellipse': {
      const n = ellipseSegmentCount(shape.rx, shape.ry, transform);
      poly = [];
      for (let i = 0; i < n; i++) {
        const theta = (2 * Math.PI * i) / n;
        poly.push({
          x: shape.cx + shape.rx * Math.cos(theta),
          y: shape.cy + shape.ry * Math.sin(theta),
        });
      }
      break;
    }
    case 'circle': {
      const n = ellipseSegmentCount(shape.r, shape.r, transform);
      poly = [];
      for (let i = 0; i < n; i++) {
        const theta = (2 * Math.PI * i) / n;
        poly.push({
          x: shape.cx + shape.r * Math.cos(theta),
          y: shape.cy + shape.r * Math.sin(theta),
        });
      }
      break;
    }
    case 'line':
      poly = [
        { x: shape.from[0], y: shape.from[1] },
        { x: shape.to[0], y: shape.to[1] },
      ];
      break;
    case 'polygon': {
      poly = [];
      for (let i = 0; i < shape.sides; i++) {
        const a = (2 * Math.PI * i) / shape.sides - Math.PI / 2 + shape.rotation;
        poly.push({
          x: shape.cx + shape.radius * Math.cos(a),
          y: shape.cy + shape.radius * Math.sin(a),
        });
      }
      break;
    }
    case 'star': {
      poly = [];
      for (let i = 0; i < shape.points * 2; i++) {
        const a = (Math.PI * i) / shape.points - Math.PI / 2 + shape.rotation;
        const r = i % 2 === 0 ? shape.outerRadius : shape.innerRadius;
        poly.push({ x: shape.cx + r * Math.cos(a), y: shape.cy + r * Math.sin(a) });
      }
      break;
    }
    case 'arrow':
      poly = [
        { x: shape.from[0], y: shape.from[1] },
        { x: shape.to[0], y: shape.to[1] },
      ];
      break;
    case 'path': {
      return pathPointsToPolygon(shape.points, shape.closed, transform);
    }
    default:
      poly = [];
  }
  return poly.map((p) => applyAffineToPt(p, transform));
}

/**
 * Extract holes from a path shape as separate polygons in world space.
 */
export function shapeHolesToPolygons(
  shape: ShapeNode['shape'],
  transform: readonly [number, number, number, number, number, number],
): Point2D[][] {
  if (shape.kind !== 'path') return [];
  const rings = shape.contours?.length ? shape.contours.slice(1) : (shape.holes ?? []);
  if (rings.length === 0) return [];
  return rings.map((hole) => pathPointsToPolygon(hole, true, transform));
}

/** Convert a filled ShapeNode into a compound region in its supplied space. */
export function shapeToRegion(
  shape: ShapeNode['shape'],
  transform: readonly [number, number, number, number, number, number],
): Region2D | null {
  if (shape.kind === 'path' && !shape.closed) return null;
  const outer = shapeToPolygon(shape, transform);
  if (outer.length < 3) return null;
  const holes = shapeHolesToPolygons(shape, transform);
  return {
    contours: [outer],
    holes,
    fillRule: shape.kind === 'path' && shape.fillRule ? shape.fillRule : 'evenodd',
  };
}

// ── World-space operand conversion ──────────────────────────────────────────

/**
 * Convert a set of shape nodes into world-space operands for boolean operations.
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

// ── Result placement ────────────────────────────────────────────────────────

/** The home (parent + sibling index) of a node. */
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

  if (anchor.parentId && newNode.shape.kind === 'path') {
    const pWorld = nodeWorldTransform(d2, anchor.parentId, parentIndex);
    const pInv = invertAffine(pWorld);

    // Transform outer points
    const points = newNode.shape.points.map((p) => {
      const [x, y] = applyAffine(pInv, [p.x, p.y]);
      return { ...p, x, y };
    });

    // Transform hole points
    const holes = newNode.shape.holes?.map((hole) =>
      hole.map((p) => {
        const [x, y] = applyAffine(pInv, [p.x, p.y]);
        return { ...p, x, y };
      }),
    );
    const contours = newNode.shape.contours?.map((ring) =>
      ring.map((p) => {
        const [x, y] = applyAffine(pInv, [p.x, p.y]);
        return { ...p, x, y };
      }),
    );

    newNode = {
      ...newNode,
      shape: {
        ...newNode.shape,
        points,
        ...(contours && contours.length > 0 ? { contours } : {}),
        ...(holes && holes.length > 0 ? { holes } : {}),
      },
    };
  }

  let d = addNode(d2, newNode);
  d = reparentNode(d, newId, anchor.parentId, anchor.index, localTransform);
  return { doc: d, nodeId: newId };
}

// ── Result construction ─────────────────────────────────────────────────────

function freshId(): string {
  return `bool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert a Point2D polygon to PathPoint[] (all corner nodes). */
function polygonToPathPoints(pts: Point2D[]): PathPoint[] {
  return pts.map((p) => ({ x: p.x, y: p.y, handleIn: null, handleOut: null }));
}

function transformPathPoint(
  point: PathPoint,
  transform: readonly [number, number, number, number, number, number],
): PathPoint {
  const [x, y] = applyAffine(transform, [point.x, point.y]);
  const transformHandle = (handle: [number, number] | null): [number, number] | null =>
    handle
      ? [
          transform[0] * handle[0] + transform[2] * handle[1],
          transform[1] * handle[0] + transform[3] * handle[1],
        ]
      : null;
  return {
    ...point,
    x,
    y,
    handleIn: transformHandle(point.handleIn),
    handleOut: transformHandle(point.handleOut),
  };
}

/** Preserve authored curves when a Boolean command has only one valid operand. */
function preservePathResult(source: ShapeNode, style: ShapeNode, id: string): ShapeNode | null {
  if (source.shape.kind !== 'path' || !source.shape.closed) return null;
  const transform = source.transform;
  const transformRing = (ring: PathPoint[]) =>
    ring.map((point) => transformPathPoint(point, transform));
  const shape = source.shape;
  return {
    ...style,
    id,
    name: 'Boolean Result',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    shape: {
      ...shape,
      points: transformRing(shape.points),
      ...(shape.contours ? { contours: shape.contours.map(transformRing) } : {}),
      ...(shape.holes ? { holes: shape.holes.map(transformRing) } : {}),
    },
  };
}

/**
 * Build a ShapeNode from a boolean result.
 * The result may be a compound path (outer + holes).
 */
function makeResultNode(result: BooleanResult, first: ShapeNode, id: string): ShapeNode {
  const { outerContours, holes } = result;

  if (outerContours.length === 0) {
    // Emptiness is explicit. A one-point closed path would be invalid vector
    // geometry and would make an empty live result impossible to recover.
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
      shape: {
        kind: 'path',
        points: [],
        closed: true,
        tolerance: 3,
        contours: [],
      },
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

  // Use the first (largest) outer contour as the primary path
  const primaryOuter = outerContours[0]!;
  const extraOuters = outerContours.slice(1);

  // `holes` is the legacy field name for additional subpaths. Use even-odd
  // for every Boolean result: it represents disconnected islands, holes, and
  // arbitrary nested parity without losing component topology.
  const normalizedExtraOuters = extraOuters.map((outer) =>
    signedArea(outer) < 0 ? [...outer].reverse() : outer,
  );
  const normalizedHoles = holes.map((hole) => (signedArea(hole) < 0 ? [...hole].reverse() : hole));

  const allRings = [...normalizedExtraOuters, ...normalizedHoles];

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
    shape: {
      kind: 'path',
      points: polygonToPathPoints(primaryOuter),
      closed: true,
      tolerance: 3,
      contours: [primaryOuter, ...allRings].map((ring) => polygonToPathPoints(ring)),
      ...(allRings.length > 0
        ? {
            holes: allRings.map((r) => polygonToPathPoints(r)),
            fillRule: 'evenodd',
          }
        : {}),
    },
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

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Perform a boolean operation on ShapeNodes.
 *
 * This is the main entry point that handles:
 *   1. Shape → polygon conversion
 *   2. World-space normalization
 *   3. Boolean operation via the new engine
 *   4. Result construction as a compound path ShapeNode
 */
export function booleanOp(kind: BooleanOpType, nodes: ShapeNode[]): ShapeNode {
  if (nodes.length === 0) throw new Error('booleanOp requires at least one node');
  const first = nodes[0]!;
  const id = freshId();

  if (nodes.length === 1) {
    const preserved = preservePathResult(first, first, id);
    if (preserved) return preserved;
    // Single node: convert to path
    const poly = shapeToPolygon(first.shape, first.transform);
    if (poly.length < 3) {
      return makeResultNode(
        { components: [], outerContours: [], holes: [], fillRule: 'evenodd' },
        first,
        id,
      );
    }
    return makeResultNode(
      {
        components: [{ outer: poly, holes: [] }],
        outerContours: [poly],
        holes: [],
        fillRule: 'evenodd',
      },
      first,
      id,
    );
  }

  // Convert all nodes to polygons in world space, filtering degenerate ones
  const validOperands = nodes
    .map((node) => ({ node, region: shapeToRegion(node.shape, node.transform) }))
    .filter((operand): operand is { node: ShapeNode; region: Region2D } => operand.region !== null);
  const regions = validOperands.map((operand) => operand.region);

  // If no valid polygons remain, return empty
  if (regions.length === 0) {
    return makeResultNode(
      { components: [], outerContours: [], holes: [], fillRule: 'evenodd' },
      first,
      id,
    );
  }
  if (regions.length === 1) {
    const preserved = preservePathResult(validOperands[0]!.node, first, id);
    if (preserved) return preserved;
    return makeResultNode(
      {
        components: [{ outer: regions[0]!.contours[0]!, holes: regions[0]!.holes }],
        outerContours: [regions[0]!.contours[0]!],
        holes: regions[0]!.holes,
        fillRule: 'evenodd',
      },
      first,
      id,
    );
  }

  // Perform the boolean operation with coordinate normalization
  const result = booleanNormalizedRegions(regions, kind);

  // Build the result ShapeNode
  return makeResultNode(result, first, id);
}

export type { BooleanOpType as BooleanOpKind, Point2D };
