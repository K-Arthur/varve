/**
 * Interactive Shape Builder geometry.
 *
 * The editor owns gestures and presentation; this module owns the canonical
 * construction model and document mutation plan.  It deliberately uses a
 * small arrangement implementation instead of treating a Boolean result as
 * a list of selectable regions.  Every face is classified against the
 * authored source fill rules before reconstruction.
 */

import type { PathPoint } from '@varve/engine';
import { type Affine, applyAffine, tryInvertAffine } from '@varve/shared';
import { type BooleanResult, booleanNormalizedRegions } from './boolean/engine';
import { booleanAnchorForNode, shapeHolesToPolygons, shapeToPolygon } from './boolean/integration';
import { computeAABB, workingTolerance } from './boolean/precision';
import type { FillRule, Point2D, Region2D } from './boolean/region';
import { pointInRegion, regionArea, signedArea, windingNumber } from './boolean/region';
import { nodeWorldTransform } from './coordinateService';
import type { Document } from './document';
import { getParent } from './document';
import { addNode, removeNode, reparentNode } from './document-nodes';
import { nextNodeId } from './node-id';
import type { NodeId, ShapeNode } from './types';
import { isContainer } from './types';

export type ShapeBuilderAction = 'merge' | 'erase' | 'extract' | 'create' | 'divide';

export const SHAPE_BUILDER_LIMITS = {
  maxSources: 64,
  maxSegments: 20_000,
  maxPairChecks: 300_000,
  maxIntersections: 100_000,
  maxFaces: 10_000,
  maxGeneratedVertices: 100_000,
} as const;

export interface ShapeBuilderPoint extends Point2D {}

export interface ShapeBuilderSource {
  id: NodeId;
  node: ShapeNode;
  transform: Affine;
  rings: Point2D[][];
  fillRule: FillRule;
}

export interface ShapeBuilderEdgeProvenance {
  sourceId: NodeId;
  ringIndex: number;
  segmentIndex: number;
  t0: number;
  t1: number;
  /** Direction of the authored segment relative to the canonical edge. */
  direction: 1 | -1;
}

export interface ShapeBuilderEdge {
  id: string;
  start: number;
  end: number;
  provenance: ShapeBuilderEdgeProvenance[];
}

export interface ShapeBuilderFace {
  /** Revision-qualified identity; never an array index. */
  id: string;
  outer: Point2D[];
  holes: Point2D[][];
  area: number;
  representative: Point2D;
  /** Sources whose authored fill is on at least one side of this face. */
  filledBy: NodeId[];
  /** Sources/segments contributing the face boundary. */
  sourceIds: NodeId[];
  edgeIds: string[];
  adjacentFaceIds: string[];
  selectable: boolean;
}

export interface ShapeBuilderModel {
  revision: string;
  status: 'ready' | 'unsupported';
  message?: string;
  sources: ShapeBuilderSource[];
  vertices: Point2D[];
  edges: ShapeBuilderEdge[];
  faces: ShapeBuilderFace[];
  tolerance: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  segmentCount: number;
  intersectionCount: number;
}

export interface ShapeBuilderEligibility {
  nodeId: NodeId;
  eligible: boolean;
  reason?: string;
}

export interface ShapeBuilderApplyOptions {
  expectedRevision?: string;
  styleSourceId?: NodeId;
}

export type ShapeBuilderApplyResult =
  | {
      ok: true;
      doc: Document;
      createdNodeIds: NodeId[];
      removedNodeIds: NodeId[];
      selectedNodeIds: NodeId[];
      revision: string;
    }
  | { ok: false; reason: string; revision?: string };

interface ConstructionSegment {
  id: number;
  sourceId: NodeId;
  ringIndex: number;
  segmentIndex: number;
  a: Point2D;
  b: Point2D;
  splitParams: number[];
}

interface EdgeRecord {
  id: string;
  start: number;
  end: number;
  provenance: ShapeBuilderEdgeProvenance[];
}

interface HalfEdge {
  id: number;
  edgeId: string;
  from: number;
  to: number;
  twin: number;
  angle: number;
}

interface Cycle {
  id: number;
  ring: Point2D[];
  edgeIds: string[];
  area: number;
  probe: Point2D;
}

interface RawFace {
  outer: Point2D[];
  holes: Point2D[][];
  edgeIds: string[];
  filledBy: NodeId[];
  sourceIds: NodeId[];
}

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const PARAMETER_TOLERANCE = 1e-12;

