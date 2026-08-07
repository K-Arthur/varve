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
 * Research basis: Figma section visibility, Sketch Inspector组织, APG Disclosure.
 */
import { isImageShape, type SceneNode } from '@varve/scene';
import type { WorkspaceMode } from '../../workspace/workspaceTypes';
import type { SelectionKind } from './selection/selectionState';

// ---------------------------------------------------------------------------
// Stable section identifiers
// ---------------------------------------------------------------------------

export type SectionId =
  | 'position-size'
  | 'corner-radius'
  | 'layout'
  | 'constraints'
  | 'appearance'
  | 'mask'
  | 'fills'
  | 'paint-library'
  | 'image-placement'
  | 'image-enhancement'
  | 'background-removal'
  | 'stroke'
  | 'effects'
  | 'warp'
  | 'mockups'
  | 'typography'
  | 'interaction'
  | 'component'
  | 'icon'
  | 'frame-presets'
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
  | 'lens-blur'
  | 'line-art'
  | 'image-crop'
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
  | 'ai-tools-hint';

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
}

// ---------------------------------------------------------------------------
// Section definition
// ---------------------------------------------------------------------------

export interface SectionDefinition {
  id: SectionId;
  title: string;
  /** Default expanded state when no user preference exists. */
  defaultExpanded: boolean;
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

function isRectNode(nodes: SceneNode[]): boolean {
  if (nodes.length !== 1) return false;
  const n = nodes[0];
  return Boolean(
    n && n.kind === 'shape' && (n as { shape?: { kind?: string } }).shape?.kind === 'rect',
  );
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

function isMultiSelection(ctx: SectionAvailabilityContext): boolean {
  return ctx.selectionKind === 'multi';
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
      isSingleSelection(ctx) && (isRectNode(ctx.selectedNodes) || isFrameNode(ctx.selectedNodes)),
  },
  {
    id: 'layout',
    title: 'Layout',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 120,
    category: 'geometry',
    isAvailable: (ctx) => isSingleSelection(ctx) && isFrameNode(ctx.selectedNodes),
  },
  {
    id: 'constraints',
    title: 'Constraints',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 115,
    category: 'geometry',
    isAvailable: (ctx) => hasNodes(ctx),
  },

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
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 210,
    category: 'appearance',
    isAvailable: (ctx) => isSingleSelection(ctx),
  },
  {
    id: 'fills',
    title: 'Fills',
    defaultExpanded: true,
    canHide: false,
    essential: true,
    order: 220,
    category: 'appearance',
    isAvailable: (ctx) => hasNodes(ctx),
  },
  {
    id: 'paint-library',
    title: 'Paint Library',
    defaultExpanded: true,
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
    title: 'Effects',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 250,
    category: 'appearance',
    isAvailable: (ctx) => isAllEffectNodes(ctx.selectedNodes),
  },
  {
    id: 'warp',
    title: 'Warp',
    defaultExpanded: true,
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
    canHide: true,
    essential: false,
    order: 300,
    category: 'content',
    isAvailable: (ctx) => isAllTextNodes(ctx.selectedNodes),
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
    category: 'content',
    // Two call sites share this id: the empty-selection "create" form (frame
    // tool active, nothing selected yet) and the single-selection "resize"
    // form (an existing, non-component frame selected, any tool).
    isAvailable: (ctx) =>
      ctx.activeTool === 'frame' ||
      (isSingleSelection(ctx) &&
        isFrameNode(ctx.selectedNodes) &&
        !isComponentInstance(ctx.selectedNodes)),
  },

  // -- Image-specific --
  {
    id: 'image-placement',
    title: 'Image Placement',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 270,
    category: 'advanced',
    isAvailable: (ctx) => isSingleSelection(ctx) && isImageNode(ctx.selectedNodes),
  },
  {
    id: 'image-crop',
    title: 'Crop & Bounds',
    defaultExpanded: true,
    canHide: true,
    essential: false,
    order: 275,
    category: 'advanced',
    isAvailable: (ctx) => isSingleSelection(ctx) && isImageNode(ctx.selectedNodes),
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
    id: 'lens-blur',
    title: 'Lens Blur',
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
    title: 'Blend Images',
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

  // -- Multi-select --
  {
    id: 'align-distribute',
    title: 'Align & Distribute',
    defaultExpanded: true,
    canHide: false,
    essential: true,
    order: 90,
    category: 'geometry',
    isAvailable: (ctx) => isMultiSelection(ctx),
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

/** Get a section definition by ID. Returns undefined for unknown IDs (safe migration). */
export function getSectionDefinition(id: SectionId): SectionDefinition | undefined {
  return SECTION_MAP.get(id);
}

/** Get all section definitions, sorted by order. */
export function getAllSections(): readonly SectionDefinition[] {
  return SECTION_DEFINITIONS;
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
  return SECTION_DEFINITIONS.filter((def) => def.isAvailable(ctx)).sort(
    (a, b) => a.order - b.order,
  );
}

/** Get all hideable section IDs. */
export function getHideableSectionIds(): SectionId[] {
  return SECTION_DEFINITIONS.filter((def) => def.canHide).map((def) => def.id);
}

/** Get all section IDs. */
export function getAllSectionIds(): SectionId[] {
  return SECTION_DEFINITIONS.map((def) => def.id);
}

/** Section IDs grouped by category. */
export function getSectionsByCategory(): Map<SectionCategory, SectionDefinition[]> {
  const grouped = new Map<SectionCategory, SectionDefinition[]>();
  for (const def of SECTION_DEFINITIONS) {
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
