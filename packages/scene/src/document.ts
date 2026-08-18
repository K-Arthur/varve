// COMPLEXITY: 100 — node ops, page ops, and component ops extracted to
// separate files (document-nodes.ts, document-pages.ts, document-components.ts).
// Remaining: factory functions, walk/validation, variable/paint/guide operations.

/**
 * Immutable scene Document + operations (Strata plan §3.1, §9).
 *
 * Operations return a new Document (structural sharing where practical). The
 * root is an ordered list of node ids; nodes live in a map. Paint order within
 * siblings is the array order; reorder via `moveNode` / `moveChild`.
 *
 * Container types: FrameNode + GroupNode (via `isContainer`/`getChildren`).
 * Reparent, group/ungroup, and detach-instance ops are available.
 * `walkNodes` recurses into both frame and group children.
 *
 * Ordering is array-index for the local-first editor (sufficient without sync).
 * CRDT-safe fractional ordering replaces it when sync lands (Phase 2, plan §1.1).
 */
import type { Affine, FontManifest, Shape } from '@varve/engine';
import type { DocumentUnit } from '@varve/shared';
import { generateKeyBetween, physicalToPx } from '@varve/shared';
import { stripBindingForVariable } from './bindings';
import type {
  BitDepth,
  BleedConfig,
  ColorConfig,
  ColorMode,
  ColorSwatch,
  ManagedColor,
  SafeAreaConfig,
  SlugConfig,
  SpotColorDef,
} from './colorManagement';
import { defaultColorConfig } from './colorManagement';
import { cryptoId, getParent, makeGroupNode } from './document-utils';
import type { ExportSettings } from './export-types';
import { DEFAULT_ARTWORK_FONT_FAMILY } from './fontDefaults';
import {
  type BaselineGrid,
  createDefaultDocumentGrid,
  createDefaultPixelGrid,
  type IsometricGrid,
  type PixelGrid,
  sanitizeGrid,
  validateGrid,
  validateIsometricGrid,
} from './gridTypes';
import { nextNodeId } from './node-id';
import { createEmptySelectionSetsData } from './selectionSet';
import { createTableModel, type TableColumnDefinition, type TableModel } from './table';
import type {
  ContainerNode,
  DocumentGrid,
  DocumentGridSettings,
  FrameNode,
  Guide,
  LayoutGrid,
  NodeId,
  Page,
  Paint,
  PathNode,
  SceneNode,
  ShapeNode,
  Style,
  TableNode,
  TextNode,
} from './types';
import { isContainer } from './types';
import type { Variable } from './variables';
import { createVariableStore, deleteVariable } from './variables';
import { CURRENT_DOCUMENT_VERSION } from './version';

export type { CreateMasterOptions } from './document-components';
export {
  activePageNodesWithMaster,
  addMasterOverride,
  assignMasterToPage,
  createMaster,
  deleteMaster,
  detachMasterOverride,
  duplicateMaster,
  pageHasOverrides,
  removeMasterOverride,
  renameMaster,
  reorderMasters,
  resetMasterOverrides,
  resolveNodeOrigin,
  setMasterAppliesTo,
} from './document-components';
// Re-export from new extracted files — keeps backward-compatible public API.
export {
  addChild,
  addNode,
  arrangeNode,
  detachInstance,
  getById,
  groupNodes,
  insertNode,
  instanceOverrides,
  moveChild,
  moveNode,
  removeNode,
  renameNode,
  reparentNode,
  resetInstanceOverrides,
  rootNodes,
  setBackgroundRemoval,
  setLayerColor,
  setSnapExcluded,
  swapInstance,
  ungroupNode,
} from './document-nodes';
export {
  activePageNodes,
  addGlobalChild,
  addPage,
  deletePageWithPolicy,
  duplicatePage,
  getFormattedPageNumber,
  getPageNumber,
  getPageSide,
  getSpreadForPage,
  isPageOnLeftSide,
  migrateToPages,
  rebuildSpreads,
  removeGlobalChild,
  removePage,
  renamePage,
  reorderPages,
  setActivePage,
  setFacingPagesEnabled,
  setPagePlacement,
  setPageSize,
  setPageSizeWithContentScale,
  spreadsFromProjection,
  toggleFacingPages,
} from './document-pages';

export { nextNodeId } from './node-id';
// Re-exported for existing same-package consumers that import these from
// './document' — their canonical homes are now './types' and './node-id'
// respectively, moved out to break the document.ts <-> clone.ts import cycle.
export { isContainer } from './types';

