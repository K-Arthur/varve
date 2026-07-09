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
import type { Adjustment, Affine, PathPoint, Shape } from '@strata/engine';
import {
  applyAffine,
  invertAffine,
  multiplyAffine,
  rectContains,
  shapeContains,
} from '@strata/engine';
import { type ImportFileInput, ImportService } from '@strata/import';
import { makeFileEntry, type Platform } from '@strata/platform';
import {
  PrototypeDebugConsole,
  type PrototypeRuntime,
  applyActionResult as protoApplyActionResult,
  getVariable as protoGetVar,
  handleEvent as protoHandleEvent,
  processDelays as protoProcessDelays,
  setVariable as protoSetVar,
} from '@strata/prototype';
import type {
  AdjustmentNode,
  ContainerNode,
  ExportPreset,
  InstanceStatus,
  ManagedColor,
  NodeId,
  Slot,
  SyncResult,
} from '@strata/scene';
import {
  type ArrangeOp,
  addChild,
  addComponentProperty as addComponentPropertyDoc,
  addGuide as addGuideDoc,
  addInteraction as addInteractionDoc,
  addKeyframe,
  addNode,
  addTimelineMarker as addTimelineMarkerDoc,
  addTrack,
  addVariableToDocument,
  advanceSMTransition,
  appendFrameToChain as appendFrameToChainDoc,
  applyMotionPreset as applyMotionPresetDoc,
  arrangeNode as arrangeNodeDoc,
  type BleedConfig,
  clearGuides,
  createComponent,
  createDocument,
  createMotionPreset as createMotionPresetDoc,
  createStateMachineRuntime,
  createTextChain as createTextChainDoc,
  createTimeline as createTimelineDoc,
  createVariableStore,
  createVariant as createVariantDoc,
  type Document,
  DocumentCodec,
  deepCloneSubtree,
  deleteTextChain as deleteTextChainDoc,
  deleteVariableFromDocument as deleteVariableFromDocumentDoc,
  detachInstance as detachInstanceDoc,
  booleanOp as doBooleanOp,
  fillSlot as fillSlotDoc,
  type Guide,
  activePageNodes as getActivePageNodes,
  getCurrentStateTimelineId,
  getInstanceStatus as getInstanceStatusDoc,
  getInteractionsForNode,
  getNestedValue,
  groupNodes as groupNodesDoc,
  installLibrary as installLibraryDoc,
  instantiate as instantiateComponent,
  isContainer,
  makeAdjustmentNode,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  moveGuide as moveGuideDoc,
  moveNode,
  nextNodeId,
  pushMasterChanges as pushMasterChangesDoc,
  removeFrameFromChain,
  removeGuide as removeGuideDoc,
  removeInteraction as removeInteractionDoc,
  removeNode,
  removeTimeline as removeTimelineDoc,
  removeTimelineMarker as removeTimelineMarkerDoc,
  removeTrack as removeTrackDoc,
  renameNode,
  renameTimeline as renameTimelineDoc,
  renameTimelineMarker as renameTimelineMarkerDoc,
  reparentNode as reparentNodeDoc,
  resetInstanceOverrides as resetInstanceOverridesDoc,
  resolve,
  resolveNodeFills,
  resolveVariantPropertiesForNode as resolveVariantPropertiesForNodeDoc,
  type SafeAreaConfig,
  type SceneNode,
  type SlugConfig,
  type SMRuntime,
  setActiveTimeline as setActiveTimelineDoc,
  setPropertyOverride as setPropertyOverrideDoc,
  setVariableModeOnDocument as setVariableModeOnDocumentDoc,
  setVariantForInstance as setVariantForInstanceDoc,
  swapInstance as swapInstanceDoc,
  syncAllInstances as syncAllInstancesDoc,
  syncInstance as syncInstanceDoc,
  toggleGuideLock as toggleGuideLockDoc,
  triggerSMEvent,
  ungroupNode as ungroupNodeDoc,
  updateInteraction as updateInteractionDoc,
  updateTrack as updateTrackDoc,
  updateVariableInDocument,
  type Variable,
  type VariableValue,
  validateDocument,
  walkNodes,
} from '@strata/scene';
import {
  alignBBox,
  animateCamera,
  clampZoom,
  computeAlignmentTarget,
  computeDistribution,
  computeTidyLayout,
  distributeToPosition,
  fitBoundsCamera,
  type OBB,
  obbAlignmentTarget,
  orientedBBox,
  revealBoundsCamera,
  screenDeltaToWorld,
  screenToWorld,
  stepZoom,
  transformRect,
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
  editorScreenToWorld,
  editorWorldToScreen,
  fitBoundsToState,
  resetViewRotationState,
  rotateViewAtScreen,
  toCamera,
} from './canvas/cameraState';
import { readClipboardUnifiedWithFallback, writeClipboard as writeToClipboard } from './clipboard';
import {
  bulkSetLayerColorDoc,
  bulkSetNodeLockedDoc,
  bulkSetNodeVisibleDoc,
  findAllOfKindIds,
  findSameKindIds,
  findSameLayerColorIds,
} from './components/LayersPanel/layerBulkOperations';
import { buildComponentLibraryPackage } from './components/LayersPanel/libraryPublish';
import type { ActivePrototypeTransition } from './components/Prototype/usePrototypeTransition';
import { loadSettings as loadUiSettings } from './components/Settings/settings';
import type { DocumentContextValue } from './context/DocumentContext';
import { DocumentProvider, SelectionProvider, ViewportProvider } from './context/index';
import type {
  CanvasMode,
  EditorState,
  GridOverlayMode,
  RulerMode,
  SessionMeta,
  ToolId,
} from './context/types';
import { applyDropPosition } from './dropUtils';
import { getActionTracker } from './intelligence/actionTracker';
import { computeFlexLayout } from './layout/computeFlexLayout';
import { applyGridLayout } from './layout/computeGridLayout';
import { applyAutoKeyframes } from './motion/autoKeyframe';
import { MotionFacade } from './motion/MotionFacade';
import { createRuntimeFromDocument, interactionsMapFromDocument } from './motion/prototypeRuntime';
import { computeSmartAnimateTransition } from './motion/smartAnimateBridge';
import { getPrimaryStateMachineTimelineId } from './motion/stateMachineBridge';
import { getSharedRecoveryManager, type RecoveryManager } from './recovery';
import {
  getOrCreateParentCache,
  getParentFast,
  type ParentIndexCache,
} from './scene/parentIndexCache';
import { getOrCreateSpatialIndex, queryPoint, type SpatialIndex } from './scene/spatialIndex';
import {
  createTransformCache,
  getWorldBounds as getCachedWorldBounds,
  getWorldTransform as getCachedWorldTransform,
  invalidateAll as invalidateTransformCache,
  type TransformCache,
} from './scene/transformCache';
import { nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from './scene/world';
import { loadSettings, updateSettings } from './settings';
import { createInitialMotionState } from './state/motion-state';
import { invalidateSamplerCache } from './timeline/TimelineSampler';
import type { DraftShape } from './tools/types';

// Re-export for backward compatibility
export type { CanvasMode, EditorState, SessionMeta, ToolId };

function insertImportedSubtree(
  targetDoc: Document,
  sourceDoc: Document,
  rootId: NodeId,
  adjustRoot: (node: SceneNode) => SceneNode,
): { doc: Document; rootId: NodeId } | null {
  const cloned = deepCloneSubtree({ ...sourceDoc, nextId: targetDoc.nextId }, rootId);
  const root = cloned.nodes[cloned.rootId];
  if (!root || Object.keys(cloned.nodes).length === 0) return null;

  const nodes = { ...cloned.nodes, [cloned.rootId]: adjustRoot(root) };

  // For paged documents, add to the active page's contentRoot so the node
  // is visible to the page-scoped renderer (activePageNodes). Adding to
  // rootChildren bypasses the page system and the node is never traversed.
  const activePage = targetDoc.pages?.find((p) => p.id === targetDoc.activePageId);
  const contentRootId = activePage?.contentRoot;
  if (contentRootId && targetDoc.nodes[contentRootId]) {
    const contentRoot = targetDoc.nodes[contentRootId] as ContainerNode;
    const children = contentRoot.children ?? [];
    const updatedContentRoot = {
      ...contentRoot,
      children: [...children, cloned.rootId],
    } as ContainerNode;
    return {
      rootId: cloned.rootId,
      doc: {
        ...targetDoc,
        nextId: cloned.nextId,
        rootChildren: targetDoc.rootChildren,
        nodes: {
          ...targetDoc.nodes,
          ...nodes,
          [contentRootId]: updatedContentRoot,
        },
      },
    };
  }

  return {
    rootId: cloned.rootId,
    doc: {
      ...targetDoc,
      nextId: cloned.nextId,
      rootChildren: [...targetDoc.rootChildren, cloned.rootId],
      nodes: { ...targetDoc.nodes, ...nodes },
    },
  };
}

export interface EditorContextValue {
  state: EditorState;
  /** The platform facade (Tauri/web/memory), undefined if none was provided. */
  platform: Platform | undefined;
  setTool: (t: ToolId) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  /** Zoom in 25% anchored to the viewport center. */
  zoomIn: () => void;
  /** Zoom out 20% anchored to the viewport center. */
  zoomOut: () => void;
  /** Zoom to an absolute level anchored to the viewport center. */
  zoomTo: (level: number) => void;
  /** Smoothly animate zoom to target level over duration ms. */
  smoothZoomTo: (targetZoom: number, durationMs?: number) => void;
  /** Smoothly animate pan to target position over duration ms. */
  smoothPanTo: (target: { x: number; y: number }, durationMs?: number) => void;
  /** Smoothly animate to reveal a rect (zoom-to-fit with animation). */
  smoothReveal: (
    bounds: { x: number; y: number; w: number; h: number },
    opts?: { padding?: number; durationMs?: number },
  ) => void;
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
  /** Cached world transform — uses TransformCache for O(1) repeated lookups. */
  getWorldTransform: (id: NodeId) => import('@strata/shared').Affine;
  /** Cached world bounds — uses TransformCache for O(1) repeated lookups. */
  getWorldBounds: (id: NodeId) => import('@strata/shared').Rect | null;
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
  /** P0*: distribute with a fixed gap in world units. */
  distributeWithGap: (axis: 'horizontal' | 'vertical', gap: number) => void;
  /** P0*: designate the key object for alignment (null = use collective bounds). */
  setKeyObject: (nodeId: string | null) => void;
  /** P0*: current key object ID (null when not set). */
  keyObjectId: string | null;
  /** P0*: align-to-page mode toggle. */
  alignToPage: boolean;
  /** P0*: toggle align-to-page mode. */
  setAlignToPage: (value: boolean) => void;
  /** P0*: auto-arrange selected nodes into a tidy grid layout. */
  tidySelected: (maxCols?: number) => void;
  /** P0*: OBB-aware alignment for rotated nodes (preserves visual orientation). */
  obbAlignSelected: (axis: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => void;
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
  /** Typography: Create a text chain for linked text frames. */
  createTextChain: (name: string, frameIds: NodeId[]) => void;
  /** Typography: Delete a text chain. */
  deleteTextChain: (chainId: string) => void;
  /** Typography: Append a frame to an existing text chain. */
  appendFrameToChain: (chainId: string, frameId: NodeId) => void;
  /** Typography: Remove a frame from a text chain. */
  removeFrameFromChain: (chainId: string, frameId: NodeId) => void;
  /** Undo last document mutation. */
  undo: () => void;
  /** Redo last undone mutation. */
  redo: () => void;
  /** Create a new empty document. */
  newDocument: () => void;
  /** Serialize current document to JSON string. */
  serializeDocument: () => string;
  /** Apply a pure transformation to the document (one undo step). */
  updateDoc: (fn: (doc: Document) => Document) => void;
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
  /** Sync all instances of a component with its master. */
  syncComponentInstances: (componentId: NodeId) => SyncResult;
  /** Sync a single instance from its master. */
  syncInstance: (instanceId: NodeId) => InstanceStatus;
  /** Get the sync status of an instance. */
  getInstanceStatus: (instanceId: NodeId) => InstanceStatus;
  /** Sync all component instances in the document. */
  syncAllInstances: () => SyncResult;
  /**
   * Publish the component defined by `nodeId`'s master root to a
   * throwaway library package, copied to the system clipboard as JSON.
   * No-ops (and returns false) when `nodeId` isn't a component master.
   */
  publishComponentToLibrary: (nodeId: NodeId) => boolean;
  /** Install a library from a library package into the document. */
  installLibrary: (library: import('@strata/scene').Library) => void;
  /** Uninstall a library by ID from the document. */
  uninstallLibrary: (libraryId: string) => void;
  /** Enter isolation/focus view scoped to a single container's subtree. */
  enterIsolation: (nodeId: NodeId) => void;
  /** Exit isolation/focus view, returning to the normal tree. */
  exitIsolation: () => void;
  /** Toggle the locked state of a node. */
  setNodeLocked: (id: NodeId, locked: boolean) => void;
  /** Toggle the visible state of a node. */
  setNodeVisible: (id: NodeId, visible: boolean) => void;
  /** Toggle clipContent on a frame node. */
  setNodeClipContent: (id: NodeId, clipContent: boolean) => void;
  /** Set a layer color tag on a node (or null to remove). */
  setLayerColor: (id: NodeId, color: import('@strata/scene').LayerColor) => void;
  /** Batch: lock/unlock multiple nodes in one undo step. */
  bulkSetNodeLocked: (ids: NodeId[], locked: boolean) => void;
  /** Batch: show/hide multiple nodes in one undo step. */
  bulkSetNodeVisible: (ids: NodeId[], visible: boolean) => void;
  /** Batch: set a layer color tag on multiple nodes in one undo step. */
  bulkSetLayerColor: (ids: NodeId[], color: import('@strata/scene').LayerColor) => void;
  /** Select all visible unlocked nodes with the same layerColor tag as the first selected node. */
  selectAllWithSameLayerColor: () => void;
  /** Select all nodes (including locked/hidden) with the same kind as the first selected node. */
  selectAllOfType: () => void;
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
  /** Create an adjustment layer node with optional initial adjustments and select it. */
  createAdjustmentLayer: (initialAdjustments?: import('@strata/engine').Adjustment[]) => void;
  /** Append an adjustment to an adjustment layer node. */
  addAdjustmentToLayer: (nodeId: NodeId, adjustment: import('@strata/engine').Adjustment) => void;
  /** Remove an adjustment by id from an adjustment layer node. */
  removeAdjustmentFromLayer: (nodeId: NodeId, adjustmentId: string) => void;
  /** Patch properties on an existing adjustment by id. */
  updateAdjustmentInLayer: (
    nodeId: NodeId,
    adjustmentId: string,
    patch: Partial<import('@strata/engine').Adjustment>,
  ) => void;
  /** Reorder an adjustment within the layer's adjustments array. */
  reorderAdjustmentInLayer: (nodeId: NodeId, adjustmentId: string, newIndex: number) => void;
  /** Set opacity on an adjustment layer node. */
  setAdjustmentLayerOpacity: (nodeId: NodeId, opacity: number) => void;
  /** Set blend mode on an adjustment layer node. */
  setAdjustmentLayerBlendMode: (nodeId: NodeId, blendMode: string) => void;
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
  /** Batch-import multiple nodes in a single state update (for drag-and-drop). */
  batchImportNodes: (
    items: {
      node: SceneNode;
      sourceDoc: import('@strata/scene').Document;
      position?: { x: number; y: number };
    }[],
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
  /** Set color blindness simulation view (protanopia/deuteranopia/tritanopia). */
  setColorBlindnessView: (type: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia') => void;
  /** Toggle pixel grid overlay. */
  setPixelGridEnabled: (v: boolean) => void;
  /** Toggle snap-to-grid. */
  setSnapEnabled: (v: boolean) => void;
  /** Set canvas rendering mode (full / outline / preview). */
  setCanvasMode: (mode: CanvasMode) => void;
  setCameraRotation: (radians: number) => void;
  rotateViewBy: (radians: number, screenAnchor?: { x: number; y: number }) => void;
  resetViewRotation: () => void;
  setRulerMode: (mode: import('./context/types').RulerMode) => void;
  setGridOverlayMode: (mode: import('./context/types').GridOverlayMode) => void;
  fitActivePage: () => void;
  fitActiveFrame: () => void;
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

  /** Remove background from the selected image node. */
  removeBackground: (method: import('@strata/scene').BackgroundRemovalMethod) => Promise<void>;
  /** Remove background with custom feather and decontaminate options. */
  removeBackgroundWithOptions: (
    method: import('@strata/scene').BackgroundRemovalMethod,
    feather: number,
    decontaminate: boolean,
  ) => Promise<void>;
  /** Toggle preview of original image (without background removal mask). */
  setShowOriginalBg: (nodeId: import('@strata/scene').NodeId | null) => void;
  setRefineMaskOptions: (opts: Partial<{ brushSize: number; hardness: number }>) => void;
  setTrimapEditOptions: (
    opts: Partial<{
      brushSize: number;
      hardness: number;
      penMode: import('./context/types').TrimapPenMode;
    }>,
  ) => void;
  refineHairEdges: () => Promise<void>;
  startTrimapEdit: () => void;
  applyTrimapMatting: () => Promise<void>;
  confirmSubjectPicker: (keepIds: number[]) => void;
  cancelSubjectPicker: () => void;
  getTrimapData: (nodeId: NodeId) => { data: Uint8Array; width: number; height: number } | null;
  setTrimapData: (nodeId: NodeId, data: Uint8Array, width: number, height: number) => void;

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
  /** Get interactions for a node from the document. */
  getNodeInteractions: (nodeId: NodeId) => import('@strata/scene').DocumentInteraction[];
  /** Add an interaction to a node. */
  addNodeInteraction: (
    nodeId: NodeId,
    interaction: Omit<import('@strata/scene').DocumentInteraction, 'id' | 'nodeId'>,
  ) => void;
  /** Remove an interaction by id. */
  removeNodeInteraction: (interactionId: string) => void;
  /** Update an interaction by id. */
  updateNodeInteraction: (
    interactionId: string,
    updates: Partial<Omit<import('@strata/scene').DocumentInteraction, 'id' | 'nodeId'>>,
  ) => void;
  /** Active screen transition during prototype navigation. */
  prototypeTransition: ActivePrototypeTransition | null;
  clearPrototypeTransition: () => void;
  /** Flow-view / inspector focus for a prototype interaction. */
  selectedInteractionId: string | null;
  selectPrototypeInteraction: (nodeId: NodeId, interactionId: string) => void;

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
  createTimeline: (name?: string, duration?: number) => string;
  removeTimeline: (id: string) => void;
  renameTimeline: (id: string, name: string) => void;
  removeTrack: (timelineId: string, trackId: string) => void;
  setTrackNestedTimeline: (
    timelineId: string,
    trackId: string,
    nestedTimelineId: string | null,
    startProgress?: number,
  ) => void;
  toggleTimelinePanel: () => void;
  addTimelineMarker: (timelineId: string, name: string, progress: number) => void;
  removeTimelineMarker: (timelineId: string, markerId: string) => void;
  renameTimelineMarker: (timelineId: string, markerId: string, name: string) => void;
  createMotionPresetFromTimeline: (timelineId: string, name: string) => string;
  applyMotionPreset: (presetId: string, timelineId: string) => void;
  toggleAutoKeyframe: () => void;

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
  /** Create a new variant for a component; optionally activate on an instance. */
  createVariant: (
    componentId: NodeId,
    name: string,
    propertyValues: Record<string, string | boolean | NodeId>,
    instanceId?: NodeId,
  ) => void;
  /** Set a per-instance component property override. */
  setPropertyOverride: (
    instanceId: NodeId,
    propName: string,
    value: string | boolean | NodeId,
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

  /** Set the active page by page id. */
  setActivePage: (pageId: NodeId) => void;
  /** Set the currently selected page in the editor UI (null = no pages mode). */
  setCurrentPageId: (id: string | null) => void;

  /** Get node IDs visible on the active page (page content + global children). */
  activePageNodes: () => NodeId[];

  /** Record a user action for analytics/onboarding/intelligence. */
  recordAction: (actionId: string) => void;
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
    case 'cloneStamp':
    case 'healBrush':
    case 'spotHeal':
    case 'patch':
    case 'refineMask':
    case 'trimapEdit':
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

/** Apply layout to a frame's children and return the updated doc. */
function applyFrameLayout(doc: Document, parentId: string | null | undefined): Document {
  if (!parentId) return doc;
  const parent = doc.nodes[parentId];
  if (parent?.kind !== 'frame' || !parent.layoutStyle) return doc;
  if (parent.layoutStyle.mode === 'grid') {
    return applyGridLayout(doc, parentId);
  }
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

/**
 * Compute world-space bounding box for any node type.
 * Retained as a fallback only — prefers canonical `nodeWorldBounds(doc, id)`
 * which composes the full ancestor transform chain.
 */
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

  // Scoped to the active page: an unscoped walk here would let a newly
  // drawn shape silently auto-parent into a frame that belongs to a
  // different (invisible) page, making the shape vanish from the canvas.
  const entries = walkNodes(doc, getActivePageNodes(doc));
  for (const [nid, entry] of entries) {
    const n = entry.node;
    if (n.locked || n.visible === false) continue;
    if (n.kind !== 'frame' && n.kind !== 'group') continue;
    if (n.kind === 'frame') {
      // Inverse-transform the world point into the frame's local space so
      // containment is correct for rotated/scaled frames (not just AABB).
      const frameWorld = nodeWorldTransform(doc, nid);
      const frameLocal = invertAffine(frameWorld);
      const localPt = applyAffine(frameLocal, [world.x, world.y]);
      if (localPt[0] >= 0 && localPt[0] <= n.w && localPt[1] >= 0 && localPt[1] <= n.h) {
        if (entry.depth > deepestDepth) {
          deepest = nid;
          deepestDepth = entry.depth;
        }
      }
    } else {
      // Inverse-transform the world point into group-local space and
      // check each child's local bounds (transformed by the child's own
      // transform). This avoids false positives from AABB-only checks
      // on rotated/scaled groups (matching the frame logic above).
      const groupWorld = nodeWorldTransform(doc, nid);
      const groupInv = invertAffine(groupWorld);
      const localPt = applyAffine(groupInv, [world.x, world.y]);
      const groupNode = doc.nodes[nid] as import('@strata/scene').GroupNode;
      if (!groupNode?.children) continue;
      for (const childId of groupNode.children) {
        const child = doc.nodes[childId];
        if (!child) continue;
        const childLocal = nodeLocalBounds(child);
        if (!childLocal) continue;
        // Transform child's own local bounds by its transform to get
        // bounds in group-space, then check if the local point is inside
        const childBoundsInGroup = transformRect(
          (child.transform ?? [1, 0, 0, 1, 0, 0]) as import('@strata/shared').Affine,
          childLocal,
        );
        if (rectContains(childBoundsInGroup, [localPt[0], localPt[1]])) {
          if (entry.depth > deepestDepth) {
            deepest = nid;
            deepestDepth = entry.depth;
          }
          break;
        }
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
    const json = DocumentCodec.encode(s.document);
    const filePath = await platform.saveDocumentToDisk(meta?.name ?? 'Untitled', json);
    if (filePath) {
      await recoveryRef.current?.deleteSession(s.activeId);
      const fileId = crypto.randomUUID();
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
      const decoded = DocumentCodec.decode(initialDocumentJson);
      if (decoded.ok) {
        doc = decoded.document;
        name = initialDocumentName ?? doc.name ?? 'Untitled';
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
      // Hidden by default — motion/timeline editing is an opt-in workflow the
      // user reaches via its own toggle, not something every document should
      // open into.
      timelinePanelVisible: false,
      motion: createInitialMotionState(),
      canvasMode: 'full',
      cameraRotation: 0,
      rulerMode: 'artboard' as RulerMode,
      gridOverlayMode: 'none' as GridOverlayMode,
      currentPageId: null,
      isolatedNodeId: null,
      showOriginalBgNodeId: null,
      refineMaskOptions: { brushSize: 20, hardness: 0.8 },
      trimapEditOptions: { brushSize: 20, hardness: 0.8, penMode: 'unknown' as const },
      subjectPickerSession: null,
      keyObjectId: null,
      alignToPage: false,
      colorBlindnessView: 'none',
    };
  });
  const [showExportDialog, setShowExportDialog] = useState(false);
  /** Ref keeping the latest state for async callbacks (auto-save, recovery). */
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Transform cache — invalidated whenever document reference changes. */
  const transformCacheRef = useRef<TransformCache>(createTransformCache());
  const prevDocRef = useRef(state.document);
  const spatialIndexRef = useRef<SpatialIndex | null>(null);
  if (state.document !== prevDocRef.current) {
    invalidateTransformCache(transformCacheRef.current);
    prevDocRef.current = state.document;
  }
  /** Parent index cache — rebuilt when document reference changes. */
  const parentCacheRef = useRef<ParentIndexCache | null>(null);
  parentCacheRef.current = getOrCreateParentCache(state.document, parentCacheRef.current);
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
  const smRuntimeRef = useRef<SMRuntime | null>(null);
  const prototypeSmartAnimateRef = useRef<ReturnType<typeof computeSmartAnimateTransition> | null>(
    null,
  );
  const [prototypeTransition, setPrototypeTransition] = useState<ActivePrototypeTransition | null>(
    null,
  );
  const [prototypeCurrentScreen, setPrototypeCurrentScreen] = useState('');
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);
  const motionFacadeRef = useRef<MotionFacade | null>(null);
  /** In-flight single-image background removal — aborted on selection change/unmount. */
  const bgRemovalAbortRef = useRef<AbortController | null>(null);
  const processingBgNodeRef = useRef<NodeId | null>(null);
  /** Ephemeral trimap buffers keyed by node id (not undo-able). */
  const trimapStoreRef = useRef<Map<string, { data: Uint8Array; width: number; height: number }>>(
    new Map(),
  );

  /** Abort pending background removal when the processed node is deselected. */
  useEffect(() => {
    const processingId = processingBgNodeRef.current;
    if (processingId && !state.selection.includes(processingId)) {
      bgRemovalAbortRef.current?.abort();
      bgRemovalAbortRef.current = null;
      processingBgNodeRef.current = null;
    }
  }, [state.selection]);

  /** Notify auto-save on every document mutation. */
  useEffect(() => {
    if (state.dirty && autoSaveRef.current) {
      autoSaveRef.current.notifyEdit();
    }
  }, [state.document, state.dirty]);

  /** Cleanup auto-save and background-removal worker pool on unmount. */
  useEffect(() => {
    return () => {
      bgRemovalAbortRef.current?.abort();
      bgRemovalAbortRef.current = null;
      processingBgNodeRef.current = null;
      autoSaveRef.current?.stop();
      motionFacadeRef.current?.stop();
      void import('@strata/engine').then(({ terminateWorkerPool }) => terminateWorkerPool());
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
      const newDoc = fn(s.document);
      return {
        ...s,
        document: newDoc,
        dirty: true,
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: true } : sess,
        ),
      };
    });
  }, []);

  /** Poll prototype delays and advance state machines while presenting. */
  useEffect(() => {
    if (!state.isPresenting && !state.prototypeMode) return;
    let rafId = 0;
    const tick = () => {
      const runtime = prototypeRuntimeRef.current;
      if (runtime) {
        protoProcessDelays(runtime, 16);
      }
      const sm = smRuntimeRef.current;
      if (sm) {
        const prevTimeline = getCurrentStateTimelineId(sm);
        const next = advanceSMTransition(sm, 16);
        smRuntimeRef.current = next;
        const nextTimeline = getCurrentStateTimelineId(next);
        if (nextTimeline && nextTimeline !== prevTimeline) {
          patch({
            motion: {
              ...stateRef.current.motion,
              activeTimelineId: nextTimeline,
              currentTime: 0,
            },
          });
          updateDoc((d) => setActiveTimelineDoc(d, nextTimeline));
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [state.isPresenting, state.prototypeMode, patch, updateDoc]);

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

  // Typography: Text chain operations
  const createTextChain = useCallback(
    (name: string, frameIds: NodeId[]) => {
      updateDoc((doc) => {
        const { doc: updatedDoc } = createTextChainDoc(doc, name, frameIds);
        return updatedDoc;
      });
    },
    [updateDoc],
  );

  const deleteTextChain = useCallback(
    (chainId: string) => {
      updateDoc((doc) => deleteTextChainDoc(doc, chainId));
    },
    [updateDoc],
  );

  const appendFrameToChain = useCallback(
    (chainId: string, frameId: NodeId) => {
      updateDoc((doc) => appendFrameToChainDoc(doc, chainId, frameId));
    },
    [updateDoc],
  );

  const removeFrameFromChain = useCallback(
    (chainId: string, frameId: NodeId) => {
      updateDoc((doc) => removeFrameFromChainDoc(doc, chainId, frameId));
    },
    [updateDoc],
  );

  const value = useMemo<EditorContextValue>(
    () => ({
      state,
      platform,
      updateDoc,
      setTool: (t) => {
        toolRef.current = t;
        patch({ tool: t });
      },
      setZoom: (z) => patch({ zoom: clampZoom(z) }),
      setPan: (p) => patch({ pan: p }),
      zoomIn: () => {
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        const camState = {
          zoom: state.zoom,
          pan: state.pan,
          cameraRotation: state.cameraRotation,
        };
        const centre = editorScreenToWorld(camState, vp.width / 2, vp.height / 2, vp);
        const newZoom = stepZoom(state.zoom, 'in');
        const newCam = zoomAboutPoint(toCamera(camState), centre, newZoom);
        patch({ zoom: newCam.zoom, pan: newCam.pan, cameraRotation: newCam.rotation ?? 0 });
      },
      zoomOut: () => {
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        const camState = {
          zoom: state.zoom,
          pan: state.pan,
          cameraRotation: state.cameraRotation,
        };
        const centre = editorScreenToWorld(camState, vp.width / 2, vp.height / 2, vp);
        const newZoom = stepZoom(state.zoom, 'out');
        const newCam = zoomAboutPoint(toCamera(camState), centre, newZoom);
        patch({ zoom: newCam.zoom, pan: newCam.pan, cameraRotation: newCam.rotation ?? 0 });
      },
      zoomTo: (level) => {
        const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vpH = typeof window !== 'undefined' ? window.innerHeight - 120 : 700;
        const cam = { pan: state.pan, zoom: state.zoom };
        const centre = screenToWorld(cam, vpW / 2, vpH / 2);
        const newCam = zoomAboutPoint(cam, centre, clampZoom(level));
        patch({ zoom: newCam.zoom, pan: newCam.pan });
      },
      smoothZoomTo: (targetZoom, durationMs = 200) => {
        const startCam = { pan: stateRef.current.pan, zoom: stateRef.current.zoom };
        const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vpH = typeof window !== 'undefined' ? window.innerHeight - 120 : 700;
        const centre = screenToWorld(startCam, vpW / 2, vpH / 2);
        const endCam = zoomAboutPoint(startCam, centre, clampZoom(targetZoom));
        const startTime = performance.now();
        requestAnimationFrame(function tick(now: number) {
          const elapsed = now - startTime;
          const { camera, done } = animateCamera(startCam, endCam, elapsed, durationMs);
          patch({ zoom: camera.zoom, pan: camera.pan });
          if (!done) requestAnimationFrame(tick);
        });
      },
      smoothPanTo: (target, durationMs = 150) => {
        const startCam = { pan: stateRef.current.pan, zoom: stateRef.current.zoom };
        const endCam = { pan: target, zoom: startCam.zoom };
        const startTime = performance.now();
        requestAnimationFrame(function tick(now: number) {
          const elapsed = now - startTime;
          const { camera, done } = animateCamera(startCam, endCam, elapsed, durationMs);
          patch({ zoom: camera.zoom, pan: camera.pan });
          if (!done) requestAnimationFrame(tick);
        });
      },
      smoothReveal: (bounds, opts) => {
        const startCam = { pan: stateRef.current.pan, zoom: stateRef.current.zoom };
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        const endCam = fitBoundsCamera(bounds, vp, opts?.padding ?? 40);
        const durationMs = opts?.durationMs ?? 250;
        const startTime = performance.now();
        requestAnimationFrame(function tick(now: number) {
          const elapsed = now - startTime;
          const { camera, done } = animateCamera(startCam, endCam, elapsed, durationMs);
          patch({ zoom: camera.zoom, pan: camera.pan });
          if (!done) requestAnimationFrame(tick);
        });
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
          patch({ zoom: cam.zoom, pan: cam.pan });
        }
      },
      revealSelection: (opts) => {
        const id = opts?.nodeId ?? state.selection[0];
        if (!id) return;
        // Prefer caller-supplied viewport, then the actual canvas container element
        // (accurate when panels are open), then fall back to window minus chrome.
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const viewportEst: Viewport =
          opts?.viewport ??
          (canvasEl
            ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
            : { width: window.innerWidth, height: window.innerHeight - 120 });
        const bounds = nodeWorldBounds(state.document, id);
        if (!bounds) return;
        const padding = opts?.padding ?? 40;
        if (opts?.fit) {
          const cam = fitBoundsCamera(bounds, viewportEst, padding);
          patch({ zoom: cam.zoom, pan: cam.pan });
        } else {
          const current: import('@strata/shared').Camera = {
            pan: state.pan,
            zoom: state.zoom,
          };
          const cam = revealBoundsCamera(current, viewportEst, bounds, padding);
          if (cam.pan.x !== state.pan.x || cam.pan.y !== state.pan.y) {
            patch({ pan: cam.pan, zoom: cam.zoom });
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
        const ids = findSameKindIds(state.document, state.selection);
        if (ids.length > 0) {
          const kind = state.document.nodes[ids[0]!]?.kind;
          patch({ selection: ids });
          announcerRef.current?.announce(`Selected ${ids.length} ${kind} nodes`);
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
            // No containing frame: add to the current page's content root so
            // the node is scoped to the active page, not global rootChildren.
            const activePage = d2.pages?.find((p) => p.id === d2.activePageId);
            const contentRootId = activePage?.contentRoot;
            if (contentRootId && d2.nodes[contentRootId]) {
              newDoc = addChild(d2, contentRootId, node);
            } else {
              newDoc = addNode(d2, node);
            }
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
            // Convert world→local: the node's transform must be in the
            // parent's coordinate space so that composing parent · child
            // yields the original world position. Without this, a text node
            // placed inside a translated frame jumps by the frame's offset.
            const pWorld = nodeWorldTransform(d2, effectiveParentId);
            const pInv = invertAffine(pWorld);
            const localPos = applyAffine(pInv, [world.x, world.y]);
            const localTransform: Affine = [1, 0, 0, 1, localPos[0], localPos[1]];
            const localNode = { ...node, transform: localTransform } as SceneNode;
            newDoc = addChild(d2, effectiveParentId, localNode);
            newDoc = applyFrameLayout(newDoc, effectiveParentId);
          } else {
            // No containing frame: add to the current page's content root so
            // the node is scoped to the active page, not global rootChildren.
            const activePage = d2.pages?.find((p) => p.id === d2.activePageId);
            const contentRootId = activePage?.contentRoot;
            if (contentRootId && d2.nodes[contentRootId]) {
              newDoc = addChild(d2, contentRootId, node);
            } else {
              newDoc = addNode(d2, node);
            }
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
          const cam = { pan: s.pan, zoom: s.zoom };
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
      getWorldTransform: (id) =>
        getCachedWorldTransform(transformCacheRef.current, state.document, id),
      getWorldBounds: (id) => getCachedWorldBounds(transformCacheRef.current, state.document, id),

      canvasToWorld: (cx, cy) => {
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: 1920, height: 1080 };
        const [wx, wy] = editorScreenToWorld(
          { zoom: state.zoom, pan: state.pan, cameraRotation: state.cameraRotation },
          cx,
          cy,
          vp,
        );
        return { x: wx, y: wy };
      },

      worldToCanvas: (wx, wy) => {
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: 1920, height: 1080 };
        const [sx, sy] = editorWorldToScreen(
          { zoom: state.zoom, pan: state.pan, cameraRotation: state.cameraRotation },
          wx,
          wy,
          vp,
        );
        return { x: sx, y: sy };
      },

      canvasDeltaToWorld: (dx, dy) => {
        const [wdx, wdy] = screenDeltaToWorld(
          toCamera({
            zoom: state.zoom,
            pan: state.pan,
            cameraRotation: state.cameraRotation,
          }),
          dx,
          dy,
        );
        return { dx: wdx, dy: wdy };
      },

      hitTestNode: (world) => {
        // Get or build spatial index for O(1) candidate lookup.
        const spatialIndex = getOrCreateSpatialIndex(state.document, spatialIndexRef.current);
        spatialIndexRef.current = spatialIndex;
        const candidates = queryPoint(spatialIndex, world.x, world.y);

        // Walk the active page's nodes in paint order (DFS) and reverse so
        // that children are tested before parents and later siblings before
        // earlier ones — the correct topmost-first hit order. Scoped to the
        // active page so a click can't hit a node on a different page that
        // happens to occupy the same on-screen coordinates.
        const entries = walkNodes(state.document, getActivePageNodes(state.document));
        const ordered = [...entries.values()].reverse();
        for (const entry of ordered) {
          const n = entry.node;
          if (n.locked || !n.visible) continue;
          // Only test nodes that overlap the query point's cell.
          if (!candidates.has(entry.nodeId)) continue;
          if (n.kind === 'shape') {
            const worldMat = nodeWorldTransform(state.document, entry.nodeId);
            const wInv = invertAffine(worldMat);
            const local = applyAffine(wInv, [world.x, world.y]);
            if (shapeContains(n.shape, local)) {
              return { nodeId: entry.nodeId, node: n };
            }
          }
          if (n.kind === 'text' || n.kind === 'frame') {
            const bbox = nodeWorldBounds(state.document, entry.nodeId);
            if (bbox && rectContains(bbox, [world.x, world.y])) {
              return { nodeId: entry.nodeId, node: n };
            }
          }
          if (n.kind === 'group') {
            // Groups use precise child geometry rather than AABB, avoiding
            // false positives on empty corners of the group's bounding box.
            // Iterate children and check each one's world bounds; if any
            // child's geometry contains the point, the group counts as "hit".
            // This also means clicking in gaps between children does NOT
            // select the group — matching Figma/Sketch behavior.
            const groupNode = n as import('@strata/scene').GroupNode;
            if (groupNode.children) {
              for (const childId of groupNode.children) {
                const child = state.document.nodes[childId];
                if (!child || child.locked || child.visible === false) continue;
                if (child.kind === 'shape') {
                  const childWorld = nodeWorldTransform(state.document, childId);
                  const childInv = invertAffine(childWorld);
                  const childLocal = applyAffine(childInv, [world.x, world.y]);
                  if (
                    shapeContains((child as import('@strata/scene').ShapeNode).shape, childLocal)
                  ) {
                    return { nodeId: entry.nodeId, node: n };
                  }
                } else {
                  const childBounds = nodeWorldBounds(state.document, childId);
                  if (childBounds && rectContains(childBounds, [world.x, world.y])) {
                    return { nodeId: entry.nodeId, node: n };
                  }
                }
              }
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
            .map((id) => getParentFast(state.document, id, parentCacheRef.current))
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

        /**
         * Deep clone a node and all its container descendants.
         * @returns [newId, updatedDoc, oldId -> newId map for the cloned tree]
         */
        function cloneNodeDeep(
          nodeId: string,
          doc: Document,
        ): [string, Document, Record<string, string>] {
          const node = doc.nodes[nodeId];
          if (!node) return [nodeId, doc, {}];

          const { id: newId, doc: d1 } = nextNodeId(doc);
          let d = d1;
          let idMap: Record<string, string> = { [nodeId]: newId };

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

          // If container with children, recursively deep-clone all descendants
          if (isContainer(node)) {
            const newChildIds: string[] = [];
            for (const childId of node.children) {
              const [newChildId, d2, childMap] = cloneNodeDeep(childId, d);
              d = d2;
              newChildIds.push(newChildId);
              idMap = { ...idMap, ...childMap };
            }
            (cloned as import('@strata/scene').ContainerNode).children = newChildIds;
          }

          d = { ...d, nodes: { ...d.nodes, [newId]: cloned } };
          return [newId, d, idMap];
        }

        setState((s) => {
          // Push undo snapshot only when not inside a transaction.
          // When inside a transaction (e.g. alt-drag), the transaction handles
          // undo on commitTransaction. Pushing here would inject a spurious
          // undo entry mid-transaction (Fix C1).
          if (!inTransactionRef.current) {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
            redoStackRef.current = [];
            redoSelStackRef.current = [];
          }

          let d = s.document;
          const newIds: string[] = [];
          for (const id of sel) {
            const [newId, d2] = cloneNodeDeep(id, d);
            d = d2;

            // Add to same parent. For paged docs, "root" (parentId === null)
            // means the node sits under the active page's contentRoot — not
            // doc.rootChildren, which holds page group IDs.
            const parentId = getParentFast(s.document, id, parentCacheRef.current);
            if (parentId === null) {
              const activePage = d.pages?.find((p) => p.id === d.activePageId);
              const contentRootId = activePage?.contentRoot;
              if (contentRootId && d.nodes[contentRootId]) {
                const cr = d.nodes[contentRootId] as ContainerNode;
                const crChildren = cr.children ?? [];
                d = {
                  ...d,
                  nodes: {
                    ...d.nodes,
                    [contentRootId]: { ...cr, children: [...crChildren, newId] } as SceneNode,
                  },
                };
              } else {
                d = { ...d, rootChildren: [...d.rootChildren, newId] };
              }
            } else {
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
            n.transform?.[0] ?? 1,
            n.transform?.[1] ?? 0,
            n.transform?.[2] ?? 0,
            n.transform?.[3] ?? 1,
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
              // Circle must stay circular: use max dimension so it doesn't warp
              return { ...n, shape: { ...s, r: Math.max(w, h) / 2, cx: w / 2, cy: h / 2 } };
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
        const sel = stateRef.current.selection;
        if (sel.length === 0) return;
        const motion = stateRef.current.motion;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            nodes[id] = { ...node, opacity: value };
          }
          let d = { ...doc, nodes };
          if (motion.autoKeyframe && motion.isPlaying && motion.activeTimelineId) {
            d = applyAutoKeyframes(
              d,
              {
                autoKeyframe: motion.autoKeyframe,
                isPlaying: motion.isPlaying,
                activeTimelineId: motion.activeTimelineId,
                currentTime: motion.currentTime,
                selection: sel,
              },
              'opacity',
            );
          }
          return d;
        });
        if (motion.autoKeyframe && motion.isPlaying) {
          invalidateSamplerCache();
        }
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

      // F6: align selected nodes — uses shared align module for pure bbox math
      alignSelected: (axis) => {
        const sel = state.selection;
        if (sel.length < 2) return;
        const doc = state.document;
        const items = getValidItemsWithBounds(sel, doc);
        if (items.length < 2) return;

        // Determine target: key object → align-to-page → collective bounds
        let target = computeKeyObjectTarget(doc, state.keyObjectId, sel);
        if (!target && state.alignToPage) {
          const typedDoc = doc as Document & { canvasWidth?: number; canvasHeight?: number };
          const pw = typedDoc.canvasWidth ?? 1920;
          const ph = typedDoc.canvasHeight ?? 1080;
          target = { left: 0, right: pw, top: 0, bottom: ph, centerX: pw / 2, centerY: ph / 2 };
        }
        if (!target) {
          const u = computeAlignmentTarget(
            axis,
            items.map((i) => i.bounds),
          );
          if (!u) return;
          target = u;
        }

        updateDoc((newDoc) => {
          const nodes = { ...newDoc.nodes };
          for (const { id, node, bounds: b } of items) {
            if (!nodes[id]) continue;
            const { x: targetWorldX, y: targetWorldY } = alignBBox(b, axis, target!);
            const newLocal = worldToLocalOrigin(
              doc,
              id,
              targetWorldX,
              targetWorldY,
              b,
              parentCacheRef.current,
            );
            nodes[id] = {
              ...node,
              transform: [
                node.transform[0],
                node.transform[1],
                node.transform[2],
                node.transform[3],
                newLocal[0],
                newLocal[1],
              ] as Affine,
            } as SceneNode;
          }
          return { ...newDoc, nodes };
        });
      },

      // F6: distribute selected nodes — uses shared computeDistribution for pure math
      distributeSelected: (axis) => {
        const sel = state.selection;
        if (sel.length < 3) return;
        const doc = state.document;
        const items = getValidItemsWithBounds(sel, doc);
        if (items.length < 3) return;

        const sorted = [...items].sort((a, b) => {
          return (
            (axis === 'horizontal' ? a.bounds.x : a.bounds.y) -
            (axis === 'horizontal' ? b.bounds.x : b.bounds.y)
          );
        });

        const positions = computeDistribution(
          axis,
          sorted.map((i) => i.bounds),
        );
        if (!positions) return;

        updateDoc((newDoc) => {
          const nodes = { ...newDoc.nodes };
          for (let i = 0; i < sorted.length; i++) {
            const { id, node, bounds: b } = sorted[i]!;
            if (!nodes[id]) continue;
            const pos = distributeToPosition(
              positions[i]!,
              i,
              b,
              axis,
              sorted.map((s) => s.bounds),
            );
            const targetWorldX = pos.x;
            const targetWorldY = pos.y;
            const wm = nodeWorldTransform(doc, id);
            const bOffX = b.x - wm[4];
            const bOffY = b.y - wm[5];
            const nodeOriginWorldX = targetWorldX - bOffX;
            const nodeOriginWorldY = targetWorldY - bOffY;
            const parentId = getParentFast(doc, id, parentCacheRef.current);
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

      // P0*: distribute with a fixed gap between adjacent edges
      distributeWithGap: (axis, gap) => {
        const sel = state.selection;
        if (sel.length < 3) return;
        const doc = state.document;
        const items = getValidItemsWithBounds(sel, doc);
        if (items.length < 3) return;

        const sorted = [...items].sort((a, b) => {
          return (
            (axis === 'horizontal' ? a.bounds.x : a.bounds.y) -
            (axis === 'horizontal' ? b.bounds.x : b.bounds.y)
          );
        });

        const positions = computeDistribution(
          axis,
          sorted.map((i) => i.bounds),
          gap,
        );
        if (!positions) return;

        updateDoc((newDoc) => {
          const nodes = { ...newDoc.nodes };
          for (let i = 0; i < sorted.length; i++) {
            const { id, node, bounds: b } = sorted[i]!;
            if (!nodes[id]) continue;
            const pos = distributeToPosition(
              positions[i]!,
              i,
              b,
              axis,
              sorted.map((s) => s.bounds),
            );
            const targetWorldX = pos.x;
            const targetWorldY = pos.y;
            const wm = nodeWorldTransform(doc, id);
            const bOffX = b.x - wm[4];
            const bOffY = b.y - wm[5];
            const nodeOriginWorldX = targetWorldX - bOffX;
            const nodeOriginWorldY = targetWorldY - bOffY;
            const parentId = getParentFast(doc, id, parentCacheRef.current);
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

      // P0*: set the key object ID (null = use collective bounds)
      setKeyObject: (nodeId) => {
        setState((s) => ({ ...s, keyObjectId: nodeId }));
      },

      // P0*: toggle align-to-page mode
      setAlignToPage: (value) => {
        setState((s) => ({ ...s, alignToPage: value }));
      },

      // P0*: OBB-aware alignment for rotated nodes
      obbAlignSelected: (axis) => {
        const sel = state.selection;
        if (sel.length < 2) return;
        const doc = state.document;

        const items: Array<{ id: NodeId; node: SceneNode; obb: OBB }> = [];
        for (const id of sel) {
          const node = doc.nodes[id];
          if (!node) continue;
          const lb = nodeLocalBounds(node);
          if (!lb) continue;
          const wm = nodeWorldTransform(doc, id);
          const obb = orientedBBox(wm, lb.w, lb.h);
          items.push({ id, node, obb });
        }
        if (items.length < 2) return;

        const targetPos = obbAlignmentTarget(
          axis,
          items.map((i) => i.obb),
        );
        if (targetPos === null) return;

        updateDoc((newDoc) => {
          const nodes = { ...newDoc.nodes };
          for (const { id, node, obb } of items) {
            if (!nodes[id]) continue;
            const corners = [obb[0], obb[1], obb[2], obb[3]];
            let deltaX = 0;
            let deltaY = 0;
            switch (axis) {
              case 'left': {
                const leftX = Math.min(...corners.map((c) => c[0]));
                deltaX = targetPos - leftX;
                break;
              }
              case 'centerH': {
                const cx = corners.reduce((s, c) => s + c[0], 0) / 4;
                deltaX = targetPos - cx;
                break;
              }
              case 'right': {
                const rightX = Math.max(...corners.map((c) => c[0]));
                deltaX = targetPos - rightX;
                break;
              }
              case 'top': {
                const topY = Math.min(...corners.map((c) => c[1]));
                deltaY = targetPos - topY;
                break;
              }
              case 'centerV': {
                const cy = corners.reduce((s, c) => s + c[1], 0) / 4;
                deltaY = targetPos - cy;
                break;
              }
              case 'bottom': {
                const bottomY = Math.max(...corners.map((c) => c[1]));
                deltaY = targetPos - bottomY;
                break;
              }
            }
            const wm = nodeWorldTransform(doc, id);
            const nodeOriginWorldX = wm[4] + deltaX;
            const nodeOriginWorldY = wm[5] + deltaY;
            const parentId = getParentFast(doc, id, parentCacheRef.current);
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

      // P0*: auto-arrange selected nodes into a tidy grid layout
      tidySelected: (maxCols) => {
        const sel = state.selection;
        if (sel.length < 2) return;
        const doc = state.document;
        const items = getValidItemsWithBounds(sel, doc);
        if (items.length < 2) return;

        const layout = computeTidyLayout(
          items.map((i) => i.bounds),
          maxCols ?? 4,
        );
        if (layout.assignments.length === 0) return;

        updateDoc((newDoc) => {
          const nodes = { ...newDoc.nodes };
          for (let i = 0; i < items.length; i++) {
            const { id, node, bounds: b } = items[i]!;
            if (!nodes[id]) continue;
            const asgn = layout.assignments[i];
            if (!asgn) continue;
            const [row, col] = asgn;
            const targetWorldX = col * layout.colWidth;
            const targetWorldY = row * layout.rowHeight;
            const wm = nodeWorldTransform(doc, id);
            const bOffX = b.x - wm[4];
            const bOffY = b.y - wm[5];
            const nodeOriginWorldX = targetWorldX - bOffX;
            const nodeOriginWorldY = targetWorldY - bOffY;
            const parentId = getParentFast(doc, id, parentCacheRef.current);
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
        // Snapshot current session before replacing document
        const sid = state.activeId;
        if (sid) {
          sessionStoreRef.current.set(sid, {
            document: state.document,
            selection: state.selection,
            viewport: { zoom: state.zoom, pan: state.pan },
            undo: [...undoStackRef.current],
            redo: [...redoStackRef.current],
            undoSel: [...undoSelStackRef.current],
            redoSel: [...redoSelStackRef.current],
          });
        }
        undoStackRef.current = [];
        redoStackRef.current = [];
        undoSelStackRef.current = [];
        redoSelStackRef.current = [];
        patch({ document: createDocument('Untitled', true), selection: [] });
      },

      serializeDocument: () => {
        return DocumentCodec.encode(state.document);
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
          const json = DocumentCodec.encode(s.document);
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
      keyObjectId: state.keyObjectId,
      alignToPage: state.alignToPage,

      loadDocument: (json, meta) => {
        try {
          const decoded = DocumentCodec.decode(json);
          if (!decoded.ok) throw new Error(decoded.error);
          const doc = decoded.document;
          const result = validateDocument(doc);
          if (!result.valid) {
            if (typeof console !== 'undefined') {
              console.warn('[Strata] loadDocument: validation warnings:', result.errors);
            }
          }
          undoStackRef.current = [];
          redoStackRef.current = [];
          undoSelStackRef.current = [];
          redoSelStackRef.current = [];
          const name = meta?.name ?? doc.name;
          const filePath = meta?.filePath;
          const sessions = state.sessions.map((s) =>
            s.id === state.activeId ? { ...s, name, filePath, dirty: false } : s,
          );
          patch({
            document: doc,
            selection: [],
            sessions,
            dirty: false,
          });
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

      syncComponentInstances: (componentId) => {
        let result: SyncResult = { updatedInstances: [], preservedOverrides: 0 };
        updateDoc((doc) => {
          const r = pushMasterChangesDoc(doc, componentId);
          result = r.result;
          return r.doc;
        });
        return result;
      },

      syncInstance: (instanceId) => {
        let status: InstanceStatus = 'broken';
        updateDoc((doc) => {
          const r = syncInstanceDoc(doc, instanceId);
          status = r.status;
          return r.doc;
        });
        return status;
      },

      getInstanceStatus: (instanceId) => {
        return getInstanceStatusDoc(state.document, instanceId);
      },

      syncAllInstances: () => {
        let result: SyncResult = { updatedInstances: [], preservedOverrides: 0 };
        updateDoc((doc) => {
          const r = syncAllInstancesDoc(doc);
          result = r.result;
          return r.doc;
        });
        return result;
      },

      publishComponentToLibrary: (nodeId) => {
        const result = buildComponentLibraryPackage(state.document, nodeId);
        if (!result) return false;
        const json = JSON.stringify(result.pkg, null, 2);
        const componentName = result.component.name;
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          navigator.clipboard
            .writeText(json)
            .then(() => {
              announcerRef.current?.announce(
                `Published "${componentName}" to library — package copied to clipboard`,
              );
            })
            .catch(() => {
              announcerRef.current?.announce(
                `Published "${componentName}" to library, but copying to clipboard failed`,
              );
            });
        } else {
          announcerRef.current?.announce(
            `Published "${componentName}" to library, but the clipboard isn't available`,
          );
        }
        return true;
      },

      installLibrary: (library) => {
        updateDoc((doc) => {
          const result = installLibraryDoc(doc, library);
          announcerRef.current?.announce(`Installed library "${library.name}"`);
          return result.doc;
        });
      },

      uninstallLibrary: (libraryId) => {
        updateDoc((doc) => {
          const installedLibraries = (doc.installedLibraries ?? []).filter(
            (l) => l.id !== libraryId,
          );
          announcerRef.current?.announce(`Uninstalled library`);
          return { ...doc, installedLibraries };
        });
      },

      enterIsolation: (nodeId) => {
        patch({ isolatedNodeId: nodeId });
      },

      exitIsolation: () => {
        patch({ isolatedNodeId: null });
      },

      setVariantForInstance: (instanceId, variantId) => {
        updateDoc((doc) => setVariantForInstanceDoc(doc, instanceId, variantId));
      },

      createVariant: (componentId, name, propertyValues, instanceId) => {
        updateDoc((doc) => {
          const { doc: newDoc, variant } = createVariantDoc(doc, componentId, name, propertyValues);
          return instanceId ? setVariantForInstanceDoc(newDoc, instanceId, variant.id) : newDoc;
        });
      },

      setPropertyOverride: (instanceId, propName, value) => {
        updateDoc((doc) => setPropertyOverrideDoc(doc, instanceId, propName, value));
      },

      addComponentProperty: (componentId, prop) => {
        updateDoc((doc) => {
          const { doc: newDoc } = addComponentPropertyDoc(doc, componentId, prop);
          return newDoc;
        });
      },

      resolveVariantPropertiesForNode: (nodeId) =>
        resolveVariantPropertiesForNodeDoc(state.document, nodeId),

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

      setActivePage: (pageId) => {
        updateDoc((doc) => ({ ...doc, activePageId: pageId }));
      },
      setCurrentPageId: (id) => {
        patch({ currentPageId: id });
      },

      activePageNodes: () => {
        return getActivePageNodes(state.document);
      },

      recordAction: (actionId: string) => {
        getActionTracker().record(actionId);
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

      setLayerColor: (id, color) => {
        updateNodeProp(id, (n) => ({ ...n, layerColor: color }));
      },

      bulkSetNodeLocked: (ids, locked) => {
        updateDoc((doc) => bulkSetNodeLockedDoc(doc, ids, locked));
      },

      bulkSetNodeVisible: (ids, visible) => {
        updateDoc((doc) => bulkSetNodeVisibleDoc(doc, ids, visible));
      },

      bulkSetLayerColor: (ids, color) => {
        updateDoc((doc) => bulkSetLayerColorDoc(doc, ids, color));
      },

      selectAllWithSameLayerColor: () => {
        const ids = findSameLayerColorIds(state.document, state.selection);
        if (ids.length > 0) {
          patch({ selection: ids });
          announcerRef.current?.announce(`Selected ${ids.length} nodes with color tag`);
        }
      },

      selectAllOfType: () => {
        const ids = findAllOfKindIds(state.document, state.selection);
        if (ids.length > 0) {
          const kind = state.document.nodes[ids[0]!]?.kind;
          patch({ selection: ids });
          announcerRef.current?.announce(`Selected ${ids.length} ${kind} nodes`);
        }
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
          const oldParentId = getParentFast(doc, id, parentCacheRef.current);
          const oldWorld = nodeWorldTransform(doc, id);
          // A null newParentId means "move to the active page's top level."
          // doc.rootChildren holds each page's contentRoot group id, not page
          // content, so splicing directly into it (like createShapeAt used to)
          // orphans the node from activePageNodes and makes it vanish from the
          // canvas while still showing in the Layers panel. Resolve to the
          // active page's contentRoot instead, mirroring createShapeAt.
          const activePage = doc.pages?.find((p) => p.id === doc.activePageId);
          const contentRootId = activePage?.contentRoot;
          const effectiveParentId =
            newParentId ?? (contentRootId && doc.nodes[contentRootId] ? contentRootId : null);
          let newDoc: Document;
          if (effectiveParentId) {
            // Convert old world pos → new parent's local space.
            const pWorld = nodeWorldTransform(doc, effectiveParentId);
            const pInv = invertAffine(pWorld);
            const newLocal = multiplyAffine(pInv, oldWorld);
            newDoc = reparentNodeDoc(doc, id, effectiveParentId, toIndex, newLocal);
          } else {
            // Move to root: local = world (root has identity transform).
            newDoc = reparentNodeDoc(doc, id, null, toIndex, oldWorld);
          }
          if (oldParentId) newDoc = applyFrameLayout(newDoc, oldParentId);
          if (effectiveParentId) newDoc = applyFrameLayout(newDoc, effectiveParentId);
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

      createAdjustmentLayer: (initialAdjustments) => {
        undoStackRef.current = [...undoStackRef.current.slice(-50), state.document];
        redoStackRef.current = [];
        const { id, doc: newDoc } = nextNodeId(state.document);
        const adjs = initialAdjustments ?? [];
        const node = makeAdjustmentNode(
          id,
          'levels',
          {
            channel: 'rgb' as const,
            inputBlack: 0,
            inputWhite: 255,
            gamma: 1,
            outputBlack: 0,
            outputWhite: 255,
          },
          {
            name: `Adjustment ${id.slice(0, 4)}`,
            opacity: 1,
            blendMode: 'normal',
            effects: [],
          },
        );
        const withAdjustments = { ...node, adjustments: adjs };
        const doc = addNode(newDoc, withAdjustments as import('@strata/scene').SceneNode);
        patch({ document: doc, selection: [id] });
        announcerRef.current?.announce('Created adjustment layer');
      },

      addAdjustmentToLayer: (nodeId, adjustment) => {
        updateNodeProp(nodeId, (n) => {
          if (n.kind !== 'adjustment') return n;
          const existing = (n as AdjustmentNode).adjustments ?? [];
          return { ...n, adjustments: [...existing, adjustment] } as SceneNode;
        });
      },

      removeAdjustmentFromLayer: (nodeId, adjustmentId) => {
        updateNodeProp(nodeId, (n) => {
          if (n.kind !== 'adjustment') return n;
          const existing = (n as AdjustmentNode).adjustments ?? [];
          return {
            ...n,
            adjustments: existing.filter((a: Adjustment) => a.id !== adjustmentId),
          } as SceneNode;
        });
      },

      updateAdjustmentInLayer: (nodeId, adjustmentId, patch) => {
        updateNodeProp(nodeId, (n) => {
          if (n.kind !== 'adjustment') return n;
          const existing = (n as AdjustmentNode).adjustments ?? [];
          return {
            ...n,
            adjustments: existing.map((a: Adjustment) =>
              a.id === adjustmentId ? ({ ...a, ...patch } as Adjustment) : a,
            ),
          } as SceneNode;
        });
      },

      reorderAdjustmentInLayer: (nodeId, adjustmentId, newIndex) => {
        updateNodeProp(nodeId, (n) => {
          if (n.kind !== 'adjustment') return n;
          const existing = [...((n as AdjustmentNode).adjustments ?? [])];
          const idx = existing.findIndex((a: Adjustment) => a.id === adjustmentId);
          if (idx < 0) return n;
          const [item] = existing.splice(idx, 1);
          if (!item) return n;
          existing.splice(Math.max(0, Math.min(newIndex, existing.length)), 0, item);
          return { ...n, adjustments: existing } as SceneNode;
        });
      },

      setAdjustmentLayerOpacity: (nodeId, opacity) => {
        updateNodeProp(nodeId, (n) => ({ ...n, opacity }) as SceneNode);
      },

      setAdjustmentLayerBlendMode: (nodeId, blendMode) => {
        updateNodeProp(nodeId, (n) => ({ ...n, blendMode }) as SceneNode);
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

      paste: async () => {
        // Single clipboard read — uses DOM ClipboardEvent when available
        // (cross-platform, no Wayland permission issues), falls back to
        // navigator.clipboard.read() for menu-triggered pastes.
        const unified = await readClipboardUnifiedWithFallback();
        const strataData = unified.strataData;

        const importInputs = unified.importItems.map((item): ImportFileInput => {
          if (typeof item.data === 'string') {
            return {
              name: item.name,
              source: 'clipboard',
              size: new TextEncoder().encode(item.data).byteLength,
              text: item.data,
            };
          }
          return {
            name: item.name,
            source: 'clipboard',
            size: item.data.byteLength,
            bytes: item.data,
          };
        });
        const importReport =
          importInputs.length > 0
            ? await ImportService.importFiles(importInputs, {
                center: true,
                embedImages: true,
              })
            : null;
        const importResults =
          importReport?.files.flatMap((fileReport) =>
            fileReport.artifacts.map((artifact) => ({
              nodeIds: artifact.nodeIds as NodeId[],
              document: artifact.document,
            })),
          ) ?? [];

        if (!strataData && importResults.length === 0) return;

        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];
          let doc = s.document;
          const newIds: NodeId[] = [];

          if (strataData) {
            const tempNodes: Record<string, SceneNode> = {};
            for (const node of strataData.nodes) {
              tempNodes[node.id] = node;
            }
            const tempDoc: Document = { ...doc, nodes: tempNodes };
            for (const node of strataData.nodes) {
              if (isContainer(node)) {
                const result = deepCloneSubtree(tempDoc, node.id);
                if (result.rootId) {
                  doc = { ...doc, nextId: result.nextId };
                  for (const cloned of Object.values(result.nodes)) {
                    doc = addNode(doc, cloned);
                    newIds.push(cloned.id);
                  }
                }
              } else {
                const { id, doc: d2 } = nextNodeId(doc);
                doc = d2;
                const cloned = { ...node, id } as SceneNode;
                doc = addNode(doc, cloned);
                newIds.push(id);
              }
            }
          }

          for (const result of importResults) {
            for (const id of result.nodeIds) {
              const inserted = insertImportedSubtree(doc, result.document, id, (node) => node);
              if (!inserted) continue;
              doc = inserted.doc;
              newIds.push(inserted.rootId);
            }
          }

          if (newIds.length === 0) return s;
          return { ...s, document: doc, selection: newIds };
        });

        const totalCount = (strataData?.nodes.length ?? 0) + importResults.length;
        if (totalCount > 0) {
          const failed = importReport?.failureCount ?? 0;
          announcerRef.current?.announce(
            `Pasted ${totalCount} layer${totalCount > 1 ? 's' : ''}${failed > 0 ? `; ${failed} failed` : ''}`,
          );
        }
      },

      importNode: (node, sourceDoc, options) => {
        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];
          const inserted = insertImportedSubtree(s.document, sourceDoc, node.id, (clonedRoot) => {
            if (options?.position) {
              return applyDropPosition(clonedRoot, options.position);
            }
            return (() => {
              const centerX = (s.pan.x + (sourceDoc.canvasWidth ?? 800) / 2) / s.zoom;
              const centerY = (s.pan.y + (sourceDoc.canvasHeight ?? 600) / 2) / s.zoom;
              const offsetX = centerX - ((node.transform[4] ?? 0) + 50);
              const offsetY = centerY - ((node.transform[5] ?? 0) + 50);
              return {
                ...clonedRoot,
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
          });
          if (!inserted) return s;
          return { ...s, document: inserted.doc, selection: [inserted.rootId] };
        });
        announcerRef.current?.announce('Imported layer');
      },

      batchImportNodes: (items) => {
        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];
          let doc = s.document;
          const newIds: NodeId[] = [];
          for (const { node, sourceDoc, position } of items) {
            const inserted = insertImportedSubtree(doc, sourceDoc, node.id, (clonedRoot) => {
              if (position) {
                return applyDropPosition(clonedRoot, position);
              }
              return (() => {
                const centerX = (s.pan.x + (sourceDoc.canvasWidth ?? 800) / 2) / s.zoom;
                const centerY = (s.pan.y + (sourceDoc.canvasHeight ?? 600) / 2) / s.zoom;
                const offsetX = centerX - ((node.transform[4] ?? 0) + 50);
                const offsetY = centerY - ((node.transform[5] ?? 0) + 50);
                return {
                  ...clonedRoot,
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
            });
            if (!inserted) continue;
            doc = inserted.doc;
            newIds.push(inserted.rootId);
          }
          return { ...s, document: doc, selection: newIds };
        });
        announcerRef.current?.announce(
          `Imported ${items.length} layer${items.length > 1 ? 's' : ''}`,
        );
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
      setCanvasMode: (mode) => patch({ canvasMode: mode }),
      setCameraRotation: (radians) => patch({ cameraRotation: radians }),
      rotateViewBy: (radians, screenAnchor) => {
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        const anchor = screenAnchor ?? { x: vp.width / 2, y: vp.height / 2 };
        const next = rotateViewAtScreen(
          { zoom: state.zoom, pan: state.pan, cameraRotation: state.cameraRotation },
          [anchor.x, anchor.y],
          radians,
          vp,
        );
        patch(next);
      },
      resetViewRotation: () => {
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        patch(
          resetViewRotationState(
            { zoom: state.zoom, pan: state.pan, cameraRotation: state.cameraRotation },
            vp,
          ),
        );
      },
      setRulerMode: (mode) => patch({ rulerMode: mode }),
      setGridOverlayMode: (mode) => patch({ gridOverlayMode: mode }),
      fitActivePage: () => {
        const doc = state.document;
        const pageId = doc.activePageId;
        const page = doc.pages?.find((p) => p.id === pageId);
        if (!page) return;
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        patch(fitBoundsToState({ x: 0, y: 0, w: page.width, h: page.height }, vp));
      },
      fitActiveFrame: () => {
        const sel = state.selection[0];
        if (!sel) return;
        const node = state.document.nodes[sel];
        if (node?.kind !== 'frame') return;
        const bounds = nodeWorldBounds(state.document, sel);
        if (!bounds) return;
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        patch(fitBoundsToState(bounds, vp));
      },
      setSoftProofEnabled: (v) => patch({ softProofEnabled: v }),
      setColorBlindnessView: (type) => patch({ colorBlindnessView: type }),

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

      resolveVariable: (nameOrId) =>
        resolve(state.document.variableStore ?? createVariableStore(), nameOrId),

      addVariable: (v) => {
        const id = `var-${Date.now()}`;
        const newVar: Variable = { id, ...v };
        updateDoc((doc) => addVariableToDocument(doc, newVar));
      },

      updateVariable: (id, patch) => {
        updateDoc((doc) => updateVariableInDocument(doc, id, patch));
      },

      deleteVariable: (id) => {
        updateDoc((doc) => deleteVariableFromDocumentDoc(doc, id));
      },

      setVariableMode: (mode) => {
        updateDoc((doc) => setVariableModeOnDocumentDoc(doc, mode));
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
          const restoredDoc = saved?.document ?? createDocument(targetMeta?.name ?? 'Untitled');
          return {
            ...s,
            document: restoredDoc,
            selection: saved?.selection ?? [],
            zoom: saved?.viewport.zoom ?? 1,
            pan: saved?.viewport.pan ?? { x: 0, y: 0 },
            dirty: targetMeta?.dirty ?? false,
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
            const decoded = DocumentCodec.decode(json);
            doc = decoded.ok ? decoded.document : createDocument(name || 'Untitled');
          } else {
            doc = createDocument(name || 'Untitled');
          }
          const result = validateDocument(doc);
          if (!result.valid) {
            if (typeof console !== 'undefined') {
              console.warn('[Strata] openFile: validation warnings:', result.errors);
            }
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
            const savedDoc = saved?.document ?? doc;
            return {
              ...s,
              document: savedDoc,
              selection: saved?.selection ?? [],
              zoom: saved?.viewport.zoom ?? 1,
              pan: saved?.viewport.pan ?? { x: 0, y: 0 },
              dirty: existing.dirty,
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

      removeBackground: async (method) => {
        const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import(
          '@strata/scene'
        );
        const imageNode = state.selection
          .map((id) => state.document.nodes[id] as import('@strata/scene').ShapeNode | undefined)
          .find((n) => n && isImageShape(n)) as import('@strata/scene').ShapeNode | undefined;
        if (!imageNode) {
          announcerRef.current?.announce('Select an image node first');
          return;
        }
        const processingNodeId = imageNode.id;
        const src = imageShapeSrc(imageNode);
        const w = imageShapeW(imageNode);
        const h = imageShapeH(imageNode);
        announcerRef.current?.announce(`Removing background using ${method}...`);
        try {
          const { getImageCache } = await import('@strata/engine');
          const { setBackgroundRemoval } = await import('@strata/scene');
          const cache = getImageCache();
          bgRemovalAbortRef.current?.abort();
          bgRemovalAbortRef.current = new AbortController();
          processingBgNodeRef.current = processingNodeId;
          const signal = bgRemovalAbortRef.current.signal;
          let img: HTMLImageElement | ImageBitmap | null = null;
          try {
            img = await cache.load(src);
          } catch {
            announcerRef.current?.announce(
              'Could not load image: the image source may be cross-origin or unavailable',
            );
            return;
          }
          if (!img) {
            announcerRef.current?.announce('Could not load image');
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          try {
            ctx.drawImage(img, 0, 0, w, h);
          } catch {
            announcerRef.current?.announce(
              'Could not render image: the image may be cross-origin (CORS blocked)',
            );
            return;
          }
          let imageData: ImageData;
          try {
            imageData = ctx.getImageData(0, 0, w, h);
          } catch {
            announcerRef.current?.announce(
              'Could not read image pixels: the image source may be cross-origin (CORS blocked)',
            );
            return;
          }
          const result = await import('@strata/engine').then((m) =>
            m.removeBackground(
              imageData,
              {
                method,
                feather: 0.5,
                decontaminate: true,
              },
              signal,
            ),
          );
          if (signal.aborted) return;
          if (method !== 'quick' && result.method === 'quick') {
            announcerRef.current?.announce(
              'AI model unavailable; used quick heuristic instead. Download the AI model in Settings, Offline Models.',
            );
          }
          const currentSelection = stateRef.current.selection;
          const stillSelected = currentSelection.includes(processingNodeId);
          if (!stillSelected) {
            announcerRef.current?.announce(
              'Background removal completed but the image is no longer selected',
            );
            return;
          }
          updateDoc((d) =>
            setBackgroundRemoval(d, imageNode.id, {
              maskDataUrl: result.maskDataUrl,
              method: result.method,
              confidence: result.confidence,
              appliedAt: Date.now(),
              feather: 0.5,
              decontaminate: true,
            }),
          );
          announcerRef.current?.announce('Background removed');
        } catch (e) {
          if (bgRemovalAbortRef.current?.signal.aborted) return;
          announcerRef.current?.announce(`Background removal failed: ${(e as Error).message}`);
        } finally {
          if (processingBgNodeRef.current === processingNodeId) {
            bgRemovalAbortRef.current = null;
            processingBgNodeRef.current = null;
          }
        }
      },

      removeBackgroundWithOptions: async (method, feather, decontaminate) => {
        const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import(
          '@strata/scene'
        );
        const imageNode = state.selection
          .map((id) => state.document.nodes[id] as import('@strata/scene').ShapeNode | undefined)
          .find((n) => n && isImageShape(n)) as import('@strata/scene').ShapeNode | undefined;
        if (!imageNode) {
          announcerRef.current?.announce('Select an image node first');
          return;
        }
        const processingNodeId = imageNode.id;
        const src = imageShapeSrc(imageNode);
        const w = imageShapeW(imageNode);
        const h = imageShapeH(imageNode);
        announcerRef.current?.announce(`Removing background using ${method}...`);
        try {
          const { getImageCache } = await import('@strata/engine');
          const { setBackgroundRemoval } = await import('@strata/scene');
          const cache = getImageCache();
          bgRemovalAbortRef.current?.abort();
          bgRemovalAbortRef.current = new AbortController();
          processingBgNodeRef.current = processingNodeId;
          const signal = bgRemovalAbortRef.current.signal;
          const img = await cache.load(src);
          if (!img) {
            announcerRef.current?.announce('Could not load image');
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const result = await import('@strata/engine').then((m) =>
            m.removeBackground(
              imageData,
              {
                method,
                feather,
                decontaminate,
              },
              signal,
            ),
          );
          if (signal.aborted) return;
          if (method !== 'quick' && result.method === 'quick') {
            announcerRef.current?.announce(
              'AI model unavailable; used quick heuristic instead. Download the AI model in Settings, Offline Models.',
            );
          }

          const { finalizeMaskResult } = await import('@strata/engine');
          const finalized = await finalizeMaskResult(result, { promptIfMultiple: true });

          if (finalized.needsSubjectPicker && finalized.components) {
            patch({
              subjectPickerSession: {
                nodeId: imageNode.id,
                width: finalized.width,
                height: finalized.height,
                components: finalized.components,
                keepIds: finalized.components[0] ? [finalized.components[0].id] : [],
                pendingMaskDataUrl: finalized.maskDataUrl,
                method: finalized.method,
                confidence: finalized.confidence,
                feather,
                decontaminate,
              },
            });
            announcerRef.current?.announce(
              'Multiple subjects detected — pick which regions to keep',
            );
            return;
          }

          updateDoc((d) =>
            setBackgroundRemoval(d, imageNode.id, {
              maskDataUrl: finalized.maskDataUrl,
              method: finalized.method,
              confidence: finalized.confidence,
              appliedAt: Date.now(),
              feather,
              decontaminate,
            }),
          );
          announcerRef.current?.announce('Background removed');
        } catch (e) {
          if (bgRemovalAbortRef.current?.signal.aborted) return;
          announcerRef.current?.announce(`Background removal failed: ${(e as Error).message}`);
        } finally {
          if (processingBgNodeRef.current === processingNodeId) {
            bgRemovalAbortRef.current = null;
            processingBgNodeRef.current = null;
          }
        }
      },

      setShowOriginalBg: (nodeId) => {
        patch({ showOriginalBgNodeId: nodeId });
      },

      setRefineMaskOptions: (opts: Partial<{ brushSize: number; hardness: number }>) => {
        setState((s) => ({
          ...s,
          refineMaskOptions: { ...s.refineMaskOptions, ...opts },
        }));
      },

      setTrimapEditOptions: (
        opts: Partial<{
          brushSize: number;
          hardness: number;
          penMode: import('./context/types').TrimapPenMode;
        }>,
      ) => {
        setState((s) => ({
          ...s,
          trimapEditOptions: { ...s.trimapEditOptions, ...opts },
        }));
      },

      confirmSubjectPicker: (keepIds: number[]) => {
        const session = stateRef.current.subjectPickerSession;
        if (!session) return;
        void (async () => {
          const { decodeMaskDataUrl, filterMaskByComponents, maskArrayToDataUrl } = await import(
            '@strata/engine'
          );
          const { setBackgroundRemoval } = await import('@strata/scene');
          const { mask, width, height } = await decodeMaskDataUrl(session.pendingMaskDataUrl);
          const filtered = filterMaskByComponents(mask, width, height, new Set(keepIds));
          updateDoc((d) =>
            setBackgroundRemoval(d, session.nodeId, {
              maskDataUrl: maskArrayToDataUrl(filtered, width, height),
              method: session.method,
              confidence: session.confidence,
              appliedAt: Date.now(),
              feather: session.feather,
              decontaminate: session.decontaminate,
            }),
          );
          patch({ subjectPickerSession: null });
          announcerRef.current?.announce(`Kept ${keepIds.length} subject(s)`);
        })();
      },

      cancelSubjectPicker: () => {
        patch({ subjectPickerSession: null });
        announcerRef.current?.announce('Subject selection cancelled');
      },

      refineHairEdges: async () => {
        const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import(
          '@strata/scene'
        );
        const imageNode = state.selection
          .map((id) => state.document.nodes[id] as import('@strata/scene').ShapeNode | undefined)
          .find((n) => n && isImageShape(n) && n.backgroundRemoval?.maskDataUrl) as
          | import('@strata/scene').ShapeNode
          | undefined;
        if (!imageNode?.backgroundRemoval?.maskDataUrl) {
          announcerRef.current?.announce('Apply background removal first');
          return;
        }
        try {
          const { decodeMaskDataUrl, getImageCache, maskArrayToDataUrl, refineHairMatting } =
            await import('@strata/engine');
          const { setBackgroundRemoval } = await import('@strata/scene');
          const w = imageShapeW(imageNode);
          const h = imageShapeH(imageNode);
          const img = await getImageCache().load(imageShapeSrc(imageNode));
          if (!img) {
            announcerRef.current?.announce('Could not load image');
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const { mask } = await decodeMaskDataUrl(imageNode.backgroundRemoval.maskDataUrl);
          const refined = refineHairMatting(imageData, mask);
          updateDoc((d) =>
            setBackgroundRemoval(d, imageNode.id, {
              ...imageNode.backgroundRemoval!,
              maskDataUrl: maskArrayToDataUrl(refined, w, h),
              appliedAt: Date.now(),
            }),
          );
          announcerRef.current?.announce('Hair/fur edges refined');
        } catch (e) {
          announcerRef.current?.announce(`Edge refinement failed: ${(e as Error).message}`);
        }
      },

      startTrimapEdit: () => {
        const nodeId = state.selection[0];
        if (!nodeId) {
          announcerRef.current?.announce('Select an image first');
          return;
        }
        patch({ tool: 'trimapEdit' });
        announcerRef.current?.announce(
          'Trimap edit: 1=foreground, 2=unknown, 3=background. Escape to finish.',
        );
      },

      applyTrimapMatting: async () => {
        const nodeId = state.selection[0];
        if (!nodeId) return;
        const trimapEntry = trimapStoreRef.current.get(nodeId);
        const node = state.document.nodes[nodeId] as import('@strata/scene').ShapeNode | undefined;
        if (!trimapEntry || !node?.backgroundRemoval) {
          announcerRef.current?.announce('Paint a trimap first');
          return;
        }
        try {
          const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import(
            '@strata/scene'
          );
          if (!isImageShape(node)) return;
          const { getImageCache, maskArrayToDataUrl, solveTrimapMatting } = await import(
            '@strata/engine'
          );
          const { setBackgroundRemoval } = await import('@strata/scene');
          const w = imageShapeW(node);
          const h = imageShapeH(node);
          const img = await getImageCache().load(imageShapeSrc(node));
          if (!img) {
            announcerRef.current?.announce('Could not load image');
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const matte = solveTrimapMatting(imageData, trimapEntry.data);
          updateDoc((d) =>
            setBackgroundRemoval(d, nodeId, {
              ...node.backgroundRemoval!,
              maskDataUrl: maskArrayToDataUrl(matte, w, h),
              appliedAt: Date.now(),
            }),
          );
          trimapStoreRef.current.delete(nodeId);
          patch({ tool: 'select' });
          announcerRef.current?.announce('Trimap matting applied');
        } catch (e) {
          announcerRef.current?.announce(`Trimap matting failed: ${(e as Error).message}`);
        }
      },

      getTrimapData: (nodeId: NodeId) => trimapStoreRef.current.get(nodeId) ?? null,

      setTrimapData: (nodeId: NodeId, data: Uint8Array, width: number, height: number) => {
        trimapStoreRef.current.set(nodeId, { data, width, height });
      },

      setPrototypeMode: (active) => {
        patch({ prototypeMode: active });
        if (active) {
          const doc = stateRef.current.document;
          const { runtime, entryScreenId } = createRuntimeFromDocument(doc);
          prototypeRuntimeRef.current = runtime;
          const smIds = Object.keys(doc.stateMachines ?? {});
          smRuntimeRef.current = smIds[0] ? createStateMachineRuntime(doc, smIds[0]) : null;
          patch({
            prototypeRuntime: runtime,
            prototypeData: {
              interactions: interactionsMapFromDocument(doc),
            },
          });
          setPrototypeCurrentScreen(entryScreenId);
        } else {
          prototypeRuntimeRef.current = null;
          smRuntimeRef.current = null;
          patch({ prototypeRuntime: null });
        }
      },

      updatePrototypeData: () => {
        const { runtime, entryScreenId } = createRuntimeFromDocument(stateRef.current.document);
        prototypeRuntimeRef.current = runtime;
        patch({
          prototypeRuntime: runtime,
          prototypeData: {
            interactions: interactionsMapFromDocument(stateRef.current.document),
          },
        });
        setPrototypeCurrentScreen(entryScreenId);
      },

      handlePrototypeEvent: (event) => {
        const runtime = prototypeRuntimeRef.current;
        if (!runtime) return;
        const fromScreenId = runtime.state.currentScreenId;
        const results = protoHandleEvent(runtime, event as Parameters<typeof protoHandleEvent>[1]);
        for (const result of results) {
          for (const actionResult of result.actionResults) {
            if (actionResult.kind === 'navigateTo') {
              const transition = actionResult.transition;
              let smartValues: Record<string, Record<string, unknown>> | undefined;
              if (transition.kind === 'smartAnimate') {
                const sa = computeSmartAnimateTransition(
                  stateRef.current.document,
                  fromScreenId,
                  actionResult.targetId,
                );
                prototypeSmartAnimateRef.current = sa;
                smartValues = sa?.values;
              }
              if (transition.kind !== 'instant') {
                setPrototypeTransition({
                  fromScreenId,
                  toScreenId: actionResult.targetId,
                  transition,
                  smartAnimateValues: smartValues,
                  layerMatches: prototypeSmartAnimateRef.current?.matches,
                  startedAt: performance.now(),
                });
              }
            }
            protoApplyActionResult(runtime, actionResult);
          }
        }

        if (smRuntimeRef.current) {
          const ev = event as { type?: string };
          if (ev.type === 'click') {
            smRuntimeRef.current = triggerSMEvent(smRuntimeRef.current, 'onClick');
            const tlId = getCurrentStateTimelineId(smRuntimeRef.current);
            if (tlId) {
              patch({
                motion: { ...stateRef.current.motion, activeTimelineId: tlId, currentTime: 0 },
              });
            }
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
        if (runtime) protoSetVar(runtime, id, value);
        updateDoc((doc) => {
          const v = doc.variableStore?.variables[id];
          if (!v) return doc;
          const mode = doc.variableStore?.activeMode ?? 'default';
          return updateVariableInDocument(doc, id, {
            valuesByMode: { ...v.valuesByMode, [mode]: value },
          });
        });
      },

      startPresentation: () => {
        const doc = stateRef.current.document;
        const { runtime, entryScreenId } = createRuntimeFromDocument(doc);
        prototypeRuntimeRef.current = runtime;
        const smIds = Object.keys(doc.stateMachines ?? {});
        smRuntimeRef.current = smIds[0] ? createStateMachineRuntime(doc, smIds[0]) : null;
        const smTimelineId = getPrimaryStateMachineTimelineId(doc);
        patch({
          isPresenting: true,
          prototypeRuntime: runtime,
          prototypeData: {
            interactions: interactionsMapFromDocument(doc),
          },
          ...(smTimelineId
            ? {
                motion: {
                  ...stateRef.current.motion,
                  activeTimelineId: smTimelineId,
                  currentTime: 0,
                  isPlaying: false,
                },
              }
            : {}),
        });
        updateDoc((d) => (smTimelineId ? setActiveTimelineDoc(d, smTimelineId) : d));
        setPrototypeCurrentScreen(entryScreenId);
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

      getNodeInteractions: (nodeId) => {
        return getInteractionsForNode(stateRef.current.document, nodeId);
      },

      addNodeInteraction: (nodeId, interaction) => {
        updateDoc((doc) => addInteractionDoc(doc, nodeId, interaction).doc);
      },

      removeNodeInteraction: (interactionId) => {
        updateDoc((doc) => removeInteractionDoc(doc, interactionId));
      },

      updateNodeInteraction: (interactionId, updates) => {
        updateDoc((doc) => updateInteractionDoc(doc, interactionId, updates));
      },

      selectedInteractionId,
      selectPrototypeInteraction: (nodeId, interactionId) => {
        setSelectedInteractionId(interactionId);
        patch({ selection: [nodeId] });
      },

      prototypeTransition,
      clearPrototypeTransition: () => setPrototypeTransition(null),

      playTimeline: (timelineId) => {
        const s = stateRef.current;
        const tlId = timelineId ?? s.motion.activeTimelineId;
        if (!tlId) return;
        const timeline = s.document.timelines?.[tlId];
        if (!timeline) return;

        let facade = motionFacadeRef.current;
        if (!facade) {
          facade = new MotionFacade({
            onFrame: (time) => {
              patch({ motion: { ...stateRef.current.motion, currentTime: time } });
            },
            onFinish: () => {
              patch({ motion: { ...stateRef.current.motion, isPlaying: false } });
            },
          });
          motionFacadeRef.current = facade;
        }

        facade.setLoop(s.motion.loop);
        facade.setSpeed(s.motion.playbackSpeed);
        facade.play(timeline);
        patch({ motion: { ...s.motion, isPlaying: true, activeTimelineId: tlId } });
      },

      pauseTimeline: () => {
        motionFacadeRef.current?.pause();
        patch({ motion: { ...stateRef.current.motion, isPlaying: false } });
      },

      stopTimeline: () => {
        motionFacadeRef.current?.stop();
        patch({ motion: { ...stateRef.current.motion, isPlaying: false, currentTime: 0 } });
      },

      seekTimeline: (time) => {
        const clamped = Math.max(0, time);
        motionFacadeRef.current?.seek(clamped);
        patch({ motion: { ...stateRef.current.motion, currentTime: clamped } });
      },

      setActiveTimeline: (id) => {
        updateDoc((doc) => setActiveTimelineDoc(doc, id));
        motionFacadeRef.current?.stop();
        patch({
          motion: {
            ...stateRef.current.motion,
            activeTimelineId: id,
            currentTime: 0,
            isPlaying: false,
          },
        });
      },

      setPlaybackSpeed: (speed) => {
        motionFacadeRef.current?.setSpeed(speed);
        patch({ motion: { ...stateRef.current.motion, playbackSpeed: speed } });
      },

      toggleLoop: () => {
        const nextLoop = !stateRef.current.motion.loop;
        motionFacadeRef.current?.setLoop(nextLoop);
        patch({ motion: { ...stateRef.current.motion, loop: nextLoop } });
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
        invalidateSamplerCache();
      },

      createTimeline: (name = 'Timeline 1', duration = 5000) => {
        let newId = '';
        updateDoc((doc) => {
          const { doc: next, id } = createTimelineDoc(doc, name, duration);
          newId = id;
          return setActiveTimelineDoc(next, id);
        });
        invalidateSamplerCache();
        motionFacadeRef.current?.stop();
        patch({
          motion: {
            ...stateRef.current.motion,
            activeTimelineId: newId,
            currentTime: 0,
            isPlaying: false,
          },
        });
        return newId;
      },

      removeTimeline: (id) => {
        const wasActive = stateRef.current.motion.activeTimelineId === id;
        updateDoc((doc) => removeTimelineDoc(doc, id));
        invalidateSamplerCache();
        if (wasActive) {
          motionFacadeRef.current?.stop();
          patch({
            motion: {
              ...stateRef.current.motion,
              activeTimelineId: null,
              currentTime: 0,
              isPlaying: false,
            },
          });
        }
      },

      renameTimeline: (id, name) => {
        updateDoc((doc) => renameTimelineDoc(doc, id, name));
      },

      removeTrack: (timelineId, trackId) => {
        updateDoc((doc) => removeTrackDoc(doc, timelineId, trackId));
        invalidateSamplerCache();
      },

      setTrackNestedTimeline: (timelineId, trackId, nestedTimelineId, startProgress = 0) => {
        updateDoc((doc) =>
          updateTrackDoc(doc, timelineId, trackId, {
            nestedTimelineId: nestedTimelineId ?? undefined,
            nestedStartProgress: nestedTimelineId ? startProgress : undefined,
          }),
        );
        invalidateSamplerCache();
      },

      addTimelineMarker: (timelineId, name, progress) => {
        const markerId = `mk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        updateDoc((doc) => addTimelineMarkerDoc(doc, timelineId, { id: markerId, name, progress }));
        invalidateSamplerCache();
      },

      removeTimelineMarker: (timelineId, markerId) => {
        updateDoc((doc) => removeTimelineMarkerDoc(doc, timelineId, markerId));
        invalidateSamplerCache();
      },

      renameTimelineMarker: (timelineId, markerId, name) => {
        updateDoc((doc) => renameTimelineMarkerDoc(doc, timelineId, markerId, name));
        invalidateSamplerCache();
      },

      createMotionPresetFromTimeline: (timelineId, name) => {
        let presetId = '';
        updateDoc((doc) => {
          const { doc: next, id } = createMotionPresetDoc(doc, timelineId, name);
          presetId = id;
          return next;
        });
        invalidateSamplerCache();
        return presetId;
      },

      applyMotionPreset: (presetId, timelineId) => {
        updateDoc((doc) => applyMotionPresetDoc(doc, presetId, timelineId));
        invalidateSamplerCache();
      },

      toggleAutoKeyframe: () => {
        patch({
          motion: {
            ...stateRef.current.motion,
            autoKeyframe: !stateRef.current.motion.autoKeyframe,
          },
        });
      },

      toggleTimelinePanel: () => {
        patch({ timelinePanelVisible: !stateRef.current.timelinePanelVisible });
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
          const nextDoc = saved?.document ?? createDocument(next.name);
          return {
            ...s,
            document: nextDoc,
            selection: saved?.selection ?? [],
            zoom: saved?.viewport.zoom ?? 1,
            pan: saved?.viewport.pan ?? { x: 0, y: 0 },
            dirty: next.dirty,
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
      createTextChain,
      deleteTextChain,
      appendFrameToChain,
      removeFrameFromChain,
      bindingField,
      setBindingField,
      focusedField,
      setFocusedField,
      showExportDialog,
      prototypeCurrentScreen,
      prototypeTransition,
      selectedInteractionId,
      platform,
    ],
  );

  const documentValue = useMemo<DocumentContextValue>(
    () => ({
      createShapeAt: value.createShapeAt,
      createTextNodeAt: value.createTextNodeAt,
      applyFramePreset: value.applyFramePreset,
      removeSelected: value.removeSelected,
      renameSelected: value.renameSelected,
      moveNode: value.moveNode,
      duplicateSelected: value.duplicateSelected,
      setSelectedFill: value.setSelectedFill,
      setSelectedFills: value.setSelectedFills,
      updateSelectedFillAt: value.updateSelectedFillAt,
      addSelectedFill: value.addSelectedFill,
      removeSelectedFillAt: value.removeSelectedFillAt,
      reorderSelectedFill: value.reorderSelectedFill,
      setNodePosition: value.setNodePosition,
      setNodeSize: value.setNodeSize,
      updateNode: value.updateNode,
      setSelectedOpacity: value.setSelectedOpacity,
      setSelectedBlendMode: value.setSelectedBlendMode,
      setSelectedRotation: value.setSelectedRotation,
      setSelectedFlipH: value.setSelectedFlipH,
      setSelectedFlipV: value.setSelectedFlipV,
      setSelectedCornerRadius: value.setSelectedCornerRadius,
      alignSelected: value.alignSelected,
      distributeSelected: value.distributeSelected,
      distributeWithGap: value.distributeWithGap,
      setKeyObject: value.setKeyObject,
      keyObjectId: value.keyObjectId,
      alignToPage: value.alignToPage,
      setAlignToPage: value.setAlignToPage,
      tidySelected: value.tidySelected,
      obbAlignSelected: value.obbAlignSelected,
      beginTransaction: value.beginTransaction,
      commitTransaction: value.commitTransaction,
      abortTransaction: value.abortTransaction,
      createTextChain: value.createTextChain,
      deleteTextChain: value.deleteTextChain,
      appendFrameToChain: value.appendFrameToChain,
      removeFrameFromChain: value.removeFrameFromChain,
      undo: value.undo,
      redo: value.redo,
      newDocument: value.newDocument,
      serializeDocument: value.serializeDocument,
      updateDoc: value.updateDoc,
      loadDocument: value.loadDocument,
      save: value.save,
      saveAs: value.saveAs,
      saveState: value.saveState,
      lastSavedAt: value.lastSavedAt,
      openFile: value.openFile,
      rootNodes: value.rootNodes,
      reparentNode: value.reparentNode,
      arrangeSelected: value.arrangeSelected,
      groupSelected: value.groupSelected,
      ungroupSelected: value.ungroupSelected,
      detachSelected: value.detachSelected,
      copySelected: value.copySelected,
      cutSelected: value.cutSelected,
      paste: value.paste,
      importNode: value.importNode,
      booleanOp: value.booleanOp,
      setNodeLocked: value.setNodeLocked,
      setNodeVisible: value.setNodeVisible,
      setNodeClipContent: value.setNodeClipContent,
      setLayerColor: value.setLayerColor,
      setNodeLayout: value.setNodeLayout,
      guides: value.guides,
      addGuide: value.addGuide,
      removeGuide: value.removeGuide,
      moveGuide: value.moveGuide,
      toggleGuideLock: value.toggleGuideLock,
      clearAllGuides: value.clearAllGuides,
      showExportDialog: value.showExportDialog,
      setShowExportDialog: value.setShowExportDialog,
      addPreset: value.addPreset,
      updatePreset: value.updatePreset,
      removePreset: value.removePreset,
      createComponentFromFrame: value.createComponentFromFrame,
      createComponentInstance: value.createComponentInstance,
      fillSlot: value.fillSlot,
      swapComponentInstance: value.swapComponentInstance,
      resetInstanceOverrides: value.resetInstanceOverrides,
      syncComponentInstances: value.syncComponentInstances,
      syncInstance: value.syncInstance,
      getInstanceStatus: value.getInstanceStatus,
      syncAllInstances: value.syncAllInstances,
      resolveVariable: value.resolveVariable,
      addVariable: value.addVariable,
      updateVariable: value.updateVariable,
      deleteVariable: value.deleteVariable,
      setVariableMode: value.setVariableMode,
      newTab: value.newTab,
      switchTab: value.switchTab,
      closeTab: value.closeTab,
      createAdjustmentLayer: value.createAdjustmentLayer,
      addAdjustmentToLayer: value.addAdjustmentToLayer,
      removeAdjustmentFromLayer: value.removeAdjustmentFromLayer,
      updateAdjustmentInLayer: value.updateAdjustmentInLayer,
      reorderAdjustmentInLayer: value.reorderAdjustmentInLayer,
      setAdjustmentLayerOpacity: value.setAdjustmentLayerOpacity,
      setAdjustmentLayerBlendMode: value.setAdjustmentLayerBlendMode,
      setVariantForInstance: value.setVariantForInstance,
      createVariant: value.createVariant,
      setPropertyOverride: value.setPropertyOverride,
      addComponentProperty: value.addComponentProperty,
      resolveVariantPropertiesForNode: value.resolveVariantPropertiesForNode,
      setPageBleed: value.setPageBleed,
      setPageSafeArea: value.setPageSafeArea,
      setPageSlug: value.setPageSlug,
      setActivePage: value.setActivePage,
      setCurrentPageId: value.setCurrentPageId,
      activePageNodes: value.activePageNodes,
    }),
    [value],
  );

  return (
    <EditorCtx.Provider value={value}>
      <DocumentProvider value={documentValue}>
        <ViewportProvider state={state} setState={setState} stateRef={stateRef}>
          <SelectionProvider state={state} setState={setState}>
            {children}
          </SelectionProvider>
        </ViewportProvider>
      </DocumentProvider>
    </EditorCtx.Provider>
  );
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}

export { useDocument, useSelection, useViewport } from './context/index';

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

// ─── Alignment helpers ─────────────────────────────────────────────────────

interface ValidItem {
  id: NodeId;
  node: SceneNode;
  bounds: { x: number; y: number; w: number; h: number };
}

/** Extract valid items with world bounds from a selection. */
function getValidItemsWithBounds(sel: NodeId[], doc: Document): ValidItem[] {
  return sel
    .map((id) => {
      const node = doc.nodes[id];
      if (!node) return null;
      const bounds = nodeWorldBounds(doc, id);
      if (!bounds) return null;
      return { id, node, bounds };
    })
    .filter((x): x is ValidItem => x !== null);
}

/** Convert target world position for a node's bounds to the node's local transform origin. */
function worldToLocalOrigin(
  doc: Document,
  id: NodeId,
  targetWorldX: number,
  targetWorldY: number,
  bounds: { x: number; y: number; w: number; h: number },
  parentCache: import('./scene/parentIndexCache').ParentIndexCache | null,
): [number, number] {
  const wm = nodeWorldTransform(doc, id);
  const bOffX = bounds.x - wm[4];
  const bOffY = bounds.y - wm[5];
  const nodeOriginWorldX = targetWorldX - bOffX;
  const nodeOriginWorldY = targetWorldY - bOffY;
  const parentId = getParentFast(doc, id, parentCache);
  if (parentId) {
    const pInv = invertAffine(nodeWorldTransform(doc, parentId));
    const local = applyAffine(pInv, [nodeOriginWorldX, nodeOriginWorldY]);
    return [local[0], local[1]];
  }
  return [nodeOriginWorldX, nodeOriginWorldY];
}

/** Compute alignment target from key object if valid, null otherwise. */
function computeKeyObjectTarget(
  doc: Document,
  keyObjectId: string | null,
  sel: NodeId[],
): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
} | null {
  if (!keyObjectId || !sel.includes(keyObjectId)) return null;
  const keyNode = doc.nodes[keyObjectId];
  if (!keyNode) return null;
  const keyBounds = nodeWorldBounds(doc, keyObjectId);
  if (!keyBounds) return null;
  return {
    left: keyBounds.x,
    right: keyBounds.x + keyBounds.w,
    top: keyBounds.y,
    bottom: keyBounds.y + keyBounds.h,
    centerX: keyBounds.x + keyBounds.w / 2,
    centerY: keyBounds.y + keyBounds.h / 2,
  };
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
