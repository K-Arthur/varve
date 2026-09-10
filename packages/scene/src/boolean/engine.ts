// Boolean geometry engine public API.
//
// All four operations resolve through one deterministic polygon kernel. The
// kernel accepts compound regions, preserves component/hole ownership, and is
// executed in a normalized working frame by `booleanNormalizedRegions`.

import {
  type BooleanOpType,
  type ClipperRegion,
  clipRegions,
  type RegionComponent,
  regionFromFlat,
  regionToFlat,
} from './polygon-clipper';
import { normalizeToOrigin, translatePolygon, workingTolerance } from './precision';
import type { FillRule, Point2D, Region2D } from './region';
import { emptyRegion, singleContour } from './region';

export type { RegionComponent } from './polygon-clipper';
export type { BooleanOpType };

export interface BooleanResult {
  /** Disconnected result components, preserving hole ownership. */
  components: RegionComponent[];
  /** Outer contours for compatibility with existing consumers. */
  outerContours: Point2D[][];
  /** Hole contours for compatibility with existing consumers. */
  holes: Point2D[][];
  /** Results use even-odd so all contour nesting is faithfully representable. */
  fillRule: FillRule;
}

function resultFromRegion(region: ClipperRegion): BooleanResult {
  const flat = regionToFlat(region);
  return {
    components: region.components,
    outerContours: flat.contours,
    holes: flat.holes,
    fillRule: flat.fillRule,
  };
}

function emptyResult(fillRule: FillRule = 'evenodd'): BooleanResult {
  return { components: [], outerContours: [], holes: [], fillRule };
}

/** Convert a BooleanResult to a flat list of contours with hole flags. */
export function resultContours(result: BooleanResult): { pts: Point2D[]; isHole: boolean }[] {
  return result.components.flatMap((component) => [
    { pts: component.outer, isHole: false },
    ...component.holes.map((pts) => ({ pts, isHole: true })),
  ]);
}

/** Convert a BooleanResult to Varve's compatibility Region2D shape. */
export function resultToRegion(result: BooleanResult): Region2D {
  return {
    contours: result.outerContours,
    holes: result.holes,
    fillRule: result.fillRule,
  };
}

/** Perform a Boolean operation on two simple polygons. */
export function booleanTwoPolygons(
  subject: Point2D[],
  clip: Point2D[],
  operation: BooleanOpType,
  fillRule: FillRule = 'evenodd',
): BooleanResult {
  return booleanNary([subject, clip], operation, fillRule);
}

/**
 * N-ary Boolean operation on simple closed polygons.
 *
 * - union: union of all operands
 * - subtract: first/base operand minus the union of the remaining operands
 * - intersect: intersection of every operand
 * - exclude: odd-parity symmetric difference across all operands
 */
export function booleanNary(
  polygons: Point2D[][],
  operation: BooleanOpType,
  fillRule: FillRule = 'evenodd',
): BooleanResult {
  const regions = polygons.map((polygon) => singleContour(polygon, fillRule));
  return booleanRegions(regions, operation);
}

/** Perform an N-ary Boolean operation on compound input regions. */
export function booleanRegions(regions: Region2D[], operation: BooleanOpType): BooleanResult {
  const valid = regions.filter((region) => region.contours.some((contour) => contour.length >= 3));
  if (!valid.length) return emptyResult();
  const tolerance = workingTolerance(
    valid.flatMap((region) => [...region.contours, ...region.holes]),
  );
  const kernelRegions = valid.map((region) => regionFromFlat(region, tolerance));
  return resultFromRegion(clipRegions(kernelRegions, operation, tolerance));
}

/**
 * Normalized N-ary operation on simple polygons. Translating around the
 * operation bounds means a document positioned at +/- 1e6 produces the same
 * topology as one at the origin.
 */
export function booleanNormalized(
  polygons: Point2D[][],
  operation: BooleanOpType,
  fillRule: FillRule = 'evenodd',
): BooleanResult {
  if (!polygons.length) return emptyResult(fillRule);
  const { normalized, offset } = normalizeToOrigin(polygons);
  const result = booleanNary(normalized, operation, fillRule);
  return translateResult(result, offset);
}

/** Normalized N-ary operation on compound regions. */
export function booleanNormalizedRegions(
  regions: Region2D[],
  operation: BooleanOpType,
): BooleanResult {
  const allContours = regions.flatMap((region) => [...region.contours, ...region.holes]);
  if (!allContours.length) return emptyResult();
  const { normalized, offset } = normalizeToOrigin(allContours);
  let cursor = 0;
  const normalizedRegions = regions.map((region) => {
    const contours = normalized.slice(cursor, cursor + region.contours.length);
    cursor += region.contours.length;
    const holes = normalized.slice(cursor, cursor + region.holes.length);
    cursor += region.holes.length;
    return { contours, holes, fillRule: region.fillRule };
  });
  return translateResult(booleanRegions(normalizedRegions, operation), offset);
}

function translateResult(result: BooleanResult, offset: Point2D): BooleanResult {
  const components = result.components.map((component) => ({
    outer: translatePolygon(component.outer, offset),
    holes: component.holes.map((hole) => translatePolygon(hole, offset)),
  }));
  return {
    components,
    outerContours: components.map((component) => component.outer),
    holes: components.flatMap((component) => component.holes),
    fillRule: result.fillRule,
  };
}

export { emptyRegion };
