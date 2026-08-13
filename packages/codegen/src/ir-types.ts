/**
 * Intermediate Representation types for design-to-code pipeline.
 *
 * This module defines the shared IR that normalizes Varve's scene model
 * into a format optimized for code generation across multiple targets.
 *
 * v2.1: flattening info, adjustment scope, responsive breakpoint inference,
 *       semantic HTML element hints, visual fidelity warnings.
 */

// ── Core IR Types ─────────────────────────────────────────────────────────────

export type SemanticKind =
  | 'container'
  | 'text'
  | 'image'
  | 'button'
  | 'link'
  | 'input'
  | 'list'
  | 'list-item'
  | 'navigation'
  | 'header'
  | 'footer'
  | 'main'
  | 'aside'
  | 'article'
  | 'section'
  | 'figure'
  | 'code'
  | 'quote'
  | 'divider'
  | 'icon'
  | 'avatar'
  | 'badge'
  | 'card'
  | 'dialog'
  | 'tooltip'
  | 'progress'
  | 'skeleton'
  | 'form'
  | 'search'
  | 'banner'
  | 'table'
  | 'unknown';

export interface SemanticRole {
  primary: SemanticKind;
  inferred: boolean;
  confidence: number;
  evidence?: string[];
}

export interface AccessibilityMetadata {
  label?: string;
  description?: string;
  role?: string;
  properties?: Record<string, string>;
  liveRegion?: boolean;
  keyboardNavigable?: boolean;
  focusable?: boolean;
  ariaExpanded?: boolean;
  ariaControls?: string;
  ariaSelected?: boolean;
  ariaHidden?: boolean;
  ariaCurrent?: 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false';
}

export type LayoutMode = 'flex' | 'grid' | 'absolute' | 'flow' | 'none';

export type Alignment = 'start' | 'center' | 'end' | 'stretch' | 'baseline';

export type JustifyContent = Alignment | 'space-between' | 'space-around' | 'space-evenly';

export type ConstraintAxis = 'min' | 'max' | 'center' | 'stretch' | 'scale' | 'fixed';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SizingSpec {
  mode: 'fixed' | 'hug' | 'fill' | 'percent' | 'auto';
  value: number;
  min?: number;
  max?: number;
}

export interface BreakpointBehavior {
  minWidth: number;
  maxWidth?: number;
  layout?: Partial<LayoutSpec>;
}

export interface ContainerQuerySpec {
  containerName: string;
  minWidth: number;
  layout?: Partial<LayoutSpec>;
}

export interface ResponsiveSpec {
  breakpoints: BreakpointBehavior[];
  containerQuery?: ContainerQuerySpec;
}

export interface OverflowSpec {
  x: 'visible' | 'hidden' | 'scroll' | 'auto' | 'clip';
  y: 'visible' | 'hidden' | 'scroll' | 'auto' | 'clip';
}

export interface FlexChildSpec {
  grow: number;
  shrink: number;
  basis: 'auto' | 'fill' | 'content' | number;
  alignSelf?: Alignment;
  order?: number;
}

export interface GridPlacement {
  column: number | 'auto';
  row: number | 'auto';
  columnSpan: number;
  rowSpan: number;
}

export interface LayoutSpec {
  mode: LayoutMode;
  direction: 'row' | 'column' | 'grid' | 'stack' | 'row-reverse' | 'column-reverse';
  padding: Spacing;
  gap: Spacing;
  alignItems: Alignment;
  justifyContent: JustifyContent;
  width: SizingSpec;
  height: SizingSpec;
  responsive: ResponsiveSpec;
  overflow: OverflowSpec;
  flex?: FlexChildSpec;
  gridPlacement?: GridPlacement;
  wrap?: boolean;
  position?: {
    type: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
  };
}

export interface ConstraintSpec {
  horizontal: ConstraintAxis;
  vertical: ConstraintAxis;
  preserveAspectRatio?: boolean;
}

export interface ColorStop {
  position: number;
  color: string;
  opacity: number;
}

