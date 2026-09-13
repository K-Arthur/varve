/**
 * Canonical, frontend-independent path editing primitives.
 *
 * The scene model still carries `points` for compatibility, while compound
 * paths may also expose `contours` and `holes`.  These helpers read all rings
 * through one boundary and write every representation that was present on the
 * input shape, preventing a node gesture from updating only the legacy ring.
 */

import type { PathNodeMode, PathPoint } from './bezier';
import { cubicBezierDerivative, cubicBezierSplit, pointToPointDist } from './bezier';
import { deleteMultipleAnchors, nearestPointOnPath, segmentToCubic } from './bezierPathOps';

export type { PathNodeMode } from './bezier';

export interface EditablePathShape {
  points: PathPoint[];
  closed: boolean;
  contours?: PathPoint[][];
  holes?: PathPoint[][];
}

export interface PathIndexLocation {
  ringIndex: number;
  pointIndex: number;
  globalIndex: number;
}

export interface InsertedPathPoint<T extends EditablePathShape> {
  shape: T;
  insertedIndex: number;
}

/** Return a defensive ring view with the legacy aliases reconciled. */
export function pathRings(shape: EditablePathShape): PathPoint[][] {
  if (shape.contours && shape.contours.length > 0) {
    return shape.contours.map((ring) => ring.map(copyPoint));
  }
  return [shape.points.map(copyPoint), ...(shape.holes ?? []).map((ring) => ring.map(copyPoint))];
}

/** Write rings while preserving which compatibility fields the shape used. */
export function withPathRings<T extends EditablePathShape>(shape: T, rings: PathPoint[][]): T {
  const next: EditablePathShape = {
    ...shape,
    points: rings[0] ?? [],
  };
  if (shape.contours !== undefined) next.contours = rings;
  if (shape.holes !== undefined) next.holes = rings.slice(1);
  return next as T;
}

export function copyPoint(point: PathPoint): PathPoint {
  return {
    ...point,
    handleIn: point.handleIn ? ([...point.handleIn] as [number, number]) : null,
    handleOut: point.handleOut ? ([...point.handleOut] as [number, number]) : null,
    tilt: point.tilt ? { ...point.tilt } : point.tilt,
  };
}

export function isFinitePathPoint(point: PathPoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    (!point.handleIn || point.handleIn.every(Number.isFinite)) &&
    (!point.handleOut || point.handleOut.every(Number.isFinite)) &&
    (point.pressure === undefined || Number.isFinite(point.pressure)) &&
    (!point.tilt || (Number.isFinite(point.tilt.x) && Number.isFinite(point.tilt.y)))
  );
}

export function areFinitePathRings(rings: readonly (readonly PathPoint[])[]): boolean {
  return rings.every((ring) => ring.every(isFinitePathPoint));
}

export function locatePathIndex(
  rings: readonly (readonly PathPoint[])[],
  globalIndex: number,
): PathIndexLocation | null {
  if (!Number.isInteger(globalIndex) || globalIndex < 0) return null;
  let offset = 0;
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex]!;
    if (globalIndex < offset + ring.length) {
      return { ringIndex, pointIndex: globalIndex - offset, globalIndex };
    }
    offset += ring.length;
  }
  return null;
}

export function globalIndexForLocation(
  rings: readonly (readonly PathPoint[])[],
  ringIndex: number,
  pointIndex: number,
): number | null {
  if (ringIndex < 0 || pointIndex < 0 || ringIndex >= rings.length) return null;
  let offset = 0;
  for (let i = 0; i < ringIndex; i++) offset += rings[i]!.length;
  if (pointIndex >= rings[ringIndex]!.length) return null;
  return offset + pointIndex;
}

export function pathPointAtIndex(
  rings: readonly (readonly PathPoint[])[],
  globalIndex: number,
): PathPoint | null {
  const location = locatePathIndex(rings, globalIndex);
  return location ? (rings[location.ringIndex]![location.pointIndex] ?? null) : null;
}