export interface Document {
  id: string;
  name: string;
  /** Schema version for migration (set by createDocument / migrateDocument). */
  formatVersion: string;
  /** Root-level node ids in paint order. */
  rootChildren: NodeId[];
  nodes: Record<NodeId, SceneNode>;
  /** Registered component definitions keyed by component id (task 1.1). */
  components: Record<NodeId, import('./types').ComponentDefinition>;
  /** Monotonic counter for id generation. */
  nextId: number;
  /** Canvas width in px (artboard/frame size). */
  canvasWidth?: number;
  /** Canvas height in px (artboard/frame size). */
  canvasHeight?: number;
  /** Canvas background color (RGBA). */
  canvasBackground?: ManagedColor;
  /** Per-document export defaults (optional — falls back to ExportSettings globals). */
  exportDefaults?: Partial<ExportSettings>;
  /**
   * Logo project (v2.12+): concepts, variants, brief, and palette metadata
   * over ordinary artboard frames. Optional — plain documents have none.
   */
  logoProject?: import('./types').LogoProject;
  /**
   * V1.8+: Reusable Paint entities keyed by paint id.
   * Each Paint wraps a Fill with identity so multiple nodes can reference
   * the same visual content via paintRefs. Paints are the mechanism for
   * paint reuse: changing one Paint updates all nodes that reference it.
   */
  paints?: Record<string, Paint>;
  /** Reusable styles keyed by style id (color, text, effect, layout). */
  styles?: Record<string, Style>;
  /** Persisted variable store with collections and modes. */
  variableStore?: import('./variables').VariableStore;
  /** References to installed libraries. */
  installedLibraries?: import('./library').InstalledLibraryRef[];
  /** Document font manifest (v2.9+). Records every font reference, identity,
   * embedding rights, and availability status for cross-device portability. */
  fontManifest?: FontManifest;
  /** Layout guides for aligning nodes on the canvas. */
  guides?: Guide[];
  /** Grid settings for document, layout, baseline, and pixel grids (v1.8+). */
  gridSettings?: import('./types').DocumentGridSettings;
  /** Pages (v1.2+). When unset, the document is in flat (pre-page) mode. */
  pages?: Page[];
  /** State machines for prototype interactions (v1.3). */
  stateMachines?: Record<string, import('./state-machine-types').StateMachine>;

  /** ID of the currently active page. Undefined for single-page documents. */
  activePageId?: NodeId;

  /** Node IDs of layers shared across all pages (visible on every page). */
  globalChildren?: NodeId[];

  // ── Print production properties (v1.1) ────────────────────────────────────

  /** Document color management configuration. */
  colorConfig?: ColorConfig;
  /** Document's display unit for measurements (px, pt, mm, cm, in, pc). */
  documentUnit?: DocumentUnit;
  /** Physical width in document units (e.g., 210 for A4 in mm). */
  physicalWidth?: number;
  /** Physical height in document units (e.g., 297 for A4 in mm). */
  physicalHeight?: number;
  /** DPI for print resolution (0 = screen/undefined). */
  dpi?: number;
  /** Bleed configuration. */
  bleed?: BleedConfig;
  /** Safe area / margin configuration. */
  safeArea?: SafeAreaConfig;
  /** Slug area configuration. */
  slug?: SlugConfig;
  /** Global color swatches. */
  swatches?: ColorSwatch[];
  /** Spot color definitions (legacy flat list; new documents use libraries). */
  spotColors?: SpotColorDef[];
  /** Named spot-color libraries (project/imported/user-global/builtin). */
  spotLibraries?: import('./colorManagement').SpotLibrary[];
  /** Soft-proof configuration (persisted print intent; never mutates colors). */
  proofConfig?: import('./proof').ProofConfig;

  /** Document-local gradient presets (v2.11+). Gradients used by gradient-map
   * effects are snapshotted here (or embedded on the effect) so documents stay
   * portable even when a global preset is renamed or deleted. */
  gradientPresets?: import('./gradientPresets').GradientPreset[];

  // ── Motion / Animation properties (v1.2+) ─────────────────────────────────

  /** Named timelines for per-node property animation. */
  timelines?: Record<string, import('./motion-types').Timeline>;
  /** The currently active timeline for playback. */
  activeTimelineId?: string;

  /** Prototype interactions keyed by node id (v1.6). */
  interactions?: Record<NodeId, import('./interaction-types').DocumentInteraction[]>;

  /** Phase 5+ motion extensions (skeleton, IK, mesh deform). */
  motionExtensions?: Record<string, import('./motion-types').MotionExtension>;
  /** Reusable motion presets captured from timelines. */
  motionPresets?: Record<string, import('./motion-types').MotionPreset>;

  // ── Typography: Linked text frames (v1.7) ───────────────────────────────────

  /**
   * Text flow chains for linked text frames (v1.7, legacy). Superseded by
   * `stories` (v2.18, ADR-0159): one authoritative story owns the text and
   * frames reference it through thread bindings. Migrated documents carry
   * stories; chains remain readable for pre-2.18 documents.
   */
  textChains?: Record<string, unknown>;

  /** Authoritative text stories (v2.18, ADR-0159), keyed by story id. */
  stories?: Record<NodeId, import('./types').TextStory>;

  // ── Brush presets (v1.10+) ──────────────────────────────────────────────────

  /** Brush presets keyed by preset id (v1.10+). */
  brushPresets?: Record<string, unknown>;

  // ── Master pages (v2.0+) ────────────────────────────────────────────────────

  /** Master pages keyed by master id. */
  masters?: Record<NodeId, import('./types').MasterPage>;

  /** Spreads for facing-page layout. */
  spreads?: import('./types').Spread[];

  /** Page sections for page numbering. */
  sections?: import('./types').PageSection[];

  /** Facing pages configuration. */
  facingPages?: import('./types').FacingPagesConfig;

  /** Spread persistence model (ADR-0128). Defaults to derived. */
  spreadModel?: import('./types').SpreadModel;

