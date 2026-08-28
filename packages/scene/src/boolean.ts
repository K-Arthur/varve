// COMPLEXITY: 10 — thin re-exports from boolean/ module.
// This file preserves backward compatibility for all existing callers.

export type { BooleanOpType as BooleanOpKind } from './boolean/engine';
export {
  booleanAnchorForNode,
  booleanOp,
  placeBooleanResult,
  shapeNodesInWorldSpace,
  shapeToPolygon,
  shapeToRegion,
} from './boolean/integration';
export {
  cleanupPolygon as cleanPolygon,
  hasSelfIntersections,
  preloadClipper,
  resolveSelfIntersections,
} from './boolean/polygon-clipper';
export { segmentIntersectionRobust as segmentIntersection } from './boolean/precision';
export type { Point2D } from './boolean/region';
export { pointInRegion as pointInPolygon } from './boolean/region';
