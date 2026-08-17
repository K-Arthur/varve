import type { Adjustment, BlendMode, PathPoint } from '@varve/engine';
import type { Platform } from '@varve/platform';
import type { PrototypeData, PrototypeDebugConsole, PrototypeRuntime } from '@varve/prototype';
import type {
  AdjustmentScope,
  BackgroundRemovalMethod,
  ColorMode,
  Document,
  DocumentGrid,
  Fill,
  GridItemPlacement,
  Guide,
  IsometricGrid,
  LayerColor,
  LayoutSizing,
  LayoutStyle,
  NodeId,
  SceneNode,
  VariableValue,
} from '@varve/scene';
import { createDefaultDocumentGrid } from '@varve/scene';
import type { Camera, DistributeMode, DocumentUnit, Viewport } from '@varve/shared';
import type { SectionVisibilityState } from '../components/Inspector/sectionState';
import type { LayerNavigationCommands } from '../components/LayersPanel/layerNavigationCommands';
import type {
  EditorHistorySession,
  HistoryIssue,
  HistoryStepView,
} from '../history/editorHistorySession';
import type { FrameSpatialIndex } from '../scene/spatialIndex';
import type { MediaState } from '../state/media-state';
import type { MotionState } from '../state/motion-state';
import type { DraftShape, MaskPreviewMode, ToolId } from '../tools/types';
import type { WorkspaceMode } from '../workspace/workspaceTypes';
import type { SelectionMode, SelectionOrigin } from './selectionState';

/** Active table edit session (ADR-0016): cell selection + keyboard focus. */
export interface TableEditState {
  tableId: NodeId;
  /** Selected cell ids (single cell or rectangular range). */
  cellIds: string[];
  /** Keyboard cursor cell (may be inside a span owner). */
  activeCellId: string | null;
  /** Cell with the inline text editor open. */
  editingCellId: string | null;
  /** Range anchor for shift-extended selections. */
  anchorCellId: string | null;
}

export * from './selectionState';
export type { MaskPreviewMode, ToolId };

export type InspectorTab =
  | 'properties'
  | 'appearance'
  | 'adjustments'
  | 'prototype'
  | 'export'
  | 'audit'
  | 'fonts';

/** Persistent revision history surface exposed on the editor context. */
export interface PersistentHistoryApi {
  /** The attached session (null until attach resolves). */
  session: EditorHistorySession | null;
  /** True once the session is attached to the active document. */
  attached: boolean;
  /** Integrity/recovery issues surfaced at attach. */
  attachIssues: HistoryIssue[];
  /** True when attach created a reconciliation revision. */
  reconciled: boolean;
  /** Bumped after every history mutation (panel refresh signal). */
  version: number;
  /** Route a committed transaction into the persistent log. */
  capture: (before: Document, after: Document, label: string, kind: string) => void;
  /** Persistent undo; returns true when a revision was loaded. */
  undo: () => Promise<boolean>;
  /** Persistent redo; returns true when a revision was loaded. */
  redo: () => Promise<boolean>;
  /** Move the working head to an ancestor revision (undo-to). */
  undoTo: (revisionId: string) => Promise<boolean>;
  /** Checkout an arbitrary revision (explicit navigation). */
  checkout: (revisionId: string) => Promise<boolean>;
  /** Load a revision's document for preview (no head movement). */
  previewRevision: (revisionId: string) => Promise<Document | null>;
  /** Refresh step rows for the panel. */
  steps: () => Promise<HistoryStepView[]>;
}

export type IntelligenceTab =
  | 'audit'
  | 'spacing'
  | 'naming'
  | 'governance'
  | 'debt'
  | 'prototype'
  | 'layout'
  | 'components'
  | 'similar'
  | 'linter';

export type TrimapPenMode = 'foreground' | 'unknown' | 'background';

export interface SubjectPickerSession {
  nodeId: NodeId;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  components: Array<{
    id: number;
    pixelCount: number;
    bbox: { x: number; y: number; w: number; h: number };
    confidence: number;
    relativeArea: number;
    centerOfMass: { x: number; y: number };
    edgePixelCount: number;
    isLargest: boolean;
    mergedFrom?: number[];
  }>;
  keepIds: number[];
  pendingMaskDataUrl: string;
  /** Source image data URL or file path for thumbnail generation. */
  sourceImageSrc: string;
  method: BackgroundRemovalMethod;
  confidence: number;
  feather: number;
  decontaminate: boolean;
  requestedMethod: BackgroundRemovalMethod;
  documentId: string;
  sourceLocator: string;
  placementRevision: number;
}

export interface BackgroundRemovalPreviewSession {
  nodeId: NodeId;
  documentId: string;
  sourceLocator: string;
  placementRevision: number;
  maskDataUrl: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  requestedMethod: BackgroundRemovalMethod;
  actualMethod: BackgroundRemovalMethod;
  confidence: number;
  feather: number;
  decontaminate: boolean;
  executionProvider?: 'webgpu' | 'webgl' | 'wasm' | 'native';
  modelId?: string;
  modelPrecision?: 'fp32' | 'int8';
  precisionFallback?: boolean;
  precisionFallbackReason?: string;
}

/** Transient Object Selection state. Never serialized or added to history. */
export interface ObjectSelectionSession {
  nodeId: NodeId;
  width: number;
  height: number;
  candidates: Array<{
    mask: Uint8Array;
    confidence: number;
  }>;
  selectedCandidate: number;
  points: Array<{ x: number; y: number; label: 0 | 1 }>;
  box: { x1: number; y1: number; x2: number; y2: number } | null;
  confidence: number;
  status: 'previewing' | 'ready' | 'error';
  modelId: string;
  executionProvider?: string;
}

export type CanvasMode = 'full' | 'outline' | 'preview';

export type RulerMode = 'global' | 'artboard';

export type GridOverlayMode = 'none' | 'document' | 'baseline' | 'isometric';

export type DocumentGridSettings = DocumentGrid;

export function createDefaultDocumentGridSettings(): DocumentGridSettings {
  return createDefaultDocumentGrid();
}

export interface SessionMeta extends SessionFileMeta {
  id: string;
  name: string;
  dirty: boolean;
  /**
   * True for encrypted project archives: no plaintext thumbnail pixels may
   * ever be written to ordinary caches; only the encrypted placeholder may
   * be stored (see thumbnail/encryptedThumbnailPolicy.ts).
   */
  encrypted?: boolean;
}

/**
 * Which file a session is bound to — the identity `save()` writes back to.
 *
 * Always passed explicitly when a document enters a tab. A session must never
 * inherit identity from whatever happened to be open before it, or saving
 * writes the new document over the previous one.
 *
 * The save *destination* is separate from the document *identity*:
 *   - `filePath`        — a user-chosen native filesystem path (desktop).
 *   - `saveHandleId`    — a persisted browser File System Access handle key
 *     (web). The actual handle lives in platform-managed IndexedDB; a path
 *     string would be a lie in a browser.
 *   - `fileId`          — identity in Varve's Home/library index. A fileId
 *     is NOT a save destination: new documents receive one at creation so
 *     the Home index can track them, but their first Save still asks the
 *     user where to put them. Only `libraryStorage: true` marks an explicit
 *     choice of Varve Library as the authoritative destination.
 *   - `libraryStorage`  — true when the user EXPLICITLY chose Varve Library
 *     as this document's destination. Only then may a library write mark the
 *     document clean.
 *   - `downloadName`    — last browser-snapshot filename. A download is NOT a
 *     persistent location: the session stays untitled-for-file purposes and
 *     a download never marks the document clean.
 *   - `diskContentHash` — FNV-1a of the last known bytes at `filePath` (from
 *     the open read or the last successful write). Compared before every
 *     native overwrite to detect external edits (save-conflict safety).
 */