  /** Immutable PNG alpha-mask payloads keyed by asset id (v2.1+). */
  rasterMaskAssets?: Record<string, import('./types').RasterMaskAsset>;

  /**
   * Icon assets keyed by asset id (v2.x icon system). Each entry stores the
   * sanitized SVG and provenance (provider, licence, attribution) for icons
   * inserted from the icon browser or provider. Nodes reference entries via
   * `NodeBase.iconAssetId`. Embedded icons travel with the document, so a
   * provider outage can never break an existing document.
   */
  iconAssets?: Record<string, import('./iconAsset').DocumentIconAsset>;

  /**
   * Content-addressed image assets keyed by asset id (v2.6+).
   * Referenced from `ImageFillData.assetId` on any node's `fills[]` or a
   * shared `Paint`. See `DocumentAsset` doc comment in ./types.
   */
  assets?: Record<string, import('./types').DocumentAsset>;

  /** Persisted continuous depth fields keyed by resource id (resource v1). */
  depthMaps?: Record<string, import('./types').DepthMapAsset>;

  /**
   * Content-addressed ICC profile registry (v2.19+). Referenced from
   * `DocumentAsset.metadata.iccProfileId`; identical profiles share one
   * entry so raw profile bytes are never copied per asset or per placement.
   */
  iccProfiles?: Record<string, import('./types').IccProfileEntry>;

  /**
   * Mockup template assets keyed by template id (v2.16+). Templates are
   * self-contained scene-slot contracts embedded in the document so
   * save/reopen and offline use never depend on a library lookup. Referenced
   * by `FrameNode.mockup.templateId`. See mockup/types.ts.
   */
  mockupTemplates?: Record<string, import('./mockup/types').MockupTemplateAsset>;

  /** Persisted linter configuration (v2.7+). Undefined for pre-v2.7 docs,
   *  in which case DEFAULT_LINTER_CONFIG applies at scan time. */
  linterConfig?: import('./intelligence/linterTypes').LinterConfig;

  /** Named selection sets for saving and restoring selections. */
  selectionSets?: import('./selectionSet').SelectionSetsData;

  // ── Email template properties (v2.21+) ─────────────────────────────────────

  /**
   * Email template profile (v2.21+). Optional — documents without this field
   * are normal Varve designs. When present, the document can be compiled into
   * email HTML via the email workspace and email compiler pipeline.
   */
  emailProfile?: import('./emailTypes').EmailProfile;

  /**
   * Per-node email semantic metadata (v2.21+). Keyed by scene node ID.
   * Captures email-specific meaning (heading, paragraph, button, section, etc.)
   * that augments normal Varve design primitives for the email compiler.
   */
  emailSemantics?: import('./emailTypes').EmailSemanticMap;
}

export interface NodeEntry {
  nodeId: NodeId;
  node: SceneNode;
  parentId: NodeId | null;
  /** Recursive depth (0 for root-level). */
  depth: number;
}

export interface CreateDocumentOptions {
  flat?: boolean;
  colorMode?: ColorMode;
  /** Color channel bit depth. Defaults to 'uint8' when omitted. */
  bitDepth?: BitDepth;
  physicalWidth?: number;
  physicalHeight?: number;
  documentUnit?: DocumentUnit;
  bleed?: BleedConfig;
  dpi?: number;
}

export function createDocument(name?: string, flat?: boolean): Document;
export function createDocument(name?: string, opts?: CreateDocumentOptions): Document;
export function createDocument(
  name = 'Untitled',
  param2?: boolean | CreateDocumentOptions,
): Document {
  const base: Document = {
    id: cryptoId(),
    formatVersion: CURRENT_DOCUMENT_VERSION,
    name,
    rootChildren: [],
    nodes: {},
    components: {},
    nextId: 1,
    selectionSets: createEmptySelectionSetsData(),
  };

  if (param2 === true) {
    // Flat document: no pages, just root-level nodes
    return initializeDefaultGridSettings(base);
  }

  if (typeof param2 === 'object' && param2 !== null) {
    const opts = param2 as CreateDocumentOptions;
    if (opts.flat) {
      return initializeDefaultGridSettings(base);
    }

    // Page/frame geometry stays a resolution-independent world unit (fixed
    // 96dpi), matching how frame presets already express paper sizes — a
    // print document's `dpi` is a rasterization/export-time multiplier, not
    // something that changes base page geometry. physicalWidth/Height are
    // stored verbatim below (in their original documentUnit) as metadata.
    const unit: DocumentUnit = opts.documentUnit ?? 'px';
    const pageWidth = opts.physicalWidth != null ? physicalToPx(opts.physicalWidth, unit) : 1920;
    const pageHeight = opts.physicalHeight != null ? physicalToPx(opts.physicalHeight, unit) : 1080;

    const { id: contentRootId, doc: d1 } = nextNodeId(base);
    const contentRoot = makeGroupNode(contentRootId, {
      name: 'Page 1 content',
      children: [],
    });

    const page: Page = {
      id: cryptoId(),
      name: 'Page 1',
      order: generateKeyBetween(null, null),
      width: pageWidth,
      height: pageHeight,
      backgrounds: [],
      contentRoot: contentRootId,
    };

    return initializeDefaultGridSettings({
      ...d1,
      activePageId: page.id,
      globalChildren: [],
      pages: [page],
      rootChildren: [contentRootId],
      nodes: { ...d1.nodes, [contentRootId]: contentRoot },
      colorConfig: opts.colorMode ? defaultColorConfig(opts.colorMode, opts.bitDepth) : undefined,
      documentUnit: opts.documentUnit,
      physicalWidth: opts.physicalWidth,
      physicalHeight: opts.physicalHeight,
      bleed: opts.bleed,
      dpi: opts.dpi,
    });
  }

  // Create a default page with a contentRoot group (legacy behavior)
  const { id: contentRootId, doc: d1 } = nextNodeId(base);
  const contentRoot = makeGroupNode(contentRootId, {
    name: 'Page 1 content',
    children: [],
  });

  const page: Page = {
    id: cryptoId(),
    name: 'Page 1',
    order: generateKeyBetween(null, null),
    width: 1920,
    height: 1080,
    backgrounds: [],
    contentRoot: contentRootId,
  };

  return initializeDefaultGridSettings({
    ...d1,
    activePageId: page.id,
    globalChildren: [],
    pages: [page],
    rootChildren: [contentRootId],
    nodes: { ...d1.nodes, [contentRootId]: contentRoot },
  });
}