/** Move anchors in all authored rings. Handle vectors intentionally do not move. */
export function translateSelectedAnchors<T extends EditablePathShape>(
  shape: T,
  selected: ReadonlySet<number>,
  delta: readonly [number, number],
): T {
  if (!Number.isFinite(delta[0]) || !Number.isFinite(delta[1]) || selected.size === 0) return shape;
  const rings = pathRings(shape);
  let offset = 0;
  const moved = rings.map((ring) => {
    const next = ring.map((point, index) =>
      selected.has(offset + index)
        ? { ...point, x: point.x + delta[0], y: point.y + delta[1] }
        : point,
    );
    offset += ring.length;
    return next;
  });
  return withPathRings(shape, moved);
}

export function updatePathPointAtIndex<T extends EditablePathShape>(
  shape: T,
  globalIndex: number,
  update: (point: PathPoint, location: PathIndexLocation, ring: readonly PathPoint[]) => PathPoint,
): T {
  const rings = pathRings(shape);
  const location = locatePathIndex(rings, globalIndex);
  if (!location) return shape;
  const updated = rings.map((ring, ringIndex) =>
    ring.map((point, pointIndex) =>
      ringIndex === location.ringIndex && pointIndex === location.pointIndex
        ? update(point, location, ring)
        : point,
    ),
  );
  return withPathRings(shape, updated);
}

export function remapSelectionAfterInsertion(
  selected: ReadonlySet<number>,
  insertedIndex: number,
): Set<number> {
  return new Set([...selected].map((index) => (index >= insertedIndex ? index + 1 : index)));
}

export function remapSelectionAfterDeletion(
  selected: ReadonlySet<number>,
  deleted: ReadonlySet<number>,
): Set<number> {
  const ordered = [...deleted].sort((a, b) => a - b);
  const next = new Set<number>();
  for (const index of selected) {
    if (deleted.has(index)) continue;
    let before = 0;
    for (const removed of ordered) {
      if (removed >= index) break;
      before++;
    }
    next.add(index - before);
  }
  return next;
}

export function remapSelectionAfterRingReverse(
  selected: ReadonlySet<number>,
  rings: readonly (readonly PathPoint[])[],
): Set<number> {
  const next = new Set<number>();
  for (const index of selected) {
    const location = locatePathIndex(rings, index);
    if (!location) continue;
    const remapped = globalIndexForLocation(
      rings,
      location.ringIndex,
      rings[location.ringIndex]!.length - 1 - location.pointIndex,
    );
    if (remapped !== null) next.add(remapped);
  }
  return next;
}

function vectorLength(vector: readonly [number, number] | null): number {
  return vector ? Math.hypot(vector[0], vector[1]) : 0;
}

function unit(vector: readonly [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1]);
  return length > 1e-9 ? [vector[0] / length, vector[1] / length] : [1, 0];
}

function chordDirection(from: PathPoint, to: PathPoint): [number, number] {
  return unit([to.x - from.x, to.y - from.y]);
}

function neighbors(
  ring: readonly PathPoint[],
  index: number,
  closed: boolean,
): { prev: PathPoint | null; next: PathPoint | null } {
  const prev = index > 0 ? ring[index - 1]! : closed && ring.length > 1 ? ring.at(-1)! : null;
  const next =
    index + 1 < ring.length ? ring[index + 1]! : closed && ring.length > 1 ? ring[0]! : null;
  return { prev, next };
}

function defaultHandleLength(ring: readonly PathPoint[], index: number, closed: boolean): number {
  const { prev, next } = neighbors(ring, index, closed);
  const lengths = [
    prev ? pointToPointDist(ring[index]!, prev) : Infinity,
    next ? pointToPointDist(ring[index]!, next) : Infinity,
  ].filter(Number.isFinite);
  return lengths.length > 0 ? Math.max(1e-6, Math.min(...lengths) / 3) : 0;
}

