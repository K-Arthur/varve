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

// ── Local typography IR types (mirrors @strata/scene without the dependency) ──

export type OpenTypeFeatureMap = Partial<Record<string, boolean>> & {
  custom?: Record<string, boolean>;
};

export type VariableFontSettings = Record<string, number>;

export type TextMode = 'point' | 'area' | 'path' | 'auto';

export interface PathTextSettings {
  pathNodeId: string;
  startOffset?: number;
  endOffset?: number;
  side?: 'top' | 'bottom';
  flip?: boolean;
  baselineShift?: number;
}

export interface CharacterFormat {
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  color?: readonly [number, number, number, number];
  openTypeFeatures?: OpenTypeFeatureMap;
  variableFontSettings?: VariableFontSettings;
  baselineShift?: number;
}

export interface ParagraphFormat {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  paragraphSpacing?: number;
  maxLines?: number;
  textOverflow?: 'clip' | 'ellipsis' | 'visible';
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
}

export interface TextRun {
  text: string;
  format?: CharacterFormat;
}

export interface Paragraph {
  runs: TextRun[];
  format?: ParagraphFormat;
}

export interface RichText {
  paragraphs: Paragraph[];
}

/** 2x3 affine as kurbo `as_coeffs()` order: [a, b, c, d, e, f] -> matrix
 * [[a, c, e], [b, d, f]]. Identical to canvas `ctx.transform(a,b,c,d,e,f)`. */
export type Affine = readonly [number, number, number, number, number, number];

/** RGBA fill, 0-255 per channel. */
export type Color = readonly [number, number, number, number];

// ── Engine Color type (mirrors @strata/scene ManagedColor) ──────────────────

/** Engine color that mirrors ManagedColor but is self-contained. */
export interface EngineRgbColor {
  space: 'rgb';
  r: number;
  g: number;
  b: number;
  a: number;
  profile?: string;
}

export interface EngineCmykColor {
  space: 'cmyk';
  c: number;
  m: number;
  y: number;
  k: number;
  a: number;
  profile?: string;
}

export interface EngineGrayColor {
  space: 'gray';
  v: number;
  a: number;
  profile?: string;
}

export interface EngineSpotColor {
  space: 'spot';
  name: string;
  tint: number;
  a: number;
  processFallback?: { c: number; m: number; y: number; k: number };
}

export type EngineColor = EngineRgbColor | EngineCmykColor | EngineGrayColor | EngineSpotColor;

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
  color: EngineColor;
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
      color: EngineColor;
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
      color: EngineColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | { type: 'layerBlur'; radius: number; visible: boolean }
  | { type: 'backgroundBlur'; radius: number; visible: boolean }
  | {
      type: 'outerGlow';
      blur: number;
      spread: number;
      color: EngineColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'innerGlow';
      blur: number;
      spread: number;
      color: EngineColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    };

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
  fill?: EngineColor;
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
  /** Optional rich text content. */
  richText?: RichText;
  /** Variable font axis values. */
  variableAxes?: VariableFontSettings;
  /** OpenType feature flags. */
  openTypeFeatures?: OpenTypeFeatureMap;
  /** Text mode. */
  textMode?: TextMode;
  /** Path text settings. */
  pathTextSettings?: PathTextSettings;
  /** Uniform or per-corner radius for rect-anchored shapes. */
  cornerRadius?: number | [number, number, number, number];
  /** 0–1 squircle smoothing applied on top of cornerRadius (iOS continuous-corner style). */
  cornerSmoothing?: number;
  /** Alpha mask data URL for compositing with transparency. */
  alphaMask?: string;
}

/** P2: Fill type for the engine (mirrors @strata/scene Fill). */
export interface EngineGradientStop {
  position: number;
  color: EngineColor;
}

export interface EngineGradientFill {
  type: 'linear' | 'radial' | 'angular' | 'diamond';
  stops: EngineGradientStop[];
  rotation?: number;
  /** Full 2x3 fill transform matrix. When set, overrides rotation. */
  transform?: Affine;
}

export interface EngineImageFillData {
  src: string;
  fit: 'fill' | 'fit' | 'stretch' | 'tile';
  x: number;
  y: number;
  scale: number;
  /** Natural image width in pixels. When omitted, fill bounds width is used. */
  imageWidth?: number;
  /** Natural image height in pixels. When omitted, fill bounds height is used. */
  imageHeight?: number;
}

export interface EnginePatternFillData {
  tileSrc: string;
  spacing: number;
  rotation: number;
}

