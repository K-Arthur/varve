// COMPLEXITY: 10 — thin re-exports from boolean-geometry and boolean-ops.

export {
  cleanPolygon,
  hasSelfIntersections,
  pointInPolygon,
  resolveSelfIntersections,
  segmentIntersection,
  shapeToPolygon,
} from './boolean-geometry';
export type { BooleanOpKind, Point2D } from './boolean-ops';
export {
  booleanAnchorForNode,
  booleanOp,
  placeBooleanResult,
  shapeNodesInWorldSpace,
} from './boolean-ops';
