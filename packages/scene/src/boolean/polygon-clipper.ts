// Deterministic polygon clipping adapter.
//
// `polygon-clipping` is a synchronous Martinez-Rueda-Feito implementation.
// Keeping the adapter synchronous is intentional: editor commands are atomic
// document mutations and must never optimistically replace operands with an
// empty result while a geometry module is still loading.

import * as polygonClipping from 'polygon-clipping';
import type { FillRule, Point2D, Region2D } from './region';
import { pointInRegion, signedArea } from './region';
import { hasSelfIntersections, resolveSelfIntersections } from './self-intersection';

export { hasSelfIntersections, resolveSelfIntersections } from './self-intersection';

export type BooleanOpType = 'union' | 'subtract' | 'intersect' | 'exclude';

type Pair = [number, number];
type Ring = Pair[];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

/** One disconnected filled component and its directly attached holes. */
export interface RegionComponent {
  outer: Point2D[];
  holes: Point2D[][];
}

/** Geometry as expected by the Boolean kernel. */
export interface ClipperRegion {
  components: RegionComponent[];
  fillRule: FillRule;
}

function isFinitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointsEqual(a: Point2D, b: Point2D, tolerance: number): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

/**
 * Remove only redundant vertices. It intentionally never performs a global
 * simplification, because tiny but intentional artwork is valid geometry.
 */
export function cleanupPolygon(points: Point2D[], tolerance: number): Point2D[] {
  const finite = points.filter(isFinitePoint);
  if (finite.length < 3) return [];

  const open = pointsEqual(finite[0]!, finite[finite.length - 1]!, tolerance)
    ? finite.slice(0, -1)
    : finite;
  if (open.length < 3) return [];

  const deduped: Point2D[] = [];
  for (const point of open) {
    if (!deduped.length || !pointsEqual(point, deduped[deduped.length - 1]!, tolerance)) {
      deduped.push(point);
    }
  }
  if (deduped.length > 1 && pointsEqual(deduped[0]!, deduped[deduped.length - 1]!, tolerance)) {
    deduped.pop();
  }
  if (deduped.length < 3) return [];

  // A point is removable only when it lies within the linear tolerance of
  // its neighbours. This keeps legitimate narrow corners at every scale.
  const cleaned: Point2D[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const prev = deduped[(i - 1 + deduped.length) % deduped.length]!;
    const curr = deduped[i]!;
    const next = deduped[(i + 1) % deduped.length]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const base = Math.hypot(dx, dy);
    const distance =
      base === 0
        ? Math.hypot(curr.x - prev.x, curr.y - prev.y)
        : Math.abs(dx * (prev.y - curr.y) - (prev.x - curr.x) * dy) / base;
    if (base === 0 || distance > tolerance) cleaned.push(curr);
  }
  return cleaned.length >= 3 ? cleaned : [];
}

/** Remove only components below the numeric area floor, never an arbitrary world-unit floor. */
export function removeSlivers(contours: Point2D[][], tolerance: number): Point2D[][] {
  const numericAreaFloor = tolerance * tolerance;
  return contours.filter((contour) => Math.abs(signedArea(contour)) > numericAreaFloor);
}

function closeRing(points: Point2D[]): Ring {
  const ring = points.map((point): Pair => [point.x, point.y]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first]);
  return ring;
}

function openRing(ring: Ring, tolerance: number): Point2D[] {
  const points = ring.map(([x, y]) => ({ x, y }));
  return cleanupPolygon(points, tolerance);
}

function orient(points: Point2D[], ccw: boolean): Point2D[] {
  const area = signedArea(points);
  if ((ccw && area < 0) || (!ccw && area > 0)) return [...points].reverse();
  return points;
}

function componentToPolygon(component: RegionComponent): Polygon | null {
  if (component.outer.length < 3) return null;
  const polygon: Polygon = [closeRing(orient(component.outer, true))];
  for (const hole of component.holes) {
    if (hole.length >= 3) polygon.push(closeRing(orient(hole, false)));
  }
  return polygon;
}

function regionToGeometry(region: ClipperRegion): MultiPolygon {
  const result: MultiPolygon = [];
  for (const component of region.components) {
    const polygon = componentToPolygon(component);
    if (polygon) result.push(polygon);
  }
  return result;
}