function unsupported(
  reason: string,
  sources: ShapeBuilderSource[] = [],
  tolerance = 0,
  bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  revision = 'shape-builder-empty',
): ShapeBuilderModel {
  return {
    revision,
    status: 'unsupported',
    message: reason,
    sources,
    vertices: [],
    edges: [],
    faces: [],
    tolerance,
    bounds,
    segmentCount: 0,
    intersectionCount: 0,
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function pointKey(point: Point2D, origin: Point2D, tolerance: number): string {
  return `${Math.round((point.x - origin.x) / tolerance)}:${Math.round(
    (point.y - origin.y) / tolerance,
  )}`;
}

function geometrySignature(sources: ShapeBuilderSource[]): string {
  return sources
    .map((source) => {
      const rings = source.rings
        .map((ring) => ring.map((point) => `${point.x},${point.y}`).join(';'))
        .join('|');
      return `${source.id}:${source.fillRule}:${rings}`;
    })
    .sort()
    .join('||');
}

function isFiniteAffine(transform: Affine): boolean {
  return transform.every(Number.isFinite);
}

function isFiniteRing(ring: Point2D[]): boolean {
  return (
    ring.length >= 3 && ring.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  );
}

function hasVisibleStroke(node: ShapeNode): boolean {
  return (node.strokes ?? []).some((stroke) => {
    const sideWeight = stroke.perSideWeights?.some((weight) => weight > 0) ?? false;
    return stroke.visible && (stroke.weight > 0 || sideWeight);
  });
}

function hasPositiveCornerRadius(node: ShapeNode): boolean {
  const radius = node.cornerRadius;
  if (typeof radius === 'number') return radius > 0;
  return (radius?.some((value) => value > 0) ?? false) || (node.cornerSmoothing ?? 0) > 0;
}

function ancestorRestriction(doc: Document, nodeId: NodeId): string | null {
  const visited = new Set<NodeId>();
  let parentId = getParent(doc, nodeId);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = doc.nodes[parentId];
    if (!parent) break;
    if (!parent.visible) return 'An ancestor layer is hidden.';
    if (parent.locked) return 'An ancestor layer is locked.';
    if (parent.kind === 'group' && parent.boolean) {
      return 'Expand the live Boolean result before using Shape Builder.';
    }
    if (parent.kind === 'frame' && parent.componentId) {
      return 'Detach the component instance before changing its topology.';
    }
    parentId = getParent(doc, parentId);
  }
  return null;
}

function nodeEligibility(
  doc: Document,
  nodeId: NodeId,
): { eligible: true; source: ShapeBuilderSource } | { eligible: false; reason: string } {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape') {
    return { eligible: false, reason: 'Select editable filled shape or path layers.' };
  }
  if (!node.visible) return { eligible: false, reason: 'Hidden layers cannot be operands.' };
  if (node.locked) return { eligible: false, reason: 'Unlock the selected layer first.' };
  if (node.shapeless)
    return { eligible: false, reason: 'Images need explicit vector geometry first.' };
  if (node.mask)
    return { eligible: false, reason: 'Remove or expand the mask before building regions.' };
  if (node.iconAssetId)
    return { eligible: false, reason: 'Detach the icon instance before rebuilding it.' };
  if (node.effects?.length)
    return { eligible: false, reason: 'Expand effects before changing topology.' };
  if (node.warps?.length || node.smartFilters?.length) {
    return { eligible: false, reason: 'Expand geometry modifiers before building regions.' };
  }
  if (hasVisibleStroke(node)) {
    return { eligible: false, reason: 'Outline the stroke before using its visible area.' };
  }
  if (hasPositiveCornerRadius(node)) {
    return {
      eligible: false,
      reason: 'Convert rounded corners to a path before building regions.',
    };
  }
  const restriction = ancestorRestriction(doc, nodeId);
  if (restriction) return { eligible: false, reason: restriction };
  if (node.layoutPosition === 'flow') {
    return {
      eligible: false,
      reason: 'Remove this layer from managed layout before rebuilding it.',
    };
  }
  const transform = nodeWorldTransform(doc, nodeId);
  if (!isFiniteAffine(transform))
    return { eligible: false, reason: 'The layer transform is not finite.' };

  if (node.shape.kind === 'path' && !node.shape.closed) {
    return {
      eligible: false,
      reason: 'Open paths are dividers, not filled operands; close or outline them.',
    };
  }
  if (node.shape.kind === 'line' || node.shape.kind === 'arrow') {
    return {
      eligible: false,
      reason: 'Open line geometry must be used as a divider or outlined first.',
    };
  }

  let outer: Point2D[];
  let holes: Point2D[][];
  try {
    outer = shapeToPolygon(node.shape, transform);
    holes = shapeHolesToPolygons(node.shape, transform);
  } catch {
    return { eligible: false, reason: 'The selected geometry could not be converted safely.' };
  }
  const rings = [outer, ...holes];
  if (!rings.every(isFiniteRing)) {
    return {
      eligible: false,
      reason: 'The selected geometry contains a degenerate or malformed ring.',
    };
  }
  const fillRule: FillRule =
    node.shape.kind === 'path' ? (node.shape.fillRule ?? 'nonzero') : 'nonzero';
  return { eligible: true, source: { id: nodeId, node, transform, rings, fillRule } };
}

export function explainShapeBuilderEligibility(
  doc: Document,
  nodeIds: readonly NodeId[],
): ShapeBuilderEligibility[] {
  const unique = [...new Set(nodeIds)];
  return unique.map((nodeId) => {
    const result = nodeEligibility(doc, nodeId);
    return result.eligible
      ? { nodeId, eligible: true }
      : { nodeId, eligible: false, reason: result.reason };
  });
}

function dedupeSourceIds(doc: Document, nodeIds: readonly NodeId[]): NodeId[] {
  const unique = [...new Set(nodeIds)];
  return unique.filter((nodeId) => {
    const node = doc.nodes[nodeId];
    if (node?.kind !== 'shape') return false;
    return !unique.some((otherId) => {
      if (otherId === nodeId) return false;
      let parentId = getParent(doc, nodeId);
      const seen = new Set<NodeId>();
      while (parentId && !seen.has(parentId)) {
        if (parentId === otherId) return true;
        seen.add(parentId);
        parentId = getParent(doc, parentId);
      }
      return false;
    });
  });
}

