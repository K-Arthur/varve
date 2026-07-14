/**
 * Scene document types (Strata plan §3.1, §9 — slots-ready model).
 *
 * Node types: ShapeNode (rect/ellipse/circle/line/polygon/star), TextNode,
 * GroupNode (container), FrameNode (layout-capable container, doubles as
 * component instance via componentId).
 *
 * Layering note: the primitive geometry types (Affine, Color, Point, Shape) are
 * imported from @strata/engine for now. A later refactor moves them to
 * @strata/shared so scene does not depend on the renderer package.
 *
 * F6 (Inspector): extended with Stroke, Effect, BlendMode, opacity, rotation,
 * per-corner radius, and stacked-fill type enums. All new fields have safe
 * defaults so existing documents deserialize correctly.
 */
import type { Adjustment, Affine, PathPoint, Shape } from '@strata/engine';
import type { BleedConfig, ManagedColor, SafeAreaConfig, SlugConfig } from './colorManagement';
import type { ExportPreset } from './export-types';

export type NodeId = string;

export type LayerColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | null;

// ── Constraints types (Figma-style responsive positioning) ─────────────────

export type ConstraintAxis = 'min' | 'max' | 'center' | 'stretch' | 'scale';

export interface Constraints {
  horizontal: ConstraintAxis;
  vertical: ConstraintAxis;
}

// ── Mask types ──────────────────────────────────────────────────────────────

/**
 * Mask type determines how the mask source node controls visibility:
 * - 'clip': the source node's vector outline clips content (boolean, hard edge)
 * - 'alpha': the source node's alpha channel controls content opacity
 * - 'luminance': the source node's luminance (perceived brightness) controls
 *   content opacity. Black = transparent, white = opaque, following the SVG
 *   mask luminance formula: L = 0.2126*R + 0.7152*G + 0.0722*B (in linear RGB),
 *   multiplied by the source alpha.
 */
export type MaskType = 'clip' | 'alpha' | 'luminance';

/**
 * A mask on a container node (FrameNode, GroupNode, or AdjustmentNode).
 *
 * The mask designates one of the container's children as the mask source.
 * A mask source acts as a child (renders in the container) BUT the container
 * may choose to hide the mask source's direct rendering and instead use its
 * outline/alpha/luminance to clip or modulate the other children.
 *
 * Architecture notes:
 * - Masks are non-destructive and re-editable.
 * - A mask source must be a direct child of the container.
 * - A container may have at most one mask.
 * - Nested masks are supported via nested containers.
 * - The mask source can have effects, fills, strokes, and transforms;
 *   these all contribute to the mask's effective shape/alpha/luminance.
 *
 * Research basis: Figma mask model, Adobe Photoshop layer masks,
 * Affinity Designer pixel/vector masks, SVG <clipPath>/<mask> specs.
 */
export interface Mask {
  /** How the mask source controls visibility of masked content. */
  type: MaskType;
  /** Id of the child node used as the mask source. Must be a child of the container. */
  sourceNodeId: NodeId;
  /** Whether the mask is active. When false, the mask is ignored during rendering. */
  visible: boolean;
  /**
   * When true, the mask effect is inverted:
   * - clip: content inside the clip region is hidden, outside is visible
   * - alpha/luminance: transparent regions become opaque and vice versa
   * (default: false)
   */
  inverted?: boolean;
  /**
   * Feather radius in world-space pixels. Softens the mask edge by
   * applying a Gaussian blur to the mask's alpha/luminance values
   * before compositing. (default: 0, no feather)
   */
  feather?: number;
  /**
   * Overall mask density/strength as a value between 0 and 1.
   * 0 = mask has no effect (full visibility), 1 = full mask effect.
   * Applied after inversion and feather. (default: 1)
   */
  density?: number;
  /**
   * When true (default), the mask transforms with the masked content.
   * When false, the mask has its own independent transform.
   * (default: true)
   */
  linked?: boolean;
  /**
   * Independent mask transform used when linked === false.
   * If linked or transform is undefined, the mask source's own transform
   * is used (which itself is relative to the container).
   */
  transform?: Affine;
  /**
   * When true, the mask source node is hidden from direct rendering
   * but still contributes to the mask effect.
   * Like Figma's "hide mask source" or Photoshop's mask thumbnail.
   * (default: false — mask source is rendered normally)
   */
  hideMaskSource?: boolean;
}