export interface GradientSpec {
  type: 'linear' | 'radial' | 'conic' | 'diamond' | 'angular';
  stops: ColorStop[];
  rotation?: number;
  cx?: number;
  cy?: number;
  focalPoint?: { x: number; y: number };
}

export interface ImageFillSpec {
  src: string;
  fit: 'cover' | 'contain' | 'fill' | 'stretch' | 'tile' | 'none';
  position: { x: number; y: number };
  crop?: { x: number; y: number; w: number; h: number };
  imageWidth?: number;
  imageHeight?: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  focalPoint?: { x: number; y: number };
}

export type FillSpec =
  | { type: 'solid'; value: string; opacity: number }
  | { type: 'gradient'; gradient: GradientSpec; opacity: number }
  | { type: 'image'; image: ImageFillSpec; opacity: number }
  | { type: 'pattern'; value: string; opacity: number }
  | { type: 'token'; tokenId: string; opacity: number };

export interface ColorSpec {
  type: 'solid' | 'gradient' | 'image' | 'token' | 'pattern';
  value: string;
  fallback?: string;
}

export interface BorderSideSpec {
  width: number;
  color: string;
  style: 'solid' | 'dashed' | 'dotted' | 'double' | 'groove' | 'ridge' | 'none';
}

export interface StrokeSpec {
  fills: FillSpec[];
  weight: number;
  cap: 'round' | 'butt' | 'square';
  join: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  dashArray: number[];
  dashOffset: number;
  align: 'center' | 'inside' | 'outside';
}

export interface BorderSpec {
  top: BorderSideSpec;
  right: BorderSideSpec;
  bottom: BorderSideSpec;
  left: BorderSideSpec;
  uniform?: boolean;
}

export interface TypographySpec {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  textAlign?: 'left' | 'center' | 'right' | 'justify' | 'start' | 'end';
  decoration?: 'none' | 'underline' | 'line-through' | 'overline';
  decorationColor?: string;
  decorationStyle?: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';
  direction?: 'ltr' | 'rtl';
  writingMode?: 'horizontal-tb' | 'vertical-lr' | 'vertical-rl';
  variableAxes?: Record<string, number>;
  openTypeFeatures?: Record<string, boolean>;
  textIndent?: number;
  wordSpacing?: number;
  whiteSpace?: 'normal' | 'nowrap' | 'pre' | 'pre-wrap' | 'pre-line';
  overflowWrap?: 'normal' | 'break-word' | 'anywhere';
}

export interface ShadowSpec {
  type: 'drop-shadow' | 'inner-shadow';
  offsetX: number;
  offsetY: number;
  radius: number;
  spread: number;
  color: string;
  inset: boolean;
}

export interface BlurSpec {
  type: 'layer-blur' | 'background-blur';
  radius: number;
}

export type EffectSpec = ShadowSpec | BlurSpec;

export interface TransformOriginSpec {
  x: number | string;
  y: number | string;
}

export interface TransformSpec {
  translate: { x: number; y: number };
  rotate: number;
  scale: { x: number; y: number };
  skew?: { x: number; y: number };
  origin: TransformOriginSpec;
}