function boundsForSources(sources: ShapeBuilderSource[]) {
  return computeAABB(sources.flatMap((source) => source.rings.flat()));
}

function squaredDistance(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function lerp(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function crossVectors(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function parameterOnSegment(point: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx === 0 ? 0 : (point.x - a.x) / dx;
  return dy === 0 ? 0 : (point.y - a.y) / dy;
}

function segmentEvents(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
  tolerance: number,
): Array<{ t: number; u: number }> {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const scale = Math.max(Math.hypot(rx, ry), Math.hypot(sx, sy), 1);
  const denominator = crossVectors(rx, ry, sx, sy);
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  if (Math.abs(denominator) > tolerance * scale) {
    const t = crossVectors(qx, qy, sx, sy) / denominator;
    const u = crossVectors(qx, qy, rx, ry) / denominator;
    if (
      t >= -PARAMETER_TOLERANCE &&
      t <= 1 + PARAMETER_TOLERANCE &&
      u >= -PARAMETER_TOLERANCE &&
      u <= 1 + PARAMETER_TOLERANCE
    ) {
      return [{ t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) }];
    }
    return [];
  }

  if (Math.abs(crossVectors(qx, qy, rx, ry)) > tolerance * scale) return [];
  const candidates: Array<{ t: number; u: number }> = [];
  const addEndpoint = (point: Point2D) => {
    const t = parameterOnSegment(point, a, b);
    const u = parameterOnSegment(point, c, d);
    if (
      t >= -PARAMETER_TOLERANCE &&
      t <= 1 + PARAMETER_TOLERANCE &&
      u >= -PARAMETER_TOLERANCE &&
      u <= 1 + PARAMETER_TOLERANCE
    ) {
      candidates.push({
        t: Math.max(0, Math.min(1, t)),
        u: Math.max(0, Math.min(1, u)),
      });
    }
  };
  addEndpoint(c);
  addEndpoint(d);
  addEndpoint(a);
  addEndpoint(b);
  return candidates.filter(
    (event, index, all) =>
      all.findIndex(
        (other) =>
          Math.abs(other.t - event.t) <= PARAMETER_TOLERANCE &&
          Math.abs(other.u - event.u) <= PARAMETER_TOLERANCE,
      ) === index,
  );
}

function boxesOverlap(a: Point2D, b: Point2D, c: Point2D, d: Point2D, tolerance: number): boolean {
  return !(
    Math.max(a.x, b.x) + tolerance < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) + tolerance < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) + tolerance < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) + tolerance < Math.min(a.y, b.y)
  );
}

function createConstructionSegments(
  sources: ShapeBuilderSource[],
  tolerance: number,
): ConstructionSegment[] {
  const segments: ConstructionSegment[] = [];
  for (const source of sources) {
    for (let ringIndex = 0; ringIndex < source.rings.length; ringIndex++) {
      const ring = source.rings[ringIndex]!;
      for (let segmentIndex = 0; segmentIndex < ring.length; segmentIndex++) {
        const a = ring[segmentIndex]!;
        const b = ring[(segmentIndex + 1) % ring.length]!;
        if (squaredDistance(a, b) <= tolerance * tolerance) continue;
        segments.push({
          id: segments.length,
          sourceId: source.id,
          ringIndex,
          segmentIndex,
          a,
          b,
          splitParams: [0, 1],
        });
      }
    }
  }
  return segments;
}

function addUniqueParameter(values: number[], value: number): void {
  const clamped = Math.max(0, Math.min(1, value));
  if (!values.some((existing) => Math.abs(existing - clamped) <= PARAMETER_TOLERANCE)) {
    values.push(clamped);
  }
}

function collectIntersections(
  segments: ConstructionSegment[],
  tolerance: number,
): { intersectionCount: number; pairChecks: number; reason?: string } {
  let intersectionCount = 0;
  let pairChecks = 0;
  for (let i = 0; i < segments.length; i++) {
    const first = segments[i]!;
    for (let j = i + 1; j < segments.length; j++) {
      pairChecks++;
      if (pairChecks > SHAPE_BUILDER_LIMITS.maxPairChecks) {
        return {
          intersectionCount,
          pairChecks,
          reason: 'The selected artwork has too many edge pairs to build safely.',
        };
      }
      const second = segments[j]!;
      if (!boxesOverlap(first.a, first.b, second.a, second.b, tolerance)) continue;
      const events = segmentEvents(first.a, first.b, second.a, second.b, tolerance);
      for (const event of events) {
        addUniqueParameter(first.splitParams, event.t);
        addUniqueParameter(second.splitParams, event.u);
      }
      intersectionCount += events.length;
      if (intersectionCount > SHAPE_BUILDER_LIMITS.maxIntersections) {
        return {
          intersectionCount,
          pairChecks,
          reason: 'The selected artwork has too many intersections to build safely.',
        };
      }
    }
  }
  return { intersectionCount, pairChecks };
}

function cleanRing(points: Point2D[], tolerance: number): Point2D[] {
  const result: Point2D[] = [];
  for (const point of points) {
    if (
      !result.length ||
      squaredDistance(result[result.length - 1]!, point) > tolerance * tolerance
    ) {
      result.push(point);
    }
  }
  if (
    result.length > 1 &&
    squaredDistance(result[0]!, result[result.length - 1]!) <= tolerance * tolerance
  ) {
    result.pop();
  }
  return result;
}