// ── Guide interface ──────────────────────────────────────────────────────────

export interface Guide {
  id: string;
  axis: 'horizontal' | 'vertical';
  position: number;
  /** Page this guide belongs to (multi-page documents). Omitted on legacy flat docs. */
  pageId?: NodeId;
  locked?: boolean;
  color?: string;
}

// ── Appearance types (Inspector F6) ─────────────────────────────────────────

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
  color: ManagedColor;
  weight: number;
  align: StrokeAlign;
  dashPattern: number[];
  dashOffset: number;
  cap: StrokeCap;
  join: StrokeJoin;
  miterLimit: number;
  visible: boolean;
  /** Optional gradient for the stroke (takes precedence over `color` when set). */
  gradient?: GradientFill;
  /** Per-side weights for rects/frames: [top, right, bottom, left]. When set, overrides `weight`. */
  perSideWeights?: [number, number, number, number];
  /** Arrowhead at the start of a line/path. */
  arrowStart?: ArrowheadStyle;
  /** Arrowhead at the end of a line/path. */
  arrowEnd?: ArrowheadStyle;
}

export function defaultStroke(): Stroke {
  return {
    color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as ManagedColor,
    weight: 1,
    align: 'center',
    dashPattern: [],
    dashOffset: 0,
    cap: 'round',
    join: 'miter',
    miterLimit: 4,
    visible: true,
  };
}

export type Effect =
  | {
      type: 'dropShadow';
      x: number;
      y: number;
      blur: number;
      spread: number;
      color: ManagedColor;
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
      color: ManagedColor;
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
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'innerGlow';
      blur: number;
      spread: number;
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'glassMaterial';
      blur: number;
      tint: ManagedColor;
      tintOpacity: number;
      saturation: number;
      brightness: number;
      noise: number;
      edgeHighlight: boolean;
      edgeHighlightWidth: number;
      edgeHighlightColor: ManagedColor;
      edgeHighlightOpacity: number;
      visible: boolean;
    };

export type GradientType = 'linear' | 'radial' | 'angular' | 'diamond';

/** Color space for gradient stop interpolation (default: oklab). */
export type GradientInterpolationSpace = 'srgb' | 'oklab' | 'oklch' | 'hsl';

/** How a gradient extends beyond its defined stop range. */
export type GradientTilingMode = 'none' | 'repeat' | 'reflect';

export interface GradientStop {
  position: number;
  color: ManagedColor;
  /** Bias for 50% blend point toward the next stop (0-1, default 0.5). */
  midpoint?: number;
}

export interface GradientFill {
  type: GradientType;
  stops: GradientStop[];
  rotation?: number;
  /** Perceptually uniform interpolation space for stop blending. Default: oklab. */
  interpolationSpace?: GradientInterpolationSpace;
  /** Full 2x3 fill transform matrix. When set, overrides rotation.
   *  Maps fill-internal [0,0]×[1,1] space to the node's local space.
   *  Backward-compat: rotation field auto-applies as rotate transform. */
  transform?: import('@strata/engine').Affine;
  /** How the gradient tiles beyond its [0,1] stop range (default: none). */
  tilingMode?: GradientTilingMode;
}

/** How an image fill is sized relative to the node bounds. */
export type ImageFit = 'fill' | 'fit' | 'stretch' | 'tile';

export interface ImageFillData {
  /** Image source: data URL, file path, or asset id. Stub until asset system lands. */
  src: string;
  fit: ImageFit;
  /** Position offset in px (relative to node top-left) when fit !== 'fill'/'stretch'. */
  x: number;
  y: number;
  /** Scale multiplier (1 = natural). Used for 'tile' and 'fit'. */
  scale: number;
  /** Natural image width in pixels. When omitted, the node bounds width is used. */
  imageWidth?: number;
  /** Natural image height in pixels. When omitted, the node bounds height is used. */
  imageHeight?: number;
  /** Opacity multiplier specific to the image (combined with Fill.opacity). */
}

