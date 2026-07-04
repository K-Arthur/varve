/**
 * Editor state context — shared across all shell surfaces.
 *
 * Holds the editor's tool state, viewport (zoom/pan), selection, AND the scene
 * Document. Document actions are provided through the context so any surface
 * (toolbar, canvas, layers, inspector) can mutate the scene.
 *
 * F1: Selection is now NodeId[] (multi-select capable). All surfaces read
 *     selection through isSelected()/selectedNodes() so nested nodes work
 *     (doc.nodes[id] lookup vs the old rootNodes().find() which missed nested).
 *
 * F4: Auto-naming is type-aware: "Rectangle 1", "Ellipse 2", "Frame 1", etc.
 *     Frame tool now correctly creates a FrameNode (container), not a ShapeNode.
 */

import { getTransactionHooks } from '@strata/collab';
import type { Affine, PathPoint, Shape } from '@strata/engine';
import type { ManagedColor } from '@strata/scene';
import {
  applyAffine,
  invertAffine,
  multiplyAffine,
  rectContains,
  shapeContains,
} from '@strata/engine';
import { importFile } from '@strata/import';
import { makeFileEntry, type Platform } from '@strata/platform';
import {
  createRuntime,
  type Interaction,
  type PrototypeData,
  PrototypeDebugConsole,
  type PrototypeRuntime,
  applyActionResult as protoApplyActionResult,
  getVariable as protoGetVar,
  handleEvent as protoHandleEvent,
  setVariable as protoSetVar,
} from '@strata/prototype';
import type { ExportPreset, NodeId, Slot } from '@strata/scene';
import {
  type ArrangeOp,
  type BleedConfig,
  addChild,
  addComponentProperty as addComponentPropertyDoc,
  type SafeAreaConfig,
  type SlugConfig,
  addGuide as addGuideDoc,
  addKeyframe,
  addNode,
  addTrack,
  arrangeNode as arrangeNodeDoc,
  clearGuides,
  createComponent,
  createDocument,
  createVariableStore,
  createVariant as createVariantDoc,
  type Document,
  detachInstance as detachInstanceDoc,
  booleanOp as doBooleanOp,
  fillSlot as fillSlotDoc,
  type Guide,
  getNestedValue,
  getParent,
  groupNodes as groupNodesDoc,
  instantiate as instantiateComponent,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  migrateDocumentJson,
  moveGuide as moveGuideDoc,
  moveNode,
  nextNodeId,
  removeGuide as removeGuideDoc,
  removeNode,
  renameNode,
  reparentNode as reparentNodeDoc,
  resetInstanceOverrides as resetInstanceOverridesDoc,
  resolve,
  resolveNodeFills,
  resolveVariantProperties,
  type SceneNode,
  setVariantForInstance as setVariantForInstanceDoc,
  swapInstance as swapInstanceDoc,
  toggleGuideLock as toggleGuideLockDoc,
  ungroupNode as ungroupNodeDoc,
  type Variable,
  type VariableStore,
  type VariableValue,
  walkNodes,
} from '@strata/scene';

import {
  clampZoom,
  fitBoundsCamera,
  revealBoundsCamera,
  screenToWorld,
  type Viewport,
  zoomAboutPoint,
} from '@strata/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AutoSaveService } from './autoSaveService';
import { CanvasAnnouncer } from './canvas/CanvasAnnouncer';
import {
  readClipboardImages,
  readClipboardText,
  readClipboard as readFromClipboard,
  writeClipboard as writeToClipboard,
} from './clipboard';
import { loadSettings as loadUiSettings } from './components/Settings/settings';
import { applyDropPosition } from './dropUtils';
import { computeFlexLayout } from './layout/computeFlexLayout';
import { getSharedRecoveryManager, type RecoveryManager } from './recovery';
import { groupWorldBounds, nodeWorldBounds, nodeWorldTransform } from './scene/world';
import { loadSettings, updateSettings } from './settings';
import {
  createInitialMotionState,
  type MotionState,
  type MotionTimelineEngine,
} from './state/motion-state';
import type { DraftShape } from './tools/types';

// Forward declaration for use in createShapeAt guard
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

/** F2: metadata for each open document tab. */
export interface SessionMeta {
  id: string;
  name: string;
  dirty: boolean;
  filePath?: string;
  /** Platform file-entry id this tab was opened from (for tab dedupe). */
  fileId?: string;
}

export interface EditorState {
  tool: ToolId;
  zoom: number;
  pan: { x: number; y: number };
  /** F1: multi-select set; use isSelected/selectedNodes helpers to read. */
  selection: NodeId[];
  document: Document;
  /** F2: open document sessions (tabs). */
  sessions: SessionMeta[];
  activeId: string;
  dirty: boolean;
  /** B1: per-session variable store. */
  variableStore: VariableStore;
  /** Cursor position on canvas (world coords), null when not over canvas. */
  cursorPos: { x: number; y: number } | null;
  /** Current display unit. */
  unitType: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%';
  /** Pixel grid overlay toggle. */
  pixelGridEnabled: boolean;
  /** Snap-to-grid toggle. */
  snapEnabled: boolean;
  /** Snap grid size in pixels. */
  snapGrid: number;
  /** Save state for the active document. */
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  /** When the active document was last saved (epoch ms). */
  lastSavedAt: number | null;
  /** Prototype mode active */
  prototypeMode: boolean;
  /** Prototype runtime instance */
  prototypeRuntime: PrototypeRuntime | null;
  /** Prototype debug console */
  prototypeDebug: PrototypeDebugConsole;
  /** Prototype data from the document */
  prototypeData: PrototypeData;
  /** Whether prototype is presenting */
  isPresenting: boolean;
  /** Soft proofing overlay toggle. */
  softProofEnabled: boolean;
  /** Layers (left) panel visibility — persisted in editor settings. */
  leftPanelVisible: boolean;
  /** Inspector (right) panel visibility — persisted in editor settings. */
  rightPanelVisible: boolean;
  /** Motion/animation playback state. */
  motion: MotionState;
}