export interface SessionFileMeta {
  name?: string;
  filePath?: string;
  fileId?: string;
  libraryStorage?: boolean;
  saveHandleId?: string;
  saveHandleName?: string;
  downloadName?: string;
  diskContentHash?: string;
}

/** A user-actionable save problem, shown in save-status UI. Category values
 *  mirror @varve/platform SaveErrorCategory; kept here (rather than imported)
 *  so types.ts stays the leaf of the package's type graph. */
export interface SaveIssue {
  category:
    | 'permission-denied'
    | 'disk-full'
    | 'read-only'
    | 'destination-missing'
    | 'file-changed-externally'
    | 'serialization-failed'
    | 'filesystem-unavailable'
    | 'permission-expired'
    | 'quota-exceeded'
    | 'unsupported'
    | 'unknown-io';
  message: string;
}

/**
 * Where a loaded document lands, and which file the tab is bound to afterwards.
 *
 * The default is deliberately the *safe* one: a loaded document arrives
 * unbound unless the caller states an identity. A caller that forgets gets a
 * Save As prompt on first save; the opposite default silently writes the newly
 * loaded document over whichever file the tab happened to hold before.
 */
export interface LoadDocumentMeta extends SessionFileMeta {
  /**
   * Keep the active tab's current fileId/filePath instead of rebinding to
   * `meta`. For callers replacing the *same* file's content — rename,
   * version/backup restore in place, crash recovery.
   */
  keepIdentity?: boolean;
  /** Load into its own tab, leaving the active document open and untouched. */
  newSession?: boolean;
}

/** Collision-free session id (two tabs can be created within the same ms). */
export function newSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

export interface EditorState {
  tool: ToolId;
  zoom: number;
  pan: { x: number; y: number };
  selection: NodeId[];
  /** Primary/anchor selection ID — the first or most recently focused node
   *  in multi-selection. Used for inspector context, alignment origin, and
   *  as the authoritative "what is selected" for commands that expect a
   *  single object. Guaranteed to be in `selection` when selection is non-empty. */
  primaryId: NodeId | null;
  /** The node that currently has keyboard focus (distinct from selection for
   *  accessibility and keyboard navigation). When non-null, this is the node
   *  that receives keyboard events. May differ from primaryId during keyboard
   *  tree navigation. */
  focusedNodeId: NodeId | null;
  /** Active container for nested/deep selection. When set, hit-testing and
   *  selection commands are scoped to this container's subtree. The container
   *  itself is also selectable. Null means document/artboard scope. */
  activeContainerId: NodeId | null;
  /** What kind of selection is active. Determines rendering and interaction
   *  behaviour for handles, hit testing, and overlay rendering. */
  selectionMode: SelectionMode;
  /** Origin of the most recent selection change — used for synchronisation
   *  and undo-grouping decisions. */
  selectionOrigin: SelectionOrigin;
  /** Monotonic revision that increments on every selection change, enabling
   *  cheap change detection without deep-equal on the full selection array. */
  selectionRevision: number;
  document: Document;
  sessions: SessionMeta[];
  activeId: string;
  dirty: boolean;
  cursorPos: { x: number; y: number } | null;
  unitType: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%';
  pixelGridEnabled: boolean;
  pixelGridSnapEnabled: boolean;
  dotGridEnabled: boolean;
  /** Show bleed/trim/slug print guides on canvas. */
  bleedGuidesVisible: boolean;
  /** Show layout grid overlays on canvas (distinct from document-level layout grids). */
  layoutGridVisible: boolean;
  findingsOverlayVisible: boolean;
  findingsProviderOverrides: Record<string, boolean | undefined>;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  snapEnabled: boolean;
  snapGrid: number;
  documentGrid: DocumentGridSettings;
  isometricGrid: IsometricGrid;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  /** Most recent save problem requiring user attention (null = none). */
  saveIssue: SaveIssue | null;
  /** Document Info dialog visibility. */
  documentInfoOpen: boolean;
  prototypeMode: boolean;
  prototypeRuntime: PrototypeRuntime | null;
  prototypeDebug: PrototypeDebugConsole;
  prototypeData: PrototypeData;
  isPresenting: boolean;
  selectedStateMachineId: string | null;
  selectedSMStateId: string | null;
  selectedSMTransitionId: string | null;
  softProofEnabled: boolean;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  libraryPanelVisible: boolean;
  /** Distraction-free canvas mode: hides chrome (menubar, side panels, status
   *  bar, page nav) while keeping the canvas, floating toolbar, and an exit
   *  affordance. Save/undo/zoom remain reachable via keyboard shortcuts,
   *  which are not panel-dependent. */
  distractionFreeMode: boolean;
  /** Before/after image comparison: when a single image-fill shape is
   *  selected, overlays its original source pixels for visual comparison.
   *  A transient view flag, not a document mutation. */
  beforeAfterCompare: boolean;
  /** Logo preview dialog (small-size / surface / mode preview) visibility. */
  logoPreviewDialogOpen: boolean;
  timelinePanelVisible: boolean;
  /** History panel visibility (M8 — persistent revision history). */
  historyPanelVisible: boolean;
  codegenPanelVisible: boolean;
  /** Logo panel visibility (persisted; follows the workspace config on switch). */
  logoPanelVisible: boolean;
  /** Active workspace mode (design / print / drawing / motion). */
  workspaceMode: WorkspaceMode;
  /** Whether the graph editor panel is visible in the timeline area. */
  graphEditorVisible: boolean;
  /**
   * Whether the State Machine panel is visible. State machines are
   * document-wide (keyed off `document.stateMachines`, not the current
   * selection), so — like the timeline — they get their own opt-in panel
   * rather than living in the per-selection Properties inspector.
   */
  stateMachinePanelVisible: boolean;
  /** Which property track is currently shown in the graph editor (nodeId.property). */
  selectedGraphProperty: string | null;
  /**
   * Pending character format for new typing in the rich-text span editor.
   * When set, grapheme input applies this format to the new run. Null when
   * unset (collapsed caret inherits the surrounding run's format).
   */
  pendingFormat: import('@varve/scene').CharacterFormat | null;
  /**
   * The selected grapheme range within the focused text node's rich text.
   * Used by the span editor to know which runs to format. Null when no
   * text editing is active.
   */
  selectionRange: import('@varve/scene').RichSelection | null;
  motion: MotionState;
  /** Animated-media playback state (never serialized, never undoable). */
  media: MediaState;
  canvasMode: CanvasMode;
  /** View rotation in radians (non-destructive canvas rotate). */
  cameraRotation: number;
  /** Global vs artboard-relative ruler ticks. */
  rulerMode: RulerMode;
  /** Optional document overlay grid type. */
  gridOverlayMode: GridOverlayMode;
  /** When false, guide lines are hidden but remain in the document and snap targets. */
  guidesVisible: boolean;
  /** Selected guide for keyboard adjustment; null when no guide is focused. */
  selectedGuideId: string | null;
  currentPageId: string | null;
  /** Isolation/focus view: when set, the layers panel shows only this
   *  container's subtree. A view-mode flag, not a document mutation — not
   *  part of undo/redo history. */
  isolatedNodeId: NodeId | null;
  /**
   * Active table edit session (ADR-0016). When set, cell selection,
   * keyboard navigation, and structural table ops are active for that
   * table. Null when not editing a table.
   */
  createTableFromDataOpen: boolean;
  tableEdit: TableEditState | null;
  showOriginalBgNodeId: NodeId | null;
  maskPreviewMode: MaskPreviewMode;
  /** Per-section collapse/hidden state for Inspector panels. Persisted in
   *  localStorage via EditorSettings. Not part of document undo/redo. */
  sectionVisibility: SectionVisibilityState;
  refineMaskOptions: {
    brushSize: number;
    hardness: number;
    sourceWidth?: number;
    sourceHeight?: number;
  };
  /** Tracks the last duplicate offset for the Repeat Duplicate command. */
  lastDuplicateOffset: { x: number; y: number } | null;
  trimapEditOptions: {
    brushSize: number;
    hardness: number;
    penMode: TrimapPenMode;
    sourceWidth?: number;
    sourceHeight?: number;
  };

