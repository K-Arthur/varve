/**
 * Engine facade types — the webview-facing contract (Strata plan §0.3).
 *
 * NOTE on wire format: Rust enums serialize via serde (externally-tagged). The
 * idiomatic TS form here is a `kind`-discriminated union. The reconciliation
 * adapter (`fromRustIr`) lands when the wasm-bindgen / Tauri type layer is
 * generated; until then the stub backend produces this form directly so the
 * facade is fully testable end-to-end.
 *
 * F6 (Inspector): Stroke, Effect, BlendMode types added. RenderItem extended
 * with strokes/effects/opacity/blendMode so the IR can carry appearance info
 * for the canvas renderer.
 */

export type Point = readonly [number, number];

/** 2x3 affine as kurbo `as_coeffs()` order: [a, b, c, d, e, f] -> matrix
 * [[a, c, e], [b, d, f]]. Identical to canvas `ctx.transform(a,b,c,d,e,f)`. */
export type Affine = readonly [number, number, number, number, number, number];

/** RGBA fill, 0-255 per channel. */
export type Color = readonly [number, number, number, number];

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'colorDodge'
  | 'colorBurn'
  | 'hardLight'
  | 'softLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type StrokeAlign = 'inside' | 'center' | 'outside';
export type StrokeCap = 'butt' | 'round' | 'square';
export type StrokeJoin = 'miter' | 'round' | 'bevel';

export interface Stroke {
  color: Color;
  weight: number;
  align: StrokeAlign;
  dashPattern: number[];
  dashOffset: number;
  cap: StrokeCap;
  join: StrokeJoin;
  miterLimit: number;
  visible: boolean;
}

export type Effect =
  | {
      type: 'dropShadow';
      x: number;
      y: number;
      blur: number;
      spread: number;
      color: Color;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'innerShadow';
      x: number;
      y: number;
      blur: number;
      spread: number;
      color: Color;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | { type: 'layerBlur'; radius: number; visible: boolean }
  | { type: 'backgroundBlur'; radius: number; visible: boolean };

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'line'; from: Point; to: Point; tolerance: number }
  | { kind: 'polygon'; cx: number; cy: number; radius: number; sides: number; rotation: number }
  | {
      kind: 'star';
      cx: number;
      cy: number;
      innerRadius: number;
      outerRadius: number;
      points: number;
      rotation: number;
    };

export interface SceneNode {
  id: string;
  name: string;
  transform: Affine;
  shape: Shape;
  fill: Color;
  opacity?: number;
  blendMode?: BlendMode;
  rotation?: number;
  strokes?: Stroke[];
  effects?: Effect[];
}

export interface Scene {
  nodes: SceneNode[];
}

export type Primitive =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'line'; from: Point; to: Point; tolerance: number }
  | { kind: 'polygon'; cx: number; cy: number; radius: number; sides: number; rotation: number }
  | {
      kind: 'star';
      cx: number;
      cy: number;
      innerRadius: number;
      outerRadius: number;
      points: number;
      rotation: number;
    };

/** One drawable record in the render IR (mirrors strata-engine::RenderItem). */
export interface RenderItem {
  transform: Affine;
  fill: Color;
  primitive: Primitive;
  /** F6: layer opacity (0-1). */
  opacity?: number;
  /** F6: blend mode. */
  blendMode?: BlendMode;
  /** F6: stacked strokes to render. */
  strokes?: Stroke[];
  /** F6: stacked effects. */
  effects?: Effect[];
}

export type Backend = 'native' | 'wasm' | 'stub';