export interface PatternFillData {
  /** Reference to a tile node id or a data URL of the tile pattern. */
  tileSrc: string;
  /** Tile spacing in px between repetitions. */
  spacing: number;
  /** Rotation of the pattern in degrees. */
  rotation: number;
}

export type FillType = 'solid' | 'gradient' | 'image' | 'pattern';

export interface Fill {
  type: FillType;
  color?: ManagedColor;
  gradient?: GradientFill;
  image?: ImageFillData;
  pattern?: PatternFillData;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
}

/**
 * A first-class, independently-addressable Paint entity (v1.8+).
 *
 * A Paint wraps a Fill with identity (`id`, `name`) so it can be:
 * 1. Referenced by multiple nodes via `paintRefs[]` (paint reuse)
 * 2. Independently updated (changing one Paint updates all consumers)
 * 3. Promoted/demoted between inline `Fill[]` and shared `Paint` status
 *
 * Paint lives in the Document's `paints` map, alongside the existing
 * inline `fills[]` on each node. When a node has `paintRefs`, those paints
 * are resolved from `Document.paints` and used as the node's effective fill
 * stack — replacing the inline `fills`/`fill` for that node.
 *
 * Paint reuse is the key architectural change that decouples "what is painted"
 * from "where it is painted," letting the same image, gradient, or pattern
 * be used as the visual content of any number of nodes while being editable
 * in one place.
 */
export interface Paint {
  id: string;
  name: string;
  /** The fill content (solid, gradient, image, or pattern). */
  fill: Fill;
}

export function makePaint(id: string, name: string, fill: Fill): Paint {
  return { id, name, fill };
}

// ── Property Binding (task 1.2+) ────────────────────────────────────────────

export interface PropertyBinding {
  variableId: string;
  expression?: string;
}

// ── Base node ───────────────────────────────────────────────────────────────

export interface NodeBase {
  id: NodeId;
  name: string;
  /** Optional 7-color layer tag (Photoshop/Affinity-style). Null = no tag. */
  layerColor?: LayerColor;
  fill: ManagedColor;
  /** P2: stacked fills (solid/gradient/image). When present, takes precedence over `fill`. */
  fills?: Fill[];
  /**
   * V1.8+: Ordered references to shared Paint entities on the Document.
   * When present, these paints are resolved from `Document.paints` and used
   * as the node's effective fill stack, replacing `fills`/`fill` for this node.
   * Each entry is a Paint ID.
   */
  paintRefs?: string[];
  /**
   * Paint order among siblings (0 = bottom). Reorder via Document.move.
   * @deprecated Use `order` (fractional-indexing) instead. This field is set at
   * creation time but never updated by reorder operations — it is vestigial.
   */
  index?: number;
  /** Fractional-indexing order key for CRDT-safe concurrent ordering. */
  order: string;
  visible: boolean;
  locked: boolean;
  /** F6: layer opacity 0-1 (default 1). */
  opacity: number;
  /** F6: CSS blend mode (default 'normal'). */
  blendMode: BlendMode;
  /** F6: rotation in degrees (default 0). Applied to transform on render. */
  rotation: number;
  /**
   * F6: optional variable bindings per property.
   * Keyed by property name (e.g. "fill", "opacity", "x", "y", "width",
   * "height", "rotation", "fontSize", "strokeWeight").
   */
  bindings?: Record<string, PropertyBinding>;
  /** P3: min/preferred/max width for clamp sizing. */
  minWidth?: number;
  preferredWidth?: number;
  maxWidth?: number;
  /** P3: min/preferred/max height for clamp sizing. */
  minHeight?: number;
  preferredHeight?: number;
  maxHeight?: number;
  /** P3: how this node is sized within its parent's auto-layout. */
  layoutSizing?: LayoutSizing;
  /** P3: grid item placement within a grid parent. */
  gridPlacement?: GridItemPlacement;
  /** Figma-style constraints for responsive child positioning within frames. */
  constraints?: Constraints;
  /** Export presets for this node. */
  presets?: ExportPreset[];
  /** Reference to a reusable style definition. */
  styleId?: NodeId;
  /** Property overrides applied on top of the referenced style. */
  styleOverrides?: Record<string, unknown>;
  /** When true, this node is excluded from snapping calculations. */
  snapExcluded?: boolean;
}