  /** Active brush settings for paint/eraser tools. Central place where the
   *  inspector writes and the PaintTool reads. Preset defaults are loaded
   *  into these fields on tool activation. */
  brushSettings: {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
    // Smudge settings
    smudgeStrength: number;
    smudgeMode: 'sampling' | 'mixing' | 'fingerpaint';
    alphaLock: boolean;
    blendMode: string;
    // Grain settings
    grainId: string | null;
    grainScale: number;
    grainRotation: number;
    grainContrast: number;
    grainInvert: boolean;
    // Wet-paint settings
    wetEnabled: boolean;
    wetEdge: boolean;
    wetMixStrength: number;
    wetDryingRate: number;
  };
  subjectPickerSession: SubjectPickerSession | null;
  /** Component ID being hovered/focused in the subject picker, for canvas highlighting. */
  subjectHighlightId: number | null;
  backgroundRemovalPreviewSession: BackgroundRemovalPreviewSession | null;
  objectSelectionSession: ObjectSelectionSession | null;
  keyObjectId: string | null;
  alignToPage: boolean;
  colorBlindnessView: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';

  /** Foreground color for painting, as RGBA [r, g, b, a] in 0-255 range. */
  foregroundColor: [number, number, number, number];
  /** Background color for painting, as RGBA [r, g, b, a] in 0-255 range. */
  backgroundColor: [number, number, number, number];

  /**
   * Quick-mask mode: transient selection-editing state.
   * When active, the canvas overlays a semi-transparent color over
   * selected regions. Painting/erasing modifies quick-mask coverage,
   * which is converted to a persistent mask or selection on exit.
   */
  quickMask: {
    active: boolean;
    /** Overlay color as RGBA [r, g, b, a] in 0-255 range. */
    color: [number, number, number, number];
    /**
     * Per-pixel mask coverage as a flat Uint8Array (0 = protected,
     * 255 = selected). Same dimensions as the document canvas.
     * Transient — not persisted to the document model.
     */
    coverage: Uint8Array | null;
    /** Canvas width of the coverage buffer (px). */
    width: number;
    /** Canvas height of the coverage buffer (px). */
    height: number;
  };
  /** Node ID for the Content-Aware Fill dialog target. When set, Shell
   *  renders the dialog. Null when closed. */ cafDialogNodeId: NodeId | null;
  /**
   * V2.16+: active warp modifier being edited by the Warp tool / overlay /
   * Inspector. Transient editor state — the modifier itself lives on the
   * Document node (`node.warps`).
   */
  warpEdit: { nodeId: NodeId; modifierId: string } | null;
  /** Whether the upscale dialog is open. */
  upscaleDialogOpen: boolean;
  /** Whether the Image Trace (vectorize) dialog is open. */
  vectorizeDialogOpen: boolean;
  /** Re-trace target for the Image Trace dialog (Edit Trace workflow). */
  vectorizeDialogPrefill: { replaceGroupId: string } | null;
  /** Whether the Extract Color Palette dialog is open. */
  paletteExtractDialogOpen: boolean;
  /** Source image URL the palette dialog is analyzing. */
  paletteExtractSrc: string | null;
  /** Incremented on every theme switch so CanvasArea, Minimap, Ruler and
   *  other canvas-based components can detect and react to theme changes
   *  without a full editor remount. */
  themeRevision: number;
  /** Monotonic revision counter for document backup/recovery. */
  revision: number;

  // ── Debug overlay state (Workstream A) ─────────────────────────────────
  debugOverlay: {
    enabled: boolean;
    channels: {
      geometry: boolean;
      hitTest: boolean;
      spatialIndex: boolean;
      interaction: boolean;
      selection: boolean;
      performance: boolean;
    };
    labelDensity: 'none' | 'sparse' | 'normal' | 'full';
    frozen: boolean;
    maxItems: number;
    sampleRate: number;
  };

  // ── Touch multi-select state (Workstream D) ────────────────────────────
  touchMultiSelect: {
    active: boolean;
    /** When true, transform gestures temporarily suspend multi-select toggling. */
    suspended: boolean;
  };
}

