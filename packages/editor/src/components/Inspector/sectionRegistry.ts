/**
 * Section Registry — single source of truth for Inspector panel sections.
 *
 * Each section has a stable ID (survives renames), default visibility/collapse
 * state, availability predicates, and ordering metadata. The registry drives:
 * - PropertiesPanel composition (replaces hardcoded imports)
 * - DisclosureSection collapse/hidden state (centralized, not per-component)
 * - SectionManagerDialog (recovery UI for hidden sections)
 * - Workspace-mode-specific defaults
 *
 * Research basis: Figma section visibility, Sketch Inspector organization, APG Disclosure.
 */
import {
  canPaintFills,
  isAdjustmentEligible,
  isAnimatedMediaNode,
  isImageShape,
  type SceneNode,
} from '@varve/scene';
import type { WorkspaceMode } from '../../workspace/workspaceTypes';
import type { SelectionKind } from './selection/selectionState';

// ---------------------------------------------------------------------------
// Stable section identifiers
// ---------------------------------------------------------------------------

export type SectionId =
  | 'position-size'
  | 'corner-radius'
  | 'layout'
  | 'layout-child'
  | 'appearance'
  | 'mask'
  | 'selection-colors'
  | 'fills'
  | 'paint-library'
  | 'image-placement'
  | 'image-perspective'
  | 'image-resolution'
  | 'image-tuning'
  | 'image-enhancement'
  | 'background-removal'
  | 'stroke'
  | 'effects'
  | 'smart-filters'
  | 'adjustment-layer-access'
  | 'warp'
  | 'mockups'
  | 'typography'
  | 'text-on-path'
  | 'interaction'
  | 'component'
  | 'icon'
  | 'frame-presets'
  | 'frame-resize'
  | 'adjustment'
  | 'align-distribute'
  | 'cognitive-load'
  | 'prototype-flow'
  | 'brush-settings'
  | 'canvas-background'
  | 'document-color'
  | 'document-proof'
  | 'document-grid'
  | 'isometric-grid'
  | 'ai-denoise'
  | 'depth-mask'
  | 'lens-blur'
  | 'line-art'
  | 'image-crop'
  | 'animation'
  | 'content-aware-fill'
  | 'detect-text'
  | 'blend-images'
  | 'adaptive-contrast'
  | 'colorize'
  | 'ocr'
  | 'palette'
  | 'font-detect'
  | 'page-print'
  | 'table'
  | 'table-cells'
  | 'table-columns'
  | 'table-rows'
  | 'ai-tools-hint'
  | 'layer-states'
  | 'snapping'
  | 'insights';

// ---------------------------------------------------------------------------
// Section categories for management UI grouping
// ---------------------------------------------------------------------------

export type SectionCategory =
  | 'geometry'
  | 'appearance'
  | 'content'
  | 'advanced'
  | 'prototype'
  | 'tool'
  | 'canvas';

// ---------------------------------------------------------------------------
// Availability context — what the registry needs to evaluate predicates
// ---------------------------------------------------------------------------

export interface SectionAvailabilityContext {
  selectionKind: SelectionKind;
  selectedNodes: SceneNode[];
  sharedKind?: SceneNode['kind'];
  workspaceMode: WorkspaceMode;
  activeTool: string;
  prototypeMode: boolean;
  /** Active table edit session (ADR-0016), when editing a table. */
  tableEdit?: { tableId: string } | null;
  /** Current document (asset lookups for animated-media predicates). */
  document?: import('@varve/scene').Document | null;
}

// ---------------------------------------------------------------------------
// Section definition
// ---------------------------------------------------------------------------

export interface SectionDefinition {
  id: SectionId;
  title: string;
  /** Default expanded state when no user preference exists. */
  defaultExpanded: boolean;
  /**
   * Default expansion for nested subsections, keyed by `subsectionId`.
   *
   * Subsections have no top-level registry state of their own, so their
   * default must live here to stay a single source of truth: a missing entry
   * means "expanded". Declaring it here is what makes the first toggle move in
   * the direction the user sees (the toggle inverts the effective default).
   */
  subsections?: Record<string, { defaultExpanded: boolean }>;
  /** Can the user hide this section via the management UI? */
  canHide: boolean;
  /** Essential sections are always shown when available (not hideable). */
  essential: boolean;
  /** Display order within the properties panel (lower = higher). */
  order: number;
  /** Category for grouping in the management UI. */
  category: SectionCategory;
  /** Determine if this section applies given the current context. */
  isAvailable: (ctx: SectionAvailabilityContext) => boolean;
}