export {
  cryptoId,
  devValidate,
  getParent,
  makeGroupNode,
  validateDocument,
} from './document-utils';

export function makeAdjustmentNode(
  id: NodeId,
  adjustmentType: import('./types').AdjustmentType,
  params: import('./types').AdjustmentParams,
  opts: Partial<
    Pick<
      import('./types').AdjustmentNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'clipping'
      | 'effects'
      | 'order'
      | 'scope'
    >
  > = {},
): import('./types').AdjustmentNode {
  return {
    id,
    kind: 'adjustment',
    name: opts.name ?? adjustmentType.charAt(0).toUpperCase() + adjustmentType.slice(1),
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    fill: opts.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    adjustmentType,
    params,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    clipping: opts.clipping ?? false,
    effects: opts.effects ?? [],
    scope: opts.scope,
  };
}

export function makeShapeNode(
  id: NodeId,
  shape: Shape,
  opts: Partial<
    Pick<
      ShapeNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'cornerRadius'
      | 'cornerSmoothing'
      | 'order'
    >
  > = {},
): ShapeNode {
  return {
    id,
    kind: 'shape',
    name: opts.name ?? 'Shape',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    shape,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
    cornerRadius: opts.cornerRadius,
    cornerSmoothing: opts.cornerSmoothing,
  };
}