export interface EditorContextValue {
  state: EditorState;
  setTool: (t: ToolId) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  /** Zoom in 25% anchored to the viewport center. */
  zoomIn: () => void;
  /** Zoom out 20% anchored to the viewport center. */
  zoomOut: () => void;
  /** Zoom to an absolute level anchored to the viewport center. */
  zoomTo: (level: number) => void;
  /** Toggle layers (left) panel visibility; persists to editor settings. */
  toggleLeftPanel: () => void;
  /** Toggle inspector (right) panel visibility; persists to editor settings. */
  toggleRightPanel: () => void;
  /** Fit all nodes in the document to the viewport. */
  fitAll: () => void;
  /** Replace selection with a single node (or clear if null). */
  setSelection: (id: NodeId | null) => void;
  /** Toggle one node in/out of the selection; additive keeps existing selection. */
  toggleSelection: (id: NodeId, additive?: boolean) => void;
  /** True if the given id is currently selected. */
  isSelected: (id: NodeId) => boolean;
  /** All selected scene nodes — works for nested nodes (uses doc.nodes lookup). */
  selectedNodes: () => SceneNode[];
  /** Select all visible unlocked nodes of the same kind as the first selected node. */
  selectAllWithSameType: () => void;
  /** Select all visible unlocked shape nodes matching the first selected node's fill. */
  selectAllWithSameFill: () => void;
  /** Create a shape/frame node from the current tool at the given world-space point. */
  createShapeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    pathPoints?: PathPoint[],
  ) => void;
  /** Create a text node at the given world-space point. */
  createTextNodeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    text?: string,
  ) => void;
  /**
   * Apply a frame size preset. If a single frame is selected, resizes it.
   * Otherwise creates a new frame of the given size centered in the viewport
   * and selects it. Used by the inspector's frame-preset panel (Figma model).
   */
  applyFramePreset: (preset: { name: string; w: number; h: number }) => void;
  /** Find the deepest frame/group containing a world point (spatial containment). */
  findContainingFrame: (world: { x: number; y: number }) => NodeId | null;
  /** Compute world-space bounding box for a node. */
  nodeWorldBounds: (n: SceneNode) => { x: number; y: number; w: number; h: number } | null;
  /** Convert canvas CSS-px coordinates to world coordinates. */
  canvasToWorld: (cx: number, cy: number) => { x: number; y: number };
  /** Convert world coordinates to canvas CSS-px coordinates. */
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
  /** Convert a canvas CSS-px delta to a world-space delta (divides by zoom). */
  canvasDeltaToWorld: (dx: number, dy: number) => { dx: number; dy: number };
  /** Efficient hit-test that returns the full node info. */
  hitTestNode: (world: { x: number; y: number }) => { nodeId: NodeId; node: SceneNode } | null;
  /** Pan (and optionally zoom) to reveal the selection or a specific node. */
  revealSelection: (opts?: {
    nodeId?: NodeId;
    fit?: boolean;
    padding?: number;
    viewport?: Viewport;
  }) => void;
  /** Get a node by ID from the document. */
  getNode: (id: NodeId) => SceneNode | undefined;
  /** Walk all nodes in the document, returning entries with parent/depth info. */
  walkNodes: () => Map<
    NodeId,
    { nodeId: NodeId; node: SceneNode; parentId: NodeId | null; depth: number }
  >;
  /** Set a draft rectangle for live feedback during gestures. */
  setDraft: (draft: DraftShape | null) => void;
  /** Remove all currently selected nodes. */
  removeSelected: () => void;
  /** Rename the first selected node. */
  renameSelected: (name: string) => void;
  /** Move a node to a new paint-order index. */
  moveNode: (id: NodeId, toIndex: number) => void;
  /** Duplicate all selected nodes with new IDs. */
  duplicateSelected: () => void;
  /** Update the fill of all selected nodes. */
  setSelectedFill: (color: ManagedColor) => void;
  /** P2: Set the entire fill stack on all selected nodes. */
  setSelectedFills: (fills: import('@strata/scene').Fill[]) => void;
  /** P2: Update a single fill in the stack at a given index on all selected nodes. */
  updateSelectedFillAt: (index: number, fill: import('@strata/scene').Fill) => void;
  /** P2: Add a fill to the stack on all selected nodes. */
  addSelectedFill: (fill: import('@strata/scene').Fill) => void;
  /** P2: Remove a fill at a given index from the stack on all selected nodes. */
  removeSelectedFillAt: (index: number) => void;
  /** P2: Reorder fills: move from one index to another on all selected nodes. */
  reorderSelectedFill: (from: number, to: number) => void;
  /** Update the position (transform) of a node. */
  setNodePosition: (id: NodeId, x: number, y: number) => void;
  /** Update the size of a shape node. */
  setNodeSize: (id: NodeId, w: number, h: number) => void;
  /**
   * Batch-edit: set X/Y on EVERY selected node in a single undo step.
   * (Strata plan §8 — multi-select batch editing commits as one history entry.)
   * Each axis is independent so a "Mixed" axis is preserved when the other edits.
   */
  setSelectedX: (x: number) => void;
  setSelectedY: (y: number) => void;
  /** Batch-edit: set W/H on every selected shape node in a single undo step. */
  setSelectedW: (w: number) => void;
  setSelectedH: (h: number) => void;
  /** F6: update any property on a single node (one undo step). */
  updateNode: (id: NodeId, updater: (node: SceneNode) => SceneNode) => void;
  /** F6: batch-edit opacity on all selected nodes. */
  setSelectedOpacity: (value: number) => void;
  /** F6: batch-edit blend mode on all selected nodes. */
  setSelectedBlendMode: (mode: import('@strata/engine').BlendMode) => void;
  /** F6: batch-edit rotation on all selected nodes. */
  setSelectedRotation: (value: number) => void;
  /** F6: batch-edit flip horizontal on all selected nodes. */
  setSelectedFlipH: () => void;
  /** F6: batch-edit flip vertical on all selected nodes. */
  setSelectedFlipV: () => void;
  /** F6: batch-edit corner radius on all selected shape nodes. */
  setSelectedCornerRadius: (value: number | [number, number, number, number]) => void;
  /** F6: align selected nodes by the given axis. */
  alignSelected: (axis: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => void;
  /** F6: distribute selected nodes equally along the given axis. */
  distributeSelected: (axis: 'horizontal' | 'vertical') => void;
  /** P3: batch-set min width on all selected nodes. */
  setSelectedMinWidth: (value: number) => void;
  /** P3: batch-set max width on all selected nodes. */
  setSelectedMaxWidth: (value: number) => void;
  /** P3: batch-set min height on all selected nodes. */
  setSelectedMinHeight: (value: number) => void;
  /** P3: batch-set max height on all selected nodes. */
  setSelectedMaxHeight: (value: number) => void;
  /** P3: batch-set layout sizing mode on all selected nodes. */
  setSelectedLayoutSizing: (value: import('@strata/scene').LayoutSizing) => void;
  /** P3: batch-set grid item placement on all selected nodes. */
  setSelectedGridPlacement: (value: import('@strata/scene').GridItemPlacement) => void;
  /** P3: set the document canvas width. */
  setCanvasWidth: (value: number) => void;
  /** P3: set the document canvas height. */
  setCanvasHeight: (value: number) => void;
  /** P3: set the document canvas background color. */
  setCanvasBackground: (value: ManagedColor) => void;
  /** F6: batch-set a variable binding on all selected nodes. */
  setSelectedBinding: (
    target: string,
    binding: import('@strata/scene').PropertyBinding | null,
  ) => void;
  /** F6: transaction API — begin, commit, abort for single-undo scrubbing. */
  beginTransaction: () => void;
  commitTransaction: () => void;
  abortTransaction: () => void;
  /** Undo last document mutation. */
  undo: () => void;
  /** Redo last undone mutation. */
  redo: () => void;
  /** Create a new empty document. */
  newDocument: () => void;
  /** Serialize current document to JSON string. */
  serializeDocument: () => string;
  /** Load a document from a JSON string. */
  loadDocument: (json: string, meta?: { name?: string; filePath?: string }) => void;
  /** Save the current document via the platform. */
  save: () => Promise<boolean>;
  /** Save As the current document via the platform. */
  saveAs: () => Promise<boolean>;
  /** Save state for display in the UI. */
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  /** When the document was last saved. */
  lastSavedAt: number | null;
  /**
   * Open a file into a tab: switches to an existing tab for the same file,
   * reuses a pristine blank tab, or opens a new tab. `json: null` creates a
   * fresh blank document (new-file flow).
   */
  openFile: (
    fileId: string,
    name: string,
    filePath: string | undefined,
    json: string | null,
  ) => void;
  /** Visible root-level nodes in paint order (layers panel, IR). */
  rootNodes: () => SceneNode[];
  /** Register a component definition from a frame. */
  createComponentFromFrame: (name: string, masterRootId: NodeId, slots: Slot[]) => void;
  /** Create an instance of a component. */
  createComponentInstance: (componentId: NodeId) => void;
  /** Fill a slot on a component instance. */
  fillSlot: (instanceId: NodeId, slotId: string, fillNodeId: NodeId) => void;
  /** Swap a component instance to a different component definition. */
  swapComponentInstance: (instanceId: NodeId, newComponentId: NodeId) => void;
  /** Reset overrides on a component instance to master defaults. */
  resetInstanceOverrides: (instanceId: NodeId) => void;
  /** Toggle the locked state of a node. */
  setNodeLocked: (id: NodeId, locked: boolean) => void;
  /** Toggle the visible state of a node. */
  setNodeVisible: (id: NodeId, visible: boolean) => void;
  /** Toggle clipContent on a frame node. */
  setNodeClipContent: (id: NodeId, clipContent: boolean) => void;
  /** B2: set or update the layout style on a frame node. */
  setNodeLayout: (id: NodeId, layout: import('@strata/scene').LayoutStyle | undefined) => void;
  /** B1: resolve a variable to its current value (throws on missing/cycle). */
  resolveVariable: (nameOrId: string) => VariableValue;
  /** B1: add a new variable to the active session's store. */
  addVariable: (v: Omit<Variable, 'id'>) => void;
  /** B1: update an existing variable. */
  updateVariable: (id: string, patch: Partial<Omit<Variable, 'id'>>) => void;
  /** B1: delete a variable by id. */
  deleteVariable: (id: string) => void;
  /** B1: switch the active variable mode. */
  setVariableMode: (mode: string) => void;
  /** F2/A8: open a new document in a new tab. */
  newTab: () => void;
  /** F2/A8: switch the active tab. */
  switchTab: (id: string) => void;
  /** F2/A8: close a tab. Returns false if dirty and force is not set (caller should confirm). */
  closeTab: (id: string, force?: boolean) => boolean;
  /** Announce a message to screen readers via the shared aria-live region. */
  announce: (msg: string) => void;
  /** Announce a selection change with formatted details. */
  announceSelection: (selected: SceneNode[]) => void;
  /** Announce an operation result. */
  announceOperation: (op: string, result: string) => void;
  /** Reparent a node to a new container (or root). One undo step. */
  reparentNode: (id: NodeId, newParentId: NodeId | null, toIndex: number) => void;
  /** Arrange selected nodes within their parent (front/back/forward/backward). */
  arrangeSelected: (op: ArrangeOp) => void;
  /** Group selected nodes into a GroupNode. */
  groupSelected: () => void;
  /** Ungroup the first selected group. */
  ungroupSelected: () => void;
  /** Detach the first selected component instance. */
  detachSelected: () => void;
  /** Copy selected nodes to system clipboard. */
  copySelected: () => void;
  /** Cut selected nodes (copy + remove). */
  cutSelected: () => void;
  /** Paste nodes from system clipboard. */
  paste: () => void;
  /** Import a node from an imported document (svg/image) into the current document. */
  importNode: (
    node: SceneNode,
    sourceDoc: import('@strata/scene').Document,
    options?: { position?: { x: number; y: number } },
  ) => void;
  /** The field name currently targeted for variable binding, or null. */
  bindingField: string | null;
  /** Open the BindingMenu for a specific field, or close it. */
  setBindingField: (field: string | null) => void;
  /** The field name currently focused (for `=` binding shortcut), or null. */
  focusedField: string | null;
  /** Set the focused field (called by NumberField on focus/blur). */
  setFocusedField: (field: string | null) => void;
  /** F6: batch-edit corner smoothing on all selected shape nodes. */
  setSelectedCornerSmoothing: (value: number) => void;
  /** Set cursor position on canvas (null when pointer leaves). */
  setCursorPos: (pos: { x: number; y: number } | null) => void;
  /** Set the display unit type. */
  setUnitType: (t: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%') => void;
  /** Set the document's measurement unit (px, pt, mm, cm, in, pc). */
  setDocumentUnit: (unit: import('@strata/shared').DocumentUnit) => void;
  /** Toggle soft proofing overlay. */
  setSoftProofEnabled: (v: boolean) => void;
  /** Toggle pixel grid overlay. */
  setPixelGridEnabled: (v: boolean) => void;
  /** Toggle snap-to-grid. */
  setSnapEnabled: (v: boolean) => void;
  /** Show the export dialog modal. */
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;
  /** Add an export preset to a node. */
  addPreset: (nodeId: NodeId, preset: ExportPreset) => void;
  /** Update an export preset on a node. */
  updatePreset: (nodeId: NodeId, preset: ExportPreset) => void;
  /** Remove an export preset from a node. */
  removePreset: (nodeId: NodeId, presetId: string) => void;
  /** Apply a boolean operation to all selected nodes; replaces selection with result. */
  booleanOp: (op: import('@strata/scene').BooleanOpKind) => void;

  /** Enter/exit prototype mode */
  setPrototypeMode: (active: boolean) => void;
  /** Set prototype data from current document */
  updatePrototypeData: () => void;
  /** Handle a prototype interaction event */
  handlePrototypeEvent: (event: unknown) => void;
  /** Get prototype variable value */
  getPrototypeVariable: (id: string) => string | number | boolean | undefined;
  /** Set prototype variable value */
  setPrototypeVariable: (id: string, value: string | number | boolean) => void;
  /** Start presentation mode (fullscreen) */
  startPresentation: () => void;
  /** Stop presentation mode */
  stopPresentation: () => void;
  /** Get all frame nodes (screens) for prototype */
  getPrototypeScreens: () => Array<{ id: string; name: string }>;
  /** Current screen in prototype */
  prototypeCurrentScreen: string;
  /** Navigate to a prototype screen */
  navigatePrototypeTo: (screenId: string) => void;

  // ── Motion / Animation ─────────────────────────────────────────────────────

  /** Start playback of the active timeline. */
  playTimeline: (timelineId?: string) => void;
  /** Pause active timeline playback. */
  pauseTimeline: () => void;
  /** Stop active timeline playback and reset to start. */
  stopTimeline: () => void;
  /** Seek to a specific time in the active timeline. */
  seekTimeline: (time: number) => void;
  /** Set the active timeline by id (or null to deactivate). */
  setActiveTimeline: (id: string | null) => void;
  /** Set playback speed multiplier. */
  setPlaybackSpeed: (speed: number) => void;
  /** Toggle loop playback. */
  toggleLoop: () => void;
  /** Add a keyframe at current time for selected nodes on the given property. */
  addKeyframeToSelected: (property: string) => void;

  // ── Guide management ────────────────────────────────────────────────────────

  /** Add a layout guide at the given axis and world position. */
  addGuide: (axis: 'horizontal' | 'vertical', position: number) => void;
  /** Remove a guide by id. */
  removeGuide: (id: string) => void;
  /** Move a guide to a new world position. */
  moveGuide: (id: string, position: number) => void;
  /** Toggle a guide's locked state. */
  toggleGuideLock: (id: string) => void;
  /** Remove all guides from the document. */
  clearAllGuides: () => void;
  /** All guides in the document. */
  guides: Guide[];

  /** Set the active variant on a component instance. */
  setVariantForInstance: (instanceId: NodeId, variantId: string) => void;
  /** Create a new variant for a component. */
  createVariant: (
    componentId: NodeId,
    name: string,
    propertyValues: Record<string, string | boolean | NodeId>,
  ) => void;
  /** Add a component property to a component definition. */
  addComponentProperty: (
    componentId: NodeId,
    prop: {
      name: string;
      type: 'text' | 'boolean' | 'instanceSwap';
      defaultValue: string | boolean | NodeId;
    },
  ) => void;
  /** Resolve properties for a node considering its active variant. */
  resolveVariantPropertiesForNode: (nodeId: NodeId) => Record<string, string | boolean | NodeId>;

  /** Set page-level bleed config for a specific page. */
  setPageBleed: (pageId: string, bleed: BleedConfig) => void;
  /** Set page-level safe area config for a specific page. */
  setPageSafeArea: (pageId: string, safeArea: SafeAreaConfig) => void;
  /** Set page-level slug config for a specific page. */
  setPageSlug: (pageId: string, slug: SlugConfig) => void;
}

export const EditorCtx = createContext<EditorContextValue | null>(null);

/** F2: full snapshot of an inactive session stored in a ref (not state). */
interface SavedSession {
  document: Document;
  selection: NodeId[];
  viewport: { zoom: number; pan: { x: number; y: number } };
  undo: Document[];
  redo: Document[];
  undoSel: NodeId[][];
  redoSel: NodeId[][];
  variableStore: VariableStore;
}

// F4: human-readable type name per tool
function typeNameForTool(tool: ToolId): string {
  switch (tool) {
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'polygon':
      return 'Polygon';
    case 'star':
      return 'Star';
    case 'line':
      return 'Line';
    case 'frame':
      return 'Frame';
    case 'text':
      return 'Text';
    case 'pen':
      return 'Path';
    case 'pencil':
      return 'Path';
    case 'arrow':
      return 'Arrow';
    default:
      return 'Shape';
  }
}

// F4: find the next unique auto-name for a type ("Rectangle 3" when 1 and 2 exist)
function nextAutoName(doc: Document, typeName: string): string {
  const used = new Set<number>();
  for (const n of Object.values(doc.nodes)) {
    const match = n.name.match(new RegExp(`^${typeName} (\\d+)$`));
    if (match?.[1]) used.add(parseInt(match[1], 10));
  }
  let i = 1;
  while (used.has(i)) i++;
  return `${typeName} ${i}`;
}

// F4: default shape geometry per tool
// Research basis: Figma/Illustrator default sizes for shape tools
function shapeForTool(tool: ToolId): Shape {
  switch (tool) {
    case 'rect':
      return { kind: 'rect', x: 0, y: 0, w: 100, h: 80 };
    case 'ellipse':
      return { kind: 'ellipse', cx: 50, cy: 40, rx: 50, ry: 40 };
    case 'polygon':
      return { kind: 'polygon', cx: 50, cy: 40, radius: 50, sides: 6, rotation: 0 };
    case 'star':
      return {
        kind: 'star',
        cx: 50,
        cy: 40,
        innerRadius: 20,
        outerRadius: 50,
        points: 5,
        rotation: 0,
      };
    case 'line':
      return { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 3 };
    case 'arrow':
      return { kind: 'arrow', from: [0, 0], to: [100, 0], tolerance: 3, arrowheadSize: 10 };
    case 'pen':
      return {
        kind: 'path',
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: false,
        tolerance: 3,
      };
    case 'pencil':
      return {
        kind: 'path',
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: false,
        tolerance: 3,
      };
    case 'text':
      return { kind: 'rect', x: 0, y: 0, w: 120, h: 32 };
    case 'frame':
    case 'slice':
      // These are containers, not shapes — should never reach here
      return { kind: 'rect', x: 0, y: 0, w: 200, h: 160 };
    case 'select':
    case 'hand':
    case 'zoom':
    case 'scale':
    case 'nodeEdit':
    case 'image':
    case 'eyedropper':
    case 'inspect':
    case 'booleanUnion':
    case 'booleanSubtract':
    case 'booleanIntersect':
    case 'booleanExclude':
      // These tools don't create shapes — should never reach here
      throw new Error(`shapeForTool called for non-drawing tool: ${tool}`);
    default: {
      // Exhaustiveness check — if we get here, there's a missing tool case
      const _exhaustiveCheck: never = tool;
      throw new Error(`Unknown tool in shapeForTool: ${_exhaustiveCheck}`);
    }
  }
}

const INITIAL_SESSION_ID = 'session-0';

// ─── standalone helpers ─────────────────────────────────────────────────

/** Apply computeFlexLayout to a frame's children and return the updated doc. */
function applyFrameLayout(doc: Document, parentId: string | null | undefined): Document {
  if (!parentId) return doc;
  const parent = doc.nodes[parentId];
  if (parent?.kind !== 'frame' || !parent.layoutStyle) return doc;
  const childNodes = parent.children
    .map((cid) => doc.nodes[cid])
    .filter((n): n is SceneNode => Boolean(n));
  const results = computeFlexLayout(parent, childNodes);
  if (results.length === 0) return doc;
  const nodes = { ...doc.nodes };
  for (const r of results) {
    const child = nodes[r.id];
    if (child) nodes[r.id] = { ...child, transform: [1, 0, 0, 1, r.x, r.y] as Affine };
  }
  return { ...doc, nodes };
}

/** Compute world-space bounding box for any node type. */
export function nodeWorldBoundsFn(
  n: SceneNode,
): { x: number; y: number; w: number; h: number } | null {
  const tx = n.transform[4] ?? 0;
  const ty = n.transform[5] ?? 0;
  if (n.kind === 'shape') {
    const s = n.shape;
    if (s.kind === 'rect') return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
    if (s.kind === 'ellipse')
      return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    if (s.kind === 'circle')
      return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
    if (s.kind === 'line') {
      const minX = Math.min(s.from[0], s.to[0]);
      const minY = Math.min(s.from[1], s.to[1]);
      return {
        x: tx + minX,
        y: ty + minY,
        w: Math.abs(s.to[0] - s.from[0]) || 4,
        h: Math.abs(s.to[1] - s.from[1]) || 4,
      };
    }
    if (s.kind === 'polygon')
      return { x: tx + s.cx - s.radius, y: ty + s.cy - s.radius, w: s.radius * 2, h: s.radius * 2 };
    if (s.kind === 'star')
      return {
        x: tx + s.cx - s.outerRadius,
        y: ty + s.cy - s.outerRadius,
        w: s.outerRadius * 2,
        h: s.outerRadius * 2,
      };
  }
  if (n.kind === 'text')
    return { x: tx, y: ty, w: (n.fontSize ?? 16) * 3, h: (n.fontSize ?? 16) * 1.4 };
  if (n.kind === 'frame') return { x: tx, y: ty, w: n.w, h: n.h };
  return null;
}

/** Deepest containing frame/group at the given world point. Skips locked/hidden. */
export function findContainingFrameInDoc(
  doc: Document,
  world: { x: number; y: number },
): NodeId | null {
  let deepest: NodeId | null = null;
  let deepestDepth = -1;

  const entries = walkNodes(doc);
  for (const [nid, entry] of entries) {
    const n = entry.node;
    if (n.locked || n.visible === false) continue;
    if (n.kind !== 'frame' && n.kind !== 'group') continue;
    const tx = n.transform[4] ?? 0;
    const ty = n.transform[5] ?? 0;
    let bbox: { x: number; y: number; w: number; h: number };
    if (n.kind === 'frame') {
      bbox = { x: tx, y: ty, w: n.w, h: n.h };
    } else {
      // Compute group bounds from children's world-space bounds.
      const groupBounds = groupWorldBounds(doc, nid);
      if (!groupBounds || groupBounds.w <= 0 || groupBounds.h <= 0) continue;
      bbox = groupBounds;
    }
    const wPt: [number, number] = [world.x, world.y];
    if (rectContains(bbox, wPt)) {
      if (entry.depth > deepestDepth) {
        deepest = nid;
        deepestDepth = entry.depth;
      }
    }
  }
  return deepest;
}

/** Save-As implementation shared between save() and saveAs(). */
async function saveAsImpl(
  platform: Platform | undefined,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  patch: (partial: Partial<EditorState>) => void,
): Promise<boolean> {
  if (!platform) {
    patch({ saveState: 'error' });
    return false;
  }
  patch({ saveState: 'saving' });
  try {
    const s = stateRef.current;
    const meta = s.sessions.find((sess) => sess.id === s.activeId);
    const json = JSON.stringify({ ...s.document, formatVersion: '1.0' });
    const filePath = await platform.saveDocumentToDisk(meta?.name ?? 'Untitled', json);
    if (filePath) {
      await recoveryRef.current?.deleteSession(s.activeId);
      const fileId = `file-${Date.now()}`;
      patch({
        dirty: false,
        saveState: 'saved',
        lastSavedAt: Date.now(),
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: false, filePath, fileId } : sess,
        ),
      });
      return true;
    }
    patch({ saveState: 'idle' });
    return false;
  } catch {
    patch({ saveState: 'error' });
    return false;
  }
}