function tangentDirection(
  point: PathPoint,
  ring: readonly PathPoint[],
  index: number,
  closed: boolean,
): [number, number] {
  const { prev, next } = neighbors(ring, index, closed);
  if (point.handleOut && vectorLength(point.handleOut) > 1e-9) return unit(point.handleOut);
  if (point.handleIn && vectorLength(point.handleIn) > 1e-9) {
    return unit([-point.handleIn[0], -point.handleIn[1]]);
  }
  if (prev && next) return unit([next.x - prev.x, next.y - prev.y]);
  if (next) return chordDirection(point, next);
  if (prev) return chordDirection(prev, point);
  return [1, 0];
}

function automaticPoint(
  point: PathPoint,
  ring: readonly PathPoint[],
  index: number,
  closed: boolean,
): PathPoint {
  const { prev, next } = neighbors(ring, index, closed);
  const tangent: [number, number] =
    prev && next
      ? unit([next.x - prev.x, next.y - prev.y])
      : next
        ? chordDirection(point, next)
        : prev
          ? chordDirection(prev, point)
          : [1, 0];
  const length = defaultHandleLength(ring, index, closed);
  const handleIn = prev ? ([-tangent[0] * length, -tangent[1] * length] as [number, number]) : null;
  const handleOut = next ? ([tangent[0] * length, tangent[1] * length] as [number, number]) : null;
  return { ...point, handleIn, handleOut, mode: 'automatic' };
}

/** Infer the visible mode for legacy points that have no explicit mode. */
export function nodeModeForPoint(
  point: PathPoint,
  tolerance = 1e-4,
): Exclude<PathNodeMode, 'automatic'> | 'automatic' {
  if (point.mode) return point.mode;
  const inLength = vectorLength(point.handleIn);
  const outLength = vectorLength(point.handleOut);
  if (inLength <= 1e-9 || outLength <= 1e-9) return 'corner';
  const cross = point.handleIn![0] * point.handleOut![1] - point.handleIn![1] * point.handleOut![0];
  const dot = point.handleIn![0] * point.handleOut![0] + point.handleIn![1] * point.handleOut![1];
  if (Math.abs(cross) / (inLength * outLength) > tolerance || dot >= 0) return 'corner';
  return Math.abs(inLength - outLength) / Math.max(inLength, outLength) <= tolerance
    ? 'symmetric'
    : 'smooth';
}

/** Apply one of the four documented node behaviours to a ring. */
export function setNodeMode(
  ring: readonly PathPoint[],
  index: number,
  mode: PathNodeMode,
  closed: boolean,
): PathPoint[] {
  if (index < 0 || index >= ring.length) return ring.map(copyPoint);
  const next = ring.map(copyPoint);
  const point = next[index]!;
  if (mode === 'corner') {
    next[index] = { ...point, mode };
    return next;
  }
  if (mode === 'automatic') {
    next[index] = automaticPoint(point, next, index, closed);
    return next;
  }

  const { prev, next: following } = neighbors(next, index, closed);
  const tangent = tangentDirection(point, next, index, closed);
  const fallbackLength = defaultHandleLength(next, index, closed);
  const inLength = vectorLength(point.handleIn) || fallbackLength;
  const outLength = vectorLength(point.handleOut) || fallbackLength;
  const symmetricLength = (inLength + outLength) / 2 || fallbackLength;
  const inVector = prev
    ? ([
        -tangent[0] * (mode === 'symmetric' ? symmetricLength : inLength),
        -tangent[1] * (mode === 'symmetric' ? symmetricLength : inLength),
      ] as [number, number])
    : null;
  const outVector = following
    ? ([
        tangent[0] * (mode === 'symmetric' ? symmetricLength : outLength),
        tangent[1] * (mode === 'symmetric' ? symmetricLength : outLength),
      ] as [number, number])
    : null;
  next[index] = { ...point, handleIn: inVector, handleOut: outVector, mode };
  return next;
}