export function makeTextNode(
  id: NodeId,
  text: string,
  opts: Partial<
    Pick<
      TextNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'w'
      | 'h'
      | 'fontSize'
      | 'fontFamily'
      | 'fontWeight'
      | 'fontStyle'
      | 'lineHeight'
      | 'letterSpacing'
      | 'textAlign'
      | 'textCase'
      | 'textDecoration'
      | 'textAlignVertical'
      | 'textOverflow'
      | 'textResizing'
      | 'listStyle'
      | 'paragraphSpacing'
      | 'openTypeFeatures'
      | 'variableAxes'
      | 'richText'
      | 'textMode'
      | 'pathTextSettings'
      | 'direction'
      | 'language'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
    >
  > = {},
): TextNode {
  return {
    id,
    kind: 'text',
    name: opts.name ?? 'Text',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: true,
    locked: false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    text,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    w: opts.w,
    h: opts.h,
    fill: opts.fill ?? { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
    fontSize: opts.fontSize ?? 16,
    fontFamily: opts.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
    fontWeight: opts.fontWeight ?? 400,
    fontStyle: opts.fontStyle ?? 'normal',
    lineHeight: opts.lineHeight ?? 1.2,
    letterSpacing: opts.letterSpacing ?? 0,
    textAlign: opts.textAlign ?? 'left',
    textCase: opts.textCase,
    textDecoration: opts.textDecoration,
    textAlignVertical: opts.textAlignVertical,
    textOverflow: opts.textOverflow,
    textResizing: opts.textResizing,
    listStyle: opts.listStyle,
    paragraphSpacing: opts.paragraphSpacing,
    openTypeFeatures: opts.openTypeFeatures,
    variableAxes: opts.variableAxes,
    richText: opts.richText,
    textMode: opts.textMode,
    pathTextSettings: opts.pathTextSettings,
    direction: opts.direction,
    language: opts.language,
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
  };
}

export function makeFrameNode(
  id: NodeId,
  opts: Partial<
    Pick<
      FrameNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'children'
      | 'componentId'
      | 'slots'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
      | 'w'
      | 'h'
      | 'clipContent'
      | 'variant'
      | 'propertyOverrides'
      | 'syncBaseline'
      | 'layoutStyle'
    >
  > = {},
): FrameNode {
  return {
    id,
    kind: 'frame',
    name: opts.name ?? 'Frame',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
    w: opts.w ?? 200,
    h: opts.h ?? 160,
    children: opts.children ?? [],
    componentId: opts.componentId,
    slots: opts.slots,
    clipContent: opts.clipContent,
    variant: opts.variant,
    propertyOverrides: opts.propertyOverrides,
    syncBaseline: opts.syncBaseline,
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
    layoutStyle: opts.layoutStyle,
  };
}

/**
 * V2.15+: canonical factory for a native table node (ADR-0016).
 */
export function makeTableNode(
  id: NodeId,
  opts: Partial<
    Pick<
      TableNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
      | 'w'
      | 'h'
      | 'clipContent'
    >
  > & {
    table?: TableModel;
    rows?: number;
    columns?: number;
    headerRows?: number;
    headerColumns?: number;
    frozenRows?: number;
    frozenColumns?: number;
    columnSizing?: TableColumnDefinition['sizing'];
  } = {},
): TableNode {
  const rows = opts.rows ?? 4;
  const columns = opts.columns ?? 4;
  const table =
    opts.table ??
    createTableModel(rows, columns, {
      headerRows: opts.headerRows,
      headerColumns: opts.headerColumns,
      frozenRows: opts.frozenRows,
      frozenColumns: opts.frozenColumns,
      columnSizing: opts.columnSizing,
    });
  return {
    id,
    kind: 'table',
    name: opts.name ?? 'Table',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    w: opts.w ?? 480,
    h: opts.h ?? 240,
    table,
    clipContent: opts.clipContent ?? true,
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
  };
}

/**
 * Canonical factory for creating a shape node with an image fill.
 * Replaces the deprecated makeImageNode.
 */
export function makeImageShapeNode(
  id: NodeId,
  opts: Partial<
    Pick<
      ShapeNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
      | 'cornerRadius'
      | 'shapeless'
    >
  > & {
    /** Image source URL (data URL, file path, or asset id). */
    src?: string;
    /** Width of the image area in world-space px. Used when shapeless=false or shape is explicit. */
    w?: number;
    /** Height of the image area in world-space px. Used when shapeless=false or shape is explicit. */
    h?: number;
    /** Natural image width in px. When shapeless=true, this defines the derived geometry. */
    imageWidth?: number;
    /** Natural image height in px. When shapeless=true, this defines the derived geometry. */
    imageHeight?: number;
    /** How the image fills the bounds. */
    imageFit?: import('./types').ImageFit;
  } = {},
): ShapeNode {
  const w = opts.w ?? opts.imageWidth ?? 100;
  const h = opts.h ?? opts.imageHeight ?? 100;
  const shapeless = opts.shapeless ?? false;
  const imageFillData: import('./types').ImageFillData = {
    src: opts.src ?? '',
    fit: opts.imageFit ?? 'fill',
    x: 0,
    y: 0,
    scale: 1,
    ...(opts.imageWidth !== undefined ? { imageWidth: opts.imageWidth } : {}),
    ...(opts.imageHeight !== undefined ? { imageHeight: opts.imageHeight } : {}),
  };
  return {
    id,
    kind: 'shape',
    name: opts.name ?? 'Image',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    shape: { kind: 'rect', x: 0, y: 0, w, h } as Shape,
    shapeless,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    fills: [
      {
        type: 'image',
        image: imageFillData,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
    cornerRadius: opts.cornerRadius,
  };
}

/** @deprecated Use makeImageShapeNode. */
export const makeImageNode = makeImageShapeNode;

export function makePathNode(
  id: NodeId,
  opts: Partial<
    Pick<
      PathNode,
      | 'name'
      | 'layerColor'
      | 'transform'
      | 'fill'
      | 'visible'
      | 'locked'
      | 'opacity'
      | 'blendMode'
      | 'rotation'
      | 'strokes'
      | 'effects'
      | 'order'
      | 'points'
      | 'closed'
    >
  > = {},
): PathNode {
  return {
    id,
    kind: 'path',
    name: opts.name ?? 'Path',
    layerColor: opts.layerColor ?? null,
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    transform: opts.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
    fill: opts.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
    points: opts.points ?? [],
    closed: opts.closed ?? false,
    strokes: opts.strokes ?? [],
    effects: opts.effects ?? [],
  };
}

/**
 * Walk nodes in paint order (DFS), yielding each with its parent info.
 *
 * `startIds` defaults to `doc.rootChildren`, which spans every page's
 * contentRoot in the document (each page's shapes are appended there by
 * `addPage`) — the right choice for whole-document operations (e.g.
 * "fit all pages"), but wrong for anything that renders or hit-tests what's
 * currently on screen. Callers scoped to the active page should pass
 * `activePageNodes(doc)` instead.
 */
export function walkNodes(doc: Document, startIds?: NodeId[]): Map<NodeId, NodeEntry> {
  const entries = new Map<NodeId, NodeEntry>();
  // Cycle safety: a malformed cyclic children graph must not hang the walk.
  const visited = new Set<NodeId>();
  function walk(parentId: NodeId | null, ids: NodeId[], depth: number) {
    for (const nid of ids) {
      if (visited.has(nid)) continue;
      const node = doc.nodes[nid];
      if (!node) continue;
      visited.add(nid);
      entries.set(nid, { nodeId: nid, node, parentId, depth });
      if (isContainer(node) && node.children.length > 0) {
        walk(nid, node.children, depth + 1);
      }
    }
  }
  walk(null, startIds ?? doc.rootChildren, 0);
  return entries;
}

/** Find the parent that contains the given node id. O(n) — fine for editor scale. */
/**
 * Build a parent-index map for O(1) parent lookups.
 *
 * Single-pass O(n) over all nodes: for each container node, maps every child
 * id to the container id. Root-level nodes (with no parent) are not included.
 *
 * Useful for fast ancestor-chain traversal in the render loop, where calling
 * `getParent` (O(n) per call) for each level of a deep tree adds up.
 */
export function buildParentIndexMap(doc: Document): Map<NodeId, NodeId> {
  const parents = new Map<NodeId, NodeId>();
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isContainer(node as SceneNode)) {
      for (const childId of (node as ContainerNode).children) {
        parents.set(childId, nid as NodeId);
      }
    }
  }
  return parents;
}

/**
 * Check if a node is within the isolated subtree.
 *
 * Walks up the ancestor chain from the candidate node to see if it eventually
 * reaches the isolated root. Returns true if the candidate is the isolated root
 * itself or any of its descendants.
 *
 * @param candidateId - The node to check
 * @param isolatedNodeId - The root of the isolated subtree
 * @param doc - The document
 * @returns true if candidate is in the isolated subtree
 */
export function isInIsolatedSubtree(
  candidateId: NodeId,
  isolatedNodeId: NodeId | null,
  doc: Document,
): boolean {
  if (!isolatedNodeId) return true; // No isolation active
  if (candidateId === isolatedNodeId) return true; // Is the isolated root itself

  // Walk up the ancestor chain
  let currentId: NodeId | null = candidateId;
  const visited = new Set<NodeId>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    if (currentId === isolatedNodeId) return true;
    currentId = getParent(doc, currentId);
  }
  return false;
}