export function EditorProvider({
  children,
  onBackToHome,
  initialDocumentJson,
  initialDocumentName,
  platform,
}: {
  children: ReactNode;
  onBackToHome?: () => void;
  initialDocumentJson?: string;
  initialDocumentName?: string;
  platform?: Platform;
}) {
  const [state, setState] = useState<EditorState>(() => {
    let doc = createDocument(initialDocumentName ?? 'Untitled');
    let name = initialDocumentName ?? 'Untitled';
    if (initialDocumentJson) {
      try {
        const migrated = migrateDocumentJson(initialDocumentJson);
        doc =
          (migrated as unknown as Document) ?? createDocument(initialDocumentName ?? 'Untitled');
        name = initialDocumentName ?? doc.name ?? 'Untitled';
      } catch {
        /* invalid JSON — use blank document */
      }
    }
    return {
      tool: 'select',
      zoom: 1,
      pan: { x: 0, y: 0 },
      selection: [],
      document: doc,
      sessions: [{ id: INITIAL_SESSION_ID, name, dirty: false }],
      activeId: INITIAL_SESSION_ID,
      dirty: false,
      variableStore: createVariableStore(),
      cursorPos: null,
      unitType: 'px',
      pixelGridEnabled: false,
      snapEnabled: true,
      snapGrid: 8,
      saveState: 'idle' as const,
      lastSavedAt: null,
      prototypeMode: false,
      prototypeRuntime: null,
      prototypeDebug: new PrototypeDebugConsole(),
      prototypeData: { interactions: {} },
      isPresenting: false,
      softProofEnabled: false,
      leftPanelVisible: loadSettings().panel.leftPanelVisible,
      rightPanelVisible: loadSettings().panel.rightPanelVisible,
      motion: createInitialMotionState(),
    };
  });
  const [showExportDialog, setShowExportDialog] = useState(false);
  /** Ref keeping the latest state for async callbacks (auto-save, recovery). */
  const stateRef = useRef(state);
  stateRef.current = state;
  const undoStackRef = useRef<Document[]>([]);
  const redoStackRef = useRef<Document[]>([]);
  const undoSelStackRef = useRef<NodeId[][]>([]);
  const redoSelStackRef = useRef<NodeId[][]>([]);
  /** F2: snapshots of all inactive sessions, keyed by session ID. */
  const sessionStoreRef = useRef<Map<string, SavedSession>>(new Map());
  /** Shared aria-live announcer for screen-reader messages. */
  const announcerRef = useRef<CanvasAnnouncer>(null);
  if (!announcerRef.current) {
    announcerRef.current = new CanvasAnnouncer();
  }
  /** F6: transaction state for single-undo scrubbing. */
  const inTransactionRef = useRef(false);
  const txSnapshotRef = useRef<Document | null>(null);
  const txSelRef = useRef<NodeId[] | null>(null);
  const [bindingField, setBindingField] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  /** Auto-save service ref for lifecycle-triggered saves. */
  const autoSaveRef = useRef<AutoSaveService | null>(null);
  /** Recovery manager for crash-recovery sessions. */
  const recoveryRef = useRef<RecoveryManager | null>(null);
  /** Initialize auto-save and recovery once. */
  if (!recoveryRef.current) {
    recoveryRef.current = getSharedRecoveryManager();
  }
  if (!autoSaveRef.current && platform) {
    const uiSettings = loadUiSettings();
    autoSaveRef.current = new AutoSaveService(
      () => {
        const s = stateRef.current;
        const meta = s.sessions.find((sess) => sess.id === s.activeId);
        return {
          document: s.document,
          meta: { fileId: meta?.fileId, name: meta?.name ?? 'Untitled' },
        };
      },
      async (json) => {
        if (!platform) return false;
        const s = stateRef.current;
        const meta = s.sessions.find((sess) => sess.id === s.activeId);
        try {
          if (meta?.fileId) {
            const fe = makeFileEntry({ id: meta.fileId, name: meta.name });
            await platform.upsertFile(fe, json);
          } else {
            // Untitled document: persist as recovery point so work is never lost
            const doc = JSON.parse(json) as Document;
            await recoveryRef.current?.createRecoveryPoint(doc, meta?.name ?? 'Untitled');
          }
          return true;
        } catch {
          return false;
        }
      },
      { intervalMs: (uiSettings.general?.autosaveInterval ?? 5) * 60 * 1000 },
    );
    autoSaveRef.current.setOnSaveRecovery(async (doc, meta) => {
      await recoveryRef.current?.createRecoveryPoint(doc, meta.name, meta.fileId);
    });
    autoSaveRef.current.start();
  }
  /** Ref mirror of the active tool, updated synchronously in setTool so that
   *  createShapeAt sees the latest tool even when React 18 automatic batching
   *  queues a setTool + createShapeAt together. Without this, createShapeAt
   *  reads the stale tool from the state closure and throws "non-drawing tool"
   *  for tools that were just set. */
  const toolRef = useRef<ToolId>(state.tool);
  const prototypeRuntimeRef = useRef<PrototypeRuntime | null>(null);
  const [prototypeCurrentScreen, setPrototypeCurrentScreen] = useState('');
  const motionEngRef = useRef<MotionTimelineEngine | null>(null);

  /** Notify auto-save on every document mutation. */
  useEffect(() => {
    if (state.dirty && autoSaveRef.current) {
      autoSaveRef.current.notifyEdit();
    }
  }, [state.document, state.dirty]);

  /** Cleanup auto-save on unmount. */
  useEffect(() => {
    return () => {
      autoSaveRef.current?.stop();
    };
  }, []);

  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [],
  );

  const updateDoc = useCallback((fn: (doc: Document) => Document) => {
    setState((s) => {
      if (!inTransactionRef.current) {
        undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
        undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
        redoStackRef.current = [];
        redoSelStackRef.current = [];
      }
      return {
        ...s,
        document: fn(s.document),
        dirty: true,
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: true } : sess,
        ),
      };
    });
  }, []);

  const rootNodes = useCallback(() => {
    const { rootChildren, nodes } = state.document;
    return rootChildren.map((id) => nodes[id]).filter((n): n is SceneNode => Boolean(n));
  }, [state.document]);

  const updateNodeProp = useCallback(
    (id: NodeId, updater: (n: SceneNode) => SceneNode) => {
      updateDoc((doc) => {
        const node = doc.nodes[id];
        if (!node) return doc;
        return {
          ...doc,
          nodes: { ...doc.nodes, [id]: updater(node) },
        };
      });
    },
    [updateDoc],
  );

  // F6: transaction API — begin/commit/abort for single-undo scrubbing
  // P5: Wired to @strata/collab transaction hooks for Yjs integration
  const beginTransaction = useCallback(() => {
    inTransactionRef.current = true;
    txSnapshotRef.current = state.document;
    txSelRef.current = state.selection;
    getTransactionHooks().onBeginTransaction();
  }, [state.document, state.selection]);

  const commitTransaction = useCallback(() => {
    if (inTransactionRef.current) {
      inTransactionRef.current = false;
      // Push the snapshot as undo entry (current state is already live)
      if (txSnapshotRef.current !== null) {
        undoStackRef.current = [...undoStackRef.current.slice(-49), txSnapshotRef.current];
        undoSelStackRef.current = [...undoSelStackRef.current.slice(-49), txSelRef.current ?? []];
        redoStackRef.current = [];
        redoSelStackRef.current = [];
      }
      txSnapshotRef.current = null;
      txSelRef.current = null;
      getTransactionHooks().onCommitTransaction();
    }
  }, []);

  const abortTransaction = useCallback(() => {
    if (inTransactionRef.current) {
      inTransactionRef.current = false;
      if (txSnapshotRef.current !== null) {
        patch({ document: txSnapshotRef.current, selection: txSelRef.current ?? [] });
      }
      txSnapshotRef.current = null;
      txSelRef.current = null;
      getTransactionHooks().onAbortTransaction();
    }
  }, [patch]);

  const value = useMemo<EditorContextValue>(
    () => ({
      state,
      setTool: (t) => {
        toolRef.current = t;
        patch({ tool: t });
      },
      setZoom: (z) => patch({ zoom: clampZoom(z) }),
      setPan: (p) => patch({ pan: p }),
      zoomIn: () => {
        const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vpH = typeof window !== 'undefined' ? window.innerHeight - 120 : 700;
        const cam = { pan: [state.pan.x, state.pan.y] as [number, number], zoom: state.zoom };
        const centre = screenToWorld(cam, vpW / 2, vpH / 2);
        const newZoom = clampZoom(state.zoom * 1.25);
        const newCam = zoomAboutPoint(cam, centre, newZoom);
        patch({ zoom: newCam.zoom, pan: { x: newCam.pan[0], y: newCam.pan[1] } });
      },
      zoomOut: () => {
        const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vpH = typeof window !== 'undefined' ? window.innerHeight - 120 : 700;
        const cam = { pan: [state.pan.x, state.pan.y] as [number, number], zoom: state.zoom };
        const centre = screenToWorld(cam, vpW / 2, vpH / 2);
        const newZoom = clampZoom(state.zoom * 0.8);
        const newCam = zoomAboutPoint(cam, centre, newZoom);
        patch({ zoom: newCam.zoom, pan: { x: newCam.pan[0], y: newCam.pan[1] } });
      },
      zoomTo: (level) => {
        const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vpH = typeof window !== 'undefined' ? window.innerHeight - 120 : 700;
        const cam = { pan: [state.pan.x, state.pan.y] as [number, number], zoom: state.zoom };
        const centre = screenToWorld(cam, vpW / 2, vpH / 2);
        const newCam = zoomAboutPoint(cam, centre, clampZoom(level));
        patch({ zoom: newCam.zoom, pan: { x: newCam.pan[0], y: newCam.pan[1] } });
      },
      toggleLeftPanel: () => {
        const next = !state.leftPanelVisible;
        patch({ leftPanelVisible: next });
        updateSettings({ panel: { leftPanelVisible: next } });
      },
      toggleRightPanel: () => {
        const next = !state.rightPanelVisible;
        patch({ rightPanelVisible: next });
        updateSettings({ panel: { rightPanelVisible: next } });
      },
      fitAll: () => {
        const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vpH = typeof window !== 'undefined' ? window.innerHeight - 120 : 700;
        const entries = walkNodes(state.document);
        let union: { x: number; y: number; w: number; h: number } | null = null;
        for (const [id] of entries) {
          const b = nodeWorldBounds(state.document, id);
          if (!b) continue;
          if (!union) {
            union = { ...b };
            continue;
          }
          const minX = Math.min(union.x, b.x);
          const minY = Math.min(union.y, b.y);
          const maxX = Math.max(union.x + union.w, b.x + b.w);
          const maxY = Math.max(union.y + union.h, b.y + b.h);
          union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
        if (union) {
          const cam = fitBoundsCamera(union, { width: vpW, height: vpH }, 40);
          patch({ zoom: cam.zoom, pan: { x: cam.pan[0], y: cam.pan[1] } });
        }
      },
      revealSelection: (opts) => {
        const id = opts?.nodeId ?? state.selection[0];
        if (!id) return;
        const viewportEst: Viewport = opts?.viewport ?? {
          width: window.innerWidth,
          height: window.innerHeight - 120,
        };
        const bounds = nodeWorldBounds(state.document, id);
        if (!bounds) return;
        const padding = opts?.padding ?? 40;
        if (opts?.fit) {
          const cam = fitBoundsCamera(bounds, viewportEst, padding);
          patch({ zoom: cam.zoom, pan: { x: cam.pan[0], y: cam.pan[1] } });
        } else {
          const current: import('@strata/shared').Camera = {
            pan: [state.pan.x, state.pan.y],
            zoom: state.zoom,
          };
          const cam = revealBoundsCamera(current, viewportEst, bounds, padding);
          if (cam.pan[0] !== state.pan.x || cam.pan[1] !== state.pan.y) {
            patch({ pan: { x: cam.pan[0], y: cam.pan[1] }, zoom: cam.zoom });
          }
        }
      },

      // F1: single-select replaces the whole set
      setSelection: (id) => patch({ selection: id ? [id] : [] }),

      // F1: additive = shift+click behaviour
      toggleSelection: (id, additive = false) => {
        setState((s) => {
          if (additive) {
            const already = s.selection.includes(id);
            return {
              ...s,
              selection: already ? s.selection.filter((x) => x !== id) : [...s.selection, id],
            };
          }
          return { ...s, selection: [id] };
        });
      },

      // F1: helpers that work for nested nodes
      isSelected: (id) => state.selection.includes(id),
      selectedNodes: () =>
        state.selection
          .map((id) => state.document.nodes[id])
          .filter((n): n is SceneNode => Boolean(n)),

      // B3: Select-similar actions
      selectAllWithSameType: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        const firstNode = state.document.nodes[sel[0]!];
        if (!firstNode) return;
        const targetKind = firstNode.kind;
        const matchingIds: NodeId[] = [];
        for (const n of Object.values(state.document.nodes)) {
          if (n && n.kind === targetKind && n.visible && !n.locked && n.id !== firstNode.id) {
            matchingIds.push(n.id);
          }
        }
        if (matchingIds.length > 0) {
          patch({ selection: [firstNode.id, ...matchingIds] });
          announcerRef.current?.announce(`Selected ${matchingIds.length + 1} ${targetKind} nodes`);
        }
      },
      selectAllWithSameFill: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        const firstNode = state.document.nodes[sel[0]!];
        if (firstNode?.kind !== 'shape') return;
        const targetFill = firstNode.fill;
        const matchingIds: NodeId[] = [];
        for (const n of Object.values(state.document.nodes)) {
          if (
            n &&
            n.kind === 'shape' &&
            n.visible &&
            !n.locked &&
            n.id !== firstNode.id &&
            colorsEqual(n.fill, targetFill)
          ) {
            matchingIds.push(n.id);
          }
        }
        if (matchingIds.length > 0) {
          patch({ selection: [firstNode.id, ...matchingIds] });
          announcerRef.current?.announce(
            `Selected ${matchingIds.length + 1} nodes with matching fill`,
          );
        }
      },

      // F4 + frame tool fix: create typed nodes with auto-names, select atomically
      createShapeAt: (world, size, parentId, pathPoints) => {
        setState((s) => {
          // Read the tool from the ref (synchronously current) instead of the
          // state closure, which may be stale due to React 18 automatic batching.
          const activeTool = toolRef.current;
          // Prevent shape creation for non-drawing tools
          const nonDrawingTools: ToolId[] = [
            'select',
            'hand',
            'zoom',
            'scale',
            'nodeEdit',
            'image',
            'eyedropper',
            'inspect',
            'booleanUnion',
            'booleanSubtract',
            'booleanIntersect',
            'booleanExclude',
            'cloneStamp',
            'healBrush',
            'spotHeal',
            'patch',
          ];
          if (nonDrawingTools.includes(activeTool)) {
            throw new Error(`createShapeAt called for non-drawing tool: ${activeTool}`);
          }

          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];

          const { id, doc: d2 } = nextNodeId(s.document);
          const typeName = typeNameForTool(activeTool);
          const autoName = nextAutoName(d2, typeName);
          const transform: Affine = [1, 0, 0, 1, world.x, world.y];

          let node: SceneNode;
          if (activeTool === 'frame' || activeTool === 'slice') {
            node = makeFrameNode(id, {
              name: autoName,
              transform,
              fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
              children: [],
              w: size?.w ?? 375,
              h: size?.h ?? 812,
            });
          } else if (pathPoints && pathPoints.length > 0) {
            // Path tools (pen/pencil) pass point data directly
            const shape: Shape = {
              kind: 'path',
              points: pathPoints,
              closed: false,
              tolerance: 3,
            };
            node = makeShapeNode(id, shape, { name: autoName, transform });
          } else {
            const shape: Shape = size
              ? buildShapeWithSize(activeTool, size)
              : shapeForTool(activeTool);
            node = makeShapeNode(id, shape, { name: autoName, transform });
          }

          const effectiveParentId = parentId ?? findContainingFrameInDoc(d2, world);
          let newDoc: Document;
          if (effectiveParentId) {
            // Convert world→local: the node's transform must be in the
            // parent's coordinate space so that composing parent · child
            // yields the original world position. Without this, a shape
            // placed inside a translated frame jumps by the frame's offset.
            const pWorld = nodeWorldTransform(d2, effectiveParentId);
            const pInv = invertAffine(pWorld);
            const localPos = applyAffine(pInv, [world.x, world.y]);
            const localTransform: Affine = [1, 0, 0, 1, localPos[0], localPos[1]];
            node = { ...node, transform: localTransform } as SceneNode;
            newDoc = addChild(d2, effectiveParentId, node);
            newDoc = applyFrameLayout(newDoc, effectiveParentId);
          } else {
            newDoc = addNode(d2, node);
          }

          return { ...s, document: newDoc, selection: [id], tool: 'select' as ToolId };
        });
      },

      createTextNodeAt: (world, _size, parentId, text = '') => {
        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];

          const { id, doc: d2 } = nextNodeId(s.document);
          const autoName = nextAutoName(d2, 'Text');
          const transform: Affine = [1, 0, 0, 1, world.x, world.y];

          const node = makeTextNode(id, text, {
            name: autoName,
            transform,
            fontSize: 16,
          });

          const effectiveParentId = parentId ?? findContainingFrameInDoc(d2, world);
          let newDoc: Document;
          if (effectiveParentId) {
            newDoc = addChild(d2, effectiveParentId, node);
            newDoc = applyFrameLayout(newDoc, effectiveParentId);
          } else {
            newDoc = addNode(d2, node);
          }

          return { ...s, document: newDoc, selection: [id], tool: 'select' as ToolId };
        });
      },

      applyFramePreset: (preset) => {
        // Resize path: a single selected frame is resized in place.
        const sel = state.selection;
        if (sel.length === 1) {
          const only = state.document.nodes[sel[0] as NodeId];
          if (only && only.kind === 'frame') {
            updateNodeProp(sel[0] as NodeId, (n) =>
              n.kind === 'frame' ? { ...n, w: preset.w, h: preset.h } : n,
            );
            return;
          }
        }

        // Create path: place a new frame centered in the current viewport.
        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];

          const { id, doc: d2 } = nextNodeId(s.document);
          const autoName = nextAutoName(d2, preset.name);

          // World-space center of the visible canvas (window estimate; the
          // fit-reveal below corrects the framing precisely afterward).
          const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
          const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
          const cam = { pan: [s.pan.x, s.pan.y] as [number, number], zoom: s.zoom };
          const center = screenToWorld(cam, vpW / 2, vpH / 2);
          const transform: Affine = [
            1,
            0,
            0,
            1,
            center[0] - preset.w / 2,
            center[1] - preset.h / 2,
          ];

          const node = makeFrameNode(id, {
            name: autoName,
            transform,
            fill: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 },
            children: [],
            w: preset.w,
            h: preset.h,
          });

          return { ...s, document: addNode(d2, node), selection: [id] };
        });
      },

      findContainingFrame: (world) => {
        return findContainingFrameInDoc(state.document, world);
      },

      nodeWorldBounds: (n) => nodeWorldBounds(state.document, n.id) ?? nodeWorldBoundsFn(n),

      canvasToWorld: (cx, cy) => {
        return { x: (cx - state.pan.x) / state.zoom, y: (cy - state.pan.y) / state.zoom };
      },

      worldToCanvas: (wx, wy) => {
        return { x: wx * state.zoom + state.pan.x, y: wy * state.zoom + state.pan.y };
      },

      canvasDeltaToWorld: (dx, dy) => {
        return { dx: dx / state.zoom, dy: dy / state.zoom };
      },

      hitTestNode: (world) => {
        // Walk all nodes in paint order (DFS) and reverse so that
        // children are tested before parents and later siblings before
        // earlier ones — the correct topmost-first hit order.
        const entries = walkNodes(state.document);
        const ordered = [...entries.values()].reverse();
        for (const entry of ordered) {
          const n = entry.node;
          if (n.locked || !n.visible) continue;
          if (n.kind === 'shape') {
            const worldMat = nodeWorldTransform(state.document, entry.nodeId);
            const wInv = invertAffine(worldMat);
            const local = applyAffine(wInv, [world.x, world.y]);
            if (shapeContains(n.shape, local)) {
              return { nodeId: entry.nodeId, node: n };
            }
          }
          if (n.kind === 'text' || n.kind === 'frame' || n.kind === 'group') {
            const bbox = nodeWorldBounds(state.document, entry.nodeId);
            if (bbox && rectContains(bbox, [world.x, world.y])) {
              return { nodeId: entry.nodeId, node: n };
            }
          }
        }
        return null;
      },

      getNode: (id) => state.document.nodes[id],

      walkNodes: () => {
        const map = walkNodes(state.document);
        const result = new Map<
          string,
          { nodeId: string; node: SceneNode; parentId: string | null; depth: number }
        >();
        for (const [key, val] of map) {
          result.set(key, val);
        }
        return result;
      },

      setDraft: (_draft) => {
        // setDraft is injected by CanvasArea; this stub ensures the context
        // value structure is always valid. CanvasArea overrides it.
      },

      removeSelected: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        if (
          sel.length > 5 &&
          !window.confirm(`Are you sure you want to delete ${sel.length} objects?`)
        )
          return;
        const parentIds = new Set(
          sel
            .map((id) => getParent(state.document, id))
            .filter((pid): pid is string => Boolean(pid)),
        );
        updateDoc((doc) => {
          let d = doc;
          for (const id of sel) d = removeNode(d, id);
          for (const pid of parentIds) d = applyFrameLayout(d, pid);
          return d;
        });
        patch({ selection: [] });
      },

      renameSelected: (name) => {
        const sel = state.selection[0];
        if (!sel) return;
        updateDoc((doc) => renameNode(doc, sel, name));
      },

      moveNode: (id, toIndex) => {
        updateDoc((doc) => moveNode(doc, id, toIndex));
      },

      duplicateSelected: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        setState((s) => {
          // Push undo snapshot (same pattern as updateDoc)
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
          redoStackRef.current = [];
          redoSelStackRef.current = [];

          let d = s.document;
          const newIds: string[] = [];
          for (const id of sel) {
            const node = d.nodes[id];
            if (!node) continue;
            const { id: newId, doc: d2 } = nextNodeId(d);
            d = d2;
            // Clone the node with a new ID and offset position
            const cloned = {
              ...node,
              id: newId,
              name: `${node.name} copy`,
              transform: [
                node.transform[0],
                node.transform[1],
                node.transform[2],
                node.transform[3],
                node.transform[4] + 20,
                node.transform[5] + 20,
              ] as typeof node.transform,
            };
            d = { ...d, nodes: { ...d.nodes, [newId]: cloned } };
            // Add to root children if it's a root node
            const parentId = getParent(s.document, id);
            if (parentId === null) {
              d = { ...d, rootChildren: [...d.rootChildren, newId] };
            } else {
              // Add to parent's children
              const parent = d.nodes[parentId];
              if (parent && 'children' in parent) {
                d = {
                  ...d,
                  nodes: {
                    ...d.nodes,
                    [parentId]: { ...parent, children: [...(parent.children || []), newId] },
                  },
                };
              }
            }
            newIds.push(newId);
          }
          return {
            ...s,
            document: d,
            selection: newIds,
            dirty: true,
            sessions: s.sessions.map((sess) =>
              sess.id === s.activeId ? { ...sess, dirty: true } : sess,
            ),
          };
        });
      },

      setSelectedFill: (color) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          let d = doc;
          for (const id of sel) {
            const node = d.nodes[id];
            if (!node) continue;
            d = { ...d, nodes: { ...d.nodes, [id]: { ...node, fill: color } } };
          }
          return d;
        });
      },

      setSelectedFills: (fills) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, fills } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      updateSelectedFillAt: (index, fill) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            const current = resolveNodeFills(node);
            const next = [...current];
            if (index >= 0 && index < next.length) next[index] = fill;
            else next.push(fill);
            nodes[id] = { ...node, fills: next } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      addSelectedFill: (fill) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            const current = resolveNodeFills(node);
            nodes[id] = { ...node, fills: [...current, fill] } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      removeSelectedFillAt: (index) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            const current = resolveNodeFills(node);
            if (current.length <= 1) continue; // keep at least one fill
            const next = current.filter((_, i) => i !== index);
            nodes[id] = { ...node, fills: next } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      reorderSelectedFill: (from, to) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            const current = [...resolveNodeFills(node)];
            if (from < 0 || from >= current.length || to < 0 || to >= current.length) continue;
            const [item] = current.splice(from, 1);
            if (item) {
              current.splice(to, 0, item);
              nodes[id] = { ...node, fills: current } as SceneNode;
            }
          }
          return { ...doc, nodes };
        });
      },

      setNodePosition: (id, x, y) => {
        updateNodeProp(id, (n) => ({
          ...n,
          transform: [
            n.transform[0],
            n.transform[1],
            n.transform[2],
            n.transform[3],
            x,
            y,
          ] as Affine,
        }));
      },

      setNodeSize: (id, w, h) => {
        updateNodeProp(id, (n) => {
          if (n.kind === 'frame') return { ...n, w, h };
          if (n.kind !== 'shape') return n;
          const s = n.shape;
          switch (s.kind) {
            case 'rect':
              return { ...n, shape: { ...s, w, h } };
            case 'ellipse':
              return { ...n, shape: { ...s, rx: w / 2, ry: h / 2, cx: w / 2, cy: h / 2 } };
            case 'circle':
              return { ...n, shape: { ...s, r: w / 2, cx: w / 2, cy: w / 2 } };
            case 'line': {
              const oldW = Math.abs(s.to[0] - s.from[0]) || 1;
              const oldH = Math.abs(s.to[1] - s.from[1]) || 1;
              const sx = w / oldW;
              const sy = h / oldH;
              const cx = (s.from[0] + s.to[0]) / 2;
              const cy = (s.from[1] + s.to[1]) / 2;
              return {
                ...n,
                shape: {
                  ...s,
                  from: [cx + (s.from[0] - cx) * sx, cy + (s.from[1] - cy) * sy] as [
                    number,
                    number,
                  ],
                  to: [cx + (s.to[0] - cx) * sx, cy + (s.to[1] - cy) * sy] as [number, number],
                },
              };
            }
            case 'arrow': {
              const oldW2 = Math.abs(s.to[0] - s.from[0]) || 1;
              const oldH2 = Math.abs(s.to[1] - s.from[1]) || 1;
              const sx2 = w / oldW2;
              const sy2 = h / oldH2;
              const cx2 = (s.from[0] + s.to[0]) / 2;
              const cy2 = (s.from[1] + s.to[1]) / 2;
              return {
                ...n,
                shape: {
                  ...s,
                  from: [cx2 + (s.from[0] - cx2) * sx2, cy2 + (s.from[1] - cy2) * sy2] as [
                    number,
                    number,
                  ],
                  to: [cx2 + (s.to[0] - cx2) * sx2, cy2 + (s.to[1] - cy2) * sy2] as [
                    number,
                    number,
                  ],
                },
              };
            }
            case 'polygon':
              return { ...n, shape: { ...s, radius: Math.max(1, w / 2) } };
            case 'star': {
              const oldOR = s.outerRadius || 1;
              const newOR = Math.max(1, w / 2);
              const ratio = newOR / oldOR;
              return {
                ...n,
                shape: {
                  ...s,
                  outerRadius: newOR,
                  innerRadius: Math.max(1, s.innerRadius * ratio),
                },
              };
            }
            case 'path': {
              const points = s.points;
              if (points.length === 0) return n;
              let minX = Infinity,
                minY = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;
              for (const p of points) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
              }
              const pbw = maxX - minX || 1;
              const pbh = maxY - minY || 1;
              const sx3 = w / pbw;
              const sy3 = h / pbh;
              return {
                ...n,
                shape: {
                  ...s,
                  points: points.map((p) => ({
                    x: (p.x - minX) * sx3 + minX,
                    y: (p.y - minY) * sy3 + minY,
                    handleIn: p.handleIn
                      ? ([
                          (p.handleIn[0] - minX) * sx3 + minX,
                          (p.handleIn[1] - minY) * sy3 + minY,
                        ] as [number, number])
                      : null,
                    handleOut: p.handleOut
                      ? ([
                          (p.handleOut[0] - minX) * sx3 + minX,
                          (p.handleOut[1] - minY) * sy3 + minY,
                        ] as [number, number])
                      : null,
                  })),
                },
              };
            }
            default:
              return n;
          }
        });
      },

      // Batch edits: one undo step for the whole selection (Strata plan §8).
      // Each axis is independent so a "Mixed" axis is preserved.
      setSelectedX: (x) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = {
              ...node,
              transform: [
                node.transform[0],
                node.transform[1],
                node.transform[2],
                node.transform[3],
                x,
                node.transform[5],
              ] as Affine,
            } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      setSelectedY: (y) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = {
              ...node,
              transform: [
                node.transform[0],
                node.transform[1],
                node.transform[2],
                node.transform[3],
                node.transform[4],
                y,
              ] as Affine,
            } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      setSelectedW: (w) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (node?.kind !== 'shape') continue;
            const s = node.shape;
            const nextShape =
              s.kind === 'rect'
                ? { ...s, w }
                : s.kind === 'ellipse'
                  ? { ...s, rx: w }
                  : s.kind === 'circle'
                    ? { ...s, r: w }
                    : s;
            nodes[id] = { ...node, shape: nextShape };
          }
          return { ...doc, nodes };
        });
      },

      setSelectedH: (h) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (node?.kind !== 'shape') continue;
            const s = node.shape;
            const nextShape =
              s.kind === 'rect' ? { ...s, h } : s.kind === 'ellipse' ? { ...s, ry: h } : s;
            nodes[id] = { ...node, shape: nextShape };
          }
          return { ...doc, nodes };
        });
      },

      // F6: public updateNode for any property
      updateNode: updateNodeProp,

      // F6: batch-edit opacity on all selected nodes
      setSelectedOpacity: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, opacity: value };
          }
          return { ...doc, nodes };
        });
      },

      // F6: batch-edit blend mode
      setSelectedBlendMode: (mode) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, blendMode: mode };
          }
          return { ...doc, nodes };
        });
      },

      // F6: batch-edit rotation
      setSelectedRotation: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, rotation: value };
          }
          return { ...doc, nodes };
        });
      },

      // F6: batch-edit flip H — negate the full X-basis vector [a, b]
      setSelectedFlipH: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = {
              ...node,
              transform: [
                -node.transform[0],
                -node.transform[1],
                node.transform[2],
                node.transform[3],
                node.transform[4],
                node.transform[5],
              ] as Affine,
            } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      // F6: batch-edit flip V — negate the full Y-basis vector [c, d]
      setSelectedFlipV: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = {
              ...node,
              transform: [
                node.transform[0],
                node.transform[1],
                -node.transform[2],
                -node.transform[3],
                node.transform[4],
                node.transform[5],
              ] as Affine,
            } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      // F6: batch-edit corner radius on shape nodes
      setSelectedCornerRadius: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (node?.kind !== 'shape') continue;
            nodes[id] = { ...node, cornerRadius: value } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      // F6: align selected nodes — uses full world bounds to handle nested nodes correctly
      alignSelected: (axis) => {
        const sel = state.selection;
        if (sel.length < 2) return;
        const doc = state.document;
        const items = sel
          .map((id) => {
            const node = doc.nodes[id];
            if (!node) return null;
            const bounds = nodeWorldBounds(doc, id);
            if (!bounds) return null;
            return { id, node, bounds };
          })
          .filter(
            (
              x,
            ): x is {
              id: NodeId;
              node: SceneNode;
              bounds: { x: number; y: number; w: number; h: number };
            } => x !== null,
          );
        if (items.length < 2) return;

        const minX = Math.min(...items.map((i) => i.bounds.x));
        const maxX = Math.max(...items.map((i) => i.bounds.x + i.bounds.w));
        const minY = Math.min(...items.map((i) => i.bounds.y));
        const maxY = Math.max(...items.map((i) => i.bounds.y + i.bounds.h));
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        updateDoc((newDoc) => {
          const nodes = { ...newDoc.nodes };
          for (const { id, bounds: b } of items) {
            const node = nodes[id];
            if (!node) continue;
            // Compute target world position for the node's bounds.
            let targetWorldX = b.x;
            let targetWorldY = b.y;
            if (axis === 'left') targetWorldX = minX;
            else if (axis === 'centerH') targetWorldX = centerX - b.w / 2;
            else if (axis === 'right') targetWorldX = maxX - b.w;
            else if (axis === 'top') targetWorldY = minY;
            else if (axis === 'centerV') targetWorldY = centerY - b.h / 2;
            else if (axis === 'bottom') targetWorldY = maxY - b.h;

            // Convert bounds position back to node origin world position.
            const wm = nodeWorldTransform(doc, id);
            const bOffX = b.x - wm[4];
            const bOffY = b.y - wm[5];
            const nodeOriginWorldX = targetWorldX - bOffX;
            const nodeOriginWorldY = targetWorldY - bOffY;

            // Convert world origin to local (parent) space.
            const parentId = getParent(doc, id);
            let newLocalX = nodeOriginWorldX;
            let newLocalY = nodeOriginWorldY;
            if (parentId) {
              const pInv = invertAffine(nodeWorldTransform(doc, parentId));
              const local = applyAffine(pInv, [nodeOriginWorldX, nodeOriginWorldY]);
              newLocalX = local[0];
              newLocalY = local[1];
            }
            nodes[id] = {
              ...node,
              transform: [
                node.transform[0],
                node.transform[1],
                node.transform[2],
                node.transform[3],
                newLocalX,
                newLocalY,
              ] as Affine,
            } as SceneNode;
          }
          return { ...newDoc, nodes };
        });
      },

      // F6: distribute selected nodes — uses full world bounds for nested node correctness
      distributeSelected: (axis) => {
        const sel = state.selection;
        if (sel.length < 3) return;
        const doc = state.document;
        const items = sel
          .map((id) => {
            const node = doc.nodes[id];
            if (!node) return null;
            const bounds = nodeWorldBounds(doc, id);
            if (!bounds) return null;
            return { id, node, bounds };
          })
          .filter(
            (
              x,
            ): x is {
              id: NodeId;
              node: SceneNode;
              bounds: { x: number; y: number; w: number; h: number };
            } => x !== null,
          );
        if (items.length < 3) return;

        const sorted = [...items].sort((a, b) => {
          return (
            (axis === 'horizontal' ? a.bounds.x : a.bounds.y) -
            (axis === 'horizontal' ? b.bounds.x : b.bounds.y)
          );
        });

        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        if (!first || !last) return;
        const start = axis === 'horizontal' ? first.bounds.x : first.bounds.y;
        const end =
          axis === 'horizontal' ? last.bounds.x + last.bounds.w : last.bounds.y + last.bounds.h;
        const totalSize = sorted.reduce(
          (s, i) => s + (axis === 'horizontal' ? i.bounds.w : i.bounds.h),
          0,
        );
        const gap = (end - start - totalSize) / (sorted.length - 1);

        updateDoc((newDoc) => {
          const nodes = { ...newDoc.nodes };
          let cursor = start;
          for (const { id, bounds: b } of sorted) {
            const node = nodes[id];
            if (!node) continue;
            const wm = nodeWorldTransform(doc, id);
            const bOffX = b.x - wm[4];
            const bOffY = b.y - wm[5];
            const targetWorldX = axis === 'horizontal' ? cursor - bOffX : wm[4];
            const targetWorldY = axis === 'vertical' ? cursor - bOffY : wm[5];
            const parentId = getParent(doc, id);
            let newLocalX = targetWorldX;
            let newLocalY = targetWorldY;
            if (parentId) {
              const pInv = invertAffine(nodeWorldTransform(doc, parentId));
              const local = applyAffine(pInv, [targetWorldX, targetWorldY]);
              newLocalX = local[0];
              newLocalY = local[1];
            }
            nodes[id] = {
              ...node,
              transform: [
                node.transform[0],
                node.transform[1],
                node.transform[2],
                node.transform[3],
                newLocalX,
                newLocalY,
              ] as Affine,
            } as SceneNode;
            cursor += (axis === 'horizontal' ? b.w : b.h) + gap;
          }
          return { ...newDoc, nodes };
        });
      },

      // F6: batch-set variable binding on all selected nodes
      setSelectedBinding: (target, binding) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            const nodeBindings = { ...(node.bindings ?? {}) };
            if (binding === null) {
              delete nodeBindings[target];
            } else {
              nodeBindings[target] = binding;
            }
            nodes[id] = {
              ...node,
              bindings: Object.keys(nodeBindings).length > 0 ? nodeBindings : undefined,
            } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      // F6: transaction API
      beginTransaction,
      commitTransaction,
      abortTransaction,

      undo: () => {
        const prev = undoStackRef.current.pop();
        const prevSel = undoSelStackRef.current.pop();
        if (!prev) return;
        redoStackRef.current = [...redoStackRef.current, state.document];
        redoSelStackRef.current = [...redoSelStackRef.current, state.selection];
        patch({ document: prev, selection: prevSel ?? [] });
      },

      redo: () => {
        const next = redoStackRef.current.pop();
        const nextSel = redoSelStackRef.current.pop();
        if (!next) return;
        undoStackRef.current = [...undoStackRef.current, state.document];
        undoSelStackRef.current = [...undoSelStackRef.current, state.selection];
        patch({ document: next, selection: nextSel ?? [] });
      },

      newDocument: () => {
        undoStackRef.current = [];
        redoStackRef.current = [];
        undoSelStackRef.current = [];
        redoSelStackRef.current = [];
        patch({ document: createDocument('Untitled'), selection: [] });
      },

      serializeDocument: () => {
        const stamped = { ...state.document, formatVersion: '1.0' };
        return JSON.stringify(stamped);
      },

      save: async () => {
        if (!platform) {
          patch({ saveState: 'error' });
          return false;
        }
        patch({ saveState: 'saving' });
        try {
          const s = stateRef.current;
          const meta = s.sessions.find((sess) => sess.id === s.activeId);
          const json = JSON.stringify({ ...s.document, formatVersion: '1.0' });
          if (meta?.fileId) {
            const fe = makeFileEntry({ id: meta.fileId, name: meta.name });
            await platform.upsertFile(fe, json);
          } else {
            return await saveAsImpl(platform, stateRef, recoveryRef, patch);
          }
          await recoveryRef.current?.deleteSession(s.activeId);
          patch({
            dirty: false,
            saveState: 'saved',
            lastSavedAt: Date.now(),
            sessions: s.sessions.map((sess) =>
              sess.id === s.activeId ? { ...sess, dirty: false } : sess,
            ),
          });
          return true;
        } catch {
          patch({ saveState: 'error' });
          return false;
        }
      },

      saveAs: async () => {
        return await saveAsImpl(platform, stateRef, recoveryRef, patch);
      },

      saveState: state.saveState,
      lastSavedAt: state.lastSavedAt,

      loadDocument: (json, meta) => {
        try {
          const migrated = migrateDocumentJson(json);
          if (!migrated) throw new Error('Migration failed');
          const doc = migrated as unknown as Document;
          undoStackRef.current = [];
          redoStackRef.current = [];
          undoSelStackRef.current = [];
          redoSelStackRef.current = [];
          const name = meta?.name ?? doc.name;
          const filePath = meta?.filePath;
          const sessions = state.sessions.map((s) =>
            s.id === state.activeId ? { ...s, name, filePath, dirty: false } : s,
          );
          patch({ document: doc, selection: [], sessions, dirty: false });
        } catch {
          // invalid JSON — ignore silently
        }
      },

      rootNodes,

      createComponentFromFrame: (name, masterRootId, slots) => {
        updateDoc((doc) => {
          const { doc: d2 } = createComponent(doc, name, masterRootId, slots);
          return d2;
        });
      },

      createComponentInstance: (componentId) => {
        updateDoc((doc) => {
          const def = doc.components[componentId];
          if (!def) return doc;
          const { node, doc: d2 } = instantiateComponent(doc, def);
          return addNode(d2, node);
        });
      },

      fillSlot: (instanceId, slotId, fillNodeId) => {
        updateDoc((doc) => fillSlotDoc(doc, instanceId, slotId, fillNodeId));
      },

      swapComponentInstance: (instanceId, newComponentId) => {
        updateDoc((doc) => swapInstanceDoc(doc, instanceId, newComponentId));
      },

      resetInstanceOverrides: (instanceId) => {
        updateDoc((doc) => resetInstanceOverridesDoc(doc, instanceId));
      },

      setVariantForInstance: (instanceId, variantId) => {
        updateDoc((doc) => setVariantForInstanceDoc(doc, instanceId, variantId));
      },

      createVariant: (componentId, name, propertyValues) => {
        updateDoc((doc) => {
          const { doc: newDoc } = createVariantDoc(doc, componentId, name, propertyValues);
          return newDoc;
        });
      },

      addComponentProperty: (componentId, prop) => {
        updateDoc((doc) => {
          const { doc: newDoc } = addComponentPropertyDoc(doc, componentId, prop);
          return newDoc;
        });
      },

      resolveVariantPropertiesForNode: (nodeId) => {
        const node = state.document.nodes[nodeId];
        if (node?.kind !== 'frame') return {};
        const frame = node;
        if (!frame.componentId || !frame.variant) return {};
        return resolveVariantProperties(state.document, frame.componentId, frame.variant);
      },

      setPageBleed: (pageId, bleed) => {
        updateDoc((doc) => {
          if (!doc.pages) return doc;
          return {
            ...doc,
            pages: doc.pages.map((p) => (p.id === pageId ? { ...p, bleed } : p)),
          };
        });
      },

      setPageSafeArea: (pageId, safeArea) => {
        updateDoc((doc) => {
          if (!doc.pages) return doc;
          return {
            ...doc,
            pages: doc.pages.map((p) => (p.id === pageId ? { ...p, safeArea } : p)),
          };
        });
      },

      setPageSlug: (pageId, slug) => {
        updateDoc((doc) => {
          if (!doc.pages) return doc;
          return {
            ...doc,
            pages: doc.pages.map((p) => (p.id === pageId ? { ...p, slug } : p)),
          };
        });
      },

      setNodeLocked: (id, locked) => {
        updateNodeProp(id, (n) => ({ ...n, locked }));
      },

      setNodeVisible: (id, visible) => {
        updateNodeProp(id, (n) => ({ ...n, visible }));
      },

      setNodeClipContent: (id, clipContent) => {
        updateNodeProp(id, (n) => {
          if (n.kind !== 'frame') return n;
          return { ...n, clipContent };
        });
      },

      announce: (msg) => {
        announcerRef.current?.announce(msg);
      },
      announceSelection: (selected) => {
        announcerRef.current?.announceSelection(selected);
      },
      announceOperation: (op, result) => {
        announcerRef.current?.announceOperation(op, result);
      },

      reparentNode: (id, newParentId, toIndex) => {
        updateDoc((doc) => {
          const node = doc.nodes[id];
          if (!node) return doc;
          const oldParentId = getParent(doc, id);
          const oldWorld = nodeWorldTransform(doc, id);
          let newDoc: Document;
          if (newParentId) {
            // Convert old world pos → new parent's local space.
            const pWorld = nodeWorldTransform(doc, newParentId);
            const pInv = invertAffine(pWorld);
            const newLocal = multiplyAffine(pInv, oldWorld);
            newDoc = reparentNodeDoc(doc, id, newParentId, toIndex, newLocal);
          } else {
            // Move to root: local = world (root has identity transform).
            newDoc = reparentNodeDoc(doc, id, null, toIndex, oldWorld);
          }
          if (oldParentId) newDoc = applyFrameLayout(newDoc, oldParentId);
          if (newParentId) newDoc = applyFrameLayout(newDoc, newParentId);
          return newDoc;
        });
      },

      arrangeSelected: (op) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          let d = doc;
          for (const id of sel) d = arrangeNodeDoc(d, id, op);
          return d;
        });
        announcerRef.current?.announce(
          op === 'front'
            ? 'Brought to front'
            : op === 'back'
              ? 'Sent to back'
              : op === 'forward'
                ? 'Brought forward'
                : 'Sent backward',
        );
      },

      groupSelected: () => {
        const sel = state.selection;
        if (sel.length < 2) return;
        setState((s) => {
          if (!inTransactionRef.current) {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
            redoStackRef.current = [];
            redoSelStackRef.current = [];
          }
          const { id: gId, doc: d2 } = nextNodeId(s.document);
          const group = makeGroupNode(gId, { name: 'Group' });
          const newDoc = groupNodesDoc(d2, sel, group);
          return { ...s, document: newDoc, selection: [gId], dirty: true };
        });
      },

      ungroupSelected: () => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        setState((s) => {
          const node = s.document.nodes[id];
          if (node?.kind !== 'group') return s;
          const childIds = [...node.children];
          if (!inTransactionRef.current) {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
            redoStackRef.current = [];
            redoSelStackRef.current = [];
          }
          const newDoc = ungroupNodeDoc(s.document, id);
          return { ...s, document: newDoc, selection: childIds, dirty: true };
        });
      },

      detachSelected: () => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => detachInstanceDoc(doc, id));
      },

      copySelected: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        const nodes = sel
          .map((id) => state.document.nodes[id])
          .filter((n): n is SceneNode => Boolean(n));
        if (nodes.length === 0) return;
        writeToClipboard(nodes);
        announcerRef.current?.announce(
          `Copied ${nodes.length} layer${nodes.length > 1 ? 's' : ''}`,
        );
      },

      cutSelected: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        const nodes = sel
          .map((id) => state.document.nodes[id])
          .filter((n): n is SceneNode => Boolean(n));
        if (nodes.length === 0) return;
        writeToClipboard(nodes);
        updateDoc((doc) => {
          let d = doc;
          for (const id of sel) d = removeNode(d, id);
          return d;
        });
        patch({ selection: [] });
        announcerRef.current?.announce(`Cut ${nodes.length} layer${nodes.length > 1 ? 's' : ''}`);
      },

      paste: () => {
        readFromClipboard().then((data) => {
          if (!data || data.nodes.length === 0) return;
          setState((s) => {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            redoStackRef.current = [];
            let doc = s.document;
            const newIds: NodeId[] = [];
            for (const node of data.nodes) {
              const { id, doc: d2 } = nextNodeId(doc);
              doc = d2;
              const cloned = { ...node, id } as SceneNode;
              doc = addNode(doc, cloned);
              newIds.push(id);
            }
            return { ...s, document: doc, selection: newIds };
          });
          announcerRef.current?.announce(
            `Pasted ${data.nodes.length} layer${data.nodes.length > 1 ? 's' : ''}`,
          );
        });
        // Also try to paste images/SVG from clipboard
        readClipboardImages().then((images) => {
          if (images.length === 0) {
            readClipboardText().then((text) => {
              if (text && (text.trim().startsWith('<svg') || text.trim().startsWith('<?xml'))) {
                try {
                  setState((s) => {
                    undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
                    redoStackRef.current = [];
                    let doc = s.document;
                    const newIds: NodeId[] = [];
                    const result = importFile('clipboard.svg', text, {
                      center: true,
                      embedImages: true,
                    });
                    for (const id of result.nodeIds) {
                      const node = result.document.nodes[id];
                      if (node) {
                        const { id: newId, doc: d2 } = nextNodeId(doc);
                        doc = d2;
                        doc = addNode(doc, { ...node, id: newId } as SceneNode);
                        newIds.push(newId);
                      }
                    }
                    return { ...s, document: doc, selection: newIds };
                  });
                } catch {
                  /* ignore clipboard parse errors */
                }
              }
            });
          } else {
            setState((s) => {
              undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
              redoStackRef.current = [];
              let doc = s.document;
              const newIds: NodeId[] = [];
              for (const img of images) {
                const result = importFile(img.name, img.dataUrl, {
                  center: true,
                  embedImages: true,
                });
                for (const id of result.nodeIds) {
                  const node = result.document.nodes[id];
                  if (node) {
                    const { id: newId, doc: d2 } = nextNodeId(doc);
                    doc = d2;
                    doc = addNode(doc, { ...node, id: newId } as SceneNode);
                    newIds.push(newId);
                  }
                }
              }
              if (newIds.length > 0) {
                return { ...s, document: doc, selection: newIds };
              }
              return s;
            });
          }
        });
      },

      importNode: (node, sourceDoc, options) => {
        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];
          let doc = s.document;
          const { id, doc: d2 } = nextNodeId(doc);
          doc = d2;
          // Apply explicit position if provided, otherwise center in viewport
          const imported = options?.position
            ? ({
                ...applyDropPosition({ ...node, id } as SceneNode, options.position),
                id,
              } as SceneNode)
            : (() => {
                const centerX = (s.pan.x + (sourceDoc.canvasWidth ?? 800) / 2) / s.zoom;
                const centerY = (s.pan.y + (sourceDoc.canvasHeight ?? 600) / 2) / s.zoom;
                const offsetX = centerX - ((node.transform[4] ?? 0) + 50);
                const offsetY = centerY - ((node.transform[5] ?? 0) + 50);
                return {
                  ...node,
                  id,
                  transform: [
                    node.transform[0],
                    node.transform[1],
                    node.transform[2],
                    node.transform[3],
                    (node.transform[4] ?? 0) + offsetX,
                    (node.transform[5] ?? 0) + offsetY,
                  ] as Affine,
                } as SceneNode;
              })();
          doc = addNode(doc, imported);
          return { ...s, document: doc, selection: [id] };
        });
        announcerRef.current?.announce('Imported layer');
      },

      bindingField,
      setBindingField,
      focusedField,
      setFocusedField,

      setSelectedCornerSmoothing: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (node?.kind !== 'shape') continue;
            nodes[id] = { ...node, cornerSmoothing: value } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },
      setCursorPos: (pos) => patch({ cursorPos: pos }),
      setUnitType: (t) => patch({ unitType: t }),
      setDocumentUnit: (unit) => {
        updateDoc((doc) => ({ ...doc, documentUnit: unit }));
      },
      setPixelGridEnabled: (v) => patch({ pixelGridEnabled: v }),
      setSnapEnabled: (v) => patch({ snapEnabled: v }),
      setSoftProofEnabled: (v) => patch({ softProofEnabled: v }),

      setNodeLayout: (id, layout) => {
        updateNodeProp(id, (n) => {
          if (n.kind !== 'frame') return n;
          return { ...n, layoutStyle: layout };
        });
      },

      setSelectedMinWidth: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, minWidth: value };
          }
          return { ...doc, nodes };
        });
      },

      setSelectedMaxWidth: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, maxWidth: value };
          }
          return { ...doc, nodes };
        });
      },

      setSelectedMinHeight: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, minHeight: value };
          }
          return { ...doc, nodes };
        });
      },

      setSelectedMaxHeight: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, maxHeight: value };
          }
          return { ...doc, nodes };
        });
      },

      setSelectedLayoutSizing: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, layoutSizing: value } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      setSelectedGridPlacement: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, gridPlacement: value } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      setCanvasWidth: (value) => {
        updateDoc((doc) => ({ ...doc, canvasWidth: value }));
      },

      setCanvasHeight: (value) => {
        updateDoc((doc) => ({ ...doc, canvasHeight: value }));
      },

      setCanvasBackground: (value) => {
        updateDoc((doc) => ({ ...doc, canvasBackground: value }));
      },

      // F2/A8 — session (tab) management -----------------------------------

      resolveVariable: (nameOrId) => resolve(state.variableStore, nameOrId),

      addVariable: (v) => {
        const id = `var-${Date.now()}`;
        const newVar: Variable = { id, ...v };
        setState((s) => ({
          ...s,
          variableStore: {
            ...s.variableStore,
            variables: { ...s.variableStore.variables, [id]: newVar },
          },
        }));
      },

      updateVariable: (id, patch) => {
        setState((s) => {
          const existing = s.variableStore.variables[id];
          if (!existing) return s;
          return {
            ...s,
            variableStore: {
              ...s.variableStore,
              variables: { ...s.variableStore.variables, [id]: { ...existing, ...patch } },
            },
          };
        });
      },

      deleteVariable: (id) => {
        setState((s) => {
          const { [id]: _, ...rest } = s.variableStore.variables;
          return { ...s, variableStore: { ...s.variableStore, variables: rest } };
        });
      },

      setVariableMode: (mode) => {
        setState((s) => ({
          ...s,
          variableStore: { ...s.variableStore, activeMode: mode },
        }));
      },

      newTab: () => {
        setState((s) => {
          // Snapshot current session before leaving it
          sessionStoreRef.current.set(s.activeId, {
            document: s.document,
            selection: s.selection,
            viewport: { zoom: s.zoom, pan: s.pan },
            undo: [...undoStackRef.current],
            redo: [...redoStackRef.current],
            undoSel: [...undoSelStackRef.current],
            redoSel: [...redoSelStackRef.current],
            variableStore: s.variableStore,
          });
          const syncedSessions = s.sessions.map((sess) =>
            sess.id === s.activeId ? { ...sess, dirty: s.dirty } : sess,
          );
          const newId = `session-${Date.now()}`;
          const newDoc = createDocument('Untitled');
          undoStackRef.current = [];
          redoStackRef.current = [];
          undoSelStackRef.current = [];
          redoSelStackRef.current = [];
          return {
            ...s,
            document: newDoc,
            selection: [],
            zoom: 1,
            pan: { x: 0, y: 0 },
            dirty: false,
            variableStore: createVariableStore(),
            sessions: [...syncedSessions, { id: newId, name: 'Untitled', dirty: false }],
            activeId: newId,
          };
        });
      },

      switchTab: (id) => {
        setState((s) => {
          if (id === s.activeId) return s;
          // Snapshot current
          sessionStoreRef.current.set(s.activeId, {
            document: s.document,
            selection: s.selection,
            viewport: { zoom: s.zoom, pan: s.pan },
            undo: [...undoStackRef.current],
            redo: [...redoStackRef.current],
            undoSel: [...undoSelStackRef.current],
            redoSel: [...redoSelStackRef.current],
            variableStore: s.variableStore,
          });
          const syncedSessions = s.sessions.map((sess) =>
            sess.id === s.activeId ? { ...sess, dirty: s.dirty } : sess,
          );
          // Restore target session
          const saved = sessionStoreRef.current.get(id);
          const targetMeta = syncedSessions.find((sess) => sess.id === id);
          undoStackRef.current = saved ? [...saved.undo] : [];
          redoStackRef.current = saved ? [...saved.redo] : [];
          undoSelStackRef.current = saved ? [...saved.undoSel] : [];
          redoSelStackRef.current = saved ? [...saved.redoSel] : [];
          return {
            ...s,
            document: saved?.document ?? createDocument(targetMeta?.name ?? 'Untitled'),
            selection: saved?.selection ?? [],
            zoom: saved?.viewport.zoom ?? 1,
            pan: saved?.viewport.pan ?? { x: 0, y: 0 },
            dirty: targetMeta?.dirty ?? false,
            variableStore: saved?.variableStore ?? createVariableStore(),
            sessions: syncedSessions,
            activeId: id,
          };
        });
      },

      openFile: (
        fileId: string,
        name: string,
        filePath: string | undefined,
        json: string | null,
      ) => {
        // Parse up front; null/invalid json = fresh blank document (new file).
        let doc: Document;
        try {
          if (json) {
            const migrated = migrateDocumentJson(json);
            doc = (migrated as unknown as Document) ?? createDocument(name || 'Untitled');
          } else {
            doc = createDocument(name || 'Untitled');
          }
        } catch {
          doc = createDocument(name || 'Untitled');
        }
        setState((s) => {
          // Dedupe: if this file is already open in a tab, switch to it
          // instead of opening a duplicate.
          const existing = s.sessions.find(
            (sess) =>
              (fileId && sess.fileId === fileId) || (filePath && sess.filePath === filePath),
          );
          const snapshotCurrent = () => {
            sessionStoreRef.current.set(s.activeId, {
              document: s.document,
              selection: s.selection,
              viewport: { zoom: s.zoom, pan: s.pan },
              undo: [...undoStackRef.current],
              redo: [...redoStackRef.current],
              undoSel: [...undoSelStackRef.current],
              redoSel: [...redoSelStackRef.current],
              variableStore: s.variableStore,
            });
          };
          const syncedSessions = s.sessions.map((sess) =>
            sess.id === s.activeId ? { ...sess, dirty: s.dirty } : sess,
          );

          if (existing && existing.id !== s.activeId) {
            snapshotCurrent();
            const saved = sessionStoreRef.current.get(existing.id);
            undoStackRef.current = saved ? [...saved.undo] : [];
            redoStackRef.current = saved ? [...saved.redo] : [];
            undoSelStackRef.current = saved ? [...saved.undoSel] : [];
            redoSelStackRef.current = saved ? [...saved.redoSel] : [];
            return {
              ...s,
              document: saved?.document ?? doc,
              selection: saved?.selection ?? [],
              zoom: saved?.viewport.zoom ?? 1,
              pan: saved?.viewport.pan ?? { x: 0, y: 0 },
              dirty: existing.dirty,
              variableStore: saved?.variableStore ?? createVariableStore(),
              sessions: syncedSessions,
              activeId: existing.id,
            };
          }
          if (existing) return s; // already the active tab

          undoStackRef.current = [];
          redoStackRef.current = [];
          undoSelStackRef.current = [];
          redoSelStackRef.current = [];

          // Reuse a pristine active tab (fresh Untitled, empty, unmodified)
          // instead of leaving a stray blank tab behind.
          const activeMeta = s.sessions.find((sess) => sess.id === s.activeId);
          const pristine =
            !s.dirty &&
            s.document.rootChildren.length === 0 &&
            activeMeta?.name === 'Untitled' &&
            !activeMeta?.filePath &&
            !activeMeta?.fileId;
          if (pristine) {
            return {
              ...s,
              document: doc,
              selection: [],
              zoom: 1,
              pan: { x: 0, y: 0 },
              dirty: false,
              variableStore: createVariableStore(),
              sessions: s.sessions.map((sess) =>
                sess.id === s.activeId ? { ...sess, name, filePath, fileId } : sess,
              ),
              activeId: s.activeId,
            };
          }

          snapshotCurrent();
          const newId = `session-${Date.now()}`;
          return {
            ...s,
            document: doc,
            selection: [],
            zoom: 1,
            pan: { x: 0, y: 0 },
            dirty: false,
            variableStore: createVariableStore(),
            sessions: [...syncedSessions, { id: newId, name, dirty: false, filePath, fileId }],
            activeId: newId,
          };
        });
      },

      showExportDialog,
      setShowExportDialog,

      addPreset: (nodeId, preset) => {
        updateDoc((doc) => {
          const node = doc.nodes[nodeId];
          if (!node) return doc;
          const existing = node.presets ?? [];
          return {
            ...doc,
            nodes: {
              ...doc.nodes,
              [nodeId]: { ...node, presets: [...existing, preset] },
            },
          };
        });
      },

      updatePreset: (nodeId, updatedPreset) => {
        updateDoc((doc) => {
          const node = doc.nodes[nodeId];
          if (!node) return doc;
          const existing = node.presets ?? [];
          return {
            ...doc,
            nodes: {
              ...doc.nodes,
              [nodeId]: {
                ...node,
                presets: existing.map((p) => (p.id === updatedPreset.id ? updatedPreset : p)),
              },
            },
          };
        });
      },

      removePreset: (nodeId, presetId) => {
        updateDoc((doc) => {
          const node = doc.nodes[nodeId];
          if (!node) return doc;
          return {
            ...doc,
            nodes: {
              ...doc.nodes,
              [nodeId]: { ...node, presets: (node.presets ?? []).filter((p) => p.id !== presetId) },
            },
          };
        });
      },

      booleanOp: (op) => {
        const sel = state.selection;
        if (sel.length < 2) return;
        setState((s) => {
          const shapeNodes = sel
            .map((id) => s.document.nodes[id])
            .filter((n): n is import('@strata/scene').ShapeNode => n?.kind === 'shape');
          if (shapeNodes.length < 2) return s;
          if (!inTransactionRef.current) {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
            redoStackRef.current = [];
            redoSelStackRef.current = [];
          }
          const result = doBooleanOp(op, shapeNodes);
          let d = s.document;
          for (const id of sel) d = removeNode(d, id);
          const { id: newId, doc: d2 } = nextNodeId(d);
          const newNode = { ...result, id: newId } as import('@strata/scene').ShapeNode;
          d = addNode(d2, newNode);
          return { ...s, document: d, selection: [newId], dirty: true };
        });
      },

      setPrototypeMode: (active) => {
        patch({ prototypeMode: active });
        if (active) {
          const screens = Object.values(state.document.nodes).filter(
            (n): n is import('@strata/scene').FrameNode => n.kind === 'frame',
          );
          const firstScreen = screens[0];
          const interactions: Interaction[] = [];
          const runtime = createRuntime(interactions, firstScreen?.id ?? '');
          prototypeRuntimeRef.current = runtime;
          patch({
            prototypeRuntime: runtime,
            prototypeData: { interactions: {} },
          });
          setPrototypeCurrentScreen(firstScreen?.id ?? '');
        } else {
          prototypeRuntimeRef.current = null;
          patch({ prototypeRuntime: null });
        }
      },

      updatePrototypeData: () => {
        const screens = Object.values(state.document.nodes).filter(
          (n): n is import('@strata/scene').FrameNode => n.kind === 'frame',
        );
        const firstScreen = screens[0];
        const interactions: Interaction[] = [];
        const runtime = createRuntime(interactions, firstScreen?.id ?? '');
        prototypeRuntimeRef.current = runtime;
        patch({
          prototypeRuntime: runtime,
          prototypeData: { interactions: {} },
        });
        setPrototypeCurrentScreen(firstScreen?.id ?? '');
      },

      handlePrototypeEvent: (event) => {
        const runtime = prototypeRuntimeRef.current;
        if (!runtime) return;
        const results = protoHandleEvent(runtime, event as Parameters<typeof protoHandleEvent>[1]);
        for (const result of results) {
          for (const actionResult of result.actionResults) {
            protoApplyActionResult(runtime, actionResult);
          }
        }
        setPrototypeCurrentScreen(runtime.state.currentScreenId);
      },

      getPrototypeVariable: (id) => {
        const runtime = prototypeRuntimeRef.current;
        if (!runtime) return undefined;
        return protoGetVar(runtime, id);
      },

      setPrototypeVariable: (id, value) => {
        const runtime = prototypeRuntimeRef.current;
        if (!runtime) return;
        protoSetVar(runtime, id, value);
      },

      startPresentation: () => {
        const screens = Object.values(state.document.nodes).filter(
          (n): n is import('@strata/scene').FrameNode => n.kind === 'frame',
        );
        const firstScreen = screens[0];
        const interactions: Interaction[] = [];
        const runtime = createRuntime(interactions, firstScreen?.id ?? '');
        prototypeRuntimeRef.current = runtime;
        patch({
          isPresenting: true,
          prototypeRuntime: runtime,
        });
        setPrototypeCurrentScreen(firstScreen?.id ?? '');
      },

      stopPresentation: () => {
        patch({ isPresenting: false });
      },

      getPrototypeScreens: () => {
        return Object.values(state.document.nodes)
          .filter((n): n is import('@strata/scene').FrameNode => n.kind === 'frame')
          .map((n) => ({ id: n.id, name: n.name }));
      },

      prototypeCurrentScreen,
      navigatePrototypeTo: (screenId) => {
        const runtime = prototypeRuntimeRef.current;
        if (runtime) {
          runtime.state.currentScreenId = screenId;
        }
        setPrototypeCurrentScreen(screenId);
      },

      // ── Motion / Animation implementations ────────────────────────────────────

      playTimeline: (timelineId) => {
        const tlId = timelineId ?? state.motion.activeTimelineId;
        if (!tlId) return;
        const timeline = state.document.timelines?.[tlId];
        if (!timeline) return;
        let eng = motionEngRef.current;
        if (!eng) {
          eng = {
            engine: null,
            startPlayback() {},
            pausePlayback() {},
            stopPlayback() {},
            seekPlayback() {},
            setPlaybackSpeed() {},
            getCurrentSample() {
              return { overrides: new Map() };
            },
          };
          motionEngRef.current = eng;
        }
        eng.startPlayback(timeline);
        patch({ motion: { ...state.motion, isPlaying: true, activeTimelineId: tlId } });
      },

      pauseTimeline: () => {
        const eng = motionEngRef.current;
        if (eng) eng.pausePlayback();
        patch({ motion: { ...state.motion, isPlaying: false } });
      },

      stopTimeline: () => {
        const eng = motionEngRef.current;
        if (eng) eng.stopPlayback();
        patch({ motion: { ...state.motion, isPlaying: false, currentTime: 0 } });
      },

      seekTimeline: (time) => {
        const eng = motionEngRef.current;
        if (eng) eng.seekPlayback(time);
        patch({ motion: { ...state.motion, currentTime: Math.max(0, time) } });
      },

      setActiveTimeline: (id) => {
        patch({
          motion: { ...state.motion, activeTimelineId: id, currentTime: 0, isPlaying: false },
        });
      },

      setPlaybackSpeed: (speed) => {
        const eng = motionEngRef.current;
        if (eng) eng.setPlaybackSpeed(speed);
        patch({ motion: { ...state.motion, playbackSpeed: speed } });
      },

      toggleLoop: () => {
        patch({ motion: { ...state.motion, loop: !state.motion.loop } });
      },

      addKeyframeToSelected: (property) => {
        const tlId = state.motion.activeTimelineId;
        if (!tlId || state.selection.length === 0) return;
        updateDoc((doc) => {
          let d = doc;
          const timeline = d.timelines?.[tlId];
          if (!timeline) return d;
          const progress = timeline.duration > 0 ? state.motion.currentTime / timeline.duration : 0;
          for (const nodeId of state.selection) {
            const node = d.nodes[nodeId];
            if (!node) continue;
            const existingTrack = timeline.tracks.find(
              (t) => t.nodeId === nodeId && t.property === property,
            );
            if (existingTrack) {
              d = addKeyframe(d, tlId, existingTrack.id, {
                progress,
                value: getPropertyValueAt(node, property),
              });
            } else {
              const { doc: d2, trackId } = addTrack(d, tlId, nodeId, property);
              d = addKeyframe(d2, tlId, trackId, {
                progress,
                value: getPropertyValueAt(node, property),
              });
            }
          }
          return d;
        });
      },

      // ── Guide management implementations ─────────────────────────────────

      guides: state.document.guides ?? [],

      addGuide: (axis, position) => {
        updateDoc((doc) => addGuideDoc(doc, axis, position));
      },

      removeGuide: (id) => {
        updateDoc((doc) => removeGuideDoc(doc, id));
      },

      moveGuide: (id, position) => {
        updateDoc((doc) => moveGuideDoc(doc, id, position));
      },

      toggleGuideLock: (id) => {
        updateDoc((doc) => toggleGuideLockDoc(doc, id));
      },

      clearAllGuides: () => {
        updateDoc((doc) => clearGuides(doc));
      },

      closeTab: (id, force = false) => {
        const sess = state.sessions.find((s) => s.id === id);
        if (sess?.dirty && !force) return false;
        setState((s) => {
          const remaining = s.sessions.filter((sess) => sess.id !== id);
          sessionStoreRef.current.delete(id);
          if (remaining.length === 0) {
            // Last tab — go back to Home
            queueMicrotask(() => onBackToHome?.());
            return s;
          }
          if (id !== s.activeId) {
            // Background tab — no switch needed
            return { ...s, sessions: remaining };
          }
          // Active tab — switch to adjacent
          const idx = s.sessions.findIndex((sess) => sess.id === id);
          const next = remaining[Math.min(idx, remaining.length - 1)];
          if (!next) return { ...s, sessions: remaining };
          const saved = sessionStoreRef.current.get(next.id);
          undoStackRef.current = saved ? [...saved.undo] : [];
          redoStackRef.current = saved ? [...saved.redo] : [];
          undoSelStackRef.current = saved ? [...saved.undoSel] : [];
          redoSelStackRef.current = saved ? [...saved.redoSel] : [];
          return {
            ...s,
            document: saved?.document ?? createDocument(next.name),
            selection: saved?.selection ?? [],
            zoom: saved?.viewport.zoom ?? 1,
            pan: saved?.viewport.pan ?? { x: 0, y: 0 },
            dirty: next.dirty,
            variableStore: saved?.variableStore ?? createVariableStore(),
            sessions: remaining,
            activeId: next.id,
          };
        });
        return true;
      },
    }),
    [
      state,
      patch,
      updateDoc,
      rootNodes,
      updateNodeProp,
      onBackToHome,
      beginTransaction,
      commitTransaction,
      abortTransaction,
      bindingField,
      setBindingField,
      focusedField,
      setFocusedField,
      showExportDialog,
      prototypeCurrentScreen,
      platform,
    ],
  );

  return <EditorCtx.Provider value={value}>{children}</EditorCtx.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}