export function setNodeModeAtIndex<T extends EditablePathShape>(
  shape: T,
  globalIndex: number,
  mode: PathNodeMode,
): T {
  const rings = pathRings(shape);
  const location = locatePathIndex(rings, globalIndex);
  if (!location) return shape;
  rings[location.ringIndex] = setNodeMode(
    rings[location.ringIndex]!,
    location.pointIndex,
    mode,
    shape.closed,
  );
  return withPathRings(shape, rings);
}

export function reversePathShape<T extends EditablePathShape>(shape: T): T {
  const rings = pathRings(shape).map((ring) =>
    [...ring].reverse().map((point) => ({
      ...point,
      handleIn: point.handleOut ? ([...point.handleOut] as [number, number]) : null,
      handleOut: point.handleIn ? ([...point.handleIn] as [number, number]) : null,
    })),
  );
  return withPathRings(shape, rings);
}

function splitRingSegment(
  points: readonly PathPoint[],
  segmentIndex: number,
  t: number,
  closed: boolean,
): { points: PathPoint[]; insertedIndex: number } | null {
  if (points.length < 2 || !Number.isFinite(t)) return null;
  const maxSegment = closed ? points.length - 1 : points.length - 2;
  if (segmentIndex < 0 || segmentIndex > maxSegment) return null;
  const fromIndex = segmentIndex;
  const toIndex = segmentIndex === points.length - 1 ? 0 : segmentIndex + 1;
  const from = points[fromIndex]!;
  const to = points[toIndex]!;
  if (!isFinitePathPoint(from) || !isFinitePathPoint(to)) return null;
  const [left, right] = cubicBezierSplit(segmentToCubic(from, to), Math.max(0, Math.min(1, t)));
  const inserted: PathPoint = {
    x: left.p3.x,
    y: left.p3.y,
    handleIn: [left.p2.x - left.p3.x, left.p2.y - left.p3.y],
    handleOut: [right.p1.x - right.p0.x, right.p1.y - right.p0.y],
    mode: 'smooth',
  };
  if (segmentIndex === points.length - 1) {
    const result = points.map(copyPoint);
    result[fromIndex] = {
      ...result[fromIndex]!,
      handleOut: [left.p1.x - left.p0.x, left.p1.y - left.p0.y],
    };
    result[toIndex] = {
      ...result[toIndex]!,
      handleIn: [right.p2.x - right.p3.x, right.p2.y - right.p3.y],
    };
    result.push(inserted);
    return { points: result, insertedIndex: result.length - 1 };
  }
  const result = points.map(copyPoint);
  result[fromIndex] = {
    ...result[fromIndex]!,
    handleOut: [left.p1.x - left.p0.x, left.p1.y - left.p0.y],
  };
  result[toIndex] = {
    ...result[toIndex]!,
    handleIn: [right.p2.x - right.p3.x, right.p2.y - right.p3.y],
  };
  result.splice(toIndex, 0, inserted);
  return { points: result, insertedIndex: toIndex };
}

/** Insert on any ring, including the closing segment of a closed contour. */
export function insertPointOnPath<T extends EditablePathShape>(
  shape: T,
  ringIndex: number,
  segmentIndex: number,
  t: number,
): InsertedPathPoint<T> | null {
  const rings = pathRings(shape);
  const ring = rings[ringIndex];
  if (!ring) return null;
  const split = splitRingSegment(ring, segmentIndex, t, shape.closed);
  if (!split) return null;
  rings[ringIndex] = split.points;
  const offset = rings.slice(0, ringIndex).reduce((sum, current) => sum + current.length, 0);
  return {
    shape: withPathRings(shape, rings),
    insertedIndex: offset + split.insertedIndex,
  };
}

/**
 * Delete selected anchors across all rings. A selected hole may disappear as
 * a contour; the outer ring must retain the minimum topology for its open or
 * closed state. Returns an explicit selection remap for surviving anchors.
 */
