/**
 * @strata/engine — dual-backend renderer facade (Strata plan §0.3, ADR-0001).
 *
 * One TypeScript surface drives desktop (native Rust via Tauri IPC) and web
 * (wasm-pack of the same crates). Feature code never knows which backend it
 * is talking to. The render IR is replayed to canvas by `replayIr`.
 */

export type { Engine } from './engine';
export { createEngine } from './engine';
export type { FontEntry, FontLoadState } from './fontRegistry';
export { FontRegistry, getFontRegistry } from './fontRegistry';
export * from './geometry';
export type { ImageCacheEntry, ImageLoadState } from './imageCache';
export { getImageCache, ImageCache, resetImageCache } from './imageCache';
export type { RasterEngine, RasterFormat, RasterOptions, RasterResult } from './raster';
export { computeOutputDimensions, estimateFileSize, renderRaster, supportsFormat } from './raster';
export { CompositeCanvas, mapBlendMode, blendPixels } from './compositeCanvas';
export type { CompositeCanvasOptions } from './compositeCanvas';
export type { ReplayTarget } from './replay';
export { replayIr } from './replay';
export type { ThumbnailOptions } from './thumbnail';
export { renderThumbnail } from './thumbnail';
export type { AdjustmentChannel, AdjustmentParams } from './adjustment';
export type { CurvePoint } from './adjustment/curves';
export type { Histogram, HistogramStats } from './adjustment/histogram';
export { autoLevelsParams, computeHistogram } from './adjustment/histogram';
export type { LevelParams } from './adjustment/levels';
export type { SelectiveColorParams, SelectiveColorTarget } from './adjustment/selectiveColor';
export type {
  Affine,
  Backend,
  BlendMode,
  Color,
  Effect,
  EngineFill,
  FillIR,
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