// ---------------------------------------------------------------------------
// Helper predicates
// ---------------------------------------------------------------------------

/**
 * True for exactly the nodes the image sections (placement, crop, AI denoise,
 * lens blur, line art, content-aware fill, detect text, OCR, blend, colorize)
 * actually render controls for. Delegates to `isImageShape` — the same check
 * every one of those section components uses internally — rather than
 * reimplementing a (previously narrower and out-of-sync) shape/fill test here.
 */
function isImageNode(nodes: SceneNode[]): boolean {
  return nodes.length === 1 && !!nodes[0] && isImageShape(nodes[0]);
}

/** Image Tuning is deliberately the one image inspector section with batch support. */
function isImageSelection(nodes: SceneNode[]): boolean {
  return nodes.length > 0 && nodes.every(isImageShape);
}

/**
 * BackgroundRemovalSection's real eligibility, mirrored from its own
 * `hasMask` check: an image fill, OR a node that already carries mask /
 * background-removal state from a previous run (whose fill may no longer be
 * classified as an image fill). Narrower than this — e.g. plain `isImageNode`
 * — would hide the section for a node the user just ran removal on.
 */
function isBackgroundRemovalEligible(nodes: SceneNode[]): boolean {
  if (nodes.length !== 1) return false;
  const n = nodes[0];
  if (!n) return false;
  if (isImageShape(n)) return true;
  const withState = n as SceneNode & {
    mask?: { rasterMask?: unknown };
    backgroundRemoval?: unknown;
  };
  return Boolean(withState.mask?.rasterMask) || Boolean(withState.backgroundRemoval);
}

function isFrameNode(nodes: SceneNode[]): boolean {
  return nodes.length === 1 && nodes[0]?.kind === 'frame';
}

function isComponentInstance(nodes: SceneNode[]): boolean {
  if (!isFrameNode(nodes)) return false;
  const frame = nodes[0] as SceneNode & { componentId?: string };
  return Boolean(frame.componentId);
}

/** Single selected native table node. */
function isTableNode(nodes: SceneNode[]): boolean {
  return nodes.length === 1 && nodes[0]?.kind === 'table';
}

/** A table edit session is active (cell/column/row sections show). */
function isTableEditActive(ctx: SectionAvailabilityContext): boolean {
  return ctx.tableEdit !== undefined && ctx.tableEdit !== null;
}

/** Single selected native table node. */

function isAdjustmentNode(nodes: SceneNode[]): boolean {
  return nodes.length === 1 && nodes[0]?.kind === 'adjustment';
}

function isAllTextNodes(nodes: SceneNode[]): boolean {
  return nodes.length > 0 && nodes.every((n) => n.kind === 'text');
}

function isAllStrokeNodes(nodes: SceneNode[]): boolean {
  return (
    nodes.length > 0 &&
    nodes.every((n) => n.kind === 'shape' || n.kind === 'text' || n.kind === 'frame')
  );
}

function isAllEffectNodes(nodes: SceneNode[]): boolean {
  return (
    nodes.length > 0 &&
    nodes.every(
      (n) =>
        n.kind === 'shape' ||
        n.kind === 'text' ||
        n.kind === 'frame' ||
        n.kind === 'adjustment' ||
        n.kind === 'path',
    )
  );
}

function hasNodes(ctx: SectionAvailabilityContext): boolean {
  return ctx.selectedNodes.length > 0;
}

function isSingleSelection(ctx: SectionAvailabilityContext): boolean {
  return ctx.selectionKind === 'single';
}

// ---------------------------------------------------------------------------
// Section registry — the canonical list
// ---------------------------------------------------------------------------