export interface ShapeNode extends NodeBase {
  kind: 'shape';
  /** Geometry in local coordinates. When `shapeless` is true, geometry is
   *  derived from the node's paint (e.g. image natural dimensions) and this
   *  field may still hold a fallback/sentinel rect for backward compat. */
  shape: Shape;
  /**
   * V1.8+: When true, this node's geometry is derived from its paint rather
   * than from the explicit `shape` field. For an image paint, the geometry is
   * the image's natural dimensions. For solid/gradient paints, it's a 100×100
   * default rect.
   *
   * This is the mechanism that makes images first-class objects: a shapeless
   * ShapeNode with an image paint IS an image — its bounds come from the image
   * content, not from a host shape that clips it. The node still supports all
   * ShapeNode features (transform, effects, strokes, blend modes, masks).
   *
   * Backward compatible: existing nodes always have shapeless=false/undefined.
   */
  shapeless?: boolean;
  transform: Affine;
  /** F6: stacked strokes. */
  strokes: Stroke[];
  /** F6: stacked effects (shadows, blurs). */
  effects: Effect[];
  /** Uniform or per-corner radius for rect-anchored shapes. */
  cornerRadius?: number | [number, number, number, number];
  /** Corner smoothing percentage (0-100), Sketch-style continuous corners. */
  cornerSmoothing?: number;
  /** Background removal mask applied to this shape's image fill. */
  backgroundRemoval?: BackgroundRemovalState;
  /** Live trace state for nondestructive raster-to-vector workflow. */
  liveTrace?: LiveTraceState;
}

export interface TextNode extends NodeBase {
  kind: 'text';
  text: string;
  transform: Affine;
  /** Local text-container width. Present for area/fixed text, omitted for point text. */
  w?: number;
  /** Local text-container height. Present for area/fixed text, omitted for point text. */
  h?: number;
  /** Font size in px at 1x; variable-bindable across breakpoints (task 1.3). */
  fontSize: number;
  /** F6: font family — CSS-safe name or exact font. */
  fontFamily?: string;
  /** F6: font weight as CSS numeric or keyword. */
  fontWeight?: number;
  /** F6: font style (normal/italic). */
  fontStyle?: 'normal' | 'italic';
  /** F6: line-height multiplier. */
  lineHeight?: number;
  /** F6: letter-spacing in px. */
  letterSpacing?: number;
  /** F6: paragraph spacing in px. */
  paragraphSpacing?: number;
  /** F6: text alignment. */
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  /** F6: vertical text alignment. */
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  /** F6: text transform. */
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** F6: text decoration. */
  textDecoration?: 'none' | 'underline' | 'line-through';
  /** F6: list style for multi-line text. */
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  /** F6: text truncation/overflow behaviour. */
  textOverflow?: 'clip' | 'ellipsis' | 'visible';
  /** F6: resizing mode — auto-width/auto-height/fixed. */
  textResizing?: 'autoWidth' | 'autoHeight' | 'fixed';
  /** F6: OpenType feature flags (stub — e.g. { liga: true, kern: true }). */
  openTypeFeatures?: Record<string, boolean>;
  /** Variable font axis values (e.g. { wght: 500, wdth: 75 }). */
  variableAxes?: Record<string, number>;
  /** Rich text content (paragraphs with runs). When set, overrides `text`. */
  richText?: import('./typography').RichText;
  /** Text mode: point, area, path, or auto. */
  textMode?: import('./typography').TextMode;
  /** Path text settings (when textMode === 'path'). */
  pathTextSettings?: import('./typography').PathTextSettings;
  /** F6: stacked strokes on text. */
  strokes: Stroke[];
  /** F6: stacked effects on text. */
  effects: Effect[];
  /** Phase 5: Reference to a path/vector node whose shape the text follows. */
  pathId?: NodeId;
  /** Phase 5: 0-1 offset along the path to start text (default 0). */
  pathOffset?: number;
  /** Phase 5: Which side of the path text appears on. */
  pathSide?: 'top' | 'bottom';
}