function makeArrangement(
  segments: ConstructionSegment[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  tolerance: number,
): { vertices: Point2D[]; edges: ShapeBuilderEdge[]; cycles: Cycle[] } | { reason: string } {
  const origin = { x: bounds.minX, y: bounds.minY };
  const vertexMap = new Map<string, number>();
  const vertices: Point2D[] = [];
  const getVertex = (point: Point2D): number => {
    const key = pointKey(point, origin, tolerance);
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const id = vertices.length;
    vertices.push(point);
    vertexMap.set(key, id);
    return id;
  };

  const edgeMap = new Map<string, EdgeRecord>();
  for (const segment of segments) {
    const params = [...segment.splitParams].sort((a, b) => a - b);
    for (let index = 0; index < params.length - 1; index++) {
      const t0 = params[index]!;
      const t1 = params[index + 1]!;
      if (t1 - t0 <= PARAMETER_TOLERANCE) continue;
      const a = getVertex(lerp(segment.a, segment.b, t0));
      const b = getVertex(lerp(segment.a, segment.b, t1));
      if (a === b) continue;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      const id = `${start}:${end}`;
      const direction: 1 | -1 = a === start ? 1 : -1;
      const provenance: ShapeBuilderEdgeProvenance = {
        sourceId: segment.sourceId,
        ringIndex: segment.ringIndex,
        segmentIndex: segment.segmentIndex,
        t0,
        t1,
        direction,
      };
      const existing = edgeMap.get(id);
      if (existing) existing.provenance.push(provenance);
      else edgeMap.set(id, { id, start, end, provenance: [provenance] });
    }
  }

  const records = [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const halfEdges: HalfEdge[] = [];
  const outgoing = new Map<number, HalfEdge[]>();
  for (const edge of records) {
    const forward: HalfEdge = {
      id: halfEdges.length,
      edgeId: edge.id,
      from: edge.start,
      to: edge.end,
      twin: halfEdges.length + 1,
      angle: Math.atan2(
        vertices[edge.end]!.y - vertices[edge.start]!.y,
        vertices[edge.end]!.x - vertices[edge.start]!.x,
      ),
    };
    const reverse: HalfEdge = {
      id: halfEdges.length + 1,
      edgeId: edge.id,
      from: edge.end,
      to: edge.start,
      twin: halfEdges.length,
      angle: Math.atan2(
        vertices[edge.start]!.y - vertices[edge.end]!.y,
        vertices[edge.start]!.x - vertices[edge.end]!.x,
      ),
    };
    halfEdges.push(forward, reverse);
    outgoing.set(forward.from, [...(outgoing.get(forward.from) ?? []), forward]);
    outgoing.set(reverse.from, [...(outgoing.get(reverse.from) ?? []), reverse]);
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.angle - b.angle || a.id - b.id);

  const next = new Map<number, number>();
  for (const halfEdge of halfEdges) {
    const list = outgoing.get(halfEdge.to);
    if (!list?.length) continue;
    const twinIndex = list.findIndex((candidate) => candidate.id === halfEdge.twin);
    if (twinIndex < 0) continue;
    next.set(halfEdge.id, list[(twinIndex - 1 + list.length) % list.length]!.id);
  }

  const cycles: Cycle[] = [];
  const visited = new Set<number>();
  const areaFloor = tolerance * tolerance;
  for (const start of halfEdges) {
    if (visited.has(start.id)) continue;
    const local = new Set<number>();
    const path: HalfEdge[] = [];
    let current: number | undefined = start.id;
    while (current !== undefined && !local.has(current) && !visited.has(current)) {
      const halfEdge = halfEdges[current];
      if (!halfEdge) break;
      local.add(current);
      visited.add(current);
      path.push(halfEdge);
      current = next.get(current);
    }
    if (current !== start.id || path.length < 3) continue;
    const ring = cleanRing(
      path.map((halfEdge) => vertices[halfEdge.from]!),
      tolerance,
    );
    const area = signedArea(ring);
    if (ring.length < 3 || area <= areaFloor) continue;
    const probe = ringInteriorProbe(ring, tolerance, []);
    if (!probe) continue;
    cycles.push({
      id: cycles.length,
      ring,
      edgeIds: [...new Set(path.map((halfEdge) => halfEdge.edgeId))],
      area,
      probe,
    });
    if (cycles.length > SHAPE_BUILDER_LIMITS.maxFaces)
      return { reason: 'The arrangement has too many regions to build safely.' };
  }

  return {
    vertices,
    edges: records,
    cycles,
  };
}

function polygonCentroid(ring: Point2D[]): Point2D | null {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) <= Number.EPSILON) return null;
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

function ringInteriorProbe(
  outer: Point2D[],
  tolerance: number,
  holes: Point2D[][],
): Point2D | null {
  const centroid = polygonCentroid(outer);
  const candidates: Point2D[] = centroid ? [centroid] : [];
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i]!;
    const b = outer[(i + 1) % outer.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= tolerance) continue;
    const nx = -dy / length;
    const ny = dx / length;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const fraction of [0.01, 0.1, 0.001]) {
      const offset = Math.max(tolerance * 4, length * fraction);
      candidates.push({ x: midpoint.x + nx * offset, y: midpoint.y + ny * offset });
    }
  }
  return (
    candidates.find(
      (candidate) =>
        pointInRegion(candidate, outer, 'evenodd') &&
        holes.every((hole) => !pointInRegion(candidate, hole, 'evenodd')),
    ) ?? null
  );
}