export function deleteSelectedAnchorsFromPath<T extends EditablePathShape>(
  shape: T,
  selected: ReadonlySet<number>,
): { shape: T; selection: Set<number> } | null {
  if (selected.size === 0) return null;
  const rings = pathRings(shape);
  const locations = new Map<number, Set<number>>();
  for (const globalIndex of selected) {
    const location = locatePathIndex(rings, globalIndex);
    if (!location) continue;
    const indexes = locations.get(location.ringIndex) ?? new Set<number>();
    indexes.add(location.pointIndex);
    locations.set(location.ringIndex, indexes);
  }
  if (locations.size === 0) return null;

  const nextRings: PathPoint[][] = [];
  const oldToNew = new Map<number, number>();
  let oldOffset = 0;
  let newOffset = 0;
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex]!;
    const remove = locations.get(ringIndex) ?? new Set<number>();
    if (ringIndex === 0) {
      const remaining = ring.length - remove.size;
      const minimum = shape.closed ? 3 : 2;
      if (remaining < minimum) return null;
    }
    if (ringIndex > 0 && remove.size >= ring.length) {
      oldOffset += ring.length;
      continue;
    }
    const next = deleteMultipleAnchors(ring, remove, shape.closed || ringIndex > 0);
    if (!next) return null;
    // Rebuild the local map without relying on the global map size, which also
    // contains preceding rings.
    let kept = 0;
    for (let index = 0; index < ring.length; index++) {
      if (!remove.has(index)) oldToNew.set(oldOffset + index, newOffset + kept++);
    }
    nextRings.push(next);
    oldOffset += ring.length;
    newOffset += next.length;
  }

  const selection = new Set<number>();
  for (const index of selected) {
    const mapped = oldToNew.get(index);
    if (mapped !== undefined) selection.add(mapped);
  }
  return { shape: withPathRings(shape, nextRings), selection };
}

/** Return a nearest segment in document-local coordinates, safely. */
export function nearestEditableSegment(
  ring: readonly PathPoint[],
  closed: boolean,
  query: { x: number; y: number },
): { segmentIndex: number; t: number; point: { x: number; y: number }; dist: number } | null {
  if (!Number.isFinite(query.x) || !Number.isFinite(query.y) || !areFinitePathRings([ring]))
    return null;
  return nearestPointOnPath(ring, closed, query);
}

/** Bend one segment while keeping both anchors fixed. */
export function bendPathSegment<T extends EditablePathShape>(
  shape: T,
  ringIndex: number,
  segmentIndex: number,
  offset: readonly [number, number],
): T {
  if (!Number.isFinite(offset[0]) || !Number.isFinite(offset[1])) return shape;
  const rings = pathRings(shape);
  const ring = rings[ringIndex];
  if (!ring || ring.length < 2) return shape;
  const last = shape.closed ? ring.length - 1 : ring.length - 2;
  if (segmentIndex < 0 || segmentIndex > last) return shape;
  const fromIndex = segmentIndex;
  const toIndex = segmentIndex === ring.length - 1 ? 0 : segmentIndex + 1;
  const from = ring[fromIndex]!;
  const to = ring[toIndex]!;
  const cubic = segmentToCubic(from, to);
  const tangent = cubicBezierDerivative(cubic, 0.5);
  const normal = unit([-tangent.y, tangent.x]);
  const amount = offset[0] * normal[0] + offset[1] * normal[1];
  const chord = pointToPointDist(from, to);
  const handleLength = Math.max(0, chord / 3 + amount);
  const along = unit([to.x - from.x, to.y - from.y]);
  const next = ring.map(copyPoint);
  next[fromIndex] = {
    ...next[fromIndex]!,
    handleOut: [along[0] * handleLength, along[1] * handleLength],
    mode: 'corner',
  };
  next[toIndex] = {
    ...next[toIndex]!,
    handleIn: [-along[0] * handleLength, -along[1] * handleLength],
    mode: 'corner',
  };
  rings[ringIndex] = next;
  return withPathRings(shape, rings);
}