export interface GroupNode extends NodeBase {
  kind: 'group';
  transform: Affine;
  /** Child node ids in paint order. */
  children: NodeId[];
  /** Optional mask applied to children (clip or alpha). */
  mask?: Mask;
  /**
   * When true, the group composites as an isolated group (backdrop is
   * transparent black). Default false (non-isolated = pass-through behavior
   * for normal blend mode). Per W3C isolated group behavior §8.3:
   * "An isolated group is one whose elements are composited onto a
   * transparent black initial backdrop."
   */
  isolated?: boolean;
  /** Effects applied to the group as a whole (shadows, blurs, glows). */
  effects: Effect[];
}

/** B2: TypeScript mirror of strata-layout LayoutStyle (Rust). */
export type LayoutMode = 'flex' | 'grid';
export type FlexDirection = 'row' | 'column' | 'rowReverse' | 'columnReverse';

export interface LayoutStyle {
  mode: LayoutMode;
  direction: FlexDirection;
  gap: number;
  wrap: boolean;
  /** [top, right, bottom, left] in px. */
  padding: [number, number, number, number];
  grow: number;
  shrink: number;
  /** F6: alignment and justification. */
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround';
  /** P3: Grid template columns (e.g., "1fr 200px 1fr", "repeat(3, 1fr)"). */
  gridTemplateColumns?: string;
  /** P3: Grid template rows (e.g., "auto 1fr auto"). */
  gridTemplateRows?: string;
  /** P3: Grid auto-flow: "row" | "column" | "row-dense" | "column-dense". */
  gridAutoFlow?: 'row' | 'column' | 'rowDense' | 'columnDense';
  /** P3: Row gap (separate from `gap` for grid). */
  rowGap?: number;
  /** P3: Column gap (separate from `gap` for grid). */
  columnGap?: number;
}

/** How a child is sized within its parent's auto-layout. */
export type LayoutSizing = 'fixed' | 'hug' | 'fill';

/** Grid item placement (column/row start/end or span). */
export interface GridItemPlacement {
  gridColumnStart?: number;
  gridColumnEnd?: number;
  gridRowStart?: number;
  gridRowEnd?: number;
}

export interface FrameNode extends NodeBase {
  kind: 'frame';
  transform: Affine;
  /** Frame width in world-space px. Set at creation; updated by resize. */
  w: number;
  /** Frame height in world-space px. Set at creation; updated by resize. */
  h: number;
  /** Child node ids in paint order. Slot bindings (task 1.1) extend this. */
  children: NodeId[];
  /** If this frame is a component instance, the component it instantiates. */
  componentId?: NodeId;
  /** Slot fills: slotId -> child NodeId (filled in task 1.1). */
  slots?: Record<string, NodeId>;
  /** B2: CSS layout properties (Taffy-backed). */
  layoutStyle?: LayoutStyle;
  /** Toggle clipping of children outside the frame bounds. Default true. */
  clipContent?: boolean;
  /** Optional mask applied to children (clip or alpha). */
  mask?: Mask;
  /** Active variant id for this component instance. */
  variant?: string;
  /** Per-property overrides on top of the variant/base component. */
  propertyOverrides?: Record<string, string | boolean | NodeId>;
  /** Last-synced property snapshot for override detection (component instances). */
  syncBaseline?: import('./component-sync').SyncBaseline;
  /** F6: strokes on frame. */
  strokes: Stroke[];
  /** F6: effects on frame. */
  effects: Effect[];
}

// ── Background Removal Types ─────────────────────────────────────────────────

export type BackgroundRemovalMethod = 'quick' | 'ai-balanced' | 'ai-quality';

export interface BackgroundRemovalState {
  maskDataUrl: string;
  method: BackgroundRemovalMethod;
  confidence: number;
  appliedAt: number;
  feather?: number;
  decontaminate?: boolean;
}

// ── Live Trace Types ─────────────────────────────────────────────────────────

