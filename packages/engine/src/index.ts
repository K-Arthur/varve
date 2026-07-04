/**
 * @strata/engine — dual-backend renderer facade (Strata plan §0.3, ADR-0001).
 *
 * One TypeScript surface drives desktop (native Rust via Tauri IPC) and web
 * (wasm-pack of the same crates). Feature code never knows which backend it
 * is talking to. The render IR is replayed to canvas by `replayIr`.
 */

export type { Engine } from './engine';
export { createEngine } from './engine';
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
export type { GlyphPlacement, GlyphPlaceOptions, PathSample } from './pathText';
export { pathLength, placeGlyphsOnPath, samplePathAtLength } from './pathText';
export type { RasterEngine, RasterFormat, RasterOptions, RasterResult } from './raster';
export { computeOutputDimensions, estimateFileSize, renderRaster, supportsFormat } from './raster';
export type { ReplayTarget } from './replay';
export { replayIr } from './replay';
export type { GlyphOutline, TextOutlineOptions, TextOutlineResult } from './textOutlines';
export { glyphOutlineToSvgPath, textOutlinesToSvg, textToOutlines } from './textOutlines';
export type { ThumbnailOptions } from './thumbnail';
export { renderThumbnail } from './thumbnail';
export type {
  Affine,
  Backend,
  BlendMode,
  Color,
  Effect,
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
