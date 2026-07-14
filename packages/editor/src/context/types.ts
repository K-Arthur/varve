import type { Adjustment, BlendMode, PathPoint } from '@strata/engine';
import type { Platform } from '@strata/platform';
import type { PrototypeData, PrototypeDebugConsole, PrototypeRuntime } from '@strata/prototype';
import type {
  BackgroundRemovalMethod,
  ColorMode,
  Document,
  Fill,
  GridItemPlacement,
  Guide,
  LayerColor,
  LayoutSizing,
  LayoutStyle,
  NodeId,
  SceneNode,
  VariableValue,
} from '@strata/scene';
import type { Camera, DistributeMode, DocumentUnit, Viewport } from '@strata/shared';
import type { FrameSpatialIndex } from '../scene/spatialIndex';
import type { MotionState } from '../state/motion-state';
import type { DraftShape } from '../tools/types';

export type ToolId =
  | 'select'
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'pencil'
  | 'nodeEdit'
  | 'text'
  | 'hand'
  | 'zoom'
  | 'scale'
  | 'image'
  | 'slice'
  | 'eyedropper'
  | 'inspect'
  | 'booleanUnion'
  | 'booleanSubtract'
  | 'booleanIntersect'
  | 'booleanExclude'
  | 'cloneStamp'
  | 'healBrush'
  | 'spotHeal'
  | 'patch'
  | 'refineMask'
  | 'trimapEdit'
  | 'crop'
  | 'paint'
  | 'eraser';

export type TrimapPenMode = 'foreground' | 'unknown' | 'background';

export interface SubjectPickerSession {
  nodeId: NodeId;
  width: number;
  height: number;
  components: Array<{
    id: number;
    pixelCount: number;
    bbox: { x: number; y: number; w: number; h: number };
  }>;
  keepIds: number[];
  pendingMaskDataUrl: string;
  method: BackgroundRemovalMethod;
  confidence: number;
  feather: number;
  decontaminate: boolean;
}

export type CanvasMode = 'full' | 'outline' | 'preview';

export type RulerMode = 'global' | 'artboard';

export type GridOverlayMode = 'none' | 'baseline' | 'isometric';

export interface SessionMeta {
  id: string;
  name: string;
  dirty: boolean;
  filePath?: string;
  fileId?: string;
}

export interface EditorState {
  tool: ToolId;
  zoom: number;
  pan: { x: number; y: number };
  selection: NodeId[];
  document: Document;
  sessions: SessionMeta[];
  activeId: string;
  dirty: boolean;
  cursorPos: { x: number; y: number } | null;
  unitType: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%';
  pixelGridEnabled: boolean;
  snapEnabled: boolean;
  snapGrid: number;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  prototypeMode: boolean;
  prototypeRuntime: PrototypeRuntime | null;
  prototypeDebug: PrototypeDebugConsole;
  prototypeData: PrototypeData;
  isPresenting: boolean;
  softProofEnabled: boolean;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  timelinePanelVisible: boolean;
  motion: MotionState;
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
   * container's subtree. A view-mode flag, not a document mutation — not
   * part of undo/redo history. */
  isolatedNodeId: NodeId | null;
  showOriginalBgNodeId: NodeId | null;
  refineMaskOptions: { brushSize: number; hardness: number };
  trimapEditOptions: { brushSize: number; hardness: number; penMode: TrimapPenMode };
  subjectPickerSession: SubjectPickerSession | null;
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
}