export function useBindingField(): [string | null, (field: string | null) => void] {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useBindingField must be used within EditorProvider');
  return [ctx.bindingField, ctx.setBindingField];
}

// Build a shape with specific dragged size
function buildShapeWithSize(tool: ToolId, size: { w: number; h: number }): Shape {
  switch (tool) {
    case 'ellipse':
      return { kind: 'ellipse', cx: size.w / 2, cy: size.h / 2, rx: size.w / 2, ry: size.h / 2 };
    case 'polygon': {
      const r = Math.min(size.w, size.h) / 2;
      return { kind: 'polygon', cx: size.w / 2, cy: size.h / 2, radius: r, sides: 6, rotation: 0 };
    }
    case 'star': {
      const r = Math.min(size.w, size.h) / 2;
      return {
        kind: 'star',
        cx: size.w / 2,
        cy: size.h / 2,
        innerRadius: r * 0.4,
        outerRadius: r,
        points: 5,
        rotation: 0,
      };
    }
    case 'line':
      return { kind: 'line', from: [0, 0], to: [size.w, size.h], tolerance: 3 };
    case 'arrow':
      return { kind: 'arrow', from: [0, 0], to: [size.w, size.h], tolerance: 3, arrowheadSize: 10 };
    case 'text':
      return { kind: 'rect', x: 0, y: 0, w: size.w, h: size.h };
    case 'pen':
    case 'pencil':
      return {
        kind: 'path',
        points: [],
        closed: false,
        tolerance: 3,
      } as Shape;
    default:
      return { kind: 'rect', x: 0, y: 0, w: size.w, h: size.h };
  }
}

/** Compare two RGBA color tuples by value. */
function colorsEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === (b as number[])[i]);
}

/** Extract a property value from a scene node for keyframe storage. */
function getPropertyValueAt(node: import('@strata/scene').SceneNode, property: string): unknown {
  if (property === 'opacity') return node.opacity;
  if (property === 'rotation') return node.rotation;
  if (property === 'fill' || property.startsWith('fill[')) return node.fill;
  if (property === 'transform' || property.startsWith('transform[')) {
    const t = (node as import('@strata/scene').ShapeNode).transform;
    return t ?? [1, 0, 0, 1, 0, 0];
  }
  if ('w' in node && property === 'w') return (node as import('@strata/scene').FrameNode).w;
  if ('h' in node && property === 'h') return (node as import('@strata/scene').FrameNode).h;
  if (property === 'fontSize' && 'fontSize' in node)
    return (node as import('@strata/scene').TextNode).fontSize;
  return getNestedValue(node as unknown as Record<string, unknown>, property.split('.')) ?? 0;
}