export const SECTION_DEFINITIONS: SectionDefinition[] = [
  // -- Geometry group --
  {
    id: 'position-size',
    title: 'Position & Size',
    defaultExpanded: true,
    canHide: false,
    essential: true,
    order: 100,
    category: 'geometry',
    isAvailable: (ctx) => hasNodes(ctx),
  },
  {
    id: 'corner-radius',
    title: 'Corner Radius',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 110,
    category: 'geometry',
    isAvailable: (ctx) =>
      ctx.selectedNodes.length > 0 &&
      ctx.selectedNodes.some(
        (n) =>
          n.kind === 'frame' ||
          (n.kind === 'shape' && (n as { shape?: { kind?: string } }).shape?.kind === 'rect'),
      ),
  },
  {
    id: 'layout',
    title: 'Stack / Grid',
    defaultExpanded: true,
    subsections: { layoutGuides: { defaultExpanded: false } },
    canHide: true,
    essential: false,
    order: 120,
    category: 'geometry',
    isAvailable: (ctx) => isSingleSelection(ctx) && isFrameNode(ctx.selectedNodes),
  },
  {
    // Child-owned layout controls (flow/absolute, per-axis sizing) for
    // non-frame nodes selected inside an auto-layout frame. Needs its own id
    // — reusing 'layout' would inherit its frame-only isAvailable gate.
    // Whether the parent actually has layoutStyle is a per-document check the
    // component itself makes (it renders nothing otherwise), not something
    // expressible in this static predicate.
    id: 'layout-child',
    title: 'Layout child',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 120,
    category: 'geometry',
    isAvailable: (ctx) => hasNodes(ctx) && !isFrameNode(ctx.selectedNodes),
  },
  // 'constraints' was merged into 'position-size' (ADR-0230). The id is
  // deliberately absent from the SectionId union and SECTION_DEFINITIONS.
  // Stale persisted state is silently dropped by migrateSectionState.

  // -- Appearance group --
  {
    id: 'appearance',
    title: 'Appearance',
    defaultExpanded: true,
    canHide: false,
    essential: true,
    order: 200,
    category: 'appearance',
    isAvailable: (ctx) => hasNodes(ctx),
  },
  {
    id: 'mask',
    title: 'Mask',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 210,
    category: 'appearance',
    isAvailable: (ctx) => isSingleSelection(ctx),
  },
  {
    id: 'selection-colors',
    title: 'Selection Colors',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 252,
    category: 'appearance',
    isAvailable: (ctx) => hasNodes(ctx),
  },
  {
    // The rendered section title is "Fill" (Figma's singular paint name with
    // stacked rows); the registry title matches so the Section Manager, the
    // collapsed header and the `fieldset` legend all say the same word.
    id: 'fills',
    title: 'Fill',
    defaultExpanded: true,
    canHide: false,
    essential: true,
    order: 220,
    category: 'appearance',
    // Only nodes whose renderer reads `fills` (shape/text/frame). Groups and
    // legacy line/arrow primitives never paint a fill, so showing the section
    // there produced an "Add fill" control that could not change the canvas.
    isAvailable: (ctx) => ctx.selectedNodes.some(canPaintFills),
  },
  {
    id: 'paint-library',
    title: 'Paint Library',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 230,
    category: 'appearance',
    isAvailable: (ctx) => hasNodes(ctx),
  },
  {
    id: 'stroke',
    title: 'Stroke',
    defaultExpanded: true,
    canHide: false,
    essential: true,
    order: 240,
    category: 'appearance',
    isAvailable: (ctx) => isAllStrokeNodes(ctx.selectedNodes),
  },
  {
    id: 'effects',
    title: 'Layer Effects',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 250,
    category: 'appearance',
    isAvailable: (ctx) => isAllEffectNodes(ctx.selectedNodes),
  },
  {
    id: 'smart-filters',
    title: 'Object Filters',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 245,
    category: 'appearance',
    isAvailable: (ctx) => isSingleSelection(ctx) && ctx.selectedNodes[0]?.kind !== 'adjustment',
  },
  {
    id: 'adjustment-layer-access',
    title: 'Adjustment Layer',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 246,
    category: 'appearance',
    isAvailable: (ctx) =>
      hasNodes(ctx) &&
      ctx.selectedNodes.every((node) => node.kind !== 'adjustment' && isAdjustmentEligible(node)),
  },
  {
    id: 'warp',
    title: 'Warp',
    defaultExpanded: true,
    subsections: { settings: { defaultExpanded: false } },
    canHide: true,
    essential: false,
    order: 255,
    category: 'appearance',
    isAvailable: (ctx) =>
      hasNodes(ctx) && ctx.selectedNodes.some((n) => 'warps' in n || ctx.activeTool === 'warp'),
  },

  // -- Content group --
  {
    id: 'typography',
    title: 'Typography',
    defaultExpanded: true,
    // Advanced sub-panels stay collapsed until the user asks for them. The
    // always-visible spine is content, family, weight, style, size,
    // line-height, letter-spacing and alignment; everything a first-time
    // user does not need (tracking, paragraph spacing, vertical align,
    // direction, writing mode, case, decoration, list, overflow, resize)
    // is one labelled row away rather than eleven rows of clutter.
    subsections: {
      advancedText: { defaultExpanded: false },
      openTypeFeatures: { defaultExpanded: false },
      variableFontAxes: { defaultExpanded: false },
      glyphAdjustments: { defaultExpanded: false },
    },
    canHide: true,
    essential: false,
    order: 300,
    category: 'content',
    isAvailable: (ctx) => isAllTextNodes(ctx.selectedNodes),
  },
  {
    id: 'text-on-path',
    title: 'Text on Path',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 310,
    category: 'content',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) &&
      ctx.selectedNodes[0]?.kind === 'text' &&
      (ctx.selectedNodes[0] as { textMode?: string }).textMode === 'path',
  },
  {
    id: 'mockups',
    title: 'Mockup',
    defaultExpanded: true,
    canHide: false,
    essential: false,
    order: 360,
    category: 'content',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) &&
      isFrameNode(ctx.selectedNodes) &&
      ctx.selectedNodes[0] != null &&
      'mockup' in (ctx.selectedNodes[0] as unknown as Record<string, unknown>),
  },
  {
    id: 'component',
    title: 'Component',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 105,
    category: 'content',
    isAvailable: (ctx) => isSingleSelection(ctx) && isComponentInstance(ctx.selectedNodes),
  },
  {
    id: 'icon',
    title: 'Icon',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 108,
    category: 'content',
    // Single node carrying a document icon asset reference.
    isAvailable: (ctx) => isSingleSelection(ctx) && Boolean(ctx.selectedNodes[0]?.iconAssetId),
  },
  {
    id: 'adjustment',
    title: 'Adjustment Layer',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 260,
    category: 'content',
    isAvailable: (ctx) => isSingleSelection(ctx) && isAdjustmentNode(ctx.selectedNodes),
  },
  {
    id: 'frame-presets',
    title: 'Frame Presets',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 125,
    category: 'tool',
    // The Frame tool's own Inspector content: with nothing selected, choosing
    // a preset places a new frame of that size.
    isAvailable: (ctx) => ctx.activeTool === 'frame' && ctx.selectionKind === 'empty',
  },
  {
    id: 'frame-resize',
    title: 'Resize to Preset',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    // Directly beneath Position & Size, whose W/H it sets.
    order: 102,
    category: 'geometry',
    // A selected, non-component frame can snap to a preset size (under any
    // tool). Separate from frame-presets so the two keep their own collapse
    // state: creation opens expanded, resizing stays one collapsed row.
    isAvailable: (ctx) =>
      isSingleSelection(ctx) &&
      isFrameNode(ctx.selectedNodes) &&
      !isComponentInstance(ctx.selectedNodes),
  },

  // -- Image-specific --
  {
    id: 'image-placement',
    title: 'Image Placement',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    // Follows Stroke so a mixed multi-selection still reaches it before the
    // effects tail; an all-image selection reorders it to the top of the tab
    // via IMAGE_SELECTION_ORDER below.
    order: 242,
    category: 'advanced',
    isAvailable: (ctx) => ctx.selectedNodes.length > 0 && ctx.selectedNodes.some(isImageShape),
  },
  {
    id: 'image-perspective',
    title: 'Perspective',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 272,
    category: 'advanced',
    isAvailable: (ctx) => isSingleSelection(ctx) && isImageNode(ctx.selectedNodes),
  },
  {
    id: 'image-resolution',
    title: 'Image Resolution',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 271,
    category: 'advanced',
    isAvailable: (ctx) => isSingleSelection(ctx) && isImageNode(ctx.selectedNodes),
  },
  {
    id: 'animation',
    title: 'Animation',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 260,
    category: 'advanced',
    // Only a single node whose fill references an animated asset.
    isAvailable: (ctx) =>
      isSingleSelection(ctx) &&
      ctx.selectedNodes.length === 1 &&
      ctx.selectedNodes[0] !== undefined &&
      ctx.document != null &&
      isAnimatedMediaNode(ctx.selectedNodes[0], ctx.document ?? undefined),
  },
  {
    id: 'image-crop',
    title: 'Crop & Bounds',
    defaultExpanded: true,
    subsections: {
      trimToSubject: { defaultExpanded: false },
      protectFaces: { defaultExpanded: false },
      expandBounds: { defaultExpanded: false },
    },
    canHide: true,
    essential: false,
    order: 275,
    category: 'advanced',
    // While the crop tool is active the tool-options popover owns this
    // surface (featureOwnership: 'tool-options', same convention as
    // brush-settings/frame-presets); the Inspector hosts it for
    // selection-based access under every other tool.
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.activeTool !== 'crop',
  },
  {
    id: 'ai-tools-hint',
    title: 'AI Tools',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 279,
    category: 'advanced',
    // The mirror image of the 11 sections below: shown only *outside* Photo
    // mode, so an image selection always has either the tools themselves or
    // a one-click way to reach them — never neither.
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode !== 'image',
  },
  {
    id: 'layer-states',
    title: 'Layer States',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 305,
    category: 'advanced',
    // Available whenever there is something to capture (a selection) or
    // previously captured states to apply. The section component renders
    // nothing when both are empty.
    isAvailable: (ctx) => hasNodes(ctx) || (ctx.document?.layerStates?.length ?? 0) > 0,
  },
  {
    id: 'image-tuning',
    title: 'Image Tuning',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 570,
    category: 'content',
    isAvailable: (ctx) => isImageSelection(ctx.selectedNodes),
  },
  {
    id: 'image-enhancement',
    title: 'Image & Vector',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 280,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'background-removal',
    title: 'Background Removal',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 290,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) &&
      isBackgroundRemovalEligible(ctx.selectedNodes) &&
      ctx.workspaceMode === 'image',
  },
  {
    id: 'colorize',
    title: 'Colorize',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 291,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'ai-denoise',
    title: 'AI Denoise',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 293,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },

  {
    id: 'depth-mask',
    title: 'Depth Mask',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 294,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'lens-blur',
    title: 'Depth Blur',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 295,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'line-art',
    title: 'Line Art',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 296,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'content-aware-fill',
    title: 'Content-Aware Fill',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 297,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'detect-text',
    title: 'Detect Text Regions',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 299,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'ocr',
    title: 'OCR / Recognize Text',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 299.5,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'blend-images',
    title: 'Frame Interpolation',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 300,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'palette',
    title: 'Extract Palette',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 301,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'table',
    title: 'Table',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 118,
    category: 'geometry',
    isAvailable: (ctx) => isSingleSelection(ctx) && isTableNode(ctx.selectedNodes),
  },
  {
    id: 'table-cells',
    title: 'Cells',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 119,
    category: 'content',
    isAvailable: (ctx) => isTableEditActive(ctx),
  },
  {
    id: 'table-columns',
    title: 'Columns',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 1195,
    category: 'content',
    isAvailable: (ctx) => isTableEditActive(ctx),
  },
  {
    id: 'table-rows',
    title: 'Rows',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 1196,
    category: 'content',
    isAvailable: (ctx) => isTableEditActive(ctx),
  },
  {
    id: 'font-detect',
    title: 'Identify Font',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 302,
    category: 'advanced',
    isAvailable: (ctx) =>
      isSingleSelection(ctx) && isImageNode(ctx.selectedNodes) && ctx.workspaceMode === 'image',
  },
  {
    id: 'adaptive-contrast',
    title: 'Adaptive Contrast',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 310,
    category: 'content',
    isAvailable: (ctx) => isAllTextNodes(ctx.selectedNodes),
  },

  // -- Selection geometry --
  {
    id: 'align-distribute',
    title: 'Align & Distribute',
    defaultExpanded: true,
    canHide: false,
    essential: true,
    order: 90,
    category: 'geometry',
    isAvailable: (ctx) => hasNodes(ctx),
  },

  // -- Analysis --
  {
    id: 'cognitive-load',
    title: 'Cognitive Load',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 500,
    category: 'advanced',
    isAvailable: (ctx) => hasNodes(ctx),
  },
  {
    // Document-level review surface. It stays available with or without a
    // selection (the whole-document audit is the point), renders last in the
    // Design composition, and is now registry-managed so a user who never
    // wants review chrome can hide it like any other optional section.
    id: 'insights',
    title: 'Insights',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 900,
    category: 'advanced',
    isAvailable: () => true,
  },

  // -- Prototype --
  {
    id: 'interaction',
    title: 'Prototype Interactions',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 400,
    category: 'prototype',
    // Authoring interactions (add trigger/action) is not gated behind
    // `prototypeMode` — InteractionSection has never checked that flag
    // internally, and `prototypeMode` currently has no UI toggle anywhere in
    // the app (see prototype-flow below), so requiring it here would make
    // this section permanently unreachable.
    isAvailable: (ctx) => isSingleSelection(ctx),
  },
  {
    id: 'prototype-flow',
    title: 'Prototype Flow',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 410,
    category: 'prototype',
    // Pre-existing: gated on `prototypeMode`, which has no UI toggle, so this
    // section is currently unreachable. Left as-is (unlike `interaction`
    // above) rather than un-gated here — the flow graph needs real width and
    // belongs in a dedicated Prototype panel, not a wider sidebar accordion.
    isAvailable: (ctx) => ctx.prototypeMode,
  },

  // -- Tool-specific --
  {
    id: 'brush-settings',
    title: 'Brush Settings',
    defaultExpanded: true,
    canHide: false,
    essential: true,
    order: 80,
    category: 'tool',
    isAvailable: (ctx) =>
      ctx.activeTool === 'paint' ||
      ctx.activeTool === 'eraser' ||
      ctx.activeTool === 'pencil' ||
      ctx.activeTool === 'smudge',
  },

  // -- Page-focused inspector (Page tool active) --
  {
    id: 'page-print',
    title: 'Page Print',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 590,
    category: 'geometry',
    isAvailable: (ctx) => ctx.activeTool === 'page',
  },

  // -- Canvas (empty selection) --
  {
    id: 'canvas-background',
    title: 'Canvas',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 600,
    category: 'canvas',
    isAvailable: (ctx) => ctx.selectionKind === 'empty',
  },
  {
    id: 'snapping',
    title: 'Snapping',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 605,
    category: 'canvas',
    isAvailable: (ctx) => ctx.selectionKind === 'empty',
  },
  {
    id: 'document-color',
    title: 'Document Color',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 610,
    category: 'canvas',
    isAvailable: (ctx) => ctx.selectionKind === 'empty',
  },
  {
    id: 'document-proof',
    title: 'Soft Proof',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 615,
    category: 'canvas',
    isAvailable: (ctx) => ctx.selectionKind === 'empty',
  },
  {
    id: 'document-grid',
    title: 'Document Grid',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 620,
    category: 'canvas',
    isAvailable: (ctx) => ctx.selectionKind === 'empty',
  },
  {
    id: 'isometric-grid',
    title: 'Isometric Grid',
    defaultExpanded: false,
    canHide: true,
    essential: false,
    order: 625,
    category: 'canvas',
    isAvailable: (ctx) => ctx.selectionKind === 'empty',
  },
];

