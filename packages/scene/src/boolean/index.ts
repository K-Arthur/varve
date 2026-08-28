// Boolean geometry system — barrel exports.
//
// This module replaces the legacy boolean-geometry.ts + boolean-ops.ts
// with a new implementation that supports:
//   - Compound paths with holes
//   - All four boolean operations (union, subtract, intersect, exclude)
//   - Scale-aware precision (no absolute epsilons)
//   - N-ary operations
//   - Multiple disconnected output contours
//   - Containment without intersections
//   - Self-intersection handling
//   - Coordinate normalization

// Boolean engine (compound regions, N-ary operations)
export type { BooleanResult } from './engine';
export {
  booleanNary,
  booleanNormalized,
  booleanNormalizedRegions,
  booleanRegions,
  booleanTwoPolygons,
  resultContours,
  resultToRegion,
} from './engine';
// Scene model integration
export {
  booleanAnchorForNode,
  booleanOp,
  placeBooleanResult,
  shapeHolesToPolygons,
  shapeNodesInWorldSpace,
  shapeToPolygon,
  shapeToRegion,
} from './integration';
// Polygon clipping (backed by polygon-clipping library)
export type { BooleanOpType } from './polygon-clipper';
export {
  cleanupPolygon,
  hasSelfIntersections,
  preloadClipper,
  removeSlivers,
  resolveSelfIntersections,
} from './polygon-clipper';
// Precision policy
export type { AABB } from './precision';
export {
  aabbDiagonal,
  clusterIntersections,
  computeAABB,
  isCollinear,
  mergeAABB,
  normalizeToOrigin,
  orient2d,
  pointsEqual,
  segmentIntersectionRobust,
  toleranceForScale,
  translatePolygon,
  workingTolerance,
} from './precision';
// Core region model
export type { FillRule, Point2D, Region2D } from './region';
export {
  buildRegion,
  cross,
  emptyRegion,
  flattenRegion,
  isContourInside,
  isEmptyRegion,
  pointInCompoundPath,
  pointInRegion,
  regionArea,
  regionToPathData,
  signedArea,
  singleContour,
  windingNumber,
} from './region';