function sourceIsFilled(source: ShapeBuilderSource, point: Point2D): boolean {
  if (source.fillRule === 'evenodd') {
    let inside = false;
    for (const ring of source.rings) {
      if (pointInRegion(point, ring, 'evenodd')) inside = !inside;
    }
    return inside;
  }
  return source.rings.reduce((winding, ring) => winding + windingNumber(point, ring), 0) !== 0;
}

function cycleHierarchy(cycles: Cycle[]): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const cycle of cycles) children.set(cycle.id, []);
  for (const cycle of cycles) {
    let parent: Cycle | null = null;
    for (const candidate of cycles) {
      if (candidate.id === cycle.id || Math.abs(candidate.area) <= Math.abs(cycle.area)) continue;
      if (!pointInRegion(cycle.probe, candidate.ring, 'evenodd')) continue;
      if (!parent || candidate.area < parent.area) parent = candidate;
    }
    if (parent) children.get(parent.id)!.push(cycle.id);
  }
  for (const ids of children.values()) ids.sort((a, b) => a - b);
  return children;
}

function regionForFace(face: Pick<ShapeBuilderFace, 'outer' | 'holes'>): Region2D {
  return { contours: [face.outer], holes: face.holes, fillRule: 'evenodd' };
}

function booleanResultRegion(result: BooleanResult): Region2D {
  return {
    contours: result.components.map((component) => component.outer),
    holes: result.components.flatMap((component) => component.holes),
    fillRule: 'evenodd',
  };
}

function buildRawFaces(
  cycles: Cycle[],
  edges: EdgeRecord[],
  sources: ShapeBuilderSource[],
  tolerance: number,
): RawFace[] {
  const byId = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const children = cycleHierarchy(cycles);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const raw: RawFace[] = [];
  for (const cycle of cycles) {
    const holes = (children.get(cycle.id) ?? [])
      .map((childId) => byId.get(childId)?.ring)
      .filter((ring): ring is Point2D[] => Boolean(ring));
    const probe = ringInteriorProbe(cycle.ring, tolerance, holes);
    if (!probe) continue;
    const filledBy = sources
      .filter((source) => sourceIsFilled(source, probe))
      .map((source) => source.id);
    const edgeRecords = cycle.edgeIds
      .map((edgeId) => edges.find((edge) => edge.id === edgeId))
      .filter((edge): edge is EdgeRecord => Boolean(edge));
    const sourceIds = [
      ...new Set(
        edgeRecords.flatMap((edge) => edge.provenance.map((provenance) => provenance.sourceId)),
      ),
    ];
    raw.push({ outer: cycle.ring, holes, edgeIds: cycle.edgeIds, filledBy, sourceIds });
    // Force the source map to be materialized here so malformed provenance is
    // not accidentally treated as an eligible source later.
    for (const sourceId of sourceIds) sourceById.get(sourceId);
  }
  return raw;
}

function canonicalRingSignature(ring: Point2D[], tolerance: number): string {
  if (!ring.length) return '';
  const places = ring.map(
    (point) => `${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)}`,
  );
  let best = places.join(';');
  for (let offset = 1; offset < places.length; offset++) {
    const rotated = [...places.slice(offset), ...places.slice(0, offset)].join(';');
    if (rotated < best) best = rotated;
  }
  return best;
}