// ---------------------------------------------------------------------------
// Registry lookup helpers
// ---------------------------------------------------------------------------

/** Map for O(1) section lookups by ID. */
const SECTION_MAP = new Map<SectionId, SectionDefinition>(
  SECTION_DEFINITIONS.map((def) => [def.id, def]),
);
const SECTION_DEFINITION_INDEX = new Map<SectionId, number>(
  SECTION_DEFINITIONS.map((def, index) => [def.id, index]),
);

/** Compare sections by explicit order, then by their declaration index. */
export function compareSectionDefinitions(a: SectionDefinition, b: SectionDefinition): number {
  const orderDelta = a.order - b.order;
  if (orderDelta !== 0) return orderDelta;
  return (
    (SECTION_DEFINITION_INDEX.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
    (SECTION_DEFINITION_INDEX.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

const ORDERED_SECTION_DEFINITIONS = [...SECTION_DEFINITIONS].sort(compareSectionDefinitions);

/** Return referential-integrity errors for the canonical section registry. */
export function getSectionRegistryIntegrityIssues(): string[] {
  const issues: string[] = [];
  const seenIds = new Set<string>();
  for (const definition of SECTION_DEFINITIONS) {
    if (seenIds.has(definition.id)) issues.push(`duplicate section id: ${definition.id}`);
    seenIds.add(definition.id);
    if (!definition.title.trim()) issues.push(`empty section title: ${definition.id}`);
    if (!Number.isFinite(definition.order)) issues.push(`invalid section order: ${definition.id}`);
    if (typeof definition.isAvailable !== 'function') {
      issues.push(`missing availability predicate: ${definition.id}`);
    }
    if (definition.essential && definition.canHide) {
      issues.push(`essential section is hideable: ${definition.id}`);
    }
  }
  return issues;
}

/** Get a section definition by ID. Returns undefined for unknown IDs (safe migration). */
/**
 * Contextual primary-band order for selections whose primary content is not
 * generic geometry. These values intentionally sit before the ordinary
 * registry orders. The primary band is protected from a saved global reorder
 * so a previous customization cannot make the selected object's main task
 * disappear below unrelated sections.
 */
const TEXT_SELECTION_ORDER: Partial<Record<SectionId, number>> = {
  typography: 70,
  'text-on-path': 71,
};

/**
 * Contextual order for image selections. A selected bitmap leads with the
 * controls that place and crop it (fit, flip, crop bounds) instead of
 * trailing eleven generic appearance sections — the 2026-09-15 real-photo
 * audit had to scroll past Mask, Paint Library, Object Filters and Layer
 * Effects to reach Crop & Bounds. Resolution and perspective deliberately
 * stay in the advanced tail: they are read-outs and rare operations, not
 * per-selection tasks.
 */
const IMAGE_SELECTION_ORDER: Partial<Record<SectionId, number>> = {
  'image-placement': 111,
  'image-crop': 112,
};

/** Table editing is a scoped content workflow, not generic frame geometry. */
const TABLE_SELECTION_ORDER: Partial<Record<SectionId, number>> = {
  table: 70,
  'table-cells': 71,
  'table-columns': 72,
  'table-rows': 73,
};

/** Component and mockup context is more useful than generic appearance. */
const FRAME_CONTEXT_ORDER: Record<'component' | 'mockups' | 'frame-resize', number> = {
  component: 70,
  mockups: 71,
  'frame-resize': 72,
};

function hasActiveMask(ctx: SectionAvailabilityContext): boolean {
  if (ctx.selectedNodes.length !== 1) return false;
  const node = ctx.selectedNodes[0] as (SceneNode & { mask?: { visible?: boolean } }) | undefined;
  return Boolean(node?.mask) && node?.mask?.visible !== false;
}

/**
 * Returns whether a section belongs to the selection's contextual primary
 * band. The value is deliberately separate from `resolveSectionOrder`: the
 * composition can protect only the primary band while preserving the user's
 * saved order for secondary and advanced sections.
 */
export function isContextualPrimarySection(
  id: SectionId,
  ctx: SectionAvailabilityContext,
): boolean {
  const textOnly =
    ctx.selectedNodes.length > 0 && ctx.selectedNodes.every((node) => node.kind === 'text');
  if (textOnly && (id === 'typography' || id === 'text-on-path')) return true;

  const tableOnly = isSingleSelection(ctx) && isTableNode(ctx.selectedNodes);
  if (tableOnly && id in TABLE_SELECTION_ORDER) return true;

  const frameOnly = isSingleSelection(ctx) && isFrameNode(ctx.selectedNodes);
  if (frameOnly) {
    const frame = ctx.selectedNodes[0] as SceneNode & {
      componentId?: string;
      mockup?: unknown;
    };
    if (id === 'component' && frame.componentId) return true;
    if (id === 'mockups' && frame.mockup) return true;
    if (id === 'frame-resize') return true;
  }

  return id === 'mask' && hasActiveMask(ctx);
}

export function resolveSectionOrder(
  def: SectionDefinition,
  ctx: SectionAvailabilityContext,
): number {
  const singleSelection = isSingleSelection(ctx);
  const tableSelection = singleSelection && isTableNode(ctx.selectedNodes);
  const frameSelection = singleSelection && isFrameNode(ctx.selectedNodes);
  const textOnly =
    ctx.selectedNodes.length > 0 && ctx.selectedNodes.every((node) => node.kind === 'text');
  if (textOnly) return TEXT_SELECTION_ORDER[def.id] ?? def.order;
  const imageOnly = ctx.selectedNodes.length > 0 && isImageNode(ctx.selectedNodes);
  if (imageOnly) {
    return IMAGE_SELECTION_ORDER[def.id] ?? def.order;
  }
  if (tableSelection) {
    return TABLE_SELECTION_ORDER[def.id] ?? def.order;
  }
  if (frameSelection) {
    const frame = ctx.selectedNodes[0] as SceneNode & {
      componentId?: string;
      mockup?: unknown;
    };
    if (def.id === 'component' && frame.componentId) return FRAME_CONTEXT_ORDER.component;
    if (def.id === 'mockups' && frame.mockup) return FRAME_CONTEXT_ORDER.mockups;
    if (def.id === 'frame-resize') return FRAME_CONTEXT_ORDER['frame-resize'];
  }
  if (def.id === 'mask' && hasActiveMask(ctx)) return 72;
  return def.order;
}

export function getSectionDefinition(id: SectionId): SectionDefinition | undefined {
  return SECTION_MAP.get(id);
}

/** Get all section definitions, sorted by order. */
export function getAllSections(): readonly SectionDefinition[] {
  return ORDERED_SECTION_DEFINITIONS;
}

/** Get sections available for the current context, sorted by order. */
export function getAvailableSections(ctx: SectionAvailabilityContext): SectionDefinition[] {
  if (
    ctx.selectionKind === 'single' &&
    ctx.selectedNodes.length === 1 &&
    ctx.selectedNodes[0]?.kind === 'adjustment'
  ) {
    const adjustment = getSectionDefinition('adjustment');
    return adjustment ? [adjustment] : [];
  }
  return SECTION_DEFINITIONS.filter((def) => def.isAvailable(ctx)).sort(compareSectionDefinitions);
}

/** Get all hideable section IDs. */
export function getHideableSectionIds(): SectionId[] {
  return SECTION_DEFINITIONS.filter((def) => def.canHide).map((def) => def.id);
}

/** Get all section IDs. */
export function getAllSectionIds(): SectionId[] {
  return ORDERED_SECTION_DEFINITIONS.map((def) => def.id);
}

/** Section IDs grouped by category. */
export function getSectionsByCategory(): Map<SectionCategory, SectionDefinition[]> {
  const grouped = new Map<SectionCategory, SectionDefinition[]>();
  for (const def of ORDERED_SECTION_DEFINITIONS) {
    const list = grouped.get(def.category) ?? [];
    list.push(def);
    grouped.set(def.category, list);
  }
  return grouped;
}

/** Category display labels. */
export const CATEGORY_LABELS: Record<SectionCategory, string> = {
  geometry: 'Geometry',
  appearance: 'Appearance',
  content: 'Content',
  advanced: 'Advanced',
  prototype: 'Prototype',
  tool: 'Tool',
  canvas: 'Canvas',
};
