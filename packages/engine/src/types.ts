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
  | 'passThrough'
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
  | 'luminosity'
  | 'plusDarker'
  | 'plusLighter';

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

export interface PathPoint {
  x: number;
  y: number;
  handleIn: [number, number] | null;
  handleOut: [number, number] | null;
}

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
    }
  | { kind: 'arrow'; from: Point; to: Point; tolerance: number; arrowheadSize: number }
  | { kind: 'path'; points: PathPoint[]; closed: boolean; tolerance: number };

export interface SceneNode {
  id: string;
  name: string;
  transform: Affine;
  kind?: string;
  shape?: Shape;
  fill?: Color;
  /** P2: stacked fills (solid/gradient). */
  fills?: EngineFill[];
  src?: string;
  w?: number;
  h?: number;
  opacity?: number;
  blendMode?: BlendMode;
  rotation?: number;
  strokes?: Stroke[];
  effects?: Effect[];
  /** Text node content (kind === 'text'). */
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: string;
  /** Text alignment. */
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  /** Vertical text alignment. */
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  /** Letter spacing in px. */
  letterSpacing?: number;
  /** Line height multiplier. */
  lineHeight?: number;
  /** Paragraph spacing in px. */
  paragraphSpacing?: number;
  /** Text case transform. */
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** Text decoration. */
  textDecoration?: 'none' | 'underline' | 'line-through';
  /** Text overflow mode. */
  textOverflow?: 'clip' | 'ellipsis' | 'visible';
  /** List style. */
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  /** Uniform or per-corner radius for rect-anchored shapes. */
  cornerRadius?: number | [number, number, number, number];
}

/** P2: Fill type for the engine (mirrors @strata/scene Fill). */
export interface EngineGradientStop {
  position: number;
  color: Color;
}

export interface EngineGradientFill {
  type: 'linear' | 'radial' | 'angular' | 'diamond';
  stops: EngineGradientStop[];
  rotation?: number;
  /** Full 2x3 fill transform matrix. When set, overrides rotation. */
  transform?: Affine;
}

export interface EngineFill {
  type: 'solid' | 'gradient' | 'image' | 'pattern';
  color?: Color;
  gradient?: EngineGradientFill;
  image?: { src: string; fit: string; x: number; y: number; scale: number };
  pattern?: { tileSrc: string; spacing: number; rotation: number };
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
}

export interface Scene {
  nodes: SceneNode[];
}

export type Primitive =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      cornerRadius?: number | [number, number, number, number];
    }
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
    }
  | { kind: 'arrow'; from: Point; to: Point; tolerance: number; arrowheadSize: number }
  | { kind: 'path'; points: PathPoint[]; closed: boolean; tolerance: number }
  | { kind: 'image'; w: number; h: number; src: string }
  | {
      kind: 'text';
      x: number;
      y: number;
      w: number;
      h: number;
      text: string;
      fontSize: number;
      fontFamily: string;
      fontWeight: number;
      fontStyle: 'normal' | 'italic';
      textAlign: 'left' | 'center' | 'right' | 'justify';
      textAlignVertical: 'top' | 'middle' | 'bottom';
      letterSpacing: number;
      lineHeight: number;
      paragraphSpacing: number;
      textCase: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
      textDecoration: 'none' | 'underline' | 'line-through';
      textOverflow: 'clip' | 'ellipsis' | 'visible';
      listStyle: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
    };

/** One drawable record in the render IR (mirrors strata-engine::RenderItem). */
export interface RenderItem {
  transform: Affine;
  fill: Color;
  /** P2: stacked fills (solid/gradient). When present, paint bottom→top. */
  fills?: FillIR[];
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

/** P2: Fill IR — a single fill in the render IR. */
export type FillIR =
  | { type: 'solid'; color: Color; opacity: number; blendMode: BlendMode; visible: boolean }
  | {
      type: 'gradient';
      gradientType: 'linear' | 'radial' | 'angular' | 'diamond';
      stops: { position: number; color: Color }[];
      rotation: number;
      transform?: Affine;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'image';
      src: string;
      fit: 'fill' | 'fit' | 'stretch' | 'tile';
      x: number;
      y: number;
      scale: number;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'pattern';
      tileSrc: string;
      spacing: number;
      rotation: number;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    };

export type Backend = 'native' | 'wasm' | 'stub';