function multiPolygonToRegion(
  multiPolygon: MultiPolygon,
  fillRule: FillRule,
  tolerance: number,
): ClipperRegion {
  const components: RegionComponent[] = [];
  for (const polygon of multiPolygon) {
    const outer = polygon[0] ? openRing(polygon[0], tolerance) : [];
    if (outer.length < 3) continue;
    const holes = polygon
      .slice(1)
      .map((ring) => openRing(ring, tolerance))
      .filter((ring) => ring.length >= 3)
      .map((ring) => orient(ring, false));
    components.push({ outer: orient(outer, true), holes });
  }
  return { components, fillRule };
}

function resolveComponent(component: RegionComponent, tolerance: number): RegionComponent[] {
  const outer = cleanupPolygon(component.outer, tolerance);
  if (outer.length < 3) return [];
  const outerParts = hasSelfIntersections(outer, tolerance)
    ? resolveSelfIntersections(outer, tolerance)
    : [outer];
  const holes = component.holes
    .map((hole) => cleanupPolygon(hole, tolerance))
    .filter((hole) => hole.length >= 3 && !hasSelfIntersections(hole, tolerance));
  return outerParts
    .map((part) => ({ outer: orient(part, true), holes }))
    .filter((part) => Math.abs(signedArea(part.outer)) > tolerance * tolerance);
}

/** Canonicalize a public Region2D into component-aware kernel geometry. */
export function regionFromFlat(region: Region2D, tolerance: number): ClipperRegion {
  // Older callers expose flat outer/hole lists. Recover ownership by assigning
  // a hole only to an outer that contains it; duplicating every hole onto every
  // island would invert unrelated components during a Boolean operation.
  const components = region.contours.flatMap((outer) =>
    resolveComponent(
      {
        outer,
        holes: region.holes.filter((hole) =>
          hole[0] ? pointInRegion(hole[0], outer, 'evenodd') : false,
        ),
      },
      tolerance,
    ),
  );
  return { components, fillRule: region.fillRule };
}

/** Flatten a kernel result for existing Varve compound-path consumers. */
export function regionToFlat(region: ClipperRegion): Region2D {
  return {
    contours: region.components.map((component) => component.outer),
    holes: region.components.flatMap((component) => component.holes),
    fillRule: region.fillRule,
  };
}

/**
 * Run an N-ary Boolean operation. `exclude` is parity/XOR across all operands;
 * `subtract` is base minus the union of all following operands.
 */
export function clipRegions(
  regions: ClipperRegion[],
  operation: BooleanOpType,
  tolerance: number,
): ClipperRegion {
  const geometries = regions.map(regionToGeometry).filter((geometry) => geometry.length > 0);
  const fillRule: FillRule = 'evenodd';
  if (!geometries.length) return { components: [], fillRule };

  let result: MultiPolygon;
  switch (operation) {
    case 'union':
      result = polygonClipping.union(geometries[0]!, ...geometries.slice(1));
      break;
    case 'intersect':
      result = polygonClipping.intersection(geometries[0]!, ...geometries.slice(1));
      break;
    case 'subtract':
      result =
        geometries.length === 1
          ? geometries[0]!
          : polygonClipping.difference(geometries[0]!, ...geometries.slice(1));
      break;
    case 'exclude':
      result = polygonClipping.xor(geometries[0]!, ...geometries.slice(1));
      break;
  }
  return multiPolygonToRegion(result, fillRule, tolerance);
}

/** Compatibility helper for the former two-polygon kernel. */
export function clipPolygonsSync(
  subject: Point2D[],
  clip: Point2D[],
  operation: BooleanOpType,
  tolerance: number,
): Region2D {
  const result = clipRegions(
    [
      { components: [{ outer: subject, holes: [] }], fillRule: 'evenodd' },
      { components: [{ outer: clip, holes: [] }], fillRule: 'evenodd' },
    ],
    operation,
    tolerance,
  );
  return regionToFlat(result);
}

/** Async compatibility wrapper; loading is intentionally no longer deferred. */
export async function clipPolygons(
  subject: Point2D[],
  clip: Point2D[],
  operation: BooleanOpType,
  tolerance: number,
): Promise<Region2D> {
  return clipPolygonsSync(subject, clip, operation, tolerance);
}

/** Kept for callers that previously awaited a dynamic preload. */
export async function preloadClipper(): Promise<void> {
  // The static import above guarantees the kernel is ready before any command.
}

export function unionRegions(a: Region2D, b: Region2D): Region2D {
  const tolerance = 1e-12;
  return regionToFlat(
    clipRegions([regionFromFlat(a, tolerance), regionFromFlat(b, tolerance)], 'union', tolerance),
  );
}
