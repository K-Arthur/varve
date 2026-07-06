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

export type MaskType = 'clip' | 'alpha';

export interface Mask {
  type: MaskType;
  /** Id of the child node used as the mask source. Must be a child of the container. */
  sourceNodeId: NodeId;
  visible: boolean;
}

// ── Guide interface ──────────────────────────────────────────────────────────

export interface Guide {
  id: string;
  axis: 'horizontal' | 'vertical';
  position: number;
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
    };

export type GradientType = 'linear' | 'radial' | 'angular' | 'diamond';

export interface GradientStop {
  position: number;
  color: ManagedColor;
}

export interface GradientFill {
  type: GradientType;
  stops: GradientStop[];
  rotation?: number;
  /** Full 2x3 fill transform matrix. When set, overrides rotation.
   *  Maps fill-internal [0,0]×[1,1] space to the node's local space.
   *  Backward-compat: rotation field auto-applies as rotate transform. */
  transform?: import('@strata/engine').Affine;
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
  /** Paint order among siblings (0 = bottom). Reorder via Document.move. */
  index: number;
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
  shape: Shape;
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
}

export interface TextNode extends NodeBase {
  kind: 'text';
  text: string;
  transform: Affine;
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

export interface ImageNode extends NodeBase {
  kind: 'image';
  transform: Affine;
  /** Image source URL (data URL, file path, or asset id). */
  src: string;
  /** Width of the image node in world-space px. */
  w: number;
  /** Height of the image node in world-space px. */
  h: number;
  /** How the image fills the bounds. */
  imageFit?: ImageFit;
  /** F6: strokes on image. */
  strokes: Stroke[];
  /** F6: effects on image. */
  effects: Effect[];
  /** Background removal mask applied to this image. */
  backgroundRemoval?: BackgroundRemovalState;
}

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

export type SceneNode = ShapeNode | TextNode | GroupNode | FrameNode | ImageNode | AdjustmentNode | PathNode;

export type ContainerNode = GroupNode | FrameNode;

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
