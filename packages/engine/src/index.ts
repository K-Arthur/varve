/**
 * @strata/engine — dual-backend renderer facade (Strata plan §0.3, ADR-0001).
 *
 * One TypeScript surface drives desktop (native Rust via Tauri IPC) and web
 * (wasm-pack of the same crates). Feature code never knows which backend it
 * is talking to. The render IR is replayed to canvas by `replayIr`.
 */

export type { AdjustmentChannel, AdjustmentParams } from './adjustment';
export type { CurvePoint } from './adjustment/curves';
export type { Histogram, HistogramStats } from './adjustment/histogram';
export { autoLevelsParams, computeHistogram } from './adjustment/histogram';
export type { LevelParams } from './adjustment/levels';
export type { SelectiveColorParams, SelectiveColorTarget } from './adjustment/selectiveColor';
export type {
  BackgroundRemovalOptions,
  BackgroundRemovalResult,
  HeuristicMethod,
  ModelMetadata,
  ModelState,
  RemovalMethod,
} from './backgroundRemoval';
export {
  AVAILABLE_MODELS,
  getModelLoader,
  removeBackground,
  resetModelLoader,
} from './backgroundRemoval';
export {
  blend,
  blendColorBurn,
  blendColorDodge,
  blendDarken,
  blendDifference,
  blendExclusion,
  blendHardLight,
  blendLighten,
  blendMultiply,
  blendNormal,
  blendOverlay,
  blendPixels,
  blendPlusDarker,
  blendPlusLighter,
  blendScreen,
  blendSoftLight,
} from './blendModes';
export type { CompositeCanvasOptions } from './compositeCanvas';
export { blendPixels as canvasBlendPixels, CompositeCanvas, mapBlendMode } from './compositeCanvas';
export type { Engine } from './engine';
export { applyStyleOverrides, createEngine } from './engine';
export type {
  Adjustment,
  AdjustmentBase,
  AdjustmentBlendMode,
  AdjustmentKind,
  BlurAdjustment,
  BrightnessAdjustment,
  ChannelMixerAdjustment,
  ColorBalanceAdjustment,
  ColorBalanceTriplet,
  ContrastAdjustment,
  CurvesAdjustment,
  CurvesPoint,
  ExposureAdjustment,
  GrayscaleAdjustment,
  HueRotateAdjustment,
  InvertAdjustment,
  LevelsAdjustment,
  OpacityAdjustment,
  PhotoFilterAdjustment,
  SaturationAdjustment,
  SelectiveColorAdjustment,
  SepiaAdjustment,
  SharpenAdjustment,
  TemperatureAdjustment,
  TintAdjustment,
  VibranceAdjustment,
} from './filters';
export {
  adjustmentDefaults,
  adjustmentsToFilters,
  adjustmentToFilter,
  applyFilterChain,
  filterChainToCss,
  filterKindDisplayName,
  filterToCss,
  makeAdjustment,
} from './filters';
export type { FontEntry, FontLoadState, VariableAxisInfo } from './fontRegistry';
export { FontRegistry, getFontRegistry, resetFontRegistry } from './fontRegistry';
export * from './geometry';
export type { ImageCacheEntry, ImageLoadState } from './imageCache';
export { getImageCache, ImageCache, resetImageCache } from './imageCache';
export type { HarmonyPalette, PaletteResult } from './intelligence/paletteExtractor';
export {
  analogousHarmony,
  complementaryHarmony,
  extractPalette,
  splitComplementaryHarmony,
  triadicHarmony,
} from './intelligence/paletteExtractor';
export type { SimplifiedPath } from './intelligence/pathSimplifier';
export {
  fitCubicBezier,
  simplifyPathRDP,
  simplifyToBezier,
} from './intelligence/pathSimplifier';
export type { NonSeparableMode } from './nonSeparable';
export {
  blendColorLch,
  blendColorW3C,
  blendHueLch,
  blendHueW3C,
  blendLuminosityLch,
  blendLuminosityW3C,
  blendNonSeparable,
  blendSaturationLch,
  blendSaturationW3C,
  clipColor,
  labToRgb,
  lchToRgb,
  lum,
  rgbToLab,
  rgbToLch,
  sat,
  setLum,
  setSat,
} from './nonSeparable';
export type { GlyphPlacement, GlyphPlaceOptions, PathSample } from './pathText';
export { pathLength, placeGlyphsOnPath, samplePathAtLength } from './pathText';
export type { PorterDuffOp } from './porterDuff';
export {
  compositePixels,
  mapPorterDuffOp,
  porterDuffCompositing,
} from './porterDuff';
export type { RasterEngine, RasterFormat, RasterOptions, RasterResult } from './raster';
export { computeOutputDimensions, estimateFileSize, renderRaster, supportsFormat } from './raster';
export type { ReplayTarget } from './replay';
export { renderAlphaMask, replayIr } from './replay';
export {
  buildBrushMask,
  clonePixels,
  createBrushMask,
  findBestPatch,
  healPixels,
  ncc,
  patchRegion,
  spotHeal,
} from './retouch';
export type { GlyphOutline, TextOutlineOptions, TextOutlineResult } from './textOutlines';
export { glyphOutlineToSvgPath, textOutlinesToSvg, textToOutlines } from './textOutlines';
export type { ThumbnailOptions } from './thumbnail';
export { renderThumbnail } from './thumbnail';
export { traceSceneNodeOutline } from './tracing';
export type {
  Affine,
  Backend,
  BlendMode,
  Color,
  Effect,
  EngineColor,
  EngineFill,
  FillIR,
  FilterIR,
  PathPoint,
  Point,
  Primitive,
  RenderItem,
  Scene,
  SceneNode,
  Shape,
  Stroke,
  StrokeAlign,
  StrokeCap,
  StrokeJoin,
} from './types';