export interface EditorContextValue {
  state: EditorState;
  platform?: Platform;
  /** Persistent revision history session (ADR-0019/0020, M7 wiring). When
   *  attached, undo/redo route through the revision store; the panel and
   *  comparison/merge surfaces read session state from here. */
  persistentHistory: PersistentHistoryApi;
  // Tool
  setTool: (t: ToolId) => void;
  // Viewport
  setCamera: (camera: Camera) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  panBy: (dx: number, dy: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (level: number) => void;
  smoothZoomTo: (targetZoom: number, durationMs?: number) => void;
  smoothPanTo: (target: { x: number; y: number }, durationMs?: number) => void;
  smoothReveal: (
    bounds: { x: number; y: number; w: number; h: number },
    opts?: { padding?: number; durationMs?: number },
  ) => void;
  canvasToWorld: (cx: number, cy: number) => { x: number; y: number };
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
  canvasDeltaToWorld: (dx: number, dy: number) => { dx: number; dy: number };
  setCanvasMode: (mode: CanvasMode) => void;
  setCameraRotation: (radians: number) => void;
  rotateViewBy: (radians: number, screenAnchor?: { x: number; y: number }) => void;
  resetViewRotation: () => void;
  setRulerMode: (mode: RulerMode) => void;
  setGridOverlayMode: (mode: GridOverlayMode) => void;
  fitActivePage: () => void;
  fitActiveFrame: () => void;
  revealSelection: (opts?: {
    nodeId?: NodeId;
    fit?: boolean;
    padding?: number;
    viewport?: Viewport;
  }) => void;
  fitAll: () => void;
  // Workspace
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleLibraryPanel: () => void;
  toggleCodegenPanel: () => void;
  /** Toggle the Logo panel (workspace-config-backed, persisted). */
  toggleLogoPanel: () => void;
  toggleDistractionFreeMode: () => void;
  __setWorkspaceModeUnsafe: (mode: WorkspaceMode) => void;
  requestWorkspaceSwitch: (mode: WorkspaceMode, options?: { force?: boolean }) => Promise<boolean>;
  resetWorkspaceToDefault: () => void;
  resetAllWorkspacesToDefaults: () => void;
  // Section visibility
  toggleSectionCollapse: (
    sectionId: import('../components/Inspector/sectionRegistry').SectionId,
  ) => void;
  toggleSubSectionCollapse: (
    sectionId: import('../components/Inspector/sectionRegistry').SectionId,
    subSectionId: string,
  ) => void;
  hideInspectorSection: (
    sectionId: import('../components/Inspector/sectionRegistry').SectionId,
  ) => void;
  showInspectorSection: (
    sectionId: import('../components/Inspector/sectionRegistry').SectionId,
  ) => void;
  showAllInspectorSections: () => void;
  restoreDefaultSectionState: () => void;
  restoreDefaultCollapsed: () => void;
  hideOptionalSections: () => void;
  // Section ordering
  moveSectionUp: (sectionId: import('../components/Inspector/sectionRegistry').SectionId) => void;
  moveSectionDown: (sectionId: import('../components/Inspector/sectionRegistry').SectionId) => void;
  moveSectionToStart: (
    sectionId: import('../components/Inspector/sectionRegistry').SectionId,
  ) => void;
  moveSectionToEnd: (
    sectionId: import('../components/Inspector/sectionRegistry').SectionId,
  ) => void;
  resetSectionOrder: () => void;
  // Selection
  setSelection: (id: NodeId | null, origin?: SelectionOrigin) => void;
  /** ADR-0016: enter/exit table edit mode (cell selection + navigation). */
  setTableEdit: (state: TableEditState | null) => void;
  /** ADR-0016: commit cell text through the normal undoable doc path. */
  updateTableCellText: (cellId: string, text: string) => void;
  /** ADR-0016: run an immutable table-model op on the owning node (undoable). */
  tableOp: (
    tableId: string,
    op: (model: import('@varve/scene').TableModel) => import('@varve/scene').TableModel,
  ) => void;
  /** Enter/exit warp edit mode (which node's modifier the overlay edits). */
  setWarpEdit: (target: { nodeId: NodeId; modifierId: string } | null) => void;
  toggleSelection: (id: NodeId, additive?: boolean, origin?: SelectionOrigin) => void;
  isSelected: (id: NodeId) => boolean;
  selectedNodes: () => SceneNode[];
  selectAllWithSameType: () => void;
  selectAllWithSameFill: () => void;
  selectAllWithSameLayerColor: () => void;
  selectAllOfType: () => void;
  selectNone: () => void;
  invertSelection: () => void;
  selectParent: () => void;
  selectChildren: () => void;
  selectSiblings: () => void;
  selectNextSibling: () => void;
  selectPreviousSibling: () => void;
  selectAllChildren: () => void;
  selectAllWithSameStroke: () => void;
  selectAllWithSameOpacity: () => void;
  selectAllWithSameBlendMode: () => void;
  selectAllWithSameFont: () => void;
  selectAllWithSameCornerRadius: () => void;
  selectPreviousSelection: () => void;
  selectNextSelection: () => void;
  // Document CRUD
  createShapeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    pathPoints?: PathPoint[],
    pathClosed?: boolean,
  ) => void;
  createTextNodeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    text?: string,
  ) => void;
  applyFramePreset: (preset: { name: string; w: number; h: number }) => void;
  findContainingFrame: (
    world: { x: number; y: number },
    frameIndex?: FrameSpatialIndex | null,
  ) => NodeId | null;
  nodeWorldBounds: (n: SceneNode) => { x: number; y: number; w: number; h: number } | null;
  getWorldTransform: (id: NodeId) => import('@varve/shared').Affine;
  getWorldBounds: (id: NodeId) => import('@varve/shared').Rect | null;
  hitTestNode: (world: { x: number; y: number }) => { nodeId: NodeId; node: SceneNode } | null;
  hitTestNodeWithPolicy: (
    world: { x: number; y: number },
    policyName: import('../hitTest').HitTestPolicyName,
  ) => { nodeId: NodeId; node: SceneNode } | null;
  /** Set the keyboard focus to a node without changing selection. */
  setFocusedNode: (id: NodeId | null) => void;
  /** Clear keyboard focus. */
  clearFocusedNode: () => void;
  /** Move focus to the next selected node in document order. */
  focusNextSelectedNode: () => void;
  /** Move focus to the previous selected node in document order. */
  focusPreviousSelectedNode: () => void;
  getNode: (id: NodeId) => SceneNode | undefined;
  walkNodes: () => Map<
    NodeId,
    { nodeId: NodeId; node: SceneNode; parentId: NodeId | null; depth: number }
  >;
  setDraft: (draft: DraftShape | null) => void;
  removeSelected: () => void;
  renameSelected: (name: string) => void;
  /**
   * Rename a specific node. `renameSelected` targets `selection[0]`, which is
   * ambiguous when a rename is initiated on a row that is not first in a
   * multi-selection.
   */
  renameNodeById: (id: NodeId, name: string) => void;
  moveNode: (id: NodeId, toIndex: number) => void;
  duplicateSelected: () => void;
  /** Repeat the last duplicate with the same offset (Cmd/Ctrl+D after initial duplicate). */
  repeatDuplicate: () => void;
  setSelectedFill: (color: import('@varve/scene').ManagedColor) => void;
  setSelectedFills: (fills: Fill[]) => void;
  updateSelectedFillAt: (index: number, fill: Fill) => void;
  addSelectedFill: (fill: Fill) => void;
  removeSelectedFillAt: (index: number) => void;
  reorderSelectedFill: (from: number, to: number) => void;
  setNodePosition: (id: NodeId, x: number, y: number) => void;
  /**
   * Batch-set absolute transforms for many nodes in ONE document update.
   * Multi-node drags/nudges previously issued one `setNodePosition` per node
   * per sample, each spreading the whole nodes map (O(N) key copies each), so
   * an N-node selection cost N*O(N) per pointermove. One batched call costs a
   * single O(N) spread per sample. Final positions are identical; the undo
   * transaction boundary is unchanged (caller still owns begin/commit).
   */
  setNodePositions: (positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>) => void;
  setNodeSize: (id: NodeId, w: number, h: number) => void;
  setSelectedX: (x: number) => void;
  setSelectedY: (y: number) => void;
  setSelectedW: (w: number) => void;
  setSelectedH: (h: number) => void;
  updateNode: (id: NodeId, updater: (node: SceneNode) => SceneNode) => void;
  /**
   * Batch-apply per-node updaters in ONE document update (single nodes-map
   * spread). Per-node `updateNode` calls each spread the whole map; gestures
   * that transform N nodes per sample (ScaleTool) previously cost N*O(N).
   * Updaters are pure and independent — they must not read other nodes'
   * post-update state.
   */
  updateNodes: (
    updaters: ReadonlyArray<{ id: NodeId; update: (node: SceneNode) => SceneNode }>,
  ) => void;
  /**
   * Apply a character format to the selected range of the focused text node's
   * rich text. Plain-text nodes are promoted to rich text automatically.
   * Requires a valid selectionRange on the focused text node.
   */
  applyFormatToSelection: (format: import('@varve/scene').CharacterFormat) => void;
  /**
   * Store the format that new typing should inherit (collapsed caret with
   * a "pending" format state — grapheme input applies this format).
   */
  setPendingFormat: (format: import('@varve/scene').CharacterFormat) => void;
  /** The pending character format for new typing (null when unset). */
  pendingFormat: import('@varve/scene').CharacterFormat | null;
  /** Report the selected grapheme range within the focused text node. */
  setSelectionRange: (range: import('@varve/scene').RichSelection | null) => void;
  setSelectedOpacity: (value: number) => void;
  setSelectedBlendMode: (mode: BlendMode) => void;
  setSelectedRotation: (value: number) => void;
  setSelectedFlipH: () => void;
  setSelectedFlipV: () => void;
  setSelectedCornerRadius: (value: number | [number, number, number, number]) => void;
  setSelectedConstraint: (constraint: import('@varve/scene').Constraints) => void;
  alignSelected: (axis: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => void;
  distributeSelected: (axis: 'horizontal' | 'vertical') => void;
  distributeWithGap: (axis: 'horizontal' | 'vertical', gap: number) => void;
  distributeWithMode: (axis: 'horizontal' | 'vertical', mode: DistributeMode) => void;
  setKeyObject: (nodeId: string | null) => void;
  keyObjectId: string | null;
  alignToPage: boolean;
  setAlignToPage: (value: boolean) => void;
  tidySelected: (maxCols?: number) => void;
  obbAlignSelected: (axis: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => void;
  setSelectedMinWidth: (value: number) => void;
  setSelectedMaxWidth: (value: number) => void;
  setSelectedMinHeight: (value: number) => void;
  setSelectedMaxHeight: (value: number) => void;
  setSelectedLayoutSizing: (value: LayoutSizing) => void;
  setSelectedLayoutSizingWidth: (value: LayoutSizing) => void;
  setSelectedLayoutSizingHeight: (value: LayoutSizing) => void;
  setSelectedLayoutPosition: (value: import('@varve/scene').LayoutPosition) => void;
  setSelectedGridPlacement: (value: GridItemPlacement) => void;
  setCanvasWidth: (value: number) => void;
  setCanvasHeight: (value: number) => void;
  setCanvasBackground: (value: import('@varve/scene').ManagedColor) => void;
  setSelectedBinding: (
    target: string,
    binding: import('@varve/scene').PropertyBinding | null,
  ) => void;
  /** Trim image bounds to the non-transparent alpha region of a background-removal mask. */
  trimToSubject: (padding?: number) => Promise<void>;
  /** Position the crop window to keep detected faces in frame. Returns true
   * when a face-aware crop was applied. */
  applyFaceAwareCrop: (options?: {
    safetyMargin?: number;
    minimumConfidence?: number;
  }) => Promise<boolean>;
  /** Expand image bounds by adding transparent space around the content. */
  expandImageBounds: (
    padding: number,
    sides?: { top?: number; right?: number; bottom?: number; left?: number },
  ) => void;
  /** Reset image node to source image natural dimensions. */
  resetImageBounds: () => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
  abortTransaction: () => void;
  undo: () => void;
  redo: () => void;
  newDocument: () => void;
  serializeDocument: () => string;
  updateDoc: (fn: (doc: Document) => Document) => void;
  loadDocument: (json: string, meta?: LoadDocumentMeta) => void;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  /** Save a duplicate to a new location WITHOUT adopting it as the active
   *  document's destination and without clearing dirty state. */
  saveCopy: () => Promise<boolean>;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  /** Most recent save problem requiring user attention (null = none). */
  saveIssue: SaveIssue | null;
  /** Open/close the Document Info surface (name, location, status, actions). */
  setShowDocumentInfo: (show: boolean) => void;
  openFile: (
    /** App-store id; omit for a file known only by path (Open Recent) or by
     *  neither (browser file picker) — save() mints one on first save. */
    fileId: string | undefined,
    name: string,
    filePath: string | undefined,
    json: string | null,
  ) => void;
  rootNodes: () => SceneNode[];
  reparentNode: (id: NodeId, newParentId: NodeId | null, toIndex: number) => void;
  arrangeSelected: (op: import('@varve/scene').ArrangeOp) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  detachSelected: () => void;

  // Components
  createComponentFromFrame: (
    name: string,
    masterRootId: NodeId,
    slots: import('@varve/scene').Slot[],
  ) => void;
  /** Turns a componentDetector.ts duplicate-structure group into a real
   *  component: the first node becomes the master definition, the rest are
   *  replaced in place with instances. Frame-only nodes are converted; other
   *  kinds in the group are left untouched. No-op (with a toast) if the
   *  first node is not a frame. */
  createComponentFromGroup: (nodeIds: NodeId[]) => void;
  promoteVariantCandidates: (
    componentName: string,
    masterNodeId: NodeId,
    properties: Array<{
      name: string;
      type: import('@varve/scene').ComponentPropertyType;
      memberValues: Record<NodeId, string>;
    }>,
    variantAssignments: Array<{ nodeId: NodeId; variantName: string }>,
  ) => { componentId?: NodeId; error?: string };
  createComponentInstance: (componentId: NodeId) => void;
  fillSlot: (instanceId: NodeId, slotId: string, fillNodeId: NodeId) => void;
  swapComponentInstance: (instanceId: NodeId, newComponentId: NodeId) => void;
  resetInstanceOverrides: (instanceId: NodeId) => void;
  syncComponentInstances: (componentId: NodeId) => import('@varve/scene').SyncResult;
  syncInstance: (instanceId: NodeId) => import('@varve/scene').InstanceStatus;
  getInstanceStatus: (instanceId: NodeId) => import('@varve/scene').InstanceStatus;
  syncAllInstances: () => import('@varve/scene').SyncResult;

  // Flatten
  flattenSelected: (mode: import('../flatten/types').FlattenMode, scale?: number) => void;
  rasterizeSelected: (scale?: number) => void;
  mergeSelected: () => void;

  // Text to outlines
  /** Convert the selected text node to vector path outlines. Shows confirmation dialog if lossy. */
  convertTextToOutlines: () => void;

  // Visibility
  setNodeLocked: (id: NodeId, locked: boolean) => void;
  setNodeVisible: (id: NodeId, visible: boolean) => void;
  setNodeClipContent: (id: NodeId, clipContent: boolean) => void;
  setLayerColor: (id: NodeId, color: LayerColor) => void;

  // Masks
  addMaskToSelected: (type?: import('@varve/scene').MaskType, sourceNodeId?: NodeId) => void;
  removeMaskFromSelected: () => void;
  toggleMask: () => void;
  invertMask: () => void;
  setMaskFeather: (feather: number) => void;
  setMaskDensity: (density: number) => void;
  setMaskHideSource: (hidden: boolean) => void;
  setMaskLinked: (linked: boolean) => void;
  setMaskType: (type: import('@varve/scene').MaskType) => void;
  setMaskSourceNode: (sourceNodeId: string) => void;
  setMaskFillRule: (fillRule: import('@varve/scene').MaskFillRule) => void;
  setMaskVectorPath: (points: import('@varve/engine').PathPoint[], closed: boolean) => void;

  // ── Clipping masks (non-destructive) ──
  /** Create a clipping mask group from selected nodes (mask shape + content). */
  createClippingMaskFromSelected: (selectionOverride?: NodeId[]) => void;
  /** Release a clipping mask, restoring original content and mask source. */
  releaseClippingMaskFromSelected: () => void;

  bulkSetNodeLocked: (ids: NodeId[], locked: boolean) => void;
  bulkSetNodeVisible: (ids: NodeId[], visible: boolean) => void;
  bulkSetLayerColor: (ids: NodeId[], color: LayerColor) => void;

  // Layout
  setNodeLayout: (id: NodeId, layout: LayoutStyle | undefined) => void;

  // Variables
  resolveVariable: (nameOrId: string) => VariableValue;
  addVariable: (v: Omit<import('@varve/scene').Variable, 'id'>) => void;
  updateVariable: (id: string, patch: Partial<Omit<import('@varve/scene').Variable, 'id'>>) => void;
  deleteVariable: (id: string) => void;
  setVariableMode: (mode: string) => void;

  // Sessions/tabs
  newTab: () => void;
  switchTab: (id: string) => void;
  closeTab: (id: string, force?: boolean) => boolean;

  // Accessibility
  announce: (msg: string) => void;
  announceSelection: (selected: SceneNode[]) => void;
  announceOperation: (op: string, result: string) => void;
  /** Show a visual toast notification (also announced via aria-live). */
  showToast: (opts: {
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    duration?: number;
  }) => void;

  // Adjustment layers
  createAdjustmentLayer: (initialAdjustments?: Adjustment[]) => void;
  addAdjustmentToLayer: (nodeId: NodeId, adjustment: Adjustment) => void;
  addLutAdjustment: (lutAdjustment: Adjustment) => void;
  removeAdjustmentFromLayer: (nodeId: NodeId, adjustmentId: string) => void;
  updateAdjustmentInLayer: (
    nodeId: NodeId,
    adjustmentId: string,
    patch: Partial<Adjustment>,
  ) => void;
  reorderAdjustmentInLayer: (nodeId: NodeId, adjustmentId: string, newIndex: number) => void;
  setAdjustmentLayerOpacity: (nodeId: NodeId, opacity: number) => void;
  setAdjustmentLayerBlendMode: (nodeId: NodeId, blendMode: string) => void;
  /** Create one shared adjustment with explicit-targets scope for the given node IDs. */
  createLinkedAdjustment: (targetIds: NodeId[], adjustments?: Adjustment[]) => void;
  /**
   * Copy selected adjustment settings as independent image-local adjustments.
   * When adjustmentIds is specified, only those adjustments are copied;
   * otherwise all adjustments on the source node are copied.
   */
  copyEditsToSelected: (
    sourceNodeId: NodeId,
    targetIds: NodeId[],
    adjustmentIds?: string[],
  ) => void;
  /** Change an adjustment node's scope. */
  setAdjustmentScope: (nodeId: NodeId, scope: AdjustmentScope) => void;

  // Clipboard
  copySelected: () => void;
  cutSelected: () => void;
  paste: () => void;
  /** Copy the visual properties (fills, strokes, effects, typography) of the
   *  first selected node for style-painter pasting. */
  copySelectedProperties: () => void;
  /** Apply the copied properties to every selected node (one undo entry). */
  pastePropertiesToSelection: () => void;
  importNode: (
    node: SceneNode,
    sourceDoc: Document,
    options?: { position?: { x: number; y: number } },
  ) => void;
  batchImportNodes: (
    items: { node: SceneNode; sourceDoc: Document; position?: { x: number; y: number } }[],
    options?: { maskTargetId?: NodeId },
  ) => void;

  // Binding
  bindingField: string | null;
  setBindingField: (field: string | null) => void;
  focusedField: string | null;
  setFocusedField: (field: string | null) => void;
  setSelectedCornerSmoothing: (value: number) => void;

  // Canvas state
  setCursorPos: (pos: { x: number; y: number } | null) => void;
  setUnitType: (t: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%') => void;
  setDocumentUnit: (unit: DocumentUnit) => void;
  setSoftProofEnabled: (v: boolean) => void;
  setFindingsOverlayVisible: (v: boolean) => void;
  setFindingsProviderOverride: (providerId: string) => void;
  setPixelGridEnabled: (v: boolean) => void;
  setPixelGridSnapEnabled: (v: boolean) => void;
  resetGridOrigin: () => void;
  setDotGridEnabled: (v: boolean) => void;
  setBleedGuidesVisible: (v: boolean) => void;
  setLayoutGridVisible: (v: boolean) => void;
  setSnapEnabled: (v: boolean) => void;
  setSnapGrid: (v: number) => void;
  setDocumentGrid: (settings: DocumentGridSettings) => void;
  setIsometricGrid: (grid: import('@varve/scene').IsometricGrid) => void;
  isSnapExcluded?: (id: string) => boolean;

  // Export
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;
  /** ADR-0016: open the Create Table From Data dialog (clipboard parse). */
  openCreateTableFromDataDialog?: () => void;

  // Upscale dialog
  upscaleDialogOpen: boolean;
  openUpscaleDialog: () => void;
  closeUpscaleDialog: () => void;

  // Image Trace dialog
  vectorizeDialogOpen: boolean;
  openVectorizeDialog: (prefill?: { replaceGroupId: string } | null) => void;
  closeVectorizeDialog: () => void;

  // Extract Color Palette dialog
  paletteExtractDialogOpen: boolean;
  openPaletteExtract: (src: string) => void;
  closePaletteExtract: () => void;

  // Archive
  showArchiveDialog: boolean;
  archiveDialogMode: 'backup' | 'restore';
  setShowArchiveDialog: (show: boolean, mode?: 'backup' | 'restore') => void;
  addPreset: (nodeId: NodeId, preset: import('@varve/scene').ExportPreset) => void;
  updatePreset: (nodeId: NodeId, preset: import('@varve/scene').ExportPreset) => void;
  removePreset: (nodeId: NodeId, presetId: string) => void;

  // Boolean operations
  booleanOp: (op: import('@varve/scene').BooleanOpKind) => void;

  // Logo geometry operations (expand stroke, offset, round, simplify,
  // mirror duplicate, radial duplicate) — see useLogoGeometry.
  expandStrokeSelected: () => void;
  offsetPathSelected: (distance: number, joinStyle?: 'miter' | 'round' | 'bevel') => void;
  roundCornersSelected: (radius: number) => void;
  simplifyPathSelected: (tolerance: number) => void;
  mirrorDuplicateSelected: (axis: 'horizontal' | 'vertical') => void;
  radialDuplicateSelected: (count: number, totalAngleDeg?: number) => void;

  // Background removal
  removeBackground: (method: BackgroundRemovalMethod) => Promise<void>;
  removeBackgroundWithOptions: (
    method: BackgroundRemovalMethod,
    feather: number,
    decontaminate: boolean,
  ) => Promise<void>;
  cancelBackgroundRemoval: () => void;
  applyBackgroundRemovalPreview: () => void;
  cancelBackgroundRemovalPreview: () => void;
  setShowOriginalBg: (nodeId: NodeId | null) => void;
  setRefineMaskOptions: (opts: Partial<{ brushSize: number; hardness: number }>) => void;
  setTrimapEditOptions: (
    opts: Partial<{ brushSize: number; hardness: number; penMode: TrimapPenMode }>,
  ) => void;
  setBrushSetting: <K extends keyof EditorState['brushSettings']>(
    key: K,
    value: EditorState['brushSettings'][K],
  ) => void;
  refineHairEdges: () => Promise<void>;
  startTrimapEdit: () => void;
  applyTrimapMatting: () => Promise<void>;
  confirmSubjectPicker: (keepIds: number[]) => void;
  cancelSubjectPicker: () => void;
  getTrimapData: (nodeId: NodeId) => { data: Uint8Array; width: number; height: number } | null;
  setTrimapData: (nodeId: NodeId, data: Uint8Array, width: number, height: number) => void;

  // SAM2 segmentation
  applySam2Segmentation: (params: {
    nodeId: NodeId;
    prompts: {
      points?: Array<{ x: number; y: number; label: 0 | 1 }>;
      box?: { x1: number; y1: number; x2: number; y2: number };
    };
    signal?: AbortSignal;
    operation: 'preview' | 'mask' | 'selection' | 'layer';
    candidateIndex?: number;
  }) => Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null>;
  cancelSam2Segmentation: () => void;
  selectSam2Candidate: (index: number) => void;

  // Prototype
  setPrototypeMode: (active: boolean) => void;
  updatePrototypeData: () => void;
  handlePrototypeEvent: (event: unknown) => void;
  getPrototypeVariable: (id: string) => string | number | boolean | undefined;
  setPrototypeVariable: (id: string, value: string | number | boolean) => void;
  startPresentation: () => void;
  stopPresentation: () => void;
  getPrototypeScreens: () => Array<{ id: string; name: string }>;
  prototypeCurrentScreen: string;
  navigatePrototypeTo: (screenId: string) => void;

  // State machines
  getStateMachines: () => import('@varve/scene').StateMachine[];
  getPrimaryStateMachineId: () => string | null;
  createStateMachine: (name: string) => string;
  removeStateMachine: (smId: string) => void;
  renameStateMachine: (smId: string, name: string) => void;
  addSMState: (smId: string, name: string, timelineId: string) => string;
  removeSMState: (smId: string, stateId: string) => void;
  renameSMState: (smId: string, stateId: string, name: string) => void;
  duplicateSMState: (smId: string, stateId: string) => void;
  setSMEntryState: (smId: string, stateId: string) => void;
  addSMTransition: (
    smId: string,
    fromStateId: string,
    toStateId: string,
    trigger: import('@varve/scene').SMTransitionTrigger,
  ) => string;
  removeSMTransition: (smId: string, transitionId: string) => void;
  setSMTransitionTrigger: (
    smId: string,
    transitionId: string,
    trigger: import('@varve/scene').SMTransitionTrigger,
  ) => void;
  setSMTransitionTarget: (smId: string, transitionId: string, toStateId: string) => void;
  setSMTransitionCondition: (
    smId: string,
    transitionId: string,
    condition: string | undefined,
  ) => void;
  setSMTransitionPriority: (smId: string, transitionId: string, priority: number) => void;
  setSMTransitionDuration: (smId: string, transitionId: string, duration: number) => void;
  setSMTransitionEasing: (
    smId: string,
    transitionId: string,
    easing: import('@varve/shared').EasingDefinition,
  ) => void;
  addSMInput: (smId: string, name: string, type: import('@varve/scene').SMInputType) => string;
  removeSMInput: (smId: string, inputId: string) => void;
  validateStateMachine: (smId: string) => import('@varve/scene').SMValidationResult;
  selectedStateMachineId: string | null;
  selectStateMachine: (smId: string | null) => void;
  selectedSMStateId: string | null;
  selectSMState: (smId: string, stateId: string | null) => void;
  selectedSMTransitionId: string | null;
  selectSMTransition: (smId: string, transitionId: string | null) => void;

  // Motion
  playTimeline: (timelineId?: string) => void;

  // Media (animated images)
  playMedia: () => void;
  pauseMedia: () => void;
  toggleMedia: () => void;
  seekMedia: (timeMs: number) => void;
  stepMediaFrame: (direction: 1 | -1) => void;
  isMediaPlaying: () => boolean;
  mediaTime: () => number;
  pauseTimeline: () => void;
  stopTimeline: () => void;
  seekTimeline: (time: number) => void;
  setActiveTimeline: (id: string | null) => void;
  setPlaybackSpeed: (speed: number) => void;
  toggleLoop: () => void;
  addKeyframeToSelected: (property: string) => void;
  createTimeline: (name?: string, duration?: number) => string;
  removeTimeline: (id: string) => void;
  renameTimeline: (id: string, name: string) => void;
  removeTrack: (timelineId: string, trackId: string) => void;
  toggleTimelinePanel: () => void;
  toggleHistoryPanel: () => void;
  /** Restore every panel's visibility for the active workspace (recovery path). */
  restoreAllPanels: () => void;
  addTimelineMarker: (timelineId: string, name: string, progress: number) => void;
  removeTimelineMarker: (timelineId: string, markerId: string) => void;
  renameTimelineMarker: (timelineId: string, markerId: string, name: string) => void;
  createMotionPresetFromTimeline: (timelineId: string, name: string) => string;
  applyMotionPreset: (presetId: string, timelineId: string) => void;
  toggleAutoKeyframe: () => void;

  // Motion Mode — graph editor + keyframe editing
  toggleGraphEditor: () => void;
  setGraphEditorProperty: (property: string | null) => void;
  deleteKeyframe: (timelineId: string, trackId: string, progress: number) => void;
  moveKeyframe: (
    timelineId: string,
    trackId: string,
    oldProgress: number,
    newProgress: number,
  ) => void;
  duplicateKeyframe: (timelineId: string, trackId: string, progress: number) => void;
  updateKeyframeEasing: (
    timelineId: string,
    trackId: string,
    progress: number,
    easing: import('@varve/shared').EasingDefinition,
  ) => void;
  addTrackToTimeline: (timelineId: string, nodeId: NodeId, property: string) => void;
  setTrackMuted: (timelineId: string, trackId: string, muted: boolean) => void;
  setTrackSolo: (timelineId: string, trackId: string, solo: boolean) => void;

  // Guides
  addGuide: (axis: 'horizontal' | 'vertical', position: number) => string;
  removeGuide: (id: string) => void;
  moveGuide: (id: string, position: number) => void;
  toggleGuideLock: (id: string) => void;
  toggleLockAllGuides: () => void;
  duplicateGuide: (id: string, position: number) => string;
  clearAllGuides: () => void;
  setGuidesVisible: (visible: boolean) => void;
  toggleGuidesVisible: () => void;
  setSelectedGuideId: (id: string | null) => void;
  nudgeSelectedGuide: (dx: number, dy: number) => void;
  guides: Guide[];

  // Variants
  setVariantForInstance: (instanceId: NodeId, variantId: string) => void;
  createVariant: (
    componentId: NodeId,
    name: string,
    propertyValues: Record<string, string | boolean | NodeId>,
    instanceId?: NodeId,
  ) => void;
  setPropertyOverride: (
    instanceId: NodeId,
    propName: string,
    value: string | boolean | NodeId,
  ) => void;
  addComponentProperty: (
    componentId: NodeId,
    prop: {
      name: string;
      type: 'text' | 'boolean' | 'instanceSwap';
      defaultValue: string | boolean | NodeId;
    },
  ) => void;
  resolveVariantPropertiesForNode: (nodeId: NodeId) => Record<string, string | boolean | NodeId>;

  // Pages
  setPageBleed: (pageId: string, bleed: import('@varve/scene').BleedConfig) => void;
  setPageSafeArea: (pageId: string, safeArea: import('@varve/scene').SafeAreaConfig) => void;
  setPageSlug: (pageId: string, slug: import('@varve/scene').SlugConfig) => void;
  setActivePage: (pageId: NodeId) => void;
  setCurrentPageId: (id: string | null) => void;
  activePageNodes: () => NodeId[];
  /** Move a page on the pasteboard (placement metadata only, ADR-0124). */
  movePageOnPasteboard: (pageId: string, x: number, y: number) => void;
  /** Resize a page's trim without scaling its content (page-only resize). */
  resizePage: (pageId: string, width: number, height: number) => void;
  /** Fit the viewport to the active page's spread bounds. */
  fitSpread: () => void;
  /** Fit the viewport to every page (pasteboard bounds). */
  fitAllPages: () => void;

  /** Link the selected text frames into one story (ADR-0159). */
  linkSelectedTextFrames: () => void;
  /** Remove the selected frames from their stories. */
  unlinkSelectedTextFrames: () => void;

  // Master page methods
  createMaster: (name: string, width: number, height: number) => void;
  deleteMaster: (masterId: NodeId) => void;
  renameMaster: (masterId: NodeId, name: string) => void;
  duplicateMaster: (masterId: NodeId) => void;
  assignMasterToPage: (pageId: NodeId, masterId: NodeId | null) => void;
  setMasterAppliesTo: (masterId: NodeId, appliesTo: import('@varve/scene').MasterAppliesTo) => void;
  activePageNodesWithMaster: () => NodeId[];

  // Spread methods
  rebuildSpreads: (facingPages?: import('@varve/scene').FacingPagesConfig) => void;
  getSpreadForPage: (pageId: NodeId) => import('@varve/scene').Spread | undefined;
  getPageSide: (pageId: NodeId) => import('@varve/scene').PageSide;
  isPageOnLeftSide: (pageId: NodeId) => boolean;

  // Page numbering
  getPageNumber: (pageId: NodeId) => number;
  getFormattedPageNumber: (pageId: NodeId) => string;

  // Facing pages toggle
  toggleFacingPages: () => void;
  setFacingPagesEnabled: (enabled: boolean) => void;

  // Color mode
  documentColorMode: ColorMode;
  /**
   * Assign a working mode without rewriting stored values. Existing colors
   * keep their space and are interpreted under the new mode at read
   * boundaries (render/export). Non-destructive to values.
   */
  assignDocumentColorMode: (mode: ColorMode) => void;
  /**
   * Rewrite stored process colors into the target mode. Analytical in the
   * browser (reported as approximate); ICC-accurate conversion requires
   * the desktop engine.
   */
  convertDocumentColors: (mode: ColorMode) => void;
  /**
   * Set the document's default bit depth for newly authored colors. Does
   * not rewrite existing values.
   */
  setDocumentBitDepth: (bitDepth: import('@varve/scene').BitDepth) => void;
  /**
   * Set the document's compositing working space ('srgb' | 'linear').
   * A settings change; existing values are not rewritten.
   */
  setDocumentWorkingSpace: (space: import('@varve/scene').WorkingSpace) => void;

  // Soft proofing
  /** Persisted proof configuration (document print intent). */
  proofConfig: import('@varve/scene').ProofConfig;
  /** Session-scoped proof toggle. Never persisted into documents. */
  proofEnabled: boolean;
  setProofEnabled: (enabled: boolean) => void;
  /** Replace the proof configuration (never touches colors). */
  setProofConfig: (config: import('@varve/scene').ProofConfig) => void;

  // Spot-color libraries
  createSpotLibrary: (name: string) => void;
  addSpotToLibrary: (libraryId: string, def: import('@varve/scene').SpotColorDef) => void;
  updateSpotDef: (
    libraryId: string,
    spotId: string,
    patch: Partial<Omit<import('@varve/scene').SpotColorDef, 'id'>>,
  ) => void;
  removeSpotFromLibrary: (libraryId: string, spotId: string) => void;
  renameSpotLibrary: (libraryId: string, name: string) => void;
  deleteSpotLibrary: (libraryId: string) => void;

  // Color blindness simulation
  setColorBlindnessView: (type: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia') => void;

  // Quick-mask mode
  enterQuickMask: () => void;
  exitQuickMask: (convertToMask?: boolean) => void;
  setQuickMaskCoverage: (coverage: Uint8Array, width: number, height: number) => void;
  paintQuickMask: (x: number, y: number, radius: number, value: number) => void;
  fillQuickMask: (value: number) => void;
  invertQuickMask: () => void;
  isQuickMaskActive: () => boolean;

  // Foreground/background painting colors
  setForegroundColor: (color: [number, number, number, number]) => void;
  setBackgroundColor: (color: [number, number, number, number]) => void;
  swapColors: () => void;
  /** Reset foreground/background to defaults (black foreground, white background). */
  resetColors: () => void;

  // Analytics
  recordAction: (actionId: string) => void;

  // Palette extraction
  extractPalette: (data: ImageData, colorCount?: number) => import('@varve/engine').PaletteResult;
  generateHarmony: (
    color: import('@varve/scene').ManagedColor,
    type: 'complementary' | 'triadic' | 'analogous' | 'splitComplementary' | 'monochromatic',
  ) => import('@varve/engine').HarmonyPalette;

  // Cognitive load
  getCognitiveLoad: (
    nodeId: import('@varve/scene').NodeId | null,
  ) => import('../intelligence/cognitiveLoad').CognitiveLoadReport;

  // Inspector panel navigation (status-bar badges -> inspector tabs)
  setInspectorTab: (tab: InspectorTab, subTab?: IntelligenceTab) => void;

  // Content-Aware Fill dialog
  openCafDialog: (nodeId: NodeId) => void;
  closeCafDialog: () => void;

  // Debug overlays (Workstream A)
  setDebugOverlayEnabled: (enabled: boolean) => void;
  setDebugOverlayChannel: (
    channel: import('../debug/DebugOverlayRegistry').DebugOverlayChannel,
    value: boolean,
  ) => void;
  setDebugOverlayLabelDensity: (
    density: import('../debug/DebugOverlayRegistry').DebugLabelDensity,
  ) => void;
  setDebugOverlayFrozen: (frozen: boolean) => void;

  // Touch multi-select (Workstream D)
  setTouchMultiSelect: (active: boolean) => void;

  // Layer navigation (registered by LayersTree when mounted)
  layerNavigation?: LayerNavigationCommands;
}