/** Get the children array of a container node, or null if not a container. */
export function getChildren(doc: Document, id: NodeId): NodeId[] | null {
  const node = doc.nodes[id];
  if (!node || !isContainer(node)) return null;
  return node.children;
}

// ── Variable operations ──────────────────────────────────────────────────────

/**
 * Add a variable to the document's variableStore.
 * Creates a variableStore on the document if one does not exist.
 */
export function addVariableToDocument(doc: Document, variable: Variable): Document {
  const store = doc.variableStore ?? createVariableStore();
  return {
    ...doc,
    variableStore: {
      ...store,
      variables: { ...store.variables, [variable.id]: variable },
    },
  };
}

/**
 * Update a variable in the document's variableStore.
 * If the variable does not exist, returns the document unchanged.
 */
export function updateVariableInDocument(
  doc: Document,
  id: string,
  patch: Partial<Omit<Variable, 'id'>>,
): Document {
  const store = doc.variableStore;
  if (!store?.variables[id]) return doc;
  return {
    ...doc,
    variableStore: {
      ...store,
      variables: {
        ...store.variables,
        [id]: { ...store.variables[id], ...patch },
      },
    },
  };
}

/**
 * Delete a variable from the document's variableStore.
 * If the variable does not exist, returns the document unchanged.
 */
export function deleteVariableFromDocument(doc: Document, id: string): Document {
  const store = doc.variableStore;
  if (!store?.variables[id]) return doc;

  const cleanedStore = deleteVariable(store, id);

  const nodes = { ...doc.nodes };
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!node.bindings) continue;
    const nextBindings = stripBindingForVariable(node.bindings, id);
    if (nextBindings !== node.bindings) {
      nodes[nodeId] = { ...node, bindings: nextBindings } as SceneNode;
    }
  }

  return { ...doc, variableStore: cleanedStore, nodes };
}

/**
 * Set the active mode on the document's variableStore.
 * Adds the mode to the modes list if not already present.
 */
export function setVariableModeOnDocument(doc: Document, mode: string): Document {
  const store = doc.variableStore ?? createVariableStore();
  const modes = store.modes.includes(mode) ? store.modes : [...store.modes, mode];
  return {
    ...doc,
    variableStore: { ...store, activeMode: mode, modes },
  };
}

// ── Paint operations (v1.8+) ──────────────────────────────────────────────────

/**
 * Add a Paint to the document's paints collection.
 * Creates the paints map if it doesn't exist.
 * If a paint with the same id already exists, replaces it.
 */
export function addPaintToDocument(doc: Document, paint: Paint): Document {
  return {
    ...doc,
    paints: { ...(doc.paints ?? {}), [paint.id]: paint },
  };
}

/**
 * Remove a Paint from the document's paints collection.
 * Does NOT update nodes that reference this paint — they will silently
 * lose their fill for that layer. Callers should first update referencing
 * nodes' paintRefs.
 */
export function removePaintFromDocument(doc: Document, paintId: string): Document {
  const paints = doc.paints;
  if (!paints?.[paintId]) return doc;
  const { [paintId]: _, ...rest } = paints;
  return { ...doc, paints: Object.keys(rest).length > 0 ? rest : undefined };
}

/**
 * Update a Paint in the document's paints collection.
 * The paint's id cannot be changed. Returns the document unchanged
 * if the paint doesn't exist.
 */
