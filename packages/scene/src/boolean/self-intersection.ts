// Self-intersection detection and resolution.
// Used before polygon clipping to ensure simple polygon inputs.

import { pointsEqual, segmentIntersectionRobust } from './precision';
import type { Point2D } from './region';

export function hasSelfIntersections(poly: Point2D[], tol: number): boolean {
  const n = poly.length;
  if (n < 3) return false;
  const m = pointsEqual(poly[0]!, poly[n - 1]!, tol) ? n - 1 : n;
  if (m < 3) return false;

  for (let i = 0; i < m; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % m]!;
    for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;
      const b1 = poly[j]!;
      const b2 = poly[(j + 1) % m]!;
      const ix = segmentIntersectionRobust(a1, a2, b1, b2, tol);
      if (ix && ix.type === 'cross') return true;
    }
  }
  return false;
}

export function resolveSelfIntersections(poly: Point2D[], tol: number): Point2D[][] {
  const n = poly.length;
  if (n < 3) return [poly];
  const m = pointsEqual(poly[0]!, poly[n - 1]!, tol) ? n - 1 : n;
  if (m < 3) return [poly];

  // Build a planar arrangement by splitting every segment at every crossing.
  // The old recursive splitter handled one crossing at a time and could drop
  // faces when a path contained two or more loops.  A half-edge graph keeps
  // every bounded face and is deterministic for a fixed input ordering.
  const splitParams = Array.from({ length: m }, () => [0, 1]);
  let hasCrossing = false;
  const addParam = (edge: number, value: number) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(0, Math.min(1, value));
    if (!splitParams[edge]!.some((existing) => Math.abs(existing - clamped) <= tol)) {
      splitParams[edge]!.push(clamped);
    }
  };
  const parameterOn = (a: Point2D, b: Point2D, p: Point2D): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denom = dx * dx + dy * dy;
    return denom <= tol * tol ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / denom;
  };

  for (let i = 0; i < m; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % m]!;
    for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;
      const b1 = poly[j]!;
      const b2 = poly[(j + 1) % m]!;
      const ix = segmentIntersectionRobust(a1, a2, b1, b2, tol);
      if (!ix) continue;
      hasCrossing = true;
      if (ix.type === 'collinear-overlap') {
        addParam(i, parameterOn(a1, a2, ix.start));
        addParam(i, parameterOn(a1, a2, ix.end));
        addParam(j, parameterOn(b1, b2, ix.start));
        addParam(j, parameterOn(b1, b2, ix.end));
      } else {
        addParam(i, ix.t1);
        addParam(j, ix.t2);
      }
    }
  }
  if (!hasCrossing) return [poly];

  type GraphNode = { point: Point2D; outgoing: number[] };
  type DirectedEdge = { from: number; to: number; twin: number };
  const nodes: GraphNode[] = [];
  const nodeByKey = new Map<string, number>();
  const edges: DirectedEdge[] = [];
  const epsilon = Math.max(Math.abs(tol), Number.EPSILON * 64);
  const nodeFor = (point: Point2D): number => {
    const key = `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}`;
    const existing = nodeByKey.get(key);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push({ point, outgoing: [] });
    nodeByKey.set(key, index);
    return index;
  };
  const addUndirectedEdge = (from: number, to: number) => {
    if (from === to) return;
    const duplicate = nodes[from]!.outgoing.some((edgeId) => edges[edgeId]!.to === to);
    if (duplicate) return;
    const forward = edges.length;
    const reverse = forward + 1;
    edges.push({ from, to, twin: reverse }, { from: to, to: from, twin: forward });
    nodes[from]!.outgoing.push(forward);
    nodes[to]!.outgoing.push(reverse);
  };

  for (let i = 0; i < m; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % m]!;
    const params = [...splitParams[i]!].sort((x, y) => x - y);
    for (let j = 0; j + 1 < params.length; j++) {
      const t0 = params[j]!;
      const t1 = params[j + 1]!;
      const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      addUndirectedEdge(nodeFor(p0), nodeFor(p1));
    }
  }

  for (const node of nodes) {
    node.outgoing.sort((left, right) => {
      const a = edges[left]!;
      const b = edges[right]!;
      const pa = nodes[a.to]!.point;
      const pb = nodes[b.to]!.point;
      const origin = node.point;
      return (
        Math.atan2(pa.y - origin.y, pa.x - origin.x) - Math.atan2(pb.y - origin.y, pb.x - origin.x)
      );
    });
  }

  const nextEdge = (edgeId: number): number => {
    const edge = edges[edgeId]!;
    const outgoing = nodes[edge.to]!.outgoing;
    const twinIndex = outgoing.indexOf(edge.twin);
    return outgoing[(twinIndex - 1 + outgoing.length) % outgoing.length]!;
  };
  const visited = new Set<number>();
  const faces: Point2D[][] = [];
  const seenFaces = new Set<string>();
  const canonicalFaceKey = (face: Point2D[]): string => {
    const keys = face.map((p) => `${Math.round(p.x / epsilon)}:${Math.round(p.y / epsilon)}`);
    let best = '';
    for (let i = 0; i < keys.length; i++) {
      const rotated = [...keys.slice(i), ...keys.slice(0, i)].join(';');
      if (!best || rotated < best) best = rotated;
    }
    return best;
  };

  for (let start = 0; start < edges.length; start++) {
    if (visited.has(start)) continue;
    const face: Point2D[] = [];
    let edgeId = start;
    let closed = false;
    for (let guard = 0; guard <= edges.length + 1; guard++) {
      if (visited.has(edgeId)) {
        closed = edgeId === start;
        break;
      }
      visited.add(edgeId);
      const edge = edges[edgeId]!;
      face.push(nodes[edge.from]!.point);
      edgeId = nextEdge(edgeId);
    }
    if (!closed || face.length < 3) continue;
    let area = 0;
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!;
      const b = face[(i + 1) % face.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    // The clockwise cycles bound the unbounded exterior. Keep bounded faces;
    // their orientation is normalized by the clipping adapter downstream.
    if (area <= epsilon * epsilon) continue;
    const key = canonicalFaceKey(face);
    if (!seenFaces.has(key)) {
      seenFaces.add(key);
      faces.push(face);
    }
  }

  return faces.length > 0 ? faces : [poly];
}
