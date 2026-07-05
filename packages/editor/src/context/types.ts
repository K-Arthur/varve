import type { NodeId, SceneNode } from '@strata/scene';
import type { Document, Guide, VariableStore, VariableValue } from '@strata/scene';
import type { LayoutStyle, LayerColor, Fill, LayoutSizing, GridItemPlacement } from '@strata/scene';
import type { Adjustment, BlendMode, PathPoint } from '@strata/engine';
import type { DocumentUnit, Viewport } from '@strata/shared';
import type { DraftShape } from '../tools/types';
import type { MotionState } from '../state/motion-state';
import type { PrototypeData, PrototypeRuntime } from '@strata/prototype';
import { PrototypeDebugConsole } from '@strata/prototype';

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
  | 'patch';

export type CanvasMode = 'full' | 'outline' | 'preview';

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
  variableStore: VariableStore;
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
  motion: MotionState;
  canvasMode: CanvasMode;
  currentPageId: string | null;
}

export interface EditorContextValue {
  state: EditorState;
  // Tool
  setTool: (t: ToolId) => void;
  // Viewport
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
  // Document CRUD
  createShapeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    pathPoints?: PathPoint[],
  ) => void;
  createTextNodeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    text?: string,
  ) => void;
  applyFramePreset: (preset: { name: string; w: number; h: number }) => void;
  findContainingFrame: (world: { x: number; y: number }) => NodeId | null;
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

  // Export
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;
  addPreset: (nodeId: NodeId, preset: import('@strata/scene').ExportPreset) => void;
  updatePreset: (nodeId: NodeId, preset: import('@strata/scene').ExportPreset) => void;
  removePreset: (nodeId: NodeId, presetId: string) => void;

  // Boolean operations
  booleanOp: (op: import('@strata/scene').BooleanOpKind) => void;

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

  // Guides
  addGuide: (axis: 'horizontal' | 'vertical', position: number) => void;
  removeGuide: (id: string) => void;
  moveGuide: (id: string, position: number) => void;
  toggleGuideLock: (id: string) => void;
  clearAllGuides: () => void;
  guides: Guide[];

  // Variants
  setVariantForInstance: (instanceId: NodeId, variantId: string) => void;
  createVariant: (
    componentId: NodeId,
    name: string,
    propertyValues: Record<string, string | boolean | NodeId>,
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

  // Analytics
  recordAction: (actionId: string) => void;
}
