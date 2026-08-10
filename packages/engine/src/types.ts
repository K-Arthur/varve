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

// ── Local typography IR types (mirrors @varve/scene without the dependency) ──

export type OpenTypeFeatureMap = Record<string, boolean | Record<string, boolean> | undefined> & {
  custom?: Record<string, boolean>;
};

export type VariableFontSettings = Record<string, number>;

export type TextMode = 'point' | 'area' | 'path' | 'auto';

/**
 * Per-cluster glyph adjustment in render IR (mirrors @varve/scene
 * GlyphAdjustment; engine intentionally does not depend on scene).
 */
export interface GlyphAdjustmentIR {
  dx: number;
  dy: number;
  advance: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface PathTextSettings {
  pathNodeId: string;
  startOffset?: number;
  endOffset?: number;
  side?: 'top' | 'bottom';
  flip?: boolean;
  baselineShift?: number;
}

export interface CharacterFormat {
  /** Typographic tracking in 1/1000 em units, added between glyphs. */
  tracking?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  /** Run color; mirrors scene's ManagedColor (legacy tuples also render). */
  color?: import('@varve/shared').ManagedColorShim;
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

// ── Engine Color type (mirrors @varve/scene ManagedColor) ──────────────────

/**
 * Engine color: structurally identical to `@varve/scene` `ManagedColor`
 * (the union lives in `@varve/shared` as `ManagedColorShim` so the engine
 * does not depend on the scene package). All render paths reduce any member
 * to RGBA via `managedColorToRgba`, so adding variants is a reducer change,
 * not a wire change.
 */
export type EngineColor = import('@varve/shared').ManagedColorShim;

/** RGB member of the engine color union (backward-compatible alias). */
export type EngineRgbColor = import('@varve/shared').ManagedColorShim & { space: 'rgb' };
/** CMYK member of the engine color union (backward-compatible alias). */
export type EngineCmykColor = import('@varve/shared').ManagedColorShim & { space: 'cmyk' };
/** Grayscale member of the engine color union (backward-compatible alias). */
export type EngineGrayColor = import('@varve/shared').ManagedColorShim & { space: 'gray' };
/** Spot member of the engine color union (backward-compatible alias). */
export type EngineSpotColor = import('@varve/shared').ManagedColorShim & { space: 'spot' };

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
export type ArrowheadStyle = 'none' | 'arrow' | 'circle' | 'square' | 'diamond';

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
  /** Arrowhead at the start of a line/arrow/path. */
  arrowStart?: ArrowheadStyle;
  /** Arrowhead at the end of a line/arrow/path. */
  arrowEnd?: ArrowheadStyle;
}

export interface ChannelOffset {
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
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
    }
  | {
      type: 'glassMaterial';
      blur: number;
      tint: EngineColor;
      tintOpacity: number;
      saturation: number;
      brightness: number;
      noise: number;
      edgeHighlight: boolean;
      edgeHighlightWidth: number;
      edgeHighlightColor: EngineColor;
      edgeHighlightOpacity: number;
      visible: boolean;
    }
  | {
      type: 'chromaticAberration';
      offsets: ChannelOffset;
      intensity: number;
      blendMode: BlendMode;
      opacity: number;
      visible: boolean;
    }
  | {
      type: 'glitch';
      seed: number;
      strength: number;
      density: number;
      sliceHeight: number;
      blockCount: number;
      blockSize: number;
      blockStrength: number;
      noiseIntensity: number;
      scanlineIntensity: number;
      scanlineSpacing: number;
      direction: 'horizontal' | 'vertical' | 'both';
      channelShift: ChannelOffset;
      channelShiftMode: 'static' | 'seeded';
      blendMode: BlendMode;
      opacity: number;
      visible: boolean;
    };

export interface PathPoint {
  x: number;
  y: number;
  handleIn: [number, number] | null;
  handleOut: [number, number] | null;
  /** Normalised pressure 0-1 (from PointerEvent.pressure). Null when unavailable. */
  pressure?: number;
  /** Pointer tilt (from PointerEvent.tiltX/tiltY). Null when unavailable. */
  tilt?: { x: number; y: number };
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
  | {
      kind: 'path';
      points: PathPoint[];
      closed: boolean;
      tolerance: number;
      /** Additional closed hole rings (evenodd fill). Optional for back-compat. */
      holes?: PathPoint[][];
      fillRule?: 'nonzero' | 'evenodd';
    }
  | TableShape;

export interface SceneNode {
  id: string;
  name: string;
  transform: Affine;
  kind?: string;
  shape?: Shape;
  /** V1.8+: When true, geometry is derived from paint instead of shape. */
  shapeless?: boolean;
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
  /** Typographic tracking in 1/1000 em units, added between glyphs. */
  tracking?: number;
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
  /** Text direction: 'ltr', 'rtl', or 'auto' (auto-detect). */
  direction?: 'ltr' | 'rtl' | 'auto';
  /** ISO language tag for language-specific shaping. */
  language?: string;
  /** Kerning mode: 'auto' (font pair kerning) or 'none' (per-cluster draw). */
  kerningMode?: 'auto' | 'none';
  /** Per-cluster adjustments keyed by grapheme-cluster index. */
  glyphAdjustments?: Record<number, GlyphAdjustmentIR>;
  /** Manual pair spacing: px between cluster i and cluster i+1. */
  pairAdjustments?: Record<number, number>;
  /** Uniform or per-corner radius for rect-anchored shapes. */
  cornerRadius?: number | [number, number, number, number];
  /** 0–1 squircle smoothing applied on top of cornerRadius (iOS continuous-corner style). */
  cornerSmoothing?: number;
  /** Alpha mask data URL for compositing with transparency. */
  alphaMask?: string;
  /** Phase 5: nondestructive adjustment filter stack. */
  filters?: FilterIR[];
  /** Raster layer pixel data (for node.kind === 'rasterLayer'). */
  rasterLayerData?: {
    width: number;
    height: number;
    pixelMode: boolean;
    tiles: Record<string, { pixels: number[]; version: number }>;
  };
}

/** P2: Fill type for the engine (mirrors @varve/scene Fill). */
export type GradientInterpolationSpace = 'srgb' | 'oklab' | 'oklch' | 'hsl';

export type GradientTilingMode = 'none' | 'repeat' | 'reflect';

export interface EngineGradientStop {
  position: number;
  color: EngineColor;
  midpoint?: number;
}

export interface EngineGradientFill {
  type: 'linear' | 'radial' | 'angular' | 'diamond';
  stops: EngineGradientStop[];
  rotation?: number;
  interpolationSpace?: GradientInterpolationSpace;
  /** Full 2x3 fill transform matrix. When set, overrides rotation. */
  transform?: Affine;
  tilingMode?: GradientTilingMode;
}

/** Crop window in source-pixel coordinates (mirrors scene ImageCropRect). */
export interface EngineImageCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EngineImageFillData {
  /**
   * Render-time image identity. For canonical embedded assets this is the
   * short content-addressed resource handle (`asset-<hash>`); legacy fills
   * keep their raw source (data:/blob:/http(s)). Handles resolve to
   * loadable sources through the image resource registry, so multi-megabyte
   * payloads never travel inside render IR.
   */
  src: string;
  /** Canonical scene asset id when this fill references one (diagnostics/provenance). */
  assetId?: string;
  fit: 'fill' | 'fit' | 'stretch' | 'tile' | 'crop';
  x: number;
  y: number;
  scale: number;
  /** Natural image width in pixels. When omitted, fill bounds width is used. */
  imageWidth?: number;
  /** Natural image height in pixels. When omitted, fill bounds height is used. */
  imageHeight?: number;
  /**
   * Non-destructive crop window in source-pixel coordinates. When set, only
   * the region [x,y,w,h] of the source image is visible. Stored on the fill
   * (not baked into node geometry) so it survives save/reopen.
   */
  crop?: EngineImageCropRect;
  /** Rotation of image content in degrees clockwise. Applied before placement. */
  rotation?: number;
  /** Horizontal flip of image content. Applied before placement. */
  flipH?: boolean;
  /** Vertical flip of image content. Applied before placement. */
  flipV?: boolean;
  /**
   * Animated-media source frame index (v2.20+). Present only on fills whose
   * asset is animated; replay resolves the frame through the media frame
   * cache. Absent for static images.
   */
  frame?: number;
}

export interface EnginePatternFillData {
  tileSrc: string;
  spacing: number;
  rotation: number;
  /** Tile width override in px. When omitted, natural image width is used. */
  imageWidth?: number;
  /** Tile height override in px. When omitted, natural image height is used. */
  imageHeight?: number;
}

/**
 * A vector shape within a pattern tile for engine IR transport.
 */
export interface EngineVecPatternShape {
  kind: string;
  params: Record<string, unknown>;
  fill?: EngineColor;
  stroke?: {
    color: EngineColor;
    weight: number;
    cap?: string;
    join?: string;
    dashPattern?: number[];
    dashOffset?: number;
  };
  transform?: [number, number, number, number, number, number];
}

export interface EngineVecPatternFillData {
  shapes: EngineVecPatternShape[];
  tileWidth: number;
  tileHeight: number;
  spacing: number;
  rotation: number;
  transform?: [number, number, number, number, number, number];
  docRelative?: boolean;
}

export interface EngineFill {
  type: 'solid' | 'gradient' | 'image' | 'pattern' | 'vec-pattern';
  color?: EngineColor;
  gradient?: EngineGradientFill;
  image?: EngineImageFillData;
  pattern?: EnginePatternFillData;
  vecPattern?: EngineVecPatternFillData;
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
  | {
      kind: 'path';
      points: PathPoint[];
      closed: boolean;
      tolerance: number;
      holes?: PathPoint[][];
      fillRule?: 'nonzero' | 'evenodd';
    }
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
      /** Typographic tracking in 1/1000 em units (fontSize * tracking / 1000
       *  added between glyphs). Parallel to letterSpacing; adds on top. */
      tracking?: number;
      lineHeight: number;
      paragraphSpacing: number;
      paragraphIndent?: number;
      firstLineIndent?: number;
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
      /** Tab stop definitions. */
      tabStops?: Array<{
        position: number;
        alignment: 'left' | 'center' | 'right' | 'decimal';
        alignmentChar?: string;
        leader?: string;
      }>;
      /** Default tab width (in px, default 8 spaces). */
      tabSize?: number;
      /** Paragraph text direction (LTR, RTL, or auto). */
      direction?: 'ltr' | 'rtl' | 'auto';
      /** ISO language tag for language-specific shaping (e.g. 'ar', 'hi', 'th'). */
      language?: string;
      /** Pre-computed shaping result (set by engine/wasm). */
      shaping?: TextShaping;
      /** Kerning mode: 'auto' (font pair kerning) or 'none' (per-cluster draw). */
      kerningMode?: 'auto' | 'none';
      /** Per-cluster adjustments keyed by grapheme-cluster index. */
      glyphAdjustments?: Record<number, GlyphAdjustmentIR>;
      /** Manual pair spacing: px added to the advance of cluster i+1. */
      pairAdjustments?: Record<number, number>;
    }
  | {
      kind: 'rasterLayer';
      width: number;
      height: number;
      pixelMode: boolean;
      tiles: Record<string, { pixels: number[]; version: number }>;
      /**
       * Stable scene-node id, used to key the persistent backing surface that
       * lets replay upload only changed tiles. Optional: without it replay
       * falls back to rebuilding the whole layer, which is always correct.
       */
      layerId?: string;
    }
  | {
      /**
       * Raster mapped onto a destination quad through a true projective
       * transform (mockup perspective surfaces). The source raster is a
       * pre-rendered surface (editor-side bake) at `src`; `fit`/alignment
       * select the source sampling rect within the quad. Output resolution
       * follows the current transform scale (export-crisp).
       */
      kind: 'warpedImage';
      src: string;
      sourceW: number;
      sourceH: number;
      fit: 'contain' | 'cover' | 'stretch' | 'native';
      alignX: 'min' | 'center' | 'max';
      alignY: 'min' | 'center' | 'max';
      quad: [Point, Point, Point, Point];
    }
  | TableShape;

export type EngineRasterLayerPrimitive = Extract<Primitive, { kind: 'rasterLayer' }>;

// ── Native table primitive (ADR-0016) ───────────────────────────────────────

/**
 * Precomputed per-cell text payload. Lines are wrapped deterministically at
 * compile time (editor layout), so replay needs no font measurement.
 */
export interface TableCellTextIR {
  lines: string[];
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  color: EngineColor;
  alignH: 'left' | 'center' | 'right';
  alignV: 'top' | 'middle' | 'bottom';
  padding: number;
}

/** One fully-positioned table cell in the render IR. */
export interface TableCellIR {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: EngineColor;
  /** Optional per-cell border override (header emphasis, selection). */
  border?: { color: EngineColor; width: number };
  text?: TableCellTextIR;
  /**
   * Rich scene content: a compiled item in the cell's local coordinate
   * space (the table transform is NOT applied again). Painted after the
   * cell fill, clipped to the cell rect (minus padding).
   */
  content?: RenderItem;
  /** Grid coordinates of the cell's top-left corner. */
  rowIdx: number;
  columnIdx: number;
  /** Span extents (1 = no span). Used to suppress dividers through merged cells. */
  rowSpan: number;
  columnSpan: number;
}

/**
 * Compiled native table. The editor layout engine precomputes every cell
 * rect, fill, border, and wrapped text line; the engine only paints.
 * `colPositions`/`rowPositions` drive the inner dividers (first track edges
 * are 0; dividers sit at the remaining edges).
 */
export interface TableShape {
  kind: 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  cornerRadius: number;
  borderColor: EngineColor;
  borderWidth: number;
  dividerColor: EngineColor;
  dividerWidth: number;
  colPositions: number[];
  rowPositions: number[];
  cells: TableCellIR[];
}

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

// ── Shaped text types ──────────────────────────────────────────────────────

/**
 * A single shaped glyph record produced by a shaping engine (rustybuzz native,
 * or the TS measurement bridge for the web/stub backend).
 */
export interface ShapedGlyph {
  /** Glyph ID in the font (glyph index). */
  glyphId: number;
  /** Advance width (horizontal), in px at font size. */
  xAdvance: number;
  /** Advance height (vertical), in px. */
  yAdvance: number;
  /** X offset from the glyph origin (GPOS mark/kerning adjustments). */
  xOffset: number;
  /** Y offset from the glyph origin. */
  yOffset: number;
  /**
   * UTF-16 index into the original text where this glyph's cluster starts.
   * For ligatures this maps to the first codepoint of the cluster.
   */
  clusterUtf16: number;
}

/**
 * A contiguous run of glyphs shaped with the same font, size, direction, script.
 */
export interface ShapedRun {
  /** Resolved font family (with source). */
  fontFamily: string;
  /** Font size in px. */
  fontSize: number;
  /** Font weight (numeric). */
  fontWeight: number;
  /** Font style. */
  fontStyle: 'normal' | 'italic';
  /** Run direction. */
  direction: 'ltr' | 'rtl';
  /** Embedding level (0 = base LTR, 1 = base RTL, 2+ = nested). */
  level: number;
  /** ISO 15924 script code for font fallback. */
  script: string;
  /** Shaped glyphs in logical (shaping) order. */
  glyphs: ShapedGlyph[];
  /** Total advance width of this run. */
  width: number;
  /** Maximum ascent above baseline in this run. */
  ascent: number;
  /** Maximum descent below baseline. */
  descent: number;
}

/**
 * Result of shaping a full text primitive.
 * One canonical layout result shared by rendering, hit-testing, selection, and export.
 */
export interface TextShaping {
  /** Shaped runs in logical order (after BiDi run segmentation). */
  runs: ShapedRun[];
  /** Total width after shaping. */
  width: number;
  /** Total height (max ascent + max descent across runs). */
  height: number;
  /** Dominant paragraph base direction. */
  baseDirection: 'ltr' | 'rtl';
  /** Resolved text direction (per-paragraph override or auto-detect). */
  direction: 'ltr' | 'rtl';
}

/**
 * Capability flags that a shaping backend exposes to callers.
 * Consumers use these to decide whether glyph-ID features
 * (native PDF text, ligature-accurate outlining) are available.
 */
export interface ShapingCapabilities {
  /** Backend produces real glyph IDs (not 0). */
  supportsGlyphIds: boolean;
  /** Backend handles GSUB/GPOS for complex scripts. */
  supportsComplexScripts: boolean;
  /** Backend exposes cluster boundaries. */
  supportsClusters: boolean;
  /** Backend applies ligature substitutions. */
  supportsLigatures: boolean;
  /** Backend provides font fallback within a run. */
  supportsFontFallback: boolean;
  /** Backend applies OpenType variation axes. */
  supportsVariationAxes: boolean;
  /** Backend resolves colour glyphs (COLR/CPAL). */
  supportsColorGlyphs: boolean;
  /** Backend can provide glyph outline paths. */
  supportsOutlines: boolean;
  /** Human-readable backend identifier. */
  backend: 'canvas2d' | 'rustybuzz-native' | 'rustybuzz-wasm' | 'harfbuzz';
}

/**
 * Input to a native (Rustybuzz / HarfBuzz) shaping call.
 * This is the full shaping request contract that gets
 * serialised over Tauri IPC.
 */
export interface NativeShapeRequest {
  /** Text to shape. */
  text: string;
  /** Font identifier (family name, PostScript name, or content hash). */
  fontId: string;
  /** Font binary data (TTF/OTF) as a Uint8Array-compatible number array. */
  fontData: number[];
  /** Zero-based face index in a TTC/OTC collection. */
  faceIndex?: number;
  /** Font size in design-space units. */
  fontSize: number;
  /** ISO 639-1 language tag (e.g. "en", "ar"). */
  language?: string;
  /** ISO 15924 script code (e.g. "Latn", "Arab"). */
  script?: string;
  /** Text direction. */
  direction?: 'ltr' | 'rtl';
  /** OpenType feature tags to enable (e.g. ["liga", "kern", "dlig"]). */
  features?: string[];
  /** OpenType feature tags to disable. */
  disableFeatures?: string[];
  /** Variable font axis coordinates (tag -> value). */
  variationAxes?: Record<string, number>;
  /** Letter spacing in font units. */
  letterSpacing?: number;
  /** Word spacing in font units. */
  wordSpacing?: number;
}

/**
 * Response from a native shaping call — one per font+run.
 */
export interface NativeShapeResponse {
  /** Glyph records in visual order. */
  glyphs: ShapedGlyph[];
  /** Total advance width. */
  width: number;
  /** Maximum ascent. */
  ascent: number;
  /** Maximum descent. */
  descent: number;
  /** Line gap from font metrics. */
  lineGap: number;
  /** Resolved script. */
  script: string;
  /** Resolved direction. */
  direction: 'ltr' | 'rtl';
  /** Whether the font has colour glyphs (COLR/CPAL/SVG). */
  hasColorGlyphs: boolean;
  /** Any glyph IDs that map to .notdef (missing glyphs). */
  missingGlyphIndices: number[];
  /** Errors per cluster (e.g. unsupported feature). */
  warnings?: string[];
}

/** Default Canvas2D capabilities — always available, no glyph IDs. */
export const CANVAS2D_SHAPING_CAPABILITIES: ShapingCapabilities = {
  supportsGlyphIds: false,
  supportsComplexScripts: true,
  supportsClusters: true,
  supportsLigatures: true,
  supportsFontFallback: true,
  supportsVariationAxes: true,
  supportsColorGlyphs: false,
  supportsOutlines: false,
  backend: 'canvas2d',
};

/** Native rustybuzz capabilities — full feature set. */
export const NATIVE_SHAPING_CAPABILITIES: ShapingCapabilities = {
  supportsGlyphIds: true,
  supportsComplexScripts: true,
  supportsClusters: true,
  supportsLigatures: true,
  supportsFontFallback: true,
  supportsVariationAxes: true,
  supportsColorGlyphs: true,
  supportsOutlines: true,
  backend: 'rustybuzz-native',
};

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
      threshold?: number;
      intensity?: number;
      softness?: number;
      invert?: boolean;
      foregroundColor?: [number, number, number];
      backgroundColor?: [number, number, number];
      channelAngles?: { c?: number; m?: number; y?: number; k?: number };
      registrationOffset?: {
        c?: [number, number];
        m?: [number, number];
        y?: [number, number];
        k?: [number, number];
      };
      tacLimit?: number;
      blackGeneration?: 'none' | 'gcr' | 'ucr';
      gcrStrength?: number;
      previewChannel?: 'composite' | 'c' | 'm' | 'y' | 'k';
      dotGain?: number;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'gradientMap';
      stops: {
        position: number;
        color: readonly [number, number, number, number];
        opacity?: number;
        midpoint?: number;
      }[];
      dither: boolean;
      preserveLuminosity: boolean;
      ditherSize?: 4 | 8;
      mode?: 'luminance' | 'channel';
      channelStops?: {
        r?: {
          position: number;
          color: readonly [number, number, number, number];
          opacity?: number;
          midpoint?: number;
        }[];
        g?: {
          position: number;
          color: readonly [number, number, number, number];
          opacity?: number;
          midpoint?: number;
        }[];
        b?: {
          position: number;
          color: readonly [number, number, number, number];
          opacity?: number;
          midpoint?: number;
        }[];
      };
      opacityStops?: {
        position: number;
        midpoint?: number;
        opacity: number;
      }[];
      reverse?: boolean;
      intensity?: number;
      luminanceMode?: import('./filters').GradientMapLuminanceMode;
      preserveSourceAlpha?: boolean;
      interpolation?: import('@varve/shared').GradientInterpolationSpace;
      lutSize?: number;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'tritone';
      shadowColor: readonly [number, number, number, number];
      midtoneColor: readonly [number, number, number, number];
      highlightColor: readonly [number, number, number, number];
      shadowPoint: number;
      highlightPoint: number;
      intensity: number;
      preserveLuminosity: boolean;
      interpolation?: 'smoothstep' | 'linear';
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'colorHalftone';
      screenSize: number;
      angle: number;
      dotShape: 'round' | 'square' | 'diamond' | 'line';
      mode: 'cmyk' | 'rgb' | 'mono';
      intensity: number;
      inkColor?: readonly [number, number, number, number];
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'lut';
      /** Serialized LUT transform (JSON) embedded in the document */
      lutJson: string;
      /** Original filename for display */
      originalFilename?: string;
      /** Assumed input colour space */
      inputSpace: string;
      /** Interpolation method: 'nearest' | 'trilinear' | 'tetrahedral' */
      interpolation: string;
      /** Mix/intensity (0..1) */
      intensity: number;
      /** Whether to linearize sRGB before applying the LUT */
      linearize: boolean;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'duotone';
      shadowColor: readonly [number, number, number, number];
      highlightColor: readonly [number, number, number, number];
      shadowPoint: number;
      highlightPoint: number;
      intensity: number;
      preserveLuminosity: boolean;
      interpolation?: 'smoothstep' | 'linear';
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'blackAndWhite';
      reds: number;
      yellows: number;
      greens: number;
      cyans: number;
      blues: number;
      magentas: number;
      brightness: number;
      tintColor?: readonly [number, number, number, number];
      preserveLuminosity: boolean;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'posterize';
      levels: number;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'threshold';
      level: number;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'dither';
      algorithm:
        | 'floyd-steinberg'
        | 'atkinson'
        | 'jarvis-judice-ninke'
        | 'stucki'
        | 'sierra'
        | 'bayer'
        | 'blue-noise';
      paletteMode: 'none' | 'levels' | 'custom';
      levels: number;
      colors: readonly (readonly number[])[];
      metric: 'rgb' | 'linear-rgb' | 'lab' | 'oklab';
      serpentine: boolean;
      strength: number;
      bayerSize: number;
      cellSize: number;
      alphaCutoff: number;
      seed: number;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'paletteSnap';
      colors: readonly (readonly number[])[];
      metric: 'rgb' | 'linear-rgb' | 'lab' | 'oklab';
      amount: number;
      dither: boolean;
      ditherAlgorithm:
        | 'floyd-steinberg'
        | 'atkinson'
        | 'jarvis-judice-ninke'
        | 'stucki'
        | 'sierra'
        | 'bayer'
        | 'blue-noise';
      ditherStrength: number;
      alphaCutoff: number;
      seed: number;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'bloom';
      threshold: number;
      softKnee: number;
      intensity: number;
      radius: number;
      diffusion: number;
      tint: readonly [number, number, number] | null;
      tintAmount: number;
      composite: 'screen' | 'add';
      streakEnabled: boolean;
      streakAngle: number;
      streakLength: number;
      streakIntensity: number;
      streakAspect: number;
      quality?: 'auto' | 'interactive' | 'normal' | 'export';
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'rgbSplit';
      mode: 'offset' | 'radial';
      redX: number;
      redY: number;
      greenX: number;
      greenY: number;
      blueX: number;
      blueY: number;
      amount: number;
      centerX: number;
      centerY: number;
      falloff: number;
      fringeAngle: number;
      borderMode: 'transparent' | 'clamp' | 'mirror' | 'wrap';
      intensity: number;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'crt';
      curvature: number;
      cornerRadius: number;
      scanlinePeriod: number;
      scanlineStrength: number;
      scanlineSoftness: number;
      phosphorMask: 'none' | 'rgb-stripe' | 'bgr-stripe' | 'aperture-grille' | 'shadow-mask';
      phosphorPitch: number;
      phosphorIntensity: number;
      glow: number;
      vignette: number;
      vignetteRadius: number;
      convergenceX: number;
      convergenceY: number;
      brightness: number;
      contrast: number;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'vhs';
      lumaNoise: number;
      chromaNoise: number;
      chromaBleed: number;
      jitter: number;
      tracking: number;
      dropouts: number;
      headSwitching: number;
      tearing: number;
      signalBlur: number;
      timeInstability: number;
      seed: number;
      time: number;
      frameRate: number;
      quality?: 'auto' | 'interactive' | 'normal' | 'export';
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'lightShafts';
      lightX: number;
      lightY: number;
      lightType: 'point' | 'directional';
      direction: number;
      intensity: number;
      exposure: number;
      decay: number;
      density: number;
      weight: number;
      sampleCount: number;
      scattering: number;
      tint: readonly [number, number, number] | null;
      occlusionSource: 'luminance' | 'alpha';
      quality?: 'auto' | 'interactive' | 'normal' | 'export';
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'lensFlare';
      sourceX: number;
      sourceY: number;
      brightness: number;
      scale: number;
      ghostCount: number;
      ghostSpacing: number;
      halo: number;
      apertureBlades: number;
      apertureRotation: number;
      streakIntensity: number;
      anamorphicRatio: number;
      chromaticDispersion: number;
      seed: number;
      quality?: 'auto' | 'interactive' | 'normal' | 'export';
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'lightLeak';
      seed: number;
      x: number;
      y: number;
      angle: number;
      size: number;
      softness: number;
      hue: number;
      saturation: number;
      lightness: number;
      intensity: number;
      noiseScale: number;
      opacity: number;
      blendMode: string;
    }
  | {
      kind: 'caustics';
      scale: number;
      depth: number;
      waveCount: number;
      complexity: number;
      refractionAmount: number;
      sharpness: number;
      lightAngle: number;
      brightness: number;
      contrast: number;
      dispersion: number;
      distortionAmount: number;
      output: 'combined' | 'lighting' | 'refraction';
      waterTint: readonly [number, number, number] | null;
      surfaceTint: readonly [number, number, number] | null;
      seed: number;
      time: number;
      animationSpeed: number;
      tileable: boolean;
      quality?: 'auto' | 'interactive' | 'normal' | 'export';
      opacity: number;
      blendMode: string;
    };

/** P2: Fill IR — a single fill in the render IR (solid, gradient, image, or pattern). */
export type FillIR =
  | { type: 'solid'; color: EngineColor; opacity: number; blendMode: BlendMode; visible: boolean }
  | {
      type: 'gradient';
      gradientType: 'linear' | 'radial' | 'angular' | 'diamond';
      stops: { position: number; color: EngineColor; midpoint?: number }[];
      rotation: number;
      interpolationSpace?: GradientInterpolationSpace;
      transform?: Affine;
      tilingMode?: GradientTilingMode;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'image';
      /** Render-time identity: resource handle for canonical assets, raw source otherwise. */
      src: string;
      /** Canonical scene asset id when this fill references one (diagnostics/provenance). */
      assetId?: string;
      fit: 'fill' | 'fit' | 'stretch' | 'tile' | 'crop';
      x: number;
      y: number;
      scale: number;
      imageWidth?: number;
      imageHeight?: number;
      /** Non-destructive crop window in source-pixel coordinates. */
      crop?: EngineImageCropRect;
      /** Rotation of image content in degrees clockwise. */
      rotation?: number;
      /** Horizontal flip of image content. */
      flipH?: boolean;
      /** Vertical flip of image content. */
      flipV?: boolean;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
      /** Alpha mask data URL for background removal compositing on shape nodes. */
      alphaMask?: string;
      /**
       * Animated-media source frame index (v2.20+). Present only on fills
       * whose asset is animated; the engine resolves the frame through the
       * media frame cache at replay time. Absent for static images.
       */
      frame?: number;
    }
  | {
      type: 'pattern';
      tileSrc: string;
      spacing: number;
      rotation: number;
      /** Tile width override in px. When omitted, natural image width is used. */
      imageWidth?: number;
      /** Tile height override in px. When omitted, natural image height is used. */
      imageHeight?: number;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'vec-pattern';
      shapes: EngineVecPatternShape[];
      tileWidth: number;
      tileHeight: number;
      spacing: number;
      rotation: number;
      transform?: [number, number, number, number, number, number];
      docRelative?: boolean;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    };

export interface Engine {
  readonly backend: Backend;
  buildIr(scene: Scene): Promise<RenderItem[]>;
  hitTest(scene: Scene, world: Point): Promise<number | null>;
}

export type Backend = 'native' | 'wasm' | 'stub';
