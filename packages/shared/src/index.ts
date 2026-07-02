/**
 * @strata/shared — framework-agnostic primitives shared across engine, scene,
 * and UI. Runs in Rust-wasm bindings, web workers, and React components alike.
 */

export type { Affine, Point, Rect } from './affine';
export {
  applyAffine,
  decomposeAffine,
  identity,
  invertAffine,
  multiplyAffine,
  pointInEllipse,
  pointToSegmentDistSq,
  rectContains,
  rotateDeg,
  rotateRad,
  scale,
  scaleXY,
  transform,
  transformRect,
  translate,
  tryInvertAffine,
} from './affine';
export { debounce, throttle } from './debounce';
export type { OrderKey } from './ordering';
export { generateKeyBetween, generateNKeysBetween, midPoint } from './ordering';
export type { SpecUnit } from './units';
export {
  convertPx,
  convertToPx,
  formatValue,
  percentToPx,
  ptToPx,
  pxToPercent,
  pxToPt,
  pxToRem,
  remToPx,
} from './units';

export type { Camera, Viewport } from './viewport';
export {
  centerBoundsCamera,
  clampZoom,
  clientToCanvas,
  DEFAULT_REVEAL_MAX_ZOOM,
  DEFAULT_REVEAL_PADDING,
  fitBoundsCamera,
  fitZoom,
  isRectInView,
  localRectToScreen,
  MAX_ZOOM,
  MIN_ZOOM,
  revealBoundsCamera,
  screenDeltaToWorld,
  screenToWorld,
  worldToScreen,
  worldToScreenAffine,
  zoomAboutPoint,
} from './viewport';

export type { TextMeasureOptions, MeasuredLine, TextMeasureResult } from './textMeasure';
export { measureText, measureWrappedText, textWrap } from './textMeasure';

export type { Point2D, CubicBezier, PathPoint } from './bezier';
export {
  cubicBezierBBox,
  cubicBezierClosestPoint,
  cubicBezierDerivative,
  cubicBezierLength,
  cubicBezierPoint,
  cubicBezierSegmentIntersection,
  cubicBezierSplit,
  lineLineIntersection,
  pathPointToBezier,
  pathSegmentIntersections,
  pointToPointDist,
} from './bezier';

/** Semantic Strata package marker. */
export const PACKAGE = '@strata/shared' as const;
