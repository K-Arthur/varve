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
export type { CubicBezier, PathPoint as BezierPathPoint, Point2D } from './bezier';
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
export {
  cmykToRgb,
  gamutMapToSrgb,
  linearSrgbToOklab,
  linearToSrgb,
  managedColorToCss,
  managedColorToRgba,
  oklabToLinearSrgb,
  oklabToOkLch,
  oklchToOkLab,
  rgbToCmyk,
  srgbToLinear,
} from './colorConversion';
export type { RulerMode } from './coordinates';
export {
  artboardToWorld,
  formatCoordForRuler,
  getArtboardRulerOrigin,
  worldToArtboard,
} from './coordinates';
export { debounce, throttle } from './debounce';
export type {
  CubicBezierEasingDef,
  EasingDefinition,
  EasingFn,
  EasingKind,
  SpringEasingDef,
  SpringPhysicsParams,
  StepsEasingDef,
} from './easing';
export {
  cubicBezier,
  easeIn,
  easeInOut,
  easeOut,
  getEasingFn,
  linear,
  sampleEasing,
  springPhysics,
  steps,
} from './easing';
export type { PathPoint, SpatialTangents } from './interpolation';
export {
  ensureVertexMatch,
  interpolateAffine,
  interpolateArray,
  interpolateColor,
  interpolateObject,
  interpolatePath,
  interpolateSpatialBezier,
  interpolateValue,
} from './interpolation';
export type { OrderKey } from './ordering';
export { generateKeyBetween, generateNKeysBetween, midPoint } from './ordering';
export type {
  MeasuredLine,
  MeasuredParagraph,
  MeasuredRun,
  MeasureTextFn,
  RichTextMeasureResult,
  RunMeasureOptions,
  TextMeasureOptions,
  TextMeasureResult,
  TextMetricsResult,
} from './textMeasure';
export {
  buildFeatureSettingsCSS,
  buildVariationSettingsCSS,
  measureRichText,
  measureRun,
  measureText,
  measureTextWithCanvas,
  measureWrappedText,
  textWrap,
} from './textMeasure';
export type { DocumentUnit, SpecUnit } from './units';
export {
  convertDocumentUnit,
  convertPx,
  convertToPx,
  formatPhysical,
  formatValue,
  percentToPx,
  physicalToPx,
  ptToPx,
  pxToPercent,
  pxToPhysical,
  pxToPt,
  pxToRem,
  remToPx,
  UNIT_TO_PX,
} from './units';
export type { Camera, Viewport } from './viewport';
export {
  animateCamera,
  applyCameraTransform,
  buildScreenToWorldAffine,
  buildWorldToScreenAffine,
  centerBoundsCamera,
  clampCamera,
  clampZoom,
  clientToCanvas,
  computeFloatingOrigin,
  DEFAULT_REVEAL_MAX_ZOOM,
  DEFAULT_REVEAL_PADDING,
  FLOATING_ORIGIN_GRID,
  fitBoundsCamera,
  fitZoom,
  isRectInView,
  isWorldRectInViewport,
  lerpCamera,
  localRectToScreen,
  MAX_ZOOM,
  MIN_ZOOM,
  resetViewRotation,
  revealBoundsCamera,
  rotateAboutScreenPoint,
  screenDeltaToWorld,
  screenToWorld,
  snapThresholdWorld,
  stepZoom,
  worldToScreen,
  worldToScreenAffine,
  ZOOM_STEP_FACTOR,
  zoomAboutPoint,
} from './viewport';

/** Semantic Strata package marker. */
export const PACKAGE = '@strata/shared' as const;