export interface LiveTraceParams {
  mode: 'monochrome' | 'grayscale' | 'color';
  threshold: number;
  foreground: 'dark' | 'light';
  alphaThreshold: number;
  minArea: number;
  simplifyTolerance: number;
  maxPaths: number;
  maxColors: number;
  compoundHoles: boolean;
}

export function defaultLiveTraceParams(): LiveTraceParams {
  return {
    mode: 'monochrome',
    threshold: 128,
    foreground: 'dark',
    alphaThreshold: 1,
    minArea: 4,
    simplifyTolerance: 0.75,
    maxPaths: 1000,
    maxColors: 8,
    compoundHoles: true,
  };
}

export interface LiveTraceState {
  sourceNodeId: NodeId;
  params: LiveTraceParams;
  resolvedAt: number | null;
  lastError: string | null;
}

/** @deprecated Use ShapeNode with imageFill(). ImageNode no longer exists as a distinct node kind. */
export type ImageNode = ShapeNode;

// ── Adjustment Layer Types (Phase 1) ─────────────────────────────────────────

export type AdjustmentType = 'curves' | 'levels' | 'selectiveColor' | 'hsl' | 'exposure';

export interface AdjustmentCurvesPoint {
  x: number;
  y: number;
}

export interface AdjustmentCurves {
  channel: 'rgb' | 'red' | 'green' | 'blue';
  points: AdjustmentCurvesPoint[];
}

export interface AdjustmentLevels {
  channel: 'rgb' | 'red' | 'green' | 'blue';
  inputBlack: number;
  inputWhite: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
}

export type SelectiveColorTarget =
  | 'red'
  | 'green'
  | 'blue'
  | 'cyan'
  | 'magenta'
  | 'yellow'
  | 'white'
  | 'neutral'
  | 'black';

export interface AdjustmentSelectiveColor {
  color: SelectiveColorTarget;
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
  method: 'absolute' | 'relative';
}

export type AdjustmentParams = AdjustmentCurves | AdjustmentLevels | AdjustmentSelectiveColor;

export interface AdjustmentNode extends NodeBase {
  kind: 'adjustment';
  adjustmentType: AdjustmentType;
  params: AdjustmentParams;
  transform: Affine;
  /** When true, only affects the layer directly below this adjustment. */
  clipping: boolean;
  /** Adjustments can optionally have their own mask. */
  mask?: Mask;
  effects: Effect[];
  /** Nondestructive adjustment entries applied in sequence. */
  adjustments?: Adjustment[];
}

// ── Vector Path Node ─────────────────────────────────────────────────────────

/** @deprecated Use ShapeNode with kind:'path' shape instead. PathNode is
 *  preserved for backward compatibility with serialized documents. */
export interface PathNode extends NodeBase {
  kind: 'path';
  /** Control points in node-local coordinates. */
  points: PathPoint[];
  /** Whether the last point connects back to the first. */
  closed: boolean;
  transform: Affine;
  strokes: Stroke[];
  effects: Effect[];
}

// ── Raster Layer Node ─────────────────────────────────────────────────────────

export interface RasterTile {
  /** RGBA pixel data (128 * 128 * 4 bytes per tile). */
  pixels: Uint8ClampedArray;
  /** Monotonic version for cache invalidation. */
  version: number;
}

export interface RasterLayerNode extends NodeBase {
  kind: 'rasterLayer';
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Whether to constrain drawing to pixel grid. */
  pixelMode: boolean;
  /** Tile storage: key = "{col}:{row}" in 128×128 grid. */
  tiles: Map<string, RasterTile>;
  /** Local transform for positioning/rotation/scale. */
  transform: Affine;
}

export type SceneNode =
  | ShapeNode
  | TextNode
  | GroupNode
  | FrameNode
  | AdjustmentNode
  | PathNode
  | RasterLayerNode;

export type ContainerNode = GroupNode | FrameNode;

/** True if the node is a container (has a children array). */
export function isContainer(node: SceneNode): node is ContainerNode {
  return node.kind === 'frame' || node.kind === 'group';
}

// ── Page type ────────────────────────────────────────────────────────────────