export interface BorderRadiusSpec {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface InteractionStateSpec {
  hover?: Partial<AppearanceSpec>;
  active?: Partial<AppearanceSpec>;
  focus?: Partial<AppearanceSpec>;
  disabled?: Partial<AppearanceSpec>;
}

export interface AppearanceSpec {
  background: FillSpec[];
  foreground: FillSpec[];
  strokes: StrokeSpec[];
  border: BorderSpec;
  typography: TypographySpec;
  effects: EffectSpec[];
  transform: TransformSpec;
  opacity: number;
  blendMode: BlendMode;
  borderRadius: BorderRadiusSpec;
  interactions: InteractionStateSpec;
  cursor?: 'pointer' | 'default' | 'text' | 'grab' | 'not-allowed';
  clipContent?: boolean;
}

export interface TokenBindings {
  background?: string;
  foreground?: string;
  border?: string;
  spacing?: string;
  typography?: string;
  radius?: string;
  shadow?: string;
  custom?: Record<string, string>;
}

export interface TextRun {
  text: string;
  style: Partial<TypographySpec>;
}

export interface TextContent {
  value: string;
  runs?: TextRun[];
  overset?: boolean;
}

export interface ImageContent {
  src: string;
  alt: string;
  fit: 'cover' | 'contain' | 'fill' | 'stretch' | 'tile' | 'none';
  position: { x: number; y: number };
  crop?: { x: number; y: number; w: number; h: number };
  focalPoint?: { x: number; y: number };
}

export interface IconContent {
  name: string;
  set: string;
}

export interface SvgContent {
  definition: string;
  viewBox?: string;
}

export type ContentType = 'text' | 'image' | 'icon' | 'svg' | 'none';

export interface ContentSpec {
  type: ContentType;
  text?: TextContent;
  image?: ImageContent;
  icon?: IconContent;
  svg?: SvgContent;
}

export interface ComponentRef {
  componentId: string;
  variantId?: string;
  slots: Record<string, string>;
  overrides: Record<string, unknown>;
}

export interface NodeMetadata {
  sourceNodeId: string;
  exportId: string;
  tags: string[];
  customData?: Record<string, unknown>;
}

// ── Flattening & Fidelity Types (v2.1) ─────────────────────────────────────────

export type FlattenReason =
  | 'adjustment-layer'
  | 'non-rect-shape'
  | 'inner-shadow'
  | 'background-blur'
  | 'layer-blur'
  | 'alpha-mask'
  | 'luminance-mask'
  | 'effect-mask'
  | 'angular-gradient'
  | 'diamond-gradient'
  | 'unsupported-blend'
  | 'pattern-fill'
  | 'stacked-fills'
  | 'multiple-strokes'
  | 'image-node'
  | 'glass-material'
  | 'chromatic-aberration'
  | 'halftone'
  | 'lut'
  | 'gradient-map'
  /**
   * A live nonlinear warp modifier. No CSS/Flutter/SwiftUI primitive can
   * express an envelope or mesh deformation, so the node must be flattened
   * rather than emitted as its unwarped source (ADR-0166).
   */
  | 'warp';

export interface FlattenInfo {
  /** Whether this node (or its subtree) requires raster fallback. */
  mustFlatten: boolean;
  /** Reasons this node cannot be represented natively. */
  reasons: FlattenReason[];
  /** If true, children must be flattened into this node's raster. */
  flattensChildren: boolean;
  /** Emit strategy: native HTML/CSS, raster image, or container with raster background. */
  emitAs: 'native' | 'image' | 'container-with-image';
  /** Pre-rasterized image data URL (populated by export flattening pipeline). */
  flattenedImageUrl?: string;
  /** Dimensions of the flattened image in CSS pixels. */
  flattenedWidth?: number;
  flattenedHeight?: number;
}

export interface AdjustmentScopeInfo {
  /** Scope mode: which nodes this adjustment targets. */
  mode: 'image-local' | 'explicit-targets' | 'container-descendant' | 'document' | 'legacy';
  /** Target node IDs this adjustment affects. */
  targetNodeIds: string[];
  /** Whether the adjustment can be represented as CSS filter functions. */
  cssFilterEquivalent: boolean;
  /** CSS filter string if cssFilterEquivalent is true. */
  cssFilterValue?: string;
}

export interface ResponsiveBreakpointInference {
  /** Inferred breakpoint at which this node's layout changes. */
  breakpoint: number;
  /** Confidence in the inferred breakpoint (0-1). */
  confidence: number;
  /** Layout changes at this breakpoint. */
  layoutChanges?: Partial<LayoutSpec>;
}

export interface SemanticNode {
  id: string;
  kind: SemanticKind;
  name: string;
  role: SemanticRole;
  accessibility: AccessibilityMetadata;
  layout: LayoutSpec;
  constraints: ConstraintSpec;
  appearance: AppearanceSpec;
  tokens: TokenBindings;
  content: ContentSpec;
  component?: ComponentRef;
  children: SemanticNode[];
  metadata: NodeMetadata;
  zIndex?: number;
  visible: boolean;
  locked: boolean;
  /** @since v2.1 — flattening analysis for export. */
  flattening?: FlattenInfo;
  /** @since v2.1 — adjustment scope for adjustment-layer nodes. */
  adjustmentScope?: AdjustmentScopeInfo;
  /** @since v2.1 — inferred responsive breakpoint behavior. */
  responsiveInference?: ResponsiveBreakpointInference;
}

// ── IR Document Types ───────────────────────────────────────────────────────────

export interface DocumentMetadata {
  documentId: string;
  name: string;
  generatedAt: number;
  generatorVersion: string;
  sourceFormat: 'strata' | 'figma' | 'sketch' | 'xd' | 'psd' | 'ai';
}

export interface TokenValue {
  value: string | number;
  type: 'color' | 'spacing' | 'dimension' | 'font' | 'other';
  description?: string;
}

export interface TokenLibrary {
  colors: Record<string, TokenValue>;
  spacing: Record<string, TokenValue>;
  typography: Record<string, TokenValue>;
  effects: Record<string, TokenValue>;
  radii: Record<string, TokenValue>;
  custom: Record<string, TokenValue>;
}

export interface BreakpointConfig {
  name: string;
  minWidth: number;
  maxWidth?: number;
  description?: string;
}

export interface SlotDefinition {
  id: string;
  name: string;
  required: boolean;
  defaultContent?: string;
}

export interface VariantDefinition {
  id: string;
  name: string;
  overrides: Record<string, unknown>;
}

export interface PropertyDefinition {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'color' | 'choice' | 'instance-swap';
  default: unknown;
  choices?: string[];
}

export interface ComponentDefinition {
  id: string;
  name: string;
  rootNode: string;
  slots: SlotDefinition[];
  variants: VariantDefinition[];
  properties: PropertyDefinition[];
}

export interface ComponentLibrary {
  [componentId: string]: ComponentDefinition;
}

export type HtmlElementHint =
  | 'div'
  | 'span'
  | 'button'
  | 'a'
  | 'img'
  | 'nav'
  | 'header'
  | 'footer'
  | 'main'
  | 'aside'
  | 'section'
  | 'article'
  | 'figure'
  | 'figcaption'
  | 'ul'
  | 'ol'
  | 'li'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'p'
  | 'input'
  | 'label'
  | 'textarea'
  | 'select'
  | 'form'
  | 'dialog'
  | 'progress'
  | 'table'
  | 'tr'
  | 'td'
  | 'th'
  | 'code'
  | 'strong'
  | 'search'
  | 'blockquote'
  | 'hr'
  | 'svg'
  | 'picture'
  | 'video'
  | 'canvas'
  | 'template';

export interface FidelityWarning {
  nodeId: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  category:
    | 'flattening'
    | 'adjustment'
    | 'mask'
    | 'effect'
    | 'font'
    | 'interaction'
    | 'accessibility';
}

export interface IRDocument {
  version: string;
  metadata: DocumentMetadata;
  nodes: Record<string, SemanticNode>;
  rootIds: string[];
  tokens: TokenLibrary;
  breakpoints: BreakpointConfig[];
  components: ComponentLibrary;
  unsupportedFeatures: string[];
  /** @since v2.1 — fidelity warnings per-node. */
  fidelityWarnings: FidelityWarning[];
  /** @since v2.1 — suggested HTML element for each node. */
  htmlHints: Record<string, HtmlElementHint>;
}

// ── IR Generation Types ──────────────────────────────────────────────────────

export interface SceneAnalysisResult {
  semanticMap: Map<string, SemanticRole>;
  layoutMap: Map<string, LayoutSpec>;
  componentMap: Map<string, ComponentRef>;
  tokenMap: Map<string, TokenBindings>;
}

export interface InferenceContext {
  parentRoles: SemanticRole[];
  siblingRoles: SemanticRole[];
  depth: number;
  documentStructure: Map<string, string[]>;
  siblings: SceneNodeInfo[];
}

export interface SceneNodeInfo {
  id: string;
  name: string;
  kind: string;
  role: SemanticRole;
}

export interface InferenceRule {
  pattern: NodePattern;
  role: SemanticRole;
  confidence: number;
}

export interface NodePattern {
  namePattern?: RegExp;
  kindPattern?: string[];
  childPattern?: NodePattern[];
  parentPattern?: NodePattern;
  propertyPattern?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  nodeId: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  nodeId: string;
  message: string;
  code: string;
}

// ── IR Diff Types ─────────────────────────────────────────────────────────────

export interface IRDiff {
  version: string;
  timestamp: number;
  changes: NodeChange[];
}

export interface NodeChange {
  nodeId: string;
  type: 'add' | 'remove' | 'modify';
  before?: SemanticNode;
  after?: SemanticNode;
}

// ── Audit-related IR types ─────────────────────────────────────────────────────

export type AuditCategory =
  | 'contrast'
  | 'typography'
  | 'layout'
  | 'accessibility'
  | 'vector'
  | 'raster'
  | 'color'
  | 'performance'
  | 'spacing'
  | 'codegen';

export interface AuditFinding {
  nodeId: string;
  nodeName: string;
  category: AuditCategory;
  severity: 'error' | 'warning' | 'info';
  message: string;
  recommendation?: string;
  autoFixAvailable: boolean;
}

export interface DesignAuditReport {
  documentId: string;
  timestamp: number;
  findings: AuditFinding[];
  byCategory: Record<AuditCategory, AuditFinding[]>;
  totalErrors: number;
  totalWarnings: number;
  totalInfo: number;
}

// ── Default Values ─────────────────────────────────────────────────────────────

export const DEFAULT_FILL_SPEC: FillSpec = { type: 'solid', value: '#000000', opacity: 1 };

export const DEFAULT_LAYOUT_SPEC: LayoutSpec = {
  mode: 'absolute',
  direction: 'stack',
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  gap: { top: 0, right: 0, bottom: 0, left: 0 },
  alignItems: 'start',
  justifyContent: 'start',
  width: { mode: 'fixed', value: 100 },
  height: { mode: 'fixed', value: 100 },
  responsive: { breakpoints: [] },
  overflow: { x: 'visible', y: 'visible' },
};

export const DEFAULT_APPEARANCE_SPEC: AppearanceSpec = {
  background: [{ type: 'solid', value: '#000000', opacity: 1 }],
  foreground: [{ type: 'solid', value: '#000000', opacity: 1 }],
  strokes: [],
  border: {
    top: { width: 0, color: '#000000', style: 'none' },
    right: { width: 0, color: '#000000', style: 'none' },
    bottom: { width: 0, color: '#000000', style: 'none' },
    left: { width: 0, color: '#000000', style: 'none' },
    uniform: true,
  },
  typography: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
  },
  effects: [],
  transform: {
    translate: { x: 0, y: 0 },
    rotate: 0,
    scale: { x: 1, y: 1 },
    origin: { x: 0, y: 0 },
  },
  opacity: 1,
  blendMode: 'normal',
  borderRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
  interactions: {},
};

export const DEFAULT_CONSTRAINT_SPEC: ConstraintSpec = {
  horizontal: 'min',
  vertical: 'min',
};

export const DEFAULT_ACCESSIBILITY: AccessibilityMetadata = {};

export const DEFAULT_TOKEN_BINDINGS: TokenBindings = {};

export const DEFAULT_CONTENT: ContentSpec = { type: 'none' };

export const DEFAULT_METADATA: NodeMetadata = {
  sourceNodeId: '',
  exportId: '',
  tags: [],
};

export const DEFAULT_BREAKPOINTS: BreakpointConfig[] = [
  { name: 'mobile', minWidth: 0, maxWidth: 639 },
  { name: 'tablet', minWidth: 640, maxWidth: 1023 },
  { name: 'desktop', minWidth: 1024, maxWidth: 1279 },
  { name: 'wide', minWidth: 1280 },
];

export const DEFAULT_FLATTEN_INFO: FlattenInfo = {
  mustFlatten: false,
  reasons: [],
  flattensChildren: false,
  emitAs: 'native',
};