function mergeEquivalentFaces(
  raw: RawFace[],
  revision: string,
  tolerance: number,
): ShapeBuilderFace[] {
  const groups = new Map<string, RawFace[]>();
  for (const face of raw) {
    const key = face.filledBy.join('|');
    groups.set(key, [...(groups.get(key) ?? []), face]);
  }
  const result: ShapeBuilderFace[] = [];
  for (const [filledKey, group] of groups) {
    const union = booleanNormalizedRegions(group.map(regionForFace), 'union');
    const edgeIds = [...new Set(group.flatMap((face) => face.edgeIds))].sort();
    const sourceIds = [...new Set(group.flatMap((face) => face.sourceIds))].sort();
    const filledBy = filledKey ? (filledKey.split('|') as NodeId[]) : [];
    for (const component of union.components) {
      const area =
        Math.abs(signedArea(component.outer)) -
        component.holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
      if (!(area > tolerance * tolerance)) continue;
      const representative = ringInteriorProbe(component.outer, tolerance, component.holes);
      if (!representative) continue;
      const signature = `${revision}|${filledKey}|${canonicalRingSignature(component.outer, tolerance)}|${component.holes
        .map((hole) => canonicalRingSignature(hole, tolerance))
        .sort()
        .join(',')}`;
      result.push({
        id: `face:${hashString(signature)}`,
        outer: component.outer,
        holes: component.holes,
        area,
        representative,
        filledBy,
        sourceIds,
        edgeIds,
        adjacentFaceIds: [],
        selectable: filledBy.length > 0,
      });
    }
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  const byEdge = new Map<string, string[]>();
  for (const face of result) {
    for (const edgeId of face.edgeIds) byEdge.set(edgeId, [...(byEdge.get(edgeId) ?? []), face.id]);
  }
  for (const face of result) {
    face.adjacentFaceIds = [
      ...new Set(
        face.edgeIds.flatMap((edgeId) => (byEdge.get(edgeId) ?? []).filter((id) => id !== face.id)),
      ),
    ].sort();
  }
  return result;
}

export function buildShapeBuilderModel(
  doc: Document,
  nodeIds: readonly NodeId[],
): ShapeBuilderModel {
  const sourceIds = dedupeSourceIds(doc, nodeIds);
  if (sourceIds.length === 0)
    return unsupported('Select at least one editable filled shape or path.');
  if (sourceIds.length > SHAPE_BUILDER_LIMITS.maxSources) {
    return unsupported(
      `Shape Builder supports at most ${SHAPE_BUILDER_LIMITS.maxSources} source layers at once.`,
    );
  }
  const sources: ShapeBuilderSource[] = [];
  for (const nodeId of sourceIds) {
    const result = nodeEligibility(doc, nodeId);
    if (!result.eligible) return unsupported(result.reason, sources);
    sources.push(result.source);
  }
  const bounds = boundsForSources(sources);
  const allPoints = sources.flatMap((source) => source.rings.flat());
  const tolerance = Math.max(workingTolerance(sources.flatMap((source) => source.rings)), 1e-9);
  const revision = `shape-builder-v1:${hashString(geometrySignature(sources))}`;
  const segments = createConstructionSegments(sources, tolerance);
  if (segments.length > SHAPE_BUILDER_LIMITS.maxSegments) {
    return unsupported(
      'The selected artwork has too many construction segments.',
      sources,
      tolerance,
      bounds,
      revision,
    );
  }
  const intersections = collectIntersections(segments, tolerance);
  if (intersections.reason) {
    return unsupported(intersections.reason, sources, tolerance, bounds, revision);
  }
  const arrangement = makeArrangement(segments, bounds, tolerance);
  if ('reason' in arrangement) {
    return unsupported(arrangement.reason, sources, tolerance, bounds, revision);
  }
  const raw = buildRawFaces(arrangement.cycles, arrangement.edges, sources, tolerance);
  const faces = mergeEquivalentFaces(raw, revision, tolerance);
  if (faces.length > SHAPE_BUILDER_LIMITS.maxFaces) {
    return unsupported(
      'The arrangement has too many regions to build safely.',
      sources,
      tolerance,
      bounds,
      revision,
    );
  }
  if (
    arrangement.vertices.length > SHAPE_BUILDER_LIMITS.maxGeneratedVertices ||
    allPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
  ) {
    return unsupported(
      'The construction produced invalid coordinates.',
      sources,
      tolerance,
      bounds,
      revision,
    );
  }
  return {
    revision,
    status: 'ready',
    message: faces.some((face) => face.selectable)
      ? undefined
      : 'No filled bounded region is available in the current selection.',
    sources,
    vertices: arrangement.vertices,
    edges: arrangement.edges,
    faces,
    tolerance,
    bounds,
    segmentCount: segments.length,
    intersectionCount: intersections.intersectionCount,
  };
}

function segmentDistance(point: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.sqrt(squaredDistance(point, a));
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.sqrt(squaredDistance(point, { x: a.x + t * dx, y: a.y + t * dy }));
}

function pointOnRing(point: Point2D, ring: Point2D[], tolerance: number): boolean {
  return ring.some(
    (start, index) => segmentDistance(point, start, ring[(index + 1) % ring.length]!) <= tolerance,
  );
}

function segmentsCross(a: Point2D, b: Point2D, c: Point2D, d: Point2D, tolerance: number): boolean {
  if (!boxesOverlap(a, b, c, d, tolerance)) return false;
  const events = segmentEvents(a, b, c, d, tolerance);
  return events.length > 0;
}

function faceContains(face: ShapeBuilderFace, point: Point2D, tolerance: number): boolean {
  if (
    pointInRegion(point, face.outer, 'evenodd') &&
    face.holes.every((hole) => !pointInRegion(point, hole, 'evenodd'))
  )
    return true;
  return (
    pointOnRing(point, face.outer, tolerance) ||
    face.holes.some((hole) => pointOnRing(point, hole, tolerance))
  );
}

export function hitTestShapeBuilderFace(
  model: ShapeBuilderModel,
  point: Point2D,
  tolerance = model.tolerance,
): ShapeBuilderFace | null {
  if (model.status !== 'ready') return null;
  return (
    model.faces
      .filter((face) => face.selectable && faceContains(face, point, tolerance))
      .sort((a, b) => a.area - b.area || a.id.localeCompare(b.id))[0] ?? null
  );
}

export function facesCrossedBySegment(
  model: ShapeBuilderModel,
  start: Point2D,
  end: Point2D,
): ShapeBuilderFace[] {
  if (model.status !== 'ready') return [];
  return model.faces.filter((face) => {
    if (!face.selectable) return false;
    if (faceContains(face, start, model.tolerance) || faceContains(face, end, model.tolerance))
      return true;
    const rings = [face.outer, ...face.holes];
    return rings.some((ring) =>
      ring.some((a, index) =>
        segmentsCross(start, end, a, ring[(index + 1) % ring.length]!, model.tolerance),
      ),
    );
  });
}

export function previewShapeBuilderSelection(
  model: ShapeBuilderModel,
  faceIds: readonly string[],
): BooleanResult {
  if (model.status !== 'ready') {
    return { components: [], outerContours: [], holes: [], fillRule: 'evenodd' };
  }
  const requested = new Set(faceIds);
  const regions = model.faces
    .filter((face) => requested.has(face.id) && face.selectable)
    .map(regionForFace);
  if (regions.length === 0)
    return { components: [], outerContours: [], holes: [], fillRule: 'evenodd' };
  return booleanNormalizedRegions(regions, 'union');
}

function outputRegionsForAction(
  action: ShapeBuilderAction,
  selectedFaces: ShapeBuilderFace[],
  selectedResult: BooleanResult,
): Array<{ outer: Point2D[]; holes: Point2D[][] }> {
  if (action === 'divide')
    return selectedFaces.map((face) => ({ outer: face.outer, holes: face.holes }));
  return selectedResult.components.map((component) => ({
    outer: component.outer,
    holes: component.holes,
  }));
}

function sourceFilledRegion(model: ShapeBuilderModel, sourceId: NodeId): Region2D {
  const faces = model.faces.filter((face) => face.filledBy.includes(sourceId));
  if (faces.length === 0) return { contours: [], holes: [], fillRule: 'evenodd' };
  return booleanResultRegion(booleanNormalizedRegions(faces.map(regionForFace), 'union'));
}

function mapRingToParent(ring: Point2D[], inverse: Affine): PathPoint[] {
  return ring.map((point) => {
    const [x, y] = applyAffine(inverse, [point.x, point.y]);
    return { x, y, handleIn: null, handleOut: null };
  });
}

function pathShapeForRegions(
  regions: Array<{ outer: Point2D[]; holes: Point2D[][] }>,
  inverse: Affine,
): ShapeNode['shape'] {
  const rings = regions.flatMap((region) => [region.outer, ...region.holes]);
  const localRings = rings.map((ring) => mapRingToParent(ring, inverse));
  const points = localRings[0] ?? [];
  return {
    kind: 'path',
    points,
    closed: true,
    tolerance: 3,
    contours: localRings,
    holes: localRings.slice(1),
    fillRule: 'evenodd',
  };
}

function makeOutputNode(
  base: ShapeNode,
  id: NodeId,
  name: string,
  regions: Array<{ outer: Point2D[]; holes: Point2D[][] }>,
  inverseParent: Affine,
): ShapeNode {
  return {
    ...base,
    id,
    name,
    kind: 'shape',
    transform: IDENTITY,
    rotation: 0,
    shape: pathShapeForRegions(regions, inverseParent),
    // A visible source stroke is ineligible. Keeping this explicit prevents a
    // future eligibility change from creating doubled internal strokes.
    strokes: [],
    effects: [],
    cornerRadius: undefined,
    cornerSmoothing: undefined,
    warps: undefined,
    smartFilters: undefined,
    mask: undefined,
  };
}

function keyedReference(value: unknown, sourceId: NodeId, keys: ReadonlySet<string>): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => keyedReference(entry, sourceId, keys));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (keys.has(key)) {
      if (typeof child === 'string' && child === sourceId) return true;
      if (Array.isArray(child) && child.includes(sourceId)) return true;
    }
    return keyedReference(child, sourceId, keys);
  });
}