export interface Page {
  id: NodeId;
  name: string;
  width: number;
  height: number;
  /** Per-page bleed override (inherits from Document.bleed when unset). */
  bleed?: BleedConfig;
  /** Per-page safe area override (inherits from Document.safeArea when unset). */
  safeArea?: SafeAreaConfig;
  /** Per-page slug override (inherits from Document.slug when unset). */
  slug?: SlugConfig;
  /** Page-level background shape layer ids (rendered behind content). */
  backgrounds: NodeId[];
  /** Group node id that holds all page content as children. */
  contentRoot: NodeId;
  /** Optional ruler origin offset within the page (artboard-local px). */
  rulerOrigin?: { x: number; y: number };
}

export type SlotKind = 'single' | 'multiple' | 'text';

export interface Slot {
  id: string;
  name: string;
  kind: SlotKind;
  /** Optional default content (NodeId of a node used as the default fill). */
  defaultContentId?: NodeId;
}

// ── Component Properties & Variants (Phase 3) ──────────────────────────────

export type ComponentPropertyType = 'text' | 'boolean' | 'instanceSwap' | 'variant';

export interface ComponentProperty {
  id: string;
  name: string;
  type: ComponentPropertyType;
  defaultValue: string | boolean | NodeId;
}

export interface Variant {
  id: string;
  name: string;
  /** Overrides for component properties. Only properties with values different
   *  from defaults need to be specified. */
  propertyValues: Record<string, string | boolean | NodeId>;
}

export interface PropertySet {
  id: string;
  name: string;
  propertyNames: string[];
}

export interface ComponentDefinition {
  id: NodeId;
  name: string;
  /** Typed slots this component accepts. */
  slots: Slot[];
  /** Root of the master tree (the synchronized template). */
  masterRootId: NodeId;
  /** Component properties for this component. */
  properties?: ComponentProperty[];
  /** Named variants that set multiple properties at once. */
  variants?: Variant[];
  /** Groups of properties that define variant axes. */
  propertySets?: PropertySet[];
}

// ── Reusable Style Types ─────────────────────────────────────────────────────

export type StyleType = 'color' | 'text' | 'effect' | 'layout';

export interface ColorStyle {
  id: NodeId;
  type: 'color';
  name: string;
  fill: Fill;
  description?: string;
}

export interface TextStyle {
  id: NodeId;
  type: 'text';
  name: string;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  paragraphSpacing?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  description?: string;
}

export interface EffectStyle {
  id: NodeId;
  type: 'effect';
  name: string;
  effects: Effect[];
  description?: string;
}

export interface LayoutStyleDef {
  id: NodeId;
  type: 'layout';
  name: string;
  layout: LayoutStyle;
  description?: string;
}

export type Style = ColorStyle | TextStyle | EffectStyle | LayoutStyleDef;

// ── Shape geometry helpers for Inspector F6 ─────────────────────────────────

/** Extract width from a Shape, returning 0 for non-sizeable shape kinds. */
export function shapeWidth(shape: Shape): number {
  switch (shape.kind) {
    case 'rect':
      return shape.w;
    case 'ellipse':
      return shape.rx * 2;
    case 'circle':
      return shape.r * 2;
    case 'polygon':
      return shape.radius * 2;
    case 'star':
      return shape.outerRadius * 2;
    case 'line':
      return Math.abs(shape.to[0] - shape.from[0]);
    case 'arrow':
      return Math.abs(shape.to[0] - shape.from[0]);
    case 'path': {
      if (shape.points.length === 0) return 0;
      const xs = shape.points.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    }
  }
}

/** Extract height from a Shape. */
export function shapeHeight(shape: Shape): number {
  switch (shape.kind) {
    case 'rect':
      return shape.h;
    case 'ellipse':
      return shape.ry * 2;
    case 'circle':
      return shape.r * 2;
    case 'polygon':
      return shape.radius * 2;
    case 'star':
      return shape.outerRadius * 2;
    case 'line':
      return Math.abs(shape.to[1] - shape.from[1]);
    case 'arrow':
      return Math.abs(shape.to[1] - shape.from[1]);
    case 'path': {
      if (shape.points.length === 0) return 0;
      const ys = shape.points.map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    }
  }
}
