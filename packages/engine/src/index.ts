/**
 * @strata/engine — dual-backend renderer facade (Strata plan §0.3, ADR-0001).
 *
 * One TypeScript surface drives desktop (native Rust via Tauri IPC) and web
 * (wasm-pack of the same crates). Feature code never knows which backend it
 * is talking to. The render IR is replayed to canvas by `replayIr`.
 */

export type { Engine } from './engine';
export { createEngine } from './engine';
export * from './geometry';
export type { ReplayTarget } from './replay';
export { replayIr } from './replay';
export type { ThumbnailOptions } from './thumbnail';
export { renderThumbnail } from './thumbnail';
export type {
  Affine,
  Backend,
  BlendMode,
  Color,
  Effect,
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