function hasDestructiveReference(doc: Document, sourceId: NodeId): boolean {
  if (doc.interactions?.[sourceId]?.length) return true;
  const referenceKeys = new Set([
    'nodeId',
    'nodeIds',
    'targetNodeId',
    'targetNodeIds',
    'pathNodeId',
    'pathId',
    'sourceNodeId',
    'overlayId',
    'containerId',
    'matteSource',
  ]);
  for (const node of Object.values(doc.nodes)) {
    if (node.id === sourceId) continue;
    if (
      node.kind === 'text' &&
      (node.pathId === sourceId || node.pathTextSettings?.pathNodeId === sourceId)
    )
      return true;
    if (
      node.mask?.sourceNodeId === sourceId ||
      (node.mask?.matteSource?.kind === 'scene-node' && node.mask.matteSource.nodeId === sourceId)
    )
      return true;
    if ('effects' in node && keyedReference(node.effects, sourceId, referenceKeys)) return true;
    if (node.kind === 'adjustment' && keyedReference(node.scope, sourceId, referenceKeys))
      return true;
    if (isContainer(node) && 'slots' in node && Object.values(node.slots ?? {}).includes(sourceId))
      return true;
  }
  if (keyedReference(doc.timelines, sourceId, referenceKeys)) return true;
  if (keyedReference(doc.motionExtensions, sourceId, referenceKeys)) return true;
  if (keyedReference(doc.interactions, sourceId, referenceKeys)) return true;
  for (const component of Object.values(doc.components)) {
    if (component.masterRootId === sourceId) return true;
  }
  return false;
}

function areaDifference(a: Region2D, b: Region2D): number {
  return Math.abs(regionArea(a) - regionArea(b));
}

