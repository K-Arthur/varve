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

function flatnessSq(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D): number {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const d2 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx);
  const d3 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx);
  return d2 + d3;
}

function curveTolerance(points: readonly Point2D[]): number {
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

function ellipseSegmentCount(rx: number, ry: number): number {
  const radius = Math.max(Math.abs(rx), Math.abs(ry));
  if (radius === 0) return 0;
  // Chord error is bounded to 1e-4 of the ellipse radius, matching the
  // path-flattening policy instead of imposing the old fixed 48-sided circle.
  const maxChordError = radius * 1e-4;
  const halfAngle = Math.acos(Math.max(-1, 1 - maxChordError / radius));
  return Math.max(8, Math.ceil(Math.PI / halfAngle));
}

function sampleCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  tolerance: number,
  depth = 0,
): Point2D[] {
  if (flatnessSq(p0, p1, p2, p3) <= tolerance * tolerance || depth >= 24) return [p0, p3];
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
function pathPointsToPolygon(points: PathPoint[], closed: boolean): Point2D[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const tolerance = curveTolerance(points);
  const result: Point2D[] = [];
  for (let i = 0; i < points.length; i++) {
    const curr = points[i]!;
    const next = points[(i + 1) % points.length]!;
    if (i === points.length - 1 && !closed) break;
    const p0: Point2D = { x: curr.x, y: curr.y };
    const p3: Point2D = { x: next.x, y: next.y };
    if (curr.handleOut || next.handleIn) {
      const p1: Point2D = curr.handleOut
        ? { x: curr.x + curr.handleOut[0], y: curr.y + curr.handleOut[1] }
        : p0;
      const p2: Point2D = next.handleIn
        ? { x: next.x + next.handleIn[0], y: next.y + next.handleIn[1] }
        : p3;
      const sampled = sampleCubicBezier(p0, p1, p2, p3, tolerance);
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
): Point2D[] {
  let poly: Point2D[];
  switch (shape.kind) {
    case 'rect':
    case 'table':
      poly = [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.w, y: shape.y },
        { x: shape.x + shape.w, y: shape.y + shape.h },
        { x: shape.x, y: shape.y + shape.h },
      ];
      break;
    case 'ellipse': {
      const n = ellipseSegmentCount(shape.rx, shape.ry);
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
      const n = ellipseSegmentCount(shape.r, shape.r);
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
      poly = pathPointsToPolygon(shape.points, shape.closed);
      return poly.map((p) => applyAffineToPt(p, transform));
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
  if (shape.kind !== 'path' || !shape.holes || shape.holes.length === 0) return [];
  return shape.holes.map((hole) =>
    pathPointsToPolygon(hole, true).map((p) => applyAffineToPt(p, transform)),
  );
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

    newNode = {
      ...newNode,
      shape: {
        ...newNode.shape,
        points,
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
  const regions = nodes
    .map((node) => shapeToRegion(node.shape, node.transform))
    .filter((region): region is Region2D => region !== null);

  // If no valid polygons remain, return empty
  if (regions.length === 0) {
    return makeResultNode(
      { components: [], outerContours: [], holes: [], fillRule: 'evenodd' },
      first,
      id,
    );
  }
  if (regions.length === 1) {
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