export interface EngineFill {
  type: 'solid' | 'gradient' | 'image' | 'pattern';
  color?: EngineColor;
  gradient?: EngineGradientFill;
  image?: EngineImageFillData;
  pattern?: EnginePatternFillData;
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
      /** 0–1 squircle smoothing (0 = standard CSS, 1 = fully smooth iOS-style corners). */
      cornerSmoothing?: number;
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
  | { kind: 'image'; w: number; h: number; src: string; alphaMask?: string }
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
      /** Rich text content (takes precedence over `text` when rendering). */
      richText?: RichText;
      /** Variable font axis values. */
      variableAxes?: VariableFontSettings;
      /** OpenType feature flags. */
      openTypeFeatures?: OpenTypeFeatureMap;
      /** Text mode. */
      textMode?: TextMode;
      /** Path text settings. */
      pathTextSettings?: PathTextSettings;
      /** Resolved shape for path text (when textMode === 'path'). */
      pathShape?: Shape;
    };

/** One drawable record in the render IR (mirrors strata-engine::RenderItem). */
export interface RenderItem {
  transform: Affine;
  fill: EngineColor;
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
  /** Phase 5: nondestructive adjustment filter stack applied to the rendered item. */
  filters?: FilterIR[];
}

/** Phase 5: portable filter IR for nondestructive image adjustments. */
export type FilterIR =
  | { kind: 'brightness'; value: number; opacity: number; blendMode: string }
  | { kind: 'contrast'; value: number; opacity: number; blendMode: string }
  | {
      kind: 'exposure';
      value: number;
      offset: number;
      gammaCorrection: number;
      opacity: number;
      blendMode: string;
    }
  | { kind: 'saturation'; value: number; opacity: number; blendMode: string }
  | { kind: 'hueRotate'; value: number; opacity: number; blendMode: string }
  | { kind: 'sepia'; value: number; opacity: number; blendMode: string }
  | { kind: 'grayscale'; value: number; opacity: number; blendMode: string }
  | { kind: 'invert'; value: number; opacity: number; blendMode: string }
  | { kind: 'opacity'; value: number; opacity: number; blendMode: string }
  | { kind: 'blur'; radius: number; opacity: number; blendMode: string }
  | {
      kind: 'sharpen';
      amount: number;
      radius: number;
      threshold: number;
      opacity: number;
      blendMode: string;
    }
  | { kind: 'temperature'; value: number; opacity: number; blendMode: string }
  | { kind: 'tint'; value: number; opacity: number; blendMode: string }
  | { kind: 'vibrance'; value: number; opacity: number; blendMode: string }
  | {
      kind: 'levels';
      inputShadows: number;
      inputMidtones: number;
      inputHighlights: number;
      outputShadows: number;
      outputHighlights: number;
      channel: string;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'curves';
      channel: string;
      points: { input: number; output: number }[];
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'selectiveColor';
      colorRange: string;
      cyan: number;
      magenta: number;
      yellow: number;
      black: number;
      relative: boolean;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'colorBalance';
      shadows: { cyanRed: number; magentaGreen: number; yellowBlue: number };
      midtones: { cyanRed: number; magentaGreen: number; yellowBlue: number };
      highlights: { cyanRed: number; magentaGreen: number; yellowBlue: number };
      preserveLuminosity: boolean;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'channelMixer';
      outputChannel: string;
      redPercent: number;
      greenPercent: number;
      bluePercent: number;
      constant: number;
      monochrome: boolean;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'photoFilter';
      color: readonly [number, number, number, number];
      density: number;
      preserveLuminosity: boolean;
      opacity: number;
      blendMode: string;
    }
  | { kind: 'chain'; filters: FilterIR[]; opacity: number; blendMode: string }
  | {
      kind: 'halftone';
      pattern: 'dot' | 'line' | 'cross' | 'circle';
      frequency: number; // LPI (lines per inch)
      angle: number; // Screen angle in degrees (0-359)
      dotShape: 'round' | 'elliptical' | 'square' | 'diamond' | 'line';
      channel: 'k' | 'c' | 'm' | 'y' | 'cmyk';
      method: 'am' | 'fm'; // Amplitude modulation or frequency modulation
      opacity: number;
      blendMode: string;
    };

/** P2: Fill IR — a single fill in the render IR (solid, gradient, image, or pattern). */
export type FillIR =
  | { type: 'solid'; color: EngineColor; opacity: number; blendMode: BlendMode; visible: boolean }
  | {
      type: 'gradient';
      gradientType: 'linear' | 'radial' | 'angular' | 'diamond';
      stops: { position: number; color: EngineColor }[];
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
      imageWidth?: number;
      imageHeight?: number;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
      /** Alpha mask data URL for background removal compositing on shape nodes. */
      alphaMask?: string;
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