export interface EditorContextValue {
  state: EditorState;
  platform?: Platform;
  // Tool
  setTool: (t: ToolId) => void;
  // Viewport
  setCamera: (camera: Camera) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
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
  // Selection
  setSelection: (id: NodeId | null) => void;
  toggleSelection: (id: NodeId, additive?: boolean) => void;
  isSelected: (id: NodeId) => boolean;
  selectedNodes: () => SceneNode[];
  selectAllWithSameType: () => void;
  selectAllWithSameFill: () => void;
  selectAllWithSameLayerColor: () => void;
  selectAllOfType: () => void;
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
  getWorldTransform: (id: NodeId) => import('@strata/shared').Affine;
  getWorldBounds: (id: NodeId) => import('@strata/shared').Rect | null;
  hitTestNode: (world: { x: number; y: number }) => { nodeId: NodeId; node: SceneNode } | null;
  getNode: (id: NodeId) => SceneNode | undefined;
  walkNodes: () => Map<
    NodeId,
    { nodeId: NodeId; node: SceneNode; parentId: NodeId | null; depth: number }
  >;
  setDraft: (draft: DraftShape | null) => void;
  removeSelected: () => void;
  renameSelected: (name: string) => void;
  moveNode: (id: NodeId, toIndex: number) => void;
  duplicateSelected: () => void;
  setSelectedFill: (color: import('@strata/scene').ManagedColor) => void;
  setSelectedFills: (fills: Fill[]) => void;
  updateSelectedFillAt: (index: number, fill: Fill) => void;
  addSelectedFill: (fill: Fill) => void;
  removeSelectedFillAt: (index: number) => void;
  reorderSelectedFill: (from: number, to: number) => void;
  setNodePosition: (id: NodeId, x: number, y: number) => void;
  setNodeSize: (id: NodeId, w: number, h: number) => void;
  setSelectedX: (x: number) => void;
  setSelectedY: (y: number) => void;
  setSelectedW: (w: number) => void;
  setSelectedH: (h: number) => void;
  updateNode: (id: NodeId, updater: (node: SceneNode) => SceneNode) => void;
  setSelectedOpacity: (value: number) => void;
  setSelectedBlendMode: (mode: BlendMode) => void;
  setSelectedRotation: (value: number) => void;
  setSelectedFlipH: () => void;
  setSelectedFlipV: () => void;
  setSelectedCornerRadius: (value: number | [number, number, number, number]) => void;
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
  setSelectedGridPlacement: (value: GridItemPlacement) => void;
  setCanvasWidth: (value: number) => void;
  setCanvasHeight: (value: number) => void;
  setCanvasBackground: (value: import('@strata/scene').ManagedColor) => void;
  setSelectedBinding: (
    target: string,
    binding: import('@strata/scene').PropertyBinding | null,
  ) => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
  abortTransaction: () => void;
  undo: () => void;
  redo: () => void;
  newDocument: () => void;
  serializeDocument: () => string;
  updateDoc: (fn: (doc: Document) => Document) => void;
  loadDocument: (json: string, meta?: { name?: string; filePath?: string }) => void;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  openFile: (
    fileId: string,
    name: string,
    filePath: string | undefined,
    json: string | null,
  ) => void;
  rootNodes: () => SceneNode[];
  reparentNode: (id: NodeId, newParentId: NodeId | null, toIndex: number) => void;
  arrangeSelected: (op: import('@strata/scene').ArrangeOp) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  detachSelected: () => void;

  // Components
  createComponentFromFrame: (
    name: string,
    masterRootId: NodeId,
    slots: import('@strata/scene').Slot[],
  ) => void;
  createComponentInstance: (componentId: NodeId) => void;
  fillSlot: (instanceId: NodeId, slotId: string, fillNodeId: NodeId) => void;
  swapComponentInstance: (instanceId: NodeId, newComponentId: NodeId) => void;
  resetInstanceOverrides: (instanceId: NodeId) => void;
  syncComponentInstances: (componentId: NodeId) => import('@strata/scene').SyncResult;
  syncInstance: (instanceId: NodeId) => import('@strata/scene').InstanceStatus;
  getInstanceStatus: (instanceId: NodeId) => import('@strata/scene').InstanceStatus;
  syncAllInstances: () => import('@strata/scene').SyncResult;

  // Visibility
  setNodeLocked: (id: NodeId, locked: boolean) => void;
  setNodeVisible: (id: NodeId, visible: boolean) => void;
  setNodeClipContent: (id: NodeId, clipContent: boolean) => void;
  setLayerColor: (id: NodeId, color: LayerColor) => void;

  // Masks
  addMaskToSelected: (type?: import('@strata/scene').MaskType) => void;
  removeMaskFromSelected: () => void;
  toggleMask: () => void;
  invertMask: () => void;
  setMaskFeather: (feather: number) => void;
  setMaskDensity: (density: number) => void;
  setMaskHideSource: (hidden: boolean) => void;
  setMaskLinked: (linked: boolean) => void;
  setMaskType: (type: import('@strata/scene').MaskType) => void;
  setMaskSourceNode: (sourceNodeId: string) => void;
  setMaskFillRule: (fillRule: import('@strata/scene').MaskFillRule) => void;
  setMaskVectorPath: (points: import('@strata/engine').PathPoint[], closed: boolean) => void;
  bulkSetNodeLocked: (ids: NodeId[], locked: boolean) => void;
  bulkSetNodeVisible: (ids: NodeId[], visible: boolean) => void;
  bulkSetLayerColor: (ids: NodeId[], color: LayerColor) => void;