export function updatePaintInDocument(
  doc: Document,
  paintId: string,
  patch: Partial<Omit<Paint, 'id'>>,
): Document {
  const paints = doc.paints;
  if (!paints?.[paintId]) return doc;
  return {
    ...doc,
    paints: { ...paints, [paintId]: { ...paints[paintId], ...patch } },
  };
}

// ── Guide operations ─────────────────────────────────────────────────────────

export interface AddGuideOptions {
  id?: string;
  pageId?: string;
  locked?: boolean;
  color?: string;
}

/** Active page id for guide placement, or undefined on flat documents. */
export function resolveGuidePageId(doc: Document): string | undefined {
  return doc.activePageId ?? doc.pages?.[0]?.id;
}

/** Guides visible on the given page (legacy guides without pageId match any page). */
export function getGuidesForPage(doc: Document, pageId: string | null | undefined): Guide[] {
  const all = doc.guides ?? [];
  if (!pageId) return all.filter((g) => !g.pageId);
  return all.filter((g) => !g.pageId || g.pageId === pageId);
}

function guideOnPage(guide: Guide, pageId: string | undefined): boolean {
  if (!pageId) return !guide.pageId;
  return !guide.pageId || guide.pageId === pageId;
}

export function createGuideId(): string {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Add a guide to a document. Returns a new document with the guide appended. */
export function addGuide(
  doc: Document,
  axis: 'horizontal' | 'vertical',
  position: number,
  options: AddGuideOptions = {},
): Document {
  const guide: Guide = {
    id: options.id ?? createGuideId(),
    axis,
    position,
    ...(options.pageId !== undefined ? { pageId: options.pageId } : {}),
    ...(options.locked !== undefined ? { locked: options.locked } : {}),
    ...(options.color !== undefined ? { color: options.color } : {}),
  };
  return { ...doc, guides: [...(doc.guides ?? []), guide] };
}

/** Remove a guide by id. Returns the document unchanged if the id is not found. */
export function removeGuide(doc: Document, id: string): Document {
  if (!doc.guides || doc.guides.length === 0) return doc;
  const idx = doc.guides.findIndex((g) => g.id === id);
  if (idx < 0) return doc;
  const next = [...doc.guides];
  next.splice(idx, 1);
  return { ...doc, guides: next };
}

/** Move a guide to a new position. Returns the document unchanged if the id is not found. */
export function moveGuide(doc: Document, id: string, position: number): Document {
  if (!doc.guides || doc.guides.length === 0) return doc;
  const idx = doc.guides.findIndex((g) => g.id === id);
  if (idx < 0) return doc;
  const next = doc.guides.map((g) => (g.id === id ? { ...g, position } : g));
  return { ...doc, guides: next };
}

/** Toggle the locked state of a guide. Returns the document unchanged if the id is not found. */
export function toggleGuideLock(doc: Document, id: string): Document {
  if (!doc.guides || doc.guides.length === 0) return doc;
  const idx = doc.guides.findIndex((g) => g.id === id);
  if (idx < 0) return doc;
  const next = doc.guides.map((g) => (g.id === id ? { ...g, locked: !g.locked } : g));
  return { ...doc, guides: next };
}

/** Lock or unlock guides on a page. Omit pageId to lock/unlock every guide. */
export function setAllGuidesLocked(doc: Document, locked: boolean, pageId?: string): Document {
  if (!doc.guides || doc.guides.length === 0) return doc;
  return {
    ...doc,
    guides: doc.guides.map((g) => {
      if (pageId === undefined) return { ...g, locked };
      return guideOnPage(g, pageId) ? { ...g, locked } : g;
    }),
  };
}

/** Duplicate a guide at a new position. Returns unchanged doc if id not found. */
export function duplicateGuide(
  doc: Document,
  id: string,
  position: number,
  newId: string,
): Document {
  if (!doc.guides || doc.guides.length === 0) return doc;
  const source = doc.guides.find((g) => g.id === id);
  if (!source) return doc;
  const copy = { ...source, id: newId, position, locked: false };
  return { ...doc, guides: [...doc.guides, copy] };
}

/** Clear guides. When pageId is set, only removes guides on that page. */
export function clearGuides(doc: Document, pageId?: string): Document {
  if (!doc.guides || doc.guides.length === 0) return doc;
  if (!pageId) return { ...doc, guides: [] };
  return { ...doc, guides: doc.guides.filter((g) => !guideOnPage(g, pageId)) };
}

/** Paste guides onto a page with new ids and an optional position offset. */
export function pasteGuides(
  doc: Document,
  guides: Guide[],
  pageId: string | undefined,
  newId: () => string,
  offset = 10,
): Document {
  let result = doc;
  for (const source of guides) {
    result = addGuide(result, source.axis, source.position + offset, {
      id: newId(),
      pageId: pageId ?? source.pageId,
      locked: false,
      ...(source.color !== undefined ? { color: source.color } : {}),
    });
  }
  return result;
}

// ── Grid operations ─────────────────────────────────────────────────────────────

/**
 * Get or create grid settings for a document.
 */
function getOrCreateGridSettings(doc: Document): DocumentGridSettings {
  return doc.gridSettings ?? {};
}

/**
 * Set the document grid configuration.
 */
export function setDocumentGrid(doc: Document, grid: DocumentGrid): Document {
  const sanitized = sanitizeGrid(grid) as DocumentGrid;
  if (!validateGrid(sanitized)) {
    return doc; // Invalid grid, return unchanged
  }
  return {
    ...doc,
    gridSettings: {
      ...getOrCreateGridSettings(doc),
      documentGrid: sanitized,
    },
  };
}

/**
 * Remove the document grid configuration.
 */
export function removeDocumentGrid(doc: Document): Document {
  if (!doc.gridSettings?.documentGrid) return doc;
  const { documentGrid, ...rest } = doc.gridSettings;
  return {
    ...doc,
    gridSettings: Object.keys(rest).length > 0 ? rest : undefined,
  };
}

/**
 * Set a layout grid for a specific frame.
 */
export function setLayoutGrid(doc: Document, frameId: string, grid: LayoutGrid): Document {
  const sanitized = sanitizeGrid(grid) as LayoutGrid;
  if (!validateGrid(sanitized)) {
    return doc; // Invalid grid, return unchanged
  }
  return {
    ...doc,
    gridSettings: {
      ...getOrCreateGridSettings(doc),
      layoutGrids: {
        ...getOrCreateGridSettings(doc).layoutGrids,
        [frameId]: sanitized,
      },
    },
  };
}

/**
 * Remove a layout grid for a specific frame.
 */
export function removeLayoutGrid(doc: Document, frameId: string): Document {
  if (!doc.gridSettings?.layoutGrids || !(frameId in doc.gridSettings.layoutGrids)) {
    return doc;
  }
  const { [frameId]: _, ...rest } = doc.gridSettings.layoutGrids;
  return {
    ...doc,
    gridSettings: {
      ...doc.gridSettings,
      layoutGrids: Object.keys(rest).length > 0 ? rest : undefined,
    },
  };
}

/**
 * Set a baseline grid configuration.
 */
export function setBaselineGrid(doc: Document, gridId: string, grid: BaselineGrid): Document {
  const sanitized = sanitizeGrid(grid) as BaselineGrid;
  if (!validateGrid(sanitized)) {
    return doc; // Invalid grid, return unchanged
  }
  return {
    ...doc,
    gridSettings: {
      ...getOrCreateGridSettings(doc),
      baselineGrids: {
        ...getOrCreateGridSettings(doc).baselineGrids,
        [gridId]: sanitized,
      },
    },
  };
}

/**
 * Remove a baseline grid configuration.
 */
export function removeBaselineGrid(doc: Document, gridId: string): Document {
  if (!doc.gridSettings?.baselineGrids || !(gridId in doc.gridSettings.baselineGrids)) {
    return doc;
  }
  const { [gridId]: _, ...rest } = doc.gridSettings.baselineGrids;
  return {
    ...doc,
    gridSettings: {
      ...doc.gridSettings,
      baselineGrids: Object.keys(rest).length > 0 ? rest : undefined,
    },
  };
}

/**
 * Set the pixel grid configuration.
 */
export function setPixelGrid(doc: Document, grid: PixelGrid): Document {
  const sanitized = sanitizeGrid(grid) as PixelGrid;
  if (!validateGrid(sanitized)) {
    return doc; // Invalid grid, return unchanged
  }
  return {
    ...doc,
    gridSettings: {
      ...getOrCreateGridSettings(doc),
      pixelGrid: sanitized,
    },
  };
}

/**
 * Remove the pixel grid configuration.
 */
export function removePixelGrid(doc: Document): Document {
  if (!doc.gridSettings?.pixelGrid) return doc;
  const { pixelGrid, ...rest } = doc.gridSettings;
  return {
    ...doc,
    gridSettings: Object.keys(rest).length > 0 ? rest : undefined,
  };
}

/**
 * Set an isometric grid configuration.
 */
export function setIsometricGrid(doc: Document, gridId: string, grid: IsometricGrid): Document {
  const sanitized = sanitizeGrid(grid) as IsometricGrid;
  if (!validateIsometricGrid(sanitized)) return doc;
  return {
    ...doc,
    gridSettings: {
      ...getOrCreateGridSettings(doc),
      isometricGrids: {
        ...getOrCreateGridSettings(doc).isometricGrids,
        [gridId]: sanitized,
      },
    },
  };
}

/**
 * Remove an isometric grid configuration.
 */
export function removeIsometricGrid(doc: Document, gridId: string): Document {
  if (!doc.gridSettings?.isometricGrids || !(gridId in doc.gridSettings.isometricGrids)) {
    return doc;
  }
  const { [gridId]: _, ...rest } = doc.gridSettings.isometricGrids;
  return {
    ...doc,
    gridSettings: {
      ...doc.gridSettings,
      isometricGrids: Object.keys(rest).length > 0 ? rest : undefined,
    },
  };
}

/**
 * Initialize default grid settings for a new document.
 */
export function initializeDefaultGridSettings(doc: Document): Document {
  if (doc.gridSettings) return doc; // Already has grid settings
  return {
    ...doc,
    gridSettings: {
      documentGrid: createDefaultDocumentGrid(),
      pixelGrid: createDefaultPixelGrid(),
    },
  };
}

// ── Document validation ──────────────────────────────────────────────────────

export interface DocValidationResult {
  valid: boolean;
  errors: string[];
}