export function applyShapeBuilderAction(
  doc: Document,
  nodeIds: readonly NodeId[],
  faceIds: readonly string[],
  action: ShapeBuilderAction,
  options: ShapeBuilderApplyOptions = {},
): ShapeBuilderApplyResult {
  const model = buildShapeBuilderModel(doc, nodeIds);
  if (model.status !== 'ready')
    return { ok: false, reason: model.message ?? 'Shape Builder cannot use this selection.' };
  if (options.expectedRevision && options.expectedRevision !== model.revision) {
    return {
      ok: false,
      reason: 'The source geometry changed; preview was discarded.',
      revision: model.revision,
    };
  }
  const selectedFaces = model.faces.filter((face) => faceIds.includes(face.id) && face.selectable);
  if (selectedFaces.length === 0)
    return {
      ok: false,
      reason: 'Select at least one filled region first.',
      revision: model.revision,
    };
  const selectedResult = previewShapeBuilderSelection(
    model,
    selectedFaces.map((face) => face.id),
  );
  if (action !== 'erase' && selectedResult.components.length === 0) {
    return {
      ok: false,
      reason: 'The selected regions produced no editable output.',
      revision: model.revision,
    };
  }
  const affectedSourceIds = [...new Set(selectedFaces.flatMap((face) => face.filledBy))];
  if (action !== 'create') {
    const referenced = affectedSourceIds.find((sourceId) => hasDestructiveReference(doc, sourceId));
    if (referenced) {
      return {
        ok: false,
        reason: `Layer “${doc.nodes[referenced]?.name ?? referenced}” is referenced by another feature; duplicate or detach it before a destructive build.`,
        revision: model.revision,
      };
    }
  }

  const anchorSourceId =
    nodeIds.find((nodeId) => model.sources.some((source) => source.id === nodeId)) ??
    model.sources[0]!.id;
  const anchor = booleanAnchorForNode(doc, anchorSourceId);
  const parentTransform = anchor.parentId ? nodeWorldTransform(doc, anchor.parentId) : IDENTITY;
  const inverseParent = tryInvertAffine(parentTransform);
  if (!inverseParent)
    return {
      ok: false,
      reason: 'The destination parent has a non-invertible transform.',
      revision: model.revision,
    };
  const styleSourceId = options.styleSourceId ?? selectedFaces[0]!.filledBy[0];
  const styleSource =
    model.sources.find((source) => source.id === styleSourceId) ?? model.sources[0]!;

  const outputRegions =
    action === 'erase' ? [] : outputRegionsForAction(action, selectedFaces, selectedResult);
  const sourceMutations: Array<{ sourceId: NodeId; replacement: ShapeNode | null }> = [];
  if (action !== 'create') {
    const selectedRegion = booleanResultRegion(selectedResult);
    for (const sourceId of affectedSourceIds) {
      const sourceNode = doc.nodes[sourceId];
      if (sourceNode?.kind !== 'shape') continue;
      const sourceRegion = sourceFilledRegion(model, sourceId);
      const remainder = booleanNormalizedRegions([sourceRegion, selectedRegion], 'subtract');
      const remainderRegion = booleanResultRegion(remainder);
      if (remainderRegion.contours.length === 0) {
        sourceMutations.push({ sourceId, replacement: null });
      } else if (
        areaDifference(sourceRegion, remainderRegion) >
        model.tolerance * model.tolerance * 4
      ) {
        const sourceParent = getParent(doc, sourceId);
        const sourceParentTransform = sourceParent
          ? nodeWorldTransform(doc, sourceParent)
          : IDENTITY;
        const sourceInverse = tryInvertAffine(sourceParentTransform);
        if (!sourceInverse)
          return {
            ok: false,
            reason: 'A source parent has a non-invertible transform.',
            revision: model.revision,
          };
        sourceMutations.push({
          sourceId,
          replacement: makeOutputNode(
            sourceNode,
            sourceId,
            sourceNode.name,
            remainder.components.map((component) => ({
              outer: component.outer,
              holes: component.holes,
            })),
            sourceInverse,
          ),
        });
      }
    }
  }

  let nextDoc = doc;
  const removedNodeIds: NodeId[] = [];
  for (const mutation of sourceMutations) {
    if (mutation.replacement) {
      nextDoc = {
        ...nextDoc,
        nodes: { ...nextDoc.nodes, [mutation.sourceId]: mutation.replacement },
      };
    } else {
      nextDoc = removeNode(nextDoc, mutation.sourceId);
      removedNodeIds.push(mutation.sourceId);
    }
  }

  const createdNodeIds: NodeId[] = [];
  if (outputRegions.length > 0) {
    for (let index = 0; index < outputRegions.length; index++) {
      const allocation = nextNodeId(nextDoc);
      nextDoc = allocation.doc;
      const output = makeOutputNode(
        styleSource.node,
        allocation.id,
        action === 'create' ? 'Shape Builder result' : `Shape Builder ${action}`,
        [outputRegions[index]!],
        inverseParent,
      );
      nextDoc = addNode(nextDoc, output);
      nextDoc = reparentNode(
        nextDoc,
        allocation.id,
        anchor.parentId,
        anchor.index + index,
        IDENTITY,
      );
      createdNodeIds.push(allocation.id);
    }
  }

  if (action === 'erase' && sourceMutations.length === 0) {
    return {
      ok: false,
      reason: 'The selected regions did not change any source artwork.',
      revision: model.revision,
    };
  }
  return {
    ok: true,
    doc: nextDoc,
    createdNodeIds,
    removedNodeIds,
    selectedNodeIds:
      createdNodeIds.length > 0
        ? createdNodeIds
        : affectedSourceIds.filter((id) => Boolean(nextDoc.nodes[id])),
    revision: model.revision,
  };
}