  // Layout
  setNodeLayout: (id: NodeId, layout: LayoutStyle | undefined) => void;

  // Variables
  resolveVariable: (nameOrId: string) => VariableValue;
  addVariable: (v: Omit<import('@strata/scene').Variable, 'id'>) => void;
  updateVariable: (
    id: string,
    patch: Partial<Omit<import('@strata/scene').Variable, 'id'>>,
  ) => void;
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
  removeAdjustmentFromLayer: (nodeId: NodeId, adjustmentId: string) => void;
  updateAdjustmentInLayer: (
    nodeId: NodeId,
    adjustmentId: string,
    patch: Partial<Adjustment>,
  ) => void;
  reorderAdjustmentInLayer: (nodeId: NodeId, adjustmentId: string, newIndex: number) => void;
  setAdjustmentLayerOpacity: (nodeId: NodeId, opacity: number) => void;
  setAdjustmentLayerBlendMode: (nodeId: NodeId, blendMode: string) => void;

  // Clipboard
  copySelected: () => void;
  cutSelected: () => void;
  paste: () => void;
  importNode: (
    node: SceneNode,
    sourceDoc: Document,
    options?: { position?: { x: number; y: number } },
  ) => void;
  batchImportNodes: (
    items: { node: SceneNode; sourceDoc: Document; position?: { x: number; y: number } }[],
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
  setPixelGridEnabled: (v: boolean) => void;
  setSnapEnabled: (v: boolean) => void;
  setSnapGrid: (v: number) => void;
  isSnapExcluded?: (id: string) => boolean;

  // Export
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;
  addPreset: (nodeId: NodeId, preset: import('@strata/scene').ExportPreset) => void;
  updatePreset: (nodeId: NodeId, preset: import('@strata/scene').ExportPreset) => void;
  removePreset: (nodeId: NodeId, presetId: string) => void;

  // Boolean operations
  booleanOp: (op: import('@strata/scene').BooleanOpKind) => void;

  // Background removal
  removeBackground: (method: BackgroundRemovalMethod) => Promise<void>;
  removeBackgroundWithOptions: (
    method: BackgroundRemovalMethod,
    feather: number,
    decontaminate: boolean,
  ) => Promise<void>;
  cancelBackgroundRemoval: () => void;
  setShowOriginalBg: (nodeId: NodeId | null) => void;
  setRefineMaskOptions: (opts: Partial<{ brushSize: number; hardness: number }>) => void;
  setTrimapEditOptions: (
    opts: Partial<{ brushSize: number; hardness: number; penMode: TrimapPenMode }>,
  ) => void;
  refineHairEdges: () => Promise<void>;
  startTrimapEdit: () => void;
  applyTrimapMatting: () => Promise<void>;
  confirmSubjectPicker: (keepIds: number[]) => void;
  cancelSubjectPicker: () => void;
  getTrimapData: (nodeId: NodeId) => { data: Uint8Array; width: number; height: number } | null;
  setTrimapData: (nodeId: NodeId, data: Uint8Array, width: number, height: number) => void;

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

  // Motion
  playTimeline: (timelineId?: string) => void;
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
  addTimelineMarker: (timelineId: string, name: string, progress: number) => void;
  removeTimelineMarker: (timelineId: string, markerId: string) => void;
  renameTimelineMarker: (timelineId: string, markerId: string, name: string) => void;
  createMotionPresetFromTimeline: (timelineId: string, name: string) => string;
  applyMotionPreset: (presetId: string, timelineId: string) => void;
  toggleAutoKeyframe: () => void;

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
  setPageBleed: (pageId: string, bleed: import('@strata/scene').BleedConfig) => void;
  setPageSafeArea: (pageId: string, safeArea: import('@strata/scene').SafeAreaConfig) => void;
  setPageSlug: (pageId: string, slug: import('@strata/scene').SlugConfig) => void;
  setActivePage: (pageId: NodeId) => void;
  setCurrentPageId: (id: string | null) => void;
  activePageNodes: () => NodeId[];

  // Color mode
  documentColorMode: ColorMode;
  switchColorMode: (mode: ColorMode) => void;

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
}
