/**
 * Editor state context — shared across all shell surfaces.
 *
 * Holds the editor's tool state, viewport (zoom/pan), selection, AND the scene
 * Document. Document actions are provided through the context so any surface
 * (toolbar, canvas, layers, inspector) can mutate the scene.
 */

/** Module-level bridge injected by Shell to forward toasts to @strata/ui ToastProvider. */
interface EditorToastOptions {
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

let toastHandler: ((opts: EditorToastOptions) => void) | null = null;

export function setToastHandler(fn: (opts: EditorToastOptions) => void): void {
  toastHandler = fn;
}

/** Module-level bridge letting status-bar badges (DebtBadge, LayoutScoreIndicator)
 *  request an inspector tab switch without PropertiesPanel's local tab state
 *  living in the shared reducer. Registered by PropertiesPanel on mount. */
interface InspectorTabRequest {
  tab: InspectorTab;
  subTab?: IntelligenceTab;
}

let inspectorTabHandler: ((req: InspectorTabRequest) => void) | null = null;

export function setInspectorTabHandler(fn: ((req: InspectorTabRequest) => void) | null): void {
  inspectorTabHandler = fn;
}

/**
 * Editor state context — shared across all shell surfaces.
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
  analogousHarmony,
  applyAffine,
  complementaryHarmony,
  extractPalette as engineExtractPalette,
  invertAffine,
  monochromaticHarmony,
  multiplyAffine,
  splitComplementaryHarmony,
  triadicHarmony,
} from '@strata/engine';
import { type ImportFileInput, ImportService } from '@strata/import';
import { type Platform, upsertPreservingMeta } from '@strata/platform';
import {
  PrototypeDebugConsole,
  type PrototypeRuntime,
  processDelays as protoProcessDelays,
} from '@strata/prototype';
import type {
  AdjustmentNode,
  ColorMode,
  ContainerNode,
  ExportPreset,
  FacingPagesConfig,
  InstanceStatus,
  LiveTraceParams,
  ManagedColor,
  MasterAppliesTo,
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
  addMask as addMaskDoc,
  addNode,
  addVariableToDocument,
  advanceSMTransition,
  appendFrameToChain as appendFrameToChainDoc,
  arrangeNode as arrangeNodeDoc,
  assignMasterToPage as assignMasterToPageDoc,
  type BleedConfig,
  buildParentIndexMap,
  canBeClipMaskSource,
  clearGuides,
  clearLiveTrace as clearLiveTraceDoc,
  createClippingMask as createClippingMaskDoc,
  createComponent,
  createDocument,
  createGuideId,
  createMaster as createMasterDoc,
  createTextChain as createTextChainDoc,
  createVariableStore,
  createVariant as createVariantDoc,
  type Document,
  DocumentCodec,
  deepCloneSubtree,
  deleteMaster as deleteMasterDoc,
  deleteTextChain as deleteTextChainDoc,
  deleteVariableFromDocument as deleteVariableFromDocumentDoc,
  detachInstance as detachInstanceDoc,
  booleanOp as doBooleanOp,
  duplicateGuide as duplicateGuideDoc,
  duplicateMaster as duplicateMasterDoc,
  fillSlot as fillSlotDoc,
  flattenLiveTrace as flattenLiveTraceDoc,
  type Guide,
  activePageNodes as getActivePageNodes,
  activePageNodesWithMaster as getActivePageNodesWithMaster,
  getCurrentStateTimelineId,
  getFormattedPageNumber as getFormattedPageNumberDoc,
  getGuidesForPage,
  getInstanceStatus as getInstanceStatusDoc,
  getInteractionsForNode,
  getPageNumber as getPageNumberDoc,
  getPageSide as getPageSideDoc,
  getParent,
  getSpreadForPage as getSpreadForPageDoc,
  groupNodes as groupNodesDoc,
  installLibrary as installLibraryDoc,
  instantiate as instantiateComponent,
  isClippingMaskGroup,
  isContainer,
  isImageShape,
  isPageOnLeftSide as isPageOnLeftSideDoc,
  type MaskType,
  makeAdjustmentNode,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  markMaskStale,
  moveGuide as moveGuideDoc,
  moveNode,
  nextNodeId,
  pasteGuides as pasteGuidesDoc,
  pushMasterChanges as pushMasterChangesDoc,
  rebuildSpreads as rebuildSpreadsDoc,
  releaseClippingMask as releaseClippingMaskDoc,
  removeFrameFromChain as removeFrameFromChainDoc,
  removeGuide as removeGuideDoc,
  removeInteraction as removeInteractionDoc,
  removeMask as removeMaskDoc,
  removeNode,
  renameMaster as renameMasterDoc,
  renameNode,
  reparentNode as reparentNodeDoc,
  resetInstanceOverrides as resetInstanceOverridesDoc,
  resolve,
  resolveGuidePageId,
  resolveNodeFills,
  resolveVariantPropertiesForNode as resolveVariantPropertiesForNodeDoc,
  type SafeAreaConfig,
  type SceneNode,
  type SlugConfig,
  type SMRuntime,
  setActivePage as setActivePageDoc,
  setActiveTimeline as setActiveTimelineDoc,
  setAllGuidesLocked,
  setFacingPagesEnabled as setFacingPagesEnabledDoc,
  setLiveTraceError as setLiveTraceErrorDoc,
  setLiveTraceParams as setLiveTraceParamsDoc,
  setLiveTraceResolved as setLiveTraceResolvedDoc,
  setMaskDensity as setMaskDensityDoc,
  setMaskFeather as setMaskFeatherDoc,
  setMaskFillRule as setMaskFillRuleDoc,
  setMaskHideSource as setMaskHideSourceDoc,
  setMaskInverted as setMaskInvertedDoc,
  setMaskLinked as setMaskLinkedDoc,
  setMaskSourceNode as setMaskSourceNodeDoc,
  setMaskType as setMaskTypeDoc,
  setMaskVectorPath as setMaskVectorPathDoc,
  setMaskVisible as setMaskVisibleDoc,
  setMasterAppliesTo as setMasterAppliesToDoc,
  setPropertyOverride as setPropertyOverrideDoc,
  setVariableModeOnDocument as setVariableModeOnDocumentDoc,
  setVariantForInstance as setVariantForInstanceDoc,
  shapeHeight,
  shapeWidth,
  swapInstance as swapInstanceDoc,
  switchColorMode as switchColorModeDoc,
  syncAllInstances as syncAllInstancesDoc,
  syncInstance as syncInstanceDoc,
  toggleFacingPages as toggleFacingPagesDoc,
  toggleGuideLock as toggleGuideLockDoc,
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
  type Camera,
  clampCamera,
  clampZoom,
  computeAlignmentTarget,
  computeDistribution,
  computeDistributionCenters,
  computeTidyLayout,
  type DistributeMode,
  distributeToPosition,
  fitBoundsCamera,
  type OBB,
  obbAlignmentTarget,
  orientedBBox,
  revealBoundsCamera,
  screenDeltaToWorld,
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
import {
  DocumentProvider,
  MotionProvider,
  PrototypeProvider,
  SelectionProvider,
  ViewportProvider,
} from './context/index';
import type { MotionContextValue } from './context/MotionContext';
import type {
  CanvasMode,
  EditorState,
  GridOverlayMode,
  InspectorTab,
  IntelligenceTab,
  RulerMode,
  SessionMeta,
  ToolId,
} from './context/types';
import { useBackgroundRemoval } from './context/useBackgroundRemoval';
import { usePersistence } from './context/usePersistence';
import {
  computeFitAllCamera,
  computeZoomStep,
  computeZoomTo,
  getCanvasViewport,
} from './context/viewportOps';
import { applyDropPosition } from './dropUtils';
import { readGuidesFromClipboard, writeGuidesToClipboard } from './guideClipboard';
import { HitTestEngine } from './hitTest';
import { useSelectionHistory } from './hooks/useSelectionHistory';
import {
  insertDerivedImageShape,
  insertLiveTraceGroup,
  insertTraceGroup,
  selectedImageShape,
} from './imageOperations';
import { getActionTracker } from './intelligence/actionTracker';
import { autoName } from './intelligence/autoNamer';
import { computeCognitiveLoad } from './intelligence/cognitiveLoad';
import { fromFitSuggestion, suggestFit } from './intelligence/imageFitAdvisor';
import { computeFlexLayout } from './layout/computeFlexLayout';
import { applyGridLayout } from './layout/computeGridLayout';
import { applyAutoKeyframes } from './motion/autoKeyframe';
import { getSharedRecoveryManager, type RecoveryManager } from './recovery';
import { findContainingFrameInDoc } from './scene/findContainingFrame';
import {
  getOrCreateParentCache,
  getParentFast,
  type ParentIndexCache,
} from './scene/parentIndexCache';
import { type FrameSpatialIndex, getOrCreateFrameSpatialIndex } from './scene/spatialIndex';
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
import { captureViewport, normalizeSavedViewport, type SavedViewport } from './viewportSession';
import { getWorkspaceConfig, type WorkspaceMode } from './workspace/workspaceTypes';

// Re-export for backward compatibility
export type { CanvasMode, EditorState, SessionMeta, ToolId };

/**
 * Flatten `ids` and all of their descendants into a single node list, for
 * clipboard serialization. Copying only the directly-selected node(s) (not
 * their descendants) means a pasted group/frame has nothing for
 * deepCloneSubtree to find its children in — they'd be silently dropped.
 */
function gatherSubtreeNodes(doc: Document, ids: NodeId[]): SceneNode[] {
  const seen = new Set<NodeId>();
  const result: SceneNode[] = [];
  const visit = (id: NodeId): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = doc.nodes[id];
    if (!node) return;
    result.push(node);
    if (isContainer(node)) {
      for (const childId of node.children) visit(childId);
    }
  };
  for (const id of ids) visit(id);
  return result;
}

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

  // Merge raster mask assets from the source document into the target.
  // Cloned nodes reference the same assetIds; the assets must exist in
  // the target document for the masks to render.
  const mergedRasterAssets = sourceDoc.rasterMaskAssets
    ? { ...(targetDoc.rasterMaskAssets ?? {}), ...sourceDoc.rasterMaskAssets }
    : targetDoc.rasterMaskAssets;

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
        ...(mergedRasterAssets !== targetDoc.rasterMaskAssets
          ? { rasterMaskAssets: mergedRasterAssets }
          : {}),
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
      ...(mergedRasterAssets !== targetDoc.rasterMaskAssets
        ? { rasterMaskAssets: mergedRasterAssets }
        : {}),
    },
  };
}

export interface EditorContextValue {
  state: EditorState;
  /** The platform facade (Tauri/web/memory), undefined if none was provided. */
  platform: Platform | undefined;
  setTool: (t: ToolId) => void;
  /** Commit zoom, pan, and rotation as one camera transaction. */
  setCamera: (camera: Camera) => void;
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
  /** Toggle distraction-free canvas mode (hides chrome, keeps canvas/toolbar). */
  toggleDistractionFreeMode: () => void;
  /** Toggle before/after comparison for the selected image. */
  toggleBeforeAfterCompare: () => void;
  /** Active workspace mode (design/print/drawing). */
  workspaceMode: import('./workspace/workspaceTypes').WorkspaceMode;
  /** Switch to a different workspace mode. */
  setWorkspaceMode: (mode: import('./workspace/workspaceTypes').WorkspaceMode) => void;
  /** Reset current workspace to its default panel/tool configuration. */
  resetWorkspaceToDefault: () => void;
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
  /** Select all visible unlocked nodes sharing the first selected node's layer color. */
  selectAllWithSameLayerColor: () => void;
  /** Select all visible unlocked nodes of the same kind as the first selected node. */
  selectAllOfType: () => void;
  /** Navigate back in selection history. */
  selectPreviousSelection: () => void;
  /** Navigate forward in selection history. */
  selectNextSelection: () => void;
  /** Create a shape/frame node from the current tool at the given world-space point. */
  createShapeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    pathPoints?: PathPoint[],
    pathClosed?: boolean,
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
  findContainingFrame: (
    world: { x: number; y: number },
    frameIndex?: FrameSpatialIndex | null,
  ) => NodeId | null;
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
  /** P0*: distribute with a configurable spacing mode. */
  distributeWithMode: (axis: 'horizontal' | 'vertical', mode: DistributeMode) => void;
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
  /** Show a visual toast notification and mirror it to aria-live. */
  showToast: (opts: EditorToastOptions) => void;
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
  /** Create a mask on the selected container from the node above it (or the first shape child). */
  addMaskToSelected: (type?: import('@strata/scene').MaskType) => void;
  /** Remove the mask from the selected container. Does NOT delete the mask source node. */
  removeMaskFromSelected: () => void;
  /** Toggle the selected container's mask visibility. */
  toggleMask: () => void;
  /** Toggle inversion on the selected container's mask. */
  invertMask: () => void;
  /** Set feather radius on the selected container's mask (world-space px). */
  setMaskFeather: (feather: number) => void;
  /** Set density (0-1) on the selected container's mask. */
  setMaskDensity: (density: number) => void;
  /** Toggle whether the mask source is hidden from direct rendering. */
  setMaskHideSource: (hidden: boolean) => void;
  /** Toggle whether the mask is linked to the container transform. */
  setMaskLinked: (linked: boolean) => void;
  /** Change the mask type ('clip', 'alpha', 'luminance'). */
  setMaskType: (type: MaskType) => void;
  /** Change the mask source node (must be a child of the container). */
  setMaskSourceNode: (sourceNodeId: string) => void;
  /** Set the fill rule for a clip/vector mask ('nonzero' | 'evenodd'). */
  setMaskFillRule: (fillRule: import('@strata/scene').MaskFillRule) => void;
  /** Set a vector path mask on the selected container. */
  setMaskVectorPath: (points: import('@strata/engine').PathPoint[], closed: boolean) => void;
  /** Create a clipping mask group from selected nodes (mask shape + content). */
  createClippingMaskFromSelected: (selectionOverride?: NodeId[]) => void;
  /** Release a clipping mask, restoring original content and mask source. */
  releaseClippingMaskFromSelected: () => void;
  /** Create an adjustment layer node with optional initial adjustments and select it. */
  createAdjustmentLayer: (initialAdjustments?: import('@strata/engine').Adjustment[]) => void;
  /** Append an adjustment to an adjustment layer node. */
  addAdjustmentToLayer: (nodeId: NodeId, adjustment: import('@strata/engine').Adjustment) => void;
  /** Create a new adjustment layer node with a LUT adjustment. */
  addLutAdjustment: (lutAdjustment: import('@strata/engine').Adjustment) => void;
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
  setSnapGrid: (v: number) => void;
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
  /**
   * Apply a boolean operation between raster image nodes (ShapeNodes with
   * image fills) and vector ShapeNodes. Extracts alpha contours from each
   * raster node, converts to ShapeNodes, combines with vector nodes, and
   * applies the boolean operation. Replaces all operand nodes with the result.
   */
  booleanOpRaster: (
    kind: import('@strata/scene').BooleanOpKind,
    rasterNodeIds: import('@strata/scene').NodeId[],
    vectorNodeIds: import('@strata/scene').NodeId[],
  ) => Promise<void>;

  /** Remove background from the selected image node. */
  removeBackground: (method: import('@strata/scene').BackgroundRemovalMethod) => Promise<void>;
  /** Remove background with custom feather and decontaminate options. */
  removeBackgroundWithOptions: (
    method: import('@strata/scene').BackgroundRemovalMethod,
    feather: number,
    decontaminate: boolean,
  ) => Promise<void>;
  /** Cancel an in-progress background removal job. */
  cancelBackgroundRemoval: () => void;
  /** Enlarge the selected image into a new editable image layer. */
  upscaleSelectedImage: (options: import('@strata/engine').UpscaleOptions) => Promise<void>;
  /** Trace the selected image into a new editable vector group. */
  traceSelectedImage: (
    options: import('@strata/engine').RasterTraceOptions & { liveTrace?: boolean },
  ) => Promise<void>;
  /** Update live trace parameters on the first selected live-traced node (marks pending re-trace). */
  setSelectedLiveTraceParams: (params: Partial<import('@strata/scene').LiveTraceParams>) => void;
  /** Flatten the first selected live-traced node to ordinary vector geometry. */
  flattenSelectedLiveTrace: () => void;
  /** Cancel the first selected live-traced node and restore the source image. */
  clearSelectedLiveTrace: () => void;
  /** Cancel an in-progress image enlargement or trace job. */
  cancelImageProcessing: () => void;
  /** Toggle preview of original image (without background removal mask). */
  setShowOriginalBg: (nodeId: import('@strata/scene').NodeId | null) => void;
  setMaskPreviewMode: (mode: import('./context/types').MaskPreviewMode) => void;
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
  addGuide: (axis: 'horizontal' | 'vertical', position: number) => string;
  /** Remove a guide by id. */
  removeGuide: (id: string) => void;
  /** Move a guide to a new world position. */
  moveGuide: (id: string, position: number) => void;
  /** Toggle a guide's locked state. */
  toggleGuideLock: (id: string) => void;
  /** Lock all guides if any are unlocked; otherwise unlock all. */
  toggleLockAllGuides: () => void;
  /** Duplicate a guide at a new position. Returns the new guide id. */
  duplicateGuide: (id: string, position: number) => string;
  /** Remove all guides from the document. */
  clearAllGuides: () => void;
  /** Show or hide guide overlay lines (guides remain in document). */
  setGuidesVisible: (visible: boolean) => void;
  toggleGuidesVisible: () => void;
  setSelectedGuideId: (id: string | null) => void;
  nudgeSelectedGuide: (dx: number, dy: number) => void;
  /** Copy the selected guide to the clipboard. */
  copySelectedGuide: () => void;
  /** Paste guides from the clipboard onto the active page. */
  pasteGuides: () => Promise<void>;
  /** All guides on the active page. */
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

  /** Create a new master page with the given name and dimensions. */
  createMaster: (name: string, width: number, height: number) => void;
  /** Delete a master page by id. */
  deleteMaster: (masterId: NodeId) => void;
  /** Rename a master page. */
  renameMaster: (masterId: NodeId, name: string) => void;
  /** Duplicate a master page. */
  duplicateMaster: (masterId: NodeId) => void;
  /** Assign a master page to a specific page (null to detach). */
  assignMasterToPage: (pageId: NodeId, masterId: NodeId | null) => void;
  /** Set whether a master applies to all, left, or right pages. */
  setMasterAppliesTo: (masterId: NodeId, appliesTo: MasterAppliesTo) => void;
  /** Get nodes visible on the active page, including applied master content. */
  activePageNodesWithMaster: () => NodeId[];

  /** Rebuild spread groupings, optionally with a facing-pages config override. */
  rebuildSpreads: (facingPages?: FacingPagesConfig) => void;
  /** Get the spread that contains the given page id. */
  getSpreadForPage: (pageId: NodeId) => import('@strata/scene').Spread | undefined;
  /** Classify a page as left/right/none based on facing-pages mode. */
  getPageSide: (pageId: NodeId) => import('@strata/scene').PageSide;
  /** True when the page sits on the left side of a spread. */
  isPageOnLeftSide: (pageId: NodeId) => boolean;
  /** Get the 1-indexed page number for a page id. */
  getPageNumber: (pageId: NodeId) => number;
  /** Get formatted page number string (e.g. "iii", "A-1") respecting sections. */
  getFormattedPageNumber: (pageId: NodeId) => string;

  /** Toggle facing-pages mode on/off. */
  toggleFacingPages: () => void;
  /** Enable or disable facing-pages mode. */
  setFacingPagesEnabled: (enabled: boolean) => void;

  /** Document color mode (rgb / cmyk / grayscale). */
  documentColorMode: ColorMode;
  /** Switch the document color mode, converting all colors. */
  switchColorMode: (mode: ColorMode) => void;

  // Quick-mask mode
  /** Enter quick-mask mode: paint-based selection editing. */
  enterQuickMask: () => void;
  /** Exit quick-mask mode, optionally converting coverage to a raster mask. */
  exitQuickMask: (convertToMask?: boolean) => void;
  /** Replace the coverage buffer with externally-computed data. */
  setQuickMaskCoverage: (coverage: Uint8Array, width: number, height: number) => void;
  /** Paint a circular brush stroke into the coverage buffer. */
  paintQuickMask: (x: number, y: number, radius: number, value: number) => void;
  /** Fill the entire coverage buffer with a constant value. */
  fillQuickMask: (value: number) => void;
  /** Invert the coverage buffer (255 - v for every pixel). */
  invertQuickMask: () => void;
  /** Whether quick-mask mode is active. */
  isQuickMaskActive: () => boolean;

  /** Record a user action for analytics/onboarding/intelligence. */
  recordAction: (actionId: string) => void;

  /** Set foreground painting color (RGBA 0-255). */
  setForegroundColor: (color: [number, number, number, number]) => void;
  /** Set background painting color (RGBA 0-255). */
  setBackgroundColor: (color: [number, number, number, number]) => void;
  /** Swap foreground and background colors. */
  swapColors: () => void;
  /** Reset foreground/background to defaults (black/white). */
  resetColors: () => void;
  /** Update a single brush setting field. */
  setBrushSetting: <K extends keyof import('./context/types').EditorState['brushSettings']>(
    key: K,
    value: import('./context/types').EditorState['brushSettings'][K],
  ) => void;

  /** Extract a dominant color palette from image pixel data. */
  extractPalette: (data: ImageData, colorCount?: number) => import('@strata/engine').PaletteResult;
  /** Generate a harmony palette (complementary, triadic, etc.) from a base color. */
  generateHarmony: (
    color: import('@strata/scene').ManagedColor,
    type: 'complementary' | 'triadic' | 'analogous' | 'splitComplementary' | 'monochromatic',
  ) => import('@strata/engine').HarmonyPalette;
  /** Compute Miller's-Law/Hick's-Law cognitive load for a node (or the whole document if null). */
  getCognitiveLoad: (
    nodeId: import('@strata/scene').NodeId | null,
  ) => import('./intelligence/cognitiveLoad').CognitiveLoadReport;

  /** Switch the inspector panel to a tab, optionally selecting an IntelligencePanel sub-tab. */
  setInspectorTab: (tab: InspectorTab, subTab?: IntelligenceTab) => void;

  /** Turn a componentDetector.ts duplicate-structure group into a real component:
   *  the first node becomes the master definition, the rest are replaced in
   *  place with instances. Non-frame nodes in the group are left untouched. */
  createComponentFromGroup: (nodeIds: NodeId[]) => void;
}

export const EditorCtx = createContext<EditorContextValue | null>(null);

/** F2: full snapshot of an inactive session stored in a ref (not state). */
interface SavedSession {
  document: Document;
  selection: NodeId[];
  viewport: SavedViewport;
  undo: Document[];
  redo: Document[];
  undoSel: NodeId[][];
  redoSel: NodeId[][];
}

function snapshotEditorSession(
  s: EditorState,
  undo: Document[],
  redo: Document[],
  undoSel: NodeId[][],
  redoSel: NodeId[][],
): SavedSession {
  return {
    document: s.document,
    selection: s.selection,
    viewport: captureViewport(s),
    undo: [...undo],
    redo: [...redo],
    undoSel: [...undoSel],
    redoSel: [...redoSel],
  };
}

function restoreViewportFields(
  raw: Partial<SavedViewport> | undefined,
): Pick<
  EditorState,
  | 'zoom'
  | 'pan'
  | 'cameraRotation'
  | 'snapEnabled'
  | 'pixelGridEnabled'
  | 'rulerMode'
  | 'gridOverlayMode'
  | 'unitType'
  | 'guidesVisible'
  | 'snapGrid'
> {
  const v = normalizeSavedViewport(raw);
  return {
    zoom: v.zoom,
    pan: v.pan,
    cameraRotation: v.cameraRotation,
    snapEnabled: v.snapEnabled,
    pixelGridEnabled: v.pixelGridEnabled,
    rulerMode: v.rulerMode,
    gridOverlayMode: v.gridOverlayMode,
    unitType: v.unitType,
    guidesVisible: v.guidesVisible,
    snapGrid: v.snapGrid,
  };
}

function persistViewportPrefs(s: EditorState): void {
  updateSettings({
    viewport: {
      snapEnabled: s.snapEnabled,
      pixelGridEnabled: s.pixelGridEnabled,
      rulerMode: s.rulerMode,
      gridOverlayMode: s.gridOverlayMode,
      unitType: s.unitType,
      guidesVisible: s.guidesVisible,
      snapGrid: s.snapGrid,
    },
  });
}

function computeDocumentUnionBounds(
  doc: Document,
): { x: number; y: number; w: number; h: number } | null {
  const entries = walkNodes(doc);
  let union: { x: number; y: number; w: number; h: number } | null = null;
  for (const [id] of entries) {
    const b = nodeWorldBounds(doc, id);
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
  return union;
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
    case 'crop':
    case 'paint':
    case 'eraser':
    case 'smudge':
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

/**
 * Resize a node to world-space width/height `w`/`h`, keeping its local
 * origin (top-left of `nodeLocalBounds`) fixed so `node.transform`'s
 * translation stays the node's on-canvas position. Shared by the canvas
 * resize handles (`setNodeSize`) and the Position/Size inspector
 * (`setSelectedW`/`setSelectedH`) so both paths agree on geometry.
 */
function resizeSceneNode(n: SceneNode, w: number, h: number): SceneNode {
  if (n.kind === 'frame') return { ...n, w, h };
  if (n.kind === 'text') return { ...n, w, h };
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
          from: [cx + (s.from[0] - cx) * sx, cy + (s.from[1] - cy) * sy] as [number, number],
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
          from: [cx2 + (s.from[0] - cx2) * sx2, cy2 + (s.from[1] - cy2) * sy2] as [number, number],
          to: [cx2 + (s.to[0] - cx2) * sx2, cy2 + (s.to[1] - cy2) * sy2] as [number, number],
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
              ? ([p.handleIn[0] * sx3, p.handleIn[1] * sy3] as [number, number])
              : null,
            handleOut: p.handleOut
              ? ([p.handleOut[0] * sx3, p.handleOut[1] * sy3] as [number, number])
              : null,
          })),
        },
      };
    }
    default:
      return n;
  }
}

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

/** No-op fallback for motion methods used before MotionProvider mounts. */
const MOTION_NOOP: MotionContextValue = {
  playTimeline: () => {},
  pauseTimeline: () => {},
  stopTimeline: () => {},
  seekTimeline: () => {},
  setActiveTimeline: () => {},
  setPlaybackSpeed: () => {},
  toggleLoop: () => {},
  addKeyframeToSelected: () => {},
  createTimeline: () => '',
  removeTimeline: () => {},
  renameTimeline: () => {},
  removeTrack: () => {},
  toggleTimelinePanel: () => {},
  addTimelineMarker: () => {},
  removeTimelineMarker: () => {},
  renameTimelineMarker: () => {},
  createMotionPresetFromTimeline: () => '',
  applyMotionPreset: () => {},
  toggleAutoKeyframe: () => {},
};

/** No-op fallback for prototype methods used before PrototypeProvider mounts. */
const PROTO_NOOP: import('./context/PrototypeContext').PrototypeContextValue = {
  setPrototypeMode: () => {},
  updatePrototypeData: () => {},
  handlePrototypeEvent: () => {},
  getPrototypeVariable: () => undefined,
  setPrototypeVariable: () => {},
  startPresentation: () => {},
  stopPresentation: () => {},
  getPrototypeScreens: () => [],
  prototypeCurrentScreen: '',
  navigatePrototypeTo: () => {},
  prototypeTransition: null,
  clearPrototypeTransition: () => {},
  selectedInteractionId: null,
  selectPrototypeInteraction: () => {},
};

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
    const vpDefaults = loadSettings().viewport;
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
      unitType: vpDefaults.unitType,
      pixelGridEnabled: vpDefaults.pixelGridEnabled,
      snapEnabled: vpDefaults.snapEnabled,
      snapGrid: vpDefaults.snapGrid,
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
      // Transient view state, not persisted — each session starts with full
      // chrome visible rather than silently reopening into a hidden-panel state.
      distractionFreeMode: false,
      beforeAfterCompare: false,
      // Hidden by default — motion/timeline editing is an opt-in workflow the
      // user reaches via its own toggle, not something every document should
      // open into.
      timelinePanelVisible: false,
      motion: createInitialMotionState(),
      canvasMode: 'full',
      workspaceMode: 'design' as WorkspaceMode,
      cameraRotation: 0,
      rulerMode: vpDefaults.rulerMode as RulerMode,
      gridOverlayMode: vpDefaults.gridOverlayMode as GridOverlayMode,
      guidesVisible: vpDefaults.guidesVisible,
      selectedGuideId: null,
      currentPageId: null,
      isolatedNodeId: null,
      showOriginalBgNodeId: null,
      maskPreviewMode: 'checkerboard' as const,
      refineMaskOptions: { brushSize: 20, hardness: 0.8 },
      trimapEditOptions: { brushSize: 20, hardness: 0.8, penMode: 'unknown' as const },
      brushSettings: {
        presetId: 'built-in-round',
        radius: 10,
        opacity: 1,
        flow: 1,
        hardness: 0.8,
        smoothing: 0.5,
        spacing: 0.25,
        smudgeStrength: 0.5,
        smudgeMode: 'sampling' as const,
        grainId: null,
        grainScale: 1,
        grainRotation: 0,
        grainContrast: 0.5,
        grainInvert: false,
        wetEnabled: false,
        wetEdge: false,
        wetMixStrength: 0.5,
        wetDryingRate: 0.5,
      },
      subjectPickerSession: null,
      keyObjectId: null,
      alignToPage: false,
      colorBlindnessView: 'none',
      foregroundColor: [0, 0, 0, 255] as [number, number, number, number],
      backgroundColor: [255, 255, 255, 255] as [number, number, number, number],
      quickMask: {
        active: false,
        color: [255, 0, 0, 128] as [number, number, number, number],
        coverage: null,
        width: 0,
        height: 0,
      },
    };
  });
  const [showExportDialog, setShowExportDialog] = useState(false);
  /** Ref keeping the latest state for async callbacks (auto-save, recovery). */
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Transform cache — invalidated whenever document reference changes. */
  const transformCacheRef = useRef<TransformCache>(createTransformCache());
  const prevDocRef = useRef(state.document);
  const frameSpatialIndexRef = useRef<FrameSpatialIndex | null>(null);
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
  /** Selection history for back/forward navigation. */
  const selectionHistory = useSelectionHistory();

  /** Snapshot current session into the session store (for tab switching). */
  const snapshotSession = useCallback(() => {
    const sid = stateRef.current.activeId;
    if (sid) {
      sessionStoreRef.current.set(
        sid,
        snapshotEditorSession(
          stateRef.current,
          undoStackRef.current,
          redoStackRef.current,
          undoSelStackRef.current,
          redoSelStackRef.current,
        ),
      );
    }
  }, [stateRef, sessionStoreRef]);

  /** Reset undo/redo stacks. */
  const resetUndo = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    undoSelStackRef.current = [];
    redoSelStackRef.current = [];
  }, []);

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
            await upsertPreservingMeta(platform, meta.fileId, meta.name, json);
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
  /** In-flight single-image background removal — aborted on selection change/unmount. */
  const bgRemovalAbortRef = useRef<AbortController | null>(null);
  const processingBgNodeRef = useRef<NodeId | null>(null);
  /** In-flight image enlargement or tracing, aborted on selection change/unmount. */
  const imageProcessingAbortRef = useRef<AbortController | null>(null);
  const processingImageNodeRef = useRef<NodeId | null>(null);
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

  useEffect(() => {
    const processingId = processingImageNodeRef.current;
    if (processingId && !state.selection.includes(processingId)) {
      imageProcessingAbortRef.current?.abort();
      imageProcessingAbortRef.current = null;
      processingImageNodeRef.current = null;
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
      imageProcessingAbortRef.current?.abort();
      imageProcessingAbortRef.current = null;
      processingImageNodeRef.current = null;
      autoSaveRef.current?.stop();
      void import('@strata/engine').then(({ terminateWorkerPool }) => terminateWorkerPool());
    };
  }, []);

  const patch = useCallback((partial: Partial<EditorState>) => {
    // Update stateRef synchronously so async callbacks (menu actions,
    // keyboard shortcuts) see the latest state even before React flushes.
    stateRef.current = { ...stateRef.current, ...partial };
    setState((s) => ({ ...s, ...partial }));
  }, []);

  /** Persistence (save/load/document lifecycle). */
  const { newDocument, serializeDocument, save, saveAs, loadDocument } = usePersistence(
    state,
    patch,
    stateRef,
    platform,
    snapshotSession,
    resetUndo,
    recoveryRef,
    computeFitAllCamera,
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

  const setCamera = useCallback((camera: Camera) => {
    setState((current) => {
      const canvasEl = document.querySelector<HTMLElement>('canvas.editor-canvas__content-layer');
      const viewport: Viewport = canvasEl
        ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
        : { width: window.innerWidth, height: window.innerHeight - 120 };
      const candidate: Camera = {
        zoom: clampZoom(camera.zoom),
        pan: { x: camera.pan.x, y: camera.pan.y },
        rotation: camera.rotation ?? current.cameraRotation,
      };
      const clamped = clampCamera(
        candidate,
        viewport,
        computeDocumentUnionBounds(current.document),
      );
      return {
        ...current,
        zoom: clamped.zoom,
        pan: clamped.pan,
        cameraRotation: clamped.rotation ?? 0,
      };
    });
  }, []);

  const [motionValue, setMotionValue] = useState<MotionContextValue | null>(null);
  const [protoValue, setProtoValue] = useState<
    import('./context/PrototypeContext').PrototypeContextValue | null
  >(null);
  const bgRemoval = useBackgroundRemoval(
    state,
    patch,
    setState,
    stateRef,
    updateDoc,
    announcerRef,
    bgRemovalAbortRef,
    processingBgNodeRef,
    trimapStoreRef,
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
      setCamera,
      setZoom: (z) => {
        setState((current) => {
          const canvasEl = document.querySelector<HTMLElement>(
            'canvas.editor-canvas__content-layer',
          );
          const viewport: Viewport = canvasEl
            ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
            : { width: window.innerWidth, height: window.innerHeight - 120 };
          return {
            ...current,
            ...computeZoomTo(
              {
                zoom: current.zoom,
                pan: current.pan,
                cameraRotation: current.cameraRotation,
              },
              z,
              viewport,
            ),
          };
        });
      },
      setPan: (p) => {
        setState((current) => {
          const canvasEl = document.querySelector<HTMLElement>(
            'canvas.editor-canvas__content-layer',
          );
          const viewport: Viewport = canvasEl
            ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
            : { width: window.innerWidth, height: window.innerHeight - 120 };
          const camera = clampCamera(
            { zoom: current.zoom, pan: p, rotation: current.cameraRotation },
            viewport,
            computeDocumentUnionBounds(current.document),
          );
          return { ...current, pan: camera.pan };
        });
      },
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
        patch(computeZoomStep(camState, 'in', vp));
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
        patch(computeZoomStep(camState, 'out', vp));
      },
      zoomTo: (level) => {
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        const camState = {
          zoom: state.zoom,
          pan: state.pan,
          cameraRotation: state.cameraRotation,
        };
        patch(computeZoomTo(camState, level, vp));
      },
      smoothZoomTo: (targetZoom, durationMs = 200) => {
        const s = stateRef.current;
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        const startCamState = {
          zoom: s.zoom,
          pan: s.pan,
          cameraRotation: s.cameraRotation,
        };
        const startCam = toCamera(startCamState);
        const centre = editorScreenToWorld(startCamState, vp.width / 2, vp.height / 2, vp);
        const endCam = zoomAboutPoint(startCam, centre, clampZoom(targetZoom), vp);
        const startTime = performance.now();
        requestAnimationFrame(function tick(now: number) {
          const elapsed = now - startTime;
          const { camera, done } = animateCamera(startCam, endCam, elapsed, durationMs);
          patch({ zoom: camera.zoom, pan: camera.pan, cameraRotation: camera.rotation ?? 0 });
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
      toggleDistractionFreeMode: () => {
        const next = !state.distractionFreeMode;
        patch({ distractionFreeMode: next });
        announcerRef.current?.announce(
          next ? 'Distraction-free mode on' : 'Distraction-free mode off',
        );
      },
      toggleBeforeAfterCompare: () => {
        const next = !state.beforeAfterCompare;
        patch({ beforeAfterCompare: next });
        announcerRef.current?.announce(next ? 'Showing original image' : 'Showing current edit');
      },
      workspaceMode: state.workspaceMode,
      setWorkspaceMode: (mode: WorkspaceMode) => {
        const config = getWorkspaceConfig(mode);
        const patchObj: Partial<EditorState> & Record<string, unknown> = {
          workspaceMode: mode,
          leftPanelVisible: config.visiblePanels.layers,
          rightPanelVisible: config.visiblePanels.inspector,
          timelinePanelVisible: config.visiblePanels.timeline,
        };
        if (config.defaultTool && config.defaultTool !== state.tool) {
          patchObj.tool = config.defaultTool as ToolId;
        }
        patch(patchObj as Partial<EditorState>);
        updateSettings({
          panel: {
            leftPanelVisible: config.visiblePanels.layers,
            rightPanelVisible: config.visiblePanels.inspector,
          },
        });
        announcerRef.current?.announce(`Switched to ${mode} workspace`);
      },
      resetWorkspaceToDefault: () => {
        const mode = state.workspaceMode;
        const config = getWorkspaceConfig(mode);
        const patchObj: Partial<EditorState> & Record<string, unknown> = {
          leftPanelVisible: config.visiblePanels.layers,
          rightPanelVisible: config.visiblePanels.inspector,
          timelinePanelVisible: config.visiblePanels.timeline,
        };
        if (config.defaultTool) {
          patchObj.tool = config.defaultTool as ToolId;
        }
        patch(patchObj as Partial<EditorState>);
        announcerRef.current?.announce(`Reset ${mode} workspace to defaults`);
      },
      fitAll: () => {
        const cam = computeFitAllCamera(state.document, getCanvasViewport());
        if (cam) patch({ zoom: cam.zoom, pan: cam.pan });
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
      setSelection: (id) => {
        const newSelection = id ? [id] : [];
        selectionHistory.push(newSelection);
        patch({ selection: newSelection });
      },

      // F1: additive = shift+click behaviour.
      // Read from stateRef.current.selection (not the closed-over state.selection)
      // so callers that batch setSelection + toggleSelection (e.g. selectAll)
      // see the accumulation from prior calls in the same synchronous tick.
      toggleSelection: (id, additive = false) => {
        const currentSel = stateRef.current.selection;
        const nextSelection = (() => {
          if (additive) {
            const already = currentSel.includes(id);
            return already ? currentSel.filter((x) => x !== id) : [...currentSel, id];
          }
          return [id];
        })();
        selectionHistory.push(nextSelection);
        stateRef.current = { ...stateRef.current, selection: nextSelection };
        setState((s) => ({ ...s, selection: nextSelection }));
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
      createShapeAt: (world, size, parentId, pathPoints, pathClosed) => {
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
            'refineMask',
            'trimapEdit',
            'crop',
            'paint',
            'eraser',
          ];
          if (nonDrawingTools.includes(activeTool)) {
            throw new Error(`createShapeAt called for non-drawing tool: ${activeTool}`);
          }

          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];

          const { id, doc: d2 } = nextNodeId(s.document);
          const transform: Affine = [1, 0, 0, 1, world.x, world.y];

          let node: SceneNode;
          let isFrame = false;
          if (activeTool === 'frame' || activeTool === 'slice') {
            node = makeFrameNode(id, {
              name: 'Node',
              transform,
              fill: { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
              children: [],
              w: size?.w ?? 375,
              h: size?.h ?? 812,
            });
            isFrame = true;
          } else if (pathPoints && pathPoints.length > 0) {
            // Path tools pass world-space anchors; store node-local relative to origin.
            const localPoints = pathPoints.map((p) => ({
              ...p,
              x: p.x - world.x,
              y: p.y - world.y,
            }));
            const shape: Shape = {
              kind: 'path',
              points: localPoints,
              closed: pathClosed ?? false,
              tolerance: 3,
            };
            node = makeShapeNode(id, shape, { name: 'Node', transform });
          } else {
            const shape: Shape = size
              ? buildShapeWithSize(activeTool, size)
              : shapeForTool(activeTool);
            const strokeOpts =
              activeTool === 'arrow'
                ? {
                    strokes: [
                      {
                        color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
                        weight: 2,
                        align: 'center' as const,
                        dashPattern: [],
                        dashOffset: 0,
                        cap: 'round' as const,
                        join: 'miter' as const,
                        miterLimit: 4,
                        visible: true,
                        arrowEnd: 'arrow' as const,
                      },
                    ],
                  }
                : activeTool === 'line'
                  ? {
                      strokes: [
                        {
                          color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
                          weight: 2,
                          align: 'center' as const,
                          dashPattern: [],
                          dashOffset: 0,
                          cap: 'round' as const,
                          join: 'miter' as const,
                          miterLimit: 4,
                          visible: true,
                        },
                      ],
                    }
                  : {};
            node = makeShapeNode(id, shape, { name: 'Node', transform, ...strokeOpts });
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

          // Frame capture-on-draw: if we just created a frame, capture any
          // fully-contained sibling nodes into it
          if (isFrame) {
            const frameNode = newDoc.nodes[id] as import('@strata/scene').FrameNode;
            // Compute true world-space AABB via nodeWorldTransform + transformRect
            // instead of using axis-aligned local dims at world click position.
            // This correctly handles rotated/scaled parent frames where the
            // frame's local w/h differ from its world-space AABB.
            const frameWorld = nodeWorldTransform(newDoc, id);
            const frameBounds = transformRect(frameWorld, {
              x: 0,
              y: 0,
              w: frameNode.w,
              h: frameNode.h,
            });
            const parentIndex = buildParentIndexMap(newDoc);

            // Find siblings (nodes with same parent as the new frame)
            const frameParent = parentIndex.get(id);
            const siblings: NodeId[] = [];
            for (const [nodeId, parentId] of parentIndex.entries()) {
              if (parentId === frameParent && nodeId !== id) {
                siblings.push(nodeId);
              }
            }

            // Capture fully-contained siblings
            for (const siblingId of siblings) {
              const siblingBounds = nodeWorldBounds(newDoc, siblingId, parentIndex);
              if (!siblingBounds) continue;

              // Check full containment (sibling must be entirely inside frame)
              if (
                siblingBounds.x >= frameBounds.x &&
                siblingBounds.y >= frameBounds.y &&
                siblingBounds.x + siblingBounds.w <= frameBounds.x + frameBounds.w &&
                siblingBounds.y + siblingBounds.h <= frameBounds.y + frameBounds.h
              ) {
                // Reparent sibling into the new frame with transform preservation
                const siblingNode = newDoc.nodes[siblingId];
                if (siblingNode && !siblingNode.locked) {
                  const frameWorld = nodeWorldTransform(newDoc, id);
                  const frameInv = invertAffine(frameWorld);
                  const siblingWorld = nodeWorldTransform(newDoc, siblingId);
                  const newLocal = multiplyAffine(frameInv, siblingWorld);
                  newDoc = reparentNodeDoc(newDoc, siblingId, id, -1, newLocal);
                }
              }
            }
          }

          // Apply context-aware auto-name now that the node is in the document
          // and any frame children have been captured.
          const finalName = autoName(newDoc, newDoc.nodes[id]!);
          if (finalName !== newDoc.nodes[id]!.name) {
            newDoc = {
              ...newDoc,
              nodes: {
                ...newDoc.nodes,
                [id]: { ...newDoc.nodes[id]!, name: finalName } as SceneNode,
              },
            };
          }

          const keepDrawTool = activeTool === 'pen' || activeTool === 'pencil';
          return {
            ...s,
            document: newDoc,
            selection: [id],
            tool: keepDrawTool ? activeTool : ('select' as ToolId),
          };
        });
      },

      createTextNodeAt: (world, size, parentId, text = '') => {
        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          redoStackRef.current = [];

          const { id, doc: d2 } = nextNodeId(s.document);
          const transform: Affine = [1, 0, 0, 1, world.x, world.y];

          const node = makeTextNode(id, text, {
            name: 'Node',
            transform,
            fontSize: 16,
            w: size?.w,
            h: size?.h,
            textMode: size ? 'area' : 'point',
            textResizing: size ? 'fixed' : 'autoWidth',
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

          const finalName = autoName(newDoc, newDoc.nodes[id]!);
          if (finalName !== newDoc.nodes[id]!.name) {
            newDoc = {
              ...newDoc,
              nodes: {
                ...newDoc.nodes,
                [id]: { ...newDoc.nodes[id]!, name: finalName } as SceneNode,
              },
            };
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

          // World-space center of the visible canvas area, using the real
          // canvas element size and the floating origin so this matches
          // what's actually on screen regardless of current pan/zoom.
          const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
          const vp: Viewport = canvasEl
            ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
            : { width: window.innerWidth, height: window.innerHeight - 120 };
          const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
          const center = editorScreenToWorld(camState, vp.width / 2, vp.height / 2, vp);
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

          // Add to the active page's content root so the node is scoped to
          // the active page (activePageNodes), not global rootChildren —
          // otherwise it's invisible to the canvas renderer while still
          // showing in the Layers panel. Mirrors createShapeAt.
          const activePage = d2.pages?.find((p) => p.id === d2.activePageId);
          const contentRootId = activePage?.contentRoot;
          const newDoc =
            contentRootId && d2.nodes[contentRootId]
              ? addChild(d2, contentRootId, node)
              : addNode(d2, node);

          return { ...s, document: newDoc, selection: [id] };
        });
      },

      findContainingFrame: (world, providedFrameIndex) => {
        const frameIndex =
          providedFrameIndex ??
          getOrCreateFrameSpatialIndex(state.document, frameSpatialIndexRef.current);
        frameSpatialIndexRef.current = frameIndex;
        return findContainingFrameInDoc(state.document, world, frameIndex);
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
        const engine = new HitTestEngine(state.document, {
          isolatedNodeId: state.isolatedNodeId,
          zoom: state.zoom,
        });
        const hit = engine.hitTest(world);
        return hit ? { nodeId: hit.nodeId, node: hit.node } : null;
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

      setDropTargetFrame: (_id: NodeId | null) => {
        // setDropTargetFrame is injected by CanvasArea; this stub ensures the context
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
          let d = { ...doc, nodes: { ...doc.nodes } };
          for (const id of sel) {
            const node = d.nodes[id];
            if (!node) continue;
            const current = resolveNodeFills(node);
            const next = [...current];
            if (index >= 0 && index < next.length) next[index] = fill;
            else next.push(fill);
            d.nodes[id] = { ...node, fills: next } as SceneNode;
            // When an image fill's src changes and the node has a raster mask,
            // mark the mask stale so the user knows to re-run background removal.
            if (
              node.mask?.rasterMask &&
              fill.type === 'image' &&
              fill.image?.src &&
              current[index]?.type === 'image' &&
              current[index]?.image?.src &&
              current[index]?.image?.src !== fill.image.src
            ) {
              d = markMaskStale(d, id, 'source-replaced');
            }
          }
          return d;
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
        updateNodeProp(id, (n) => resizeSceneNode(n, w, h));
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
            if (!node) continue;
            const bounds = nodeLocalBounds(node, doc);
            if (!bounds) continue;
            nodes[id] = resizeSceneNode(node, w, bounds.h);
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
            if (!node) continue;
            const bounds = nodeLocalBounds(node, doc);
            if (!bounds) continue;
            nodes[id] = resizeSceneNode(node, bounds.w, h);
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

      // F6: batch-edit flip H — negate the X-basis vector [a, b] while
      // preserving the visual centre.  The local-space centre is derived
      // from nodeLocalBounds; when bounds are unavailable (groups, etc.)
      // the translation is left unchanged (identity-local case).
      setSelectedFlipH: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            const [a, b, c, d, e, f] = node.transform as Affine;
            const lb = nodeLocalBounds(node, doc);
            const lcx = lb ? lb.x + lb.w / 2 : 0;
            // Negate X-basis and shift both e and f to keep world centre fixed.
            //   e' = e + 2·a·localCentreX
            //   f' = f + 2·b·localCentreX
            nodes[id] = {
              ...node,
              transform: [-a, -b, c, d, e + 2 * a * lcx, f + 2 * b * lcx] as Affine,
            } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      // F6: batch-edit flip V — negate the Y-basis vector [c, d] while
      // preserving the visual centre.
      setSelectedFlipV: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            const [a, b, c, d, e, f] = node.transform as Affine;
            const lb = nodeLocalBounds(node, doc);
            const lcy = lb ? lb.y + lb.h / 2 : 0;
            // Negate Y-basis and shift both e and f to keep world centre fixed:
            //   e' = e + 2·c·localCentreY
            //   f' = f + 2·d·localCentreY
            nodes[id] = {
              ...node,
              transform: [a, b, -c, -d, e + 2 * c * lcy, f + 2 * d * lcy] as Affine,
            } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      // F6: batch-edit corner radius on shape/frame nodes
      setSelectedCornerRadius: (value) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (node?.kind !== 'shape' && node?.kind !== 'frame') continue;
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

      // P0*: distribute with configurable mode (equalGap or equalCenter)
      distributeWithMode: (axis, mode) => {
        const sel = state.selection;
        if (sel.length < 3) return;
        const doc = state.document;
        const items = getValidItemsWithBounds(sel, doc);
        if (items.length < 3) return;

        let positions: number[] | null;
        if (mode === 'equalCenter') {
          positions = computeDistributionCenters(
            axis,
            items.map((i) => i.bounds),
          );
          if (!positions) return;
          // Centers mode: positions are center coordinates. Convert to origin positions.
          const sortedByCenter = [...items].sort((a, b) => {
            const ca =
              axis === 'horizontal' ? a.bounds.x + a.bounds.w / 2 : a.bounds.y + a.bounds.h / 2;
            const cb =
              axis === 'horizontal' ? b.bounds.x + b.bounds.w / 2 : b.bounds.y + b.bounds.h / 2;
            return ca - cb;
          });
          updateDoc((newDoc) => {
            const nodes = { ...newDoc.nodes };
            for (let i = 0; i < sortedByCenter.length; i++) {
              const { id, node, bounds: b } = sortedByCenter[i]!;
              if (!nodes[id]) continue;
              const centerPos = positions![i]!;
              const targetWorldX = axis === 'horizontal' ? centerPos - b.w / 2 : b.x;
              const targetWorldY = axis === 'vertical' ? centerPos - b.h / 2 : b.y;
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
          return;
        }

        // equalGap mode — reuse distributeSelected logic
        const sorted = [...items].sort((a, b) => {
          return (
            (axis === 'horizontal' ? a.bounds.x : a.bounds.y) -
            (axis === 'horizontal' ? b.bounds.x : b.bounds.y)
          );
        });
        positions = computeDistribution(
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
              positions![i]!,
              i,
              b,
              axis,
              sorted.map((s) => s.bounds),
            );
            const wm = nodeWorldTransform(doc, id);
            const bOffX = b.x - wm[4];
            const bOffY = b.y - wm[5];
            const nodeOriginWorldX = pos.x - bOffX;
            const nodeOriginWorldY = pos.y - bOffY;
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
          const lb = nodeLocalBounds(node, doc);
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

      // Text chain operations
      createTextChain,
      deleteTextChain,
      appendFrameToChain,
      removeFrameFromChain,

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

      newDocument,
      serializeDocument,
      save,
      saveAs,

      saveState: state.saveState,
      lastSavedAt: state.lastSavedAt,
      keyObjectId: state.keyObjectId,
      alignToPage: state.alignToPage,

      loadDocument,

      rootNodes,

      createComponentFromFrame: (name, masterRootId, slots) => {
        updateDoc((doc) => {
          const { doc: d2 } = createComponent(doc, name, masterRootId, slots);
          return d2;
        });
      },

      createComponentFromGroup: (nodeIds: NodeId[]) => {
        const masterRootId = nodeIds[0];
        if (!masterRootId) return;
        const master = state.document.nodes[masterRootId];
        if (master?.kind !== 'frame') {
          toastHandler?.({
            message: 'Only frame-based groups can become components.',
            type: 'warning',
          });
          return;
        }
        updateDoc((doc) => {
          const { component, doc: withDef } = createComponent(doc, master.name, masterRootId, []);
          let next = withDef;
          for (const nodeId of nodeIds.slice(1)) {
            const original = next.nodes[nodeId];
            if (original?.kind !== 'frame') continue;
            const parentId = getParent(next, nodeId);
            const { node: instanceNode, doc: withInstance } = instantiateComponent(next, component);
            next = withInstance;
            const placed: SceneNode = {
              ...instanceNode,
              transform: original.transform,
              opacity: original.opacity,
              rotation: original.rotation,
              visible: original.visible,
              locked: original.locked,
            };
            next = removeNode(next, nodeId);
            next = parentId ? addChild(next, parentId, placed) : addNode(next, placed);
          }
          return next;
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
        updateDoc((doc) => setActivePageDoc(doc, pageId));
      },
      setCurrentPageId: (id) => {
        patch({ currentPageId: id });
      },

      activePageNodes: () => {
        return getActivePageNodes(state.document);
      },

      // Master page methods
      createMaster: (name, width, height) => {
        updateDoc((doc) => createMasterDoc(doc, { name, width, height }));
      },
      deleteMaster: (masterId) => {
        updateDoc((doc) => deleteMasterDoc(doc, masterId));
      },
      renameMaster: (masterId, name) => {
        updateDoc((doc) => renameMasterDoc(doc, masterId, name));
      },
      duplicateMaster: (masterId) => {
        updateDoc((doc) => duplicateMasterDoc(doc, masterId));
      },
      assignMasterToPage: (pageId, masterId) => {
        updateDoc((doc) => assignMasterToPageDoc(doc, pageId, masterId));
      },
      setMasterAppliesTo: (masterId, appliesTo) => {
        updateDoc((doc) => setMasterAppliesToDoc(doc, masterId, appliesTo));
      },
      activePageNodesWithMaster: () => {
        const doc = state.document;
        if (!doc.activePageId) return getActivePageNodes(doc);
        return getActivePageNodesWithMaster(doc, doc.activePageId);
      },

      // Spread methods
      rebuildSpreads: (facingPages) => {
        updateDoc((doc) => rebuildSpreadsDoc(doc, facingPages));
      },
      getSpreadForPage: (pageId) => {
        return getSpreadForPageDoc(state.document, pageId);
      },
      getPageSide: (pageId) => {
        return getPageSideDoc(state.document, pageId);
      },
      isPageOnLeftSide: (pageId) => {
        return isPageOnLeftSideDoc(state.document, pageId);
      },

      // Page numbering
      getPageNumber: (pageId) => {
        return getPageNumberDoc(state.document, pageId);
      },
      getFormattedPageNumber: (pageId) => {
        return getFormattedPageNumberDoc(state.document, pageId);
      },

      // Facing pages toggle
      toggleFacingPages: () => {
        updateDoc((doc) => toggleFacingPagesDoc(doc));
      },
      setFacingPagesEnabled: (enabled) => {
        updateDoc((doc) => setFacingPagesEnabledDoc(doc, enabled));
      },

      recordAction: (actionId: string) => {
        getActionTracker().record(actionId);
      },

      extractPalette: (data: ImageData, colorCount?: number) => {
        return engineExtractPalette(data, colorCount);
      },
      generateHarmony: (
        color: import('@strata/scene').ManagedColor,
        type: 'complementary' | 'triadic' | 'analogous' | 'splitComplementary' | 'monochromatic',
      ) => {
        switch (type) {
          case 'complementary':
            return complementaryHarmony(color);
          case 'triadic':
            return triadicHarmony(color);
          case 'analogous':
            return analogousHarmony(color);
          case 'splitComplementary':
            return splitComplementaryHarmony(color);
          case 'monochromatic':
            return monochromaticHarmony(color);
        }
      },
      getCognitiveLoad: (nodeId: import('@strata/scene').NodeId | null) => {
        return computeCognitiveLoad(state.document, nodeId);
      },

      setInspectorTab: (tab: InspectorTab, subTab?: IntelligenceTab) => {
        if (!state.rightPanelVisible) {
          patch({ rightPanelVisible: true });
          updateSettings({ panel: { rightPanelVisible: true } });
        }
        inspectorTabHandler?.({ tab, subTab });
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

      selectPreviousSelection: () => {
        const prev = selectionHistory.selectPrevious();
        if (prev) {
          patch({ selection: prev });
          announcerRef.current?.announce('Selection history back');
        }
      },

      selectNextSelection: () => {
        const next = selectionHistory.selectNext();
        if (next) {
          patch({ selection: next });
          announcerRef.current?.announce('Selection history forward');
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
      showToast: (opts) => {
        announcerRef.current?.announce(opts.message);
        toastHandler?.(opts);
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

      addMaskToSelected: (type: MaskType = 'alpha') => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => {
          const container = doc.nodes[id];
          if (!container || !('children' in container)) return doc;
          const children = container.children;
          // Use first child as mask source, or find a shape child
          const maskSource = children.length > 0 ? children[0] : null;
          if (!maskSource || !doc.nodes[maskSource]) return doc;
          return addMaskDoc(doc, id, maskSource, type);
        });
      },

      removeMaskFromSelected: () => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => removeMaskDoc(doc, id));
      },

      toggleMask: () => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => {
          const container = doc.nodes[id];
          const n = container as { mask?: { visible?: boolean } };
          if (!n.mask) return doc;
          return setMaskVisibleDoc(doc, id, !n.mask.visible);
        });
      },

      invertMask: () => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => {
          const container = doc.nodes[id];
          const n = container as { mask?: { inverted?: boolean } };
          if (!n.mask) return doc;
          return setMaskInvertedDoc(doc, id, !n.mask.inverted);
        });
      },

      setMaskFeather: (feather: number) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => setMaskFeatherDoc(doc, id, feather));
      },

      setMaskDensity: (density: number) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => setMaskDensityDoc(doc, id, density));
      },

      setMaskHideSource: (hidden: boolean) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => setMaskHideSourceDoc(doc, id, hidden));
      },

      setMaskLinked: (linked: boolean) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => setMaskLinkedDoc(doc, id, linked));
      },

      setMaskType: (type: MaskType) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => setMaskTypeDoc(doc, id, type));
      },

      setMaskSourceNode: (sourceNodeId: string) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => setMaskSourceNodeDoc(doc, id, sourceNodeId as NodeId));
      },

      setMaskFillRule: (fillRule: import('@strata/scene').MaskFillRule) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => setMaskFillRuleDoc(doc, id, fillRule));
      },

      setMaskVectorPath: (points: import('@strata/engine').PathPoint[], closed: boolean) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => setMaskVectorPathDoc(doc, id, points, closed));
      },

      // ── Clipping masks ──

      createClippingMaskFromSelected: (selectionOverride?: NodeId[]) => {
        // Read selection inside setState callback where React guarantees the latest
        // state, avoiding stale reads from stateRef when called after selectAll
        // (React 18 batching may not have flushed yet).
        setState((s) => {
          const sel = selectionOverride ?? s.selection;
          if (sel.length < 2) {
            announcerRef.current?.announce('Select a mask shape and at least one content layer');
            return s;
          }
          let maskIdx = -1;
          for (let i = 0; i < sel.length; i++) {
            const id = sel[i]!;
            const node = s.document.nodes[id];
            if (node && canBeClipMaskSource(node)) {
              maskIdx = i;
              break;
            }
          }
          if (maskIdx < 0) {
            announcerRef.current?.announce(
              'No node in selection can be used as a clipping mask shape',
            );
            return s;
          }

          const maskNodeId = sel[maskIdx]!;
          const contentIds = sel.filter((id) => id !== maskNodeId);

          const maskNode = s.document.nodes[maskNodeId];
          if (!maskNode || !canBeClipMaskSource(maskNode)) {
            announcerRef.current?.announce('Selected node cannot be used as a clipping mask shape');
            return s;
          }

          if (!inTransactionRef.current) {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
            redoStackRef.current = [];
            redoSelStackRef.current = [];
          }
          try {
            const result = createClippingMaskDoc(s.document, maskNodeId, contentIds, {
              type: 'clip',
              hideMaskSource: true,
              linked: true,
            });
            return {
              ...s,
              document: result.doc,
              selection: [result.groupId],
              dirty: true,
            };
          } catch (err) {
            announcerRef.current?.announce(
              err instanceof Error ? err.message : 'Failed to create clipping mask',
            );
            return s;
          }
        });
      },

      releaseClippingMaskFromSelected: () => {
        const sel = stateRef.current.selection;
        const id = sel[0];
        if (!id) return;

        const node = stateRef.current.document.nodes[id];
        if (!node || !isClippingMaskGroup(node)) {
          announcerRef.current?.announce('Selected node is not a clipping mask group');
          return;
        }
        // node is a GroupNode or FrameNode (has children) — safe after isClippingMaskGroup check
        const groupNode = node as { children: string[] };

        setState((s) => {
          if (!inTransactionRef.current) {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
            redoStackRef.current = [];
            redoSelStackRef.current = [];
          }
          const childIds = [...groupNode.children];
          const newDoc = releaseClippingMaskDoc(s.document, id);
          return {
            ...s,
            document: newDoc,
            selection: childIds,
            dirty: true,
          };
        });
      },

      enterQuickMask: () => {
        setState((s) => {
          const w = s.document.canvasWidth ?? 1920;
          const h = s.document.canvasHeight ?? 1080;
          const coverage = s.quickMask.coverage ?? new Uint8Array(w * h);
          announcerRef.current?.announce('Quick mask mode');
          return {
            ...s,
            quickMask: {
              ...s.quickMask,
              active: true,
              coverage,
              width: w,
              height: h,
            },
          };
        });
      },

      exitQuickMask: (convertToMask?: boolean) => {
        setState((s) => {
          announcerRef.current?.announce('Exited quick mask mode');
          return {
            ...s,
            quickMask: {
              ...s.quickMask,
              active: false,
              coverage: convertToMask ? s.quickMask.coverage : null,
            },
          };
        });
      },

      setQuickMaskCoverage: (coverage: Uint8Array, width: number, height: number) => {
        setState((s) => ({
          ...s,
          quickMask: { ...s.quickMask, coverage, width, height },
        }));
      },

      paintQuickMask: (x: number, y: number, radius: number, value: number) => {
        setState((s) => {
          const buf = s.quickMask.coverage;
          if (!buf) return s;
          const w = s.quickMask.width;
          const h = s.quickMask.height;
          const r = Math.max(1, radius);
          const clamped = Math.max(0, Math.min(255, Math.round(value)));
          const minX = Math.max(0, Math.floor(x - r));
          const maxX = Math.min(w - 1, Math.ceil(x + r));
          const minY = Math.max(0, Math.floor(y - r));
          const maxY = Math.min(h - 1, Math.ceil(y + r));
          const r2 = r * r;
          for (let py = minY; py <= maxY; py++) {
            for (let px = minX; px <= maxX; px++) {
              const dx = px - x;
              const dy = py - y;
              if (dx * dx + dy * dy <= r2) {
                buf[py * w + px] = clamped;
              }
            }
          }
          return { ...s, quickMask: { ...s.quickMask, coverage: buf.slice(0) } };
        });
      },

      fillQuickMask: (value: number) => {
        setState((s) => {
          const buf = s.quickMask.coverage;
          if (!buf) return s;
          const clamped = Math.max(0, Math.min(255, Math.round(value)));
          buf.fill(clamped);
          return { ...s, quickMask: { ...s.quickMask, coverage: buf.slice(0) } };
        });
      },

      invertQuickMask: () => {
        setState((s) => {
          const buf = s.quickMask.coverage;
          if (!buf) return s;
          for (let i = 0; i < buf.length; i++) {
            buf[i] = 255 - buf[i]!;
          }
          return { ...s, quickMask: { ...s.quickMask, coverage: buf.slice(0) } };
        });
      },

      isQuickMaskActive: () => state.quickMask.active,

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

      addLutAdjustment: (lutAdjustment: Adjustment) => {
        undoStackRef.current = [...undoStackRef.current.slice(-50), state.document];
        redoStackRef.current = [];
        const { id, doc: newDoc } = nextNodeId(state.document);
        // Adjustment layers must have opacity=0 to trigger the adjustment-layer
        // rendering path in replay.ts (line 679: item.opacity <= 0)
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
            name: `LUT ${lutAdjustment.kind === 'lut' ? (lutAdjustment.originalFilename ?? id.slice(0, 4)) : id.slice(0, 4)}`,
            opacity: 0,
            blendMode: 'normal',
            effects: [],
          },
        );
        const withLut = { ...node, adjustments: [lutAdjustment] };
        const doc = addNode(newDoc, withLut as import('@strata/scene').SceneNode);
        patch({ document: doc, selection: [id] });
        announcerRef.current?.announce('Created LUT adjustment layer');
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
        const guideId = stateRef.current.selectedGuideId;
        if (guideId) {
          const pageId = resolveGuidePageId(stateRef.current.document);
          const guide = getGuidesForPage(stateRef.current.document, pageId).find(
            (g) => g.id === guideId,
          );
          if (guide) {
            void writeGuidesToClipboard([guide]);
            announcerRef.current?.announce('Copied guide');
          }
          return;
        }
        const sel = state.selection;
        if (sel.length === 0) return;
        const nodes = gatherSubtreeNodes(state.document, sel);
        if (nodes.length === 0) return;
        const nodeIds = nodes.map((n) => n.id);
        const closure = DocumentCodec.collectNodeClosure(state.document, nodeIds);
        writeToClipboard(nodes, closure.rasterMaskAssets);
        announcerRef.current?.announce(`Copied ${sel.length} layer${sel.length > 1 ? 's' : ''}`);
      },

      cutSelected: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        const nodes = gatherSubtreeNodes(state.document, sel);
        if (nodes.length === 0) return;
        writeToClipboard(nodes);
        updateDoc((doc) => {
          let d = doc;
          for (const id of sel) d = removeNode(d, id);
          return d;
        });
        patch({ selection: [] });
        announcerRef.current?.announce(`Cut ${sel.length} layer${sel.length > 1 ? 's' : ''}`);
      },

      paste: async () => {
        const guideClipboard = await readGuidesFromClipboard();
        if (guideClipboard && guideClipboard.length > 0) {
          const pageId = resolveGuidePageId(stateRef.current.document);
          const pastedIds: string[] = [];
          updateDoc((doc) =>
            pasteGuidesDoc(
              doc,
              guideClipboard,
              pageId,
              () => {
                const id = createGuideId();
                pastedIds.push(id);
                return id;
              },
              10,
            ),
          );
          patch({ selectedGuideId: pastedIds[pastedIds.length - 1] ?? null });
          announcerRef.current?.announce(
            `Pasted ${guideClipboard.length} guide${guideClipboard.length > 1 ? 's' : ''}`,
          );
          return;
        }

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
            const tempDoc: Document = {
              ...doc,
              nodes: tempNodes,
              ...(strataData.rasterMaskAssets
                ? { rasterMaskAssets: strataData.rasterMaskAssets }
                : {}),
            };
            // copySelected()/cutSelected() serialize each selected node plus
            // its full descendant subtree (gatherSubtreeNodes), so a node
            // referenced as another copied node's child is a descendant, not
            // an independent paste target — only the roots of the original
            // selection should become new top-level pastes.
            const childIds = new Set<NodeId>();
            for (const node of strataData.nodes) {
              if (isContainer(node)) {
                for (const childId of node.children) childIds.add(childId);
              }
            }
            for (const node of strataData.nodes) {
              if (childIds.has(node.id)) continue;
              // insertImportedSubtree deep-clones from tempDoc (handling
              // containers and leaves alike), merges every cloned descendant
              // into doc.nodes, and hooks only the subtree root into the
              // active page's contentRoot (or doc.rootChildren for flat
              // documents) — the same page-scoping every other insertion
              // path (importNode, drag-and-drop) already relies on.
              const inserted = insertImportedSubtree(doc, tempDoc, node.id, (n) => n);
              if (!inserted) continue;
              doc = inserted.doc;
              newIds.push(inserted.rootId);
            }
          }

          // Place pasted (non-native, e.g. clipboard image) content at the
          // center of the current viewport, not wherever the importer's
          // document happened to put it — mirrors the world-center placement
          // used for dropped files (CanvasArea.tsx handleDrop) and new frame
          // presets, via the same editorScreenToWorld/applyDropPosition path.
          const pasteCanvasEl = document.querySelector<HTMLElement>('.editor-canvas');
          const pasteVp: Viewport = pasteCanvasEl
            ? { width: pasteCanvasEl.clientWidth, height: pasteCanvasEl.clientHeight }
            : { width: window.innerWidth, height: window.innerHeight - 120 };
          const pasteCamState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
          const pasteCenter = editorScreenToWorld(
            pasteCamState,
            pasteVp.width / 2,
            pasteVp.height / 2,
            pasteVp,
          );
          let pasteIndex = 0;
          for (const result of importResults) {
            for (const id of result.nodeIds) {
              const offset = pasteIndex * 40;
              const inserted = insertImportedSubtree(doc, result.document, id, (node) =>
                applyDropPosition(node, {
                  x: pasteCenter[0] + offset,
                  y: pasteCenter[1] + offset,
                }),
              );
              if (!inserted) continue;
              doc = inserted.doc;
              newIds.push(inserted.rootId);
              pasteIndex += 1;
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
            const insertedNode = doc.nodes[inserted.rootId];
            if (insertedNode && isImageShape(insertedNode)) {
              const shape = insertedNode as import('@strata/scene').ShapeNode;
              const imageFill = shape.fills?.find((f) => f.type === 'image' && f.image)?.image;
              if (imageFill) {
                const existingFit = imageFill.fit !== 'fill' ? imageFill.fit : undefined;
                const frameW = shapeWidth(shape.shape);
                const frameH = shapeHeight(shape.shape);
                const imageW = imageFill.imageWidth ?? frameW;
                const imageH = imageFill.imageHeight ?? frameH;
                const suggestion = suggestFit(imageW, imageH, frameW, frameH, false, existingFit);
                const newFit = fromFitSuggestion(suggestion.fit);
                if (newFit !== imageFill.fit) {
                  const fills = shape.fills ?? [];
                  const newFills = fills.map((f) =>
                    f.type === 'image' && f.image
                      ? { ...f, image: { ...f.image, fit: newFit } }
                      : f,
                  );
                  doc = {
                    ...doc,
                    nodes: {
                      ...doc.nodes,
                      [inserted.rootId]: { ...shape, fills: newFills } as SceneNode,
                    },
                  };
                }
              }
            }
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
            if (node?.kind !== 'shape' && node?.kind !== 'frame') continue;
            nodes[id] = { ...node, cornerSmoothing: value } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },
      setCursorPos: (pos) => patch({ cursorPos: pos }),
      setUnitType: (t) => {
        patch({ unitType: t });
        persistViewportPrefs({ ...stateRef.current, unitType: t });
      },
      setDocumentUnit: (unit) => {
        updateDoc((doc) => ({ ...doc, documentUnit: unit }));
      },
      setPixelGridEnabled: (v) => {
        patch({ pixelGridEnabled: v });
        persistViewportPrefs({ ...stateRef.current, pixelGridEnabled: v });
      },
      setSnapEnabled: (v) => {
        patch({ snapEnabled: v });
        persistViewportPrefs({ ...stateRef.current, snapEnabled: v });
      },
      setSnapGrid: (v) => {
        const clamped = Math.max(1, Math.min(256, Math.round(v)));
        patch({ snapGrid: clamped });
        persistViewportPrefs({ ...stateRef.current, snapGrid: clamped });
      },
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
      setRulerMode: (mode) => {
        patch({ rulerMode: mode });
        persistViewportPrefs({ ...stateRef.current, rulerMode: mode });
      },
      setGridOverlayMode: (mode) => {
        patch({ gridOverlayMode: mode });
        persistViewportPrefs({ ...stateRef.current, gridOverlayMode: mode });
      },
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
      setForegroundColor: (color) => patch({ foregroundColor: color }),
      setBackgroundColor: (color) => patch({ backgroundColor: color }),
      swapColors: () =>
        patch({
          foregroundColor: state.backgroundColor,
          backgroundColor: state.foregroundColor,
        }),
      resetColors: () =>
        patch({
          foregroundColor: [0, 0, 0, 255] as [number, number, number, number],
          backgroundColor: [255, 255, 255, 255] as [number, number, number, number],
        }),

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

      documentColorMode: state.document.colorConfig?.mode ?? 'rgb',

      switchColorMode: (mode: ColorMode) => {
        const current = state.document.colorConfig?.mode;
        if (current === mode) return;
        updateDoc((doc) => switchColorModeDoc(doc, mode));
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
          sessionStoreRef.current.set(
            s.activeId,
            snapshotEditorSession(
              s,
              undoStackRef.current,
              redoStackRef.current,
              undoSelStackRef.current,
              redoSelStackRef.current,
            ),
          );
          const syncedSessions = s.sessions.map((sess) =>
            sess.id === s.activeId ? { ...sess, dirty: s.dirty } : sess,
          );
          const newId = `session-${Date.now()}`;
          const newDoc = createDocument('Untitled');
          const vpDefaults = loadSettings().viewport;
          undoStackRef.current = [];
          redoStackRef.current = [];
          undoSelStackRef.current = [];
          redoSelStackRef.current = [];
          return {
            ...s,
            document: newDoc,
            selection: [],
            selectedGuideId: null,
            zoom: 1,
            pan: { x: 0, y: 0 },
            cameraRotation: 0,
            snapEnabled: vpDefaults.snapEnabled,
            pixelGridEnabled: vpDefaults.pixelGridEnabled,
            rulerMode: vpDefaults.rulerMode,
            gridOverlayMode: vpDefaults.gridOverlayMode,
            unitType: vpDefaults.unitType,
            guidesVisible: vpDefaults.guidesVisible,
            snapGrid: vpDefaults.snapGrid,
            dirty: false,
            sessions: [...syncedSessions, { id: newId, name: 'Untitled', dirty: false }],
            activeId: newId,
          };
        });
      },

      switchTab: (id) => {
        setState((s) => {
          if (id === s.activeId) return s;
          sessionStoreRef.current.set(
            s.activeId,
            snapshotEditorSession(
              s,
              undoStackRef.current,
              redoStackRef.current,
              undoSelStackRef.current,
              redoSelStackRef.current,
            ),
          );
          const syncedSessions = s.sessions.map((sess) =>
            sess.id === s.activeId ? { ...sess, dirty: s.dirty } : sess,
          );
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
            selectedGuideId: null,
            ...restoreViewportFields(saved?.viewport),
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
            sessionStoreRef.current.set(
              s.activeId,
              snapshotEditorSession(
                s,
                undoStackRef.current,
                redoStackRef.current,
                undoSelStackRef.current,
                redoSelStackRef.current,
              ),
            );
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
              selectedGuideId: null,
              ...restoreViewportFields(saved?.viewport),
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

          // The document format has no saved camera to restore, and this
          // branch is for a file that isn't already open in another tab (so
          // there's no in-memory session snapshot either) — without an
          // explicit fit, a document whose content lives far from world
          // origin would open with the camera still sitting at (0,0),
          // rendering a blank canvas despite the content existing and
          // showing correctly in the Layers panel. Use the canvas element's
          // own rendered size (not window size) so the fit is actually
          // centered in the visible canvas area, not shifted by however much
          // the layers/inspector side panels currently take up.
          const openCam = computeFitAllCamera(doc, getCanvasViewport());
          const openZoom = openCam?.zoom ?? 1;
          const openPan = openCam?.pan ?? { x: 0, y: 0 };

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
              zoom: openZoom,
              pan: openPan,
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
            zoom: openZoom,
            pan: openPan,
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

      booleanOpRaster: async (kind, rasterNodeIds, vectorNodeIds) => {
        const allIds = [...rasterNodeIds, ...vectorNodeIds];
        if (allIds.length < 2) {
          announcerRef.current?.announce('Need at least 2 nodes for boolean operation');
          return;
        }
        setState((s) => {
          if (!inTransactionRef.current) {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
            redoStackRef.current = [];
            redoSelStackRef.current = [];
          }
          return s;
        });
        announcerRef.current?.announce('Processing boolean operation...');
        try {
          const { extractAlphaContours, alphaContoursToShapeNodes } = await import(
            '@strata/engine'
          );
          const { getImageCache } = await import('@strata/engine');
          const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import(
            '@strata/scene'
          );
          const doc = stateRef.current.document;

          // Process raster nodes: extract alpha contours, convert to ShapeNodes
          const rasterShapeNodes: import('@strata/scene').ShapeNode[] = [];
          for (const nodeId of rasterNodeIds) {
            const node = doc.nodes[nodeId] as import('@strata/scene').ShapeNode | undefined;
            if (node?.kind !== 'shape' || !isImageShape(node)) continue;
            const src = imageShapeSrc(node);
            if (!src) continue;
            const w = imageShapeW(node);
            const h = imageShapeH(node);
            if (w < 1 || h < 1) continue;
            const img = await getImageCache().load(src);
            if (!img) continue;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            const contours = extractAlphaContours(imageData, { alphaThreshold: 1, minArea: 4 });
            // alphaContoursToShapeNodes lives in @strata/engine, which can't depend on
            // @strata/scene's ShapeNode/Stroke types (would create a package cycle), so
            // it returns a structurally-equivalent ContourShapeNodeData with loosened
            // fill/fills/strokes/effects typing. The values are passed straight through
            // from `node` (a real ShapeNode), so the runtime shape matches ShapeNode.
            const nodes = alphaContoursToShapeNodes(
              contours,
              node.id,
              node as unknown as Parameters<typeof alphaContoursToShapeNodes>[2],
            ) as unknown as import('@strata/scene').ShapeNode[];
            rasterShapeNodes.push(...nodes);
          }

          // Collect vector nodes
          const vectorShapeNodes: import('@strata/scene').ShapeNode[] = [];
          for (const nodeId of vectorNodeIds) {
            const node = doc.nodes[nodeId] as import('@strata/scene').ShapeNode | undefined;
            if (node?.kind !== 'shape') continue;
            vectorShapeNodes.push(node);
          }

          if (rasterShapeNodes.length === 0 && vectorShapeNodes.length === 0) {
            announcerRef.current?.announce('No valid nodes for boolean operation');
            return;
          }

          const allShapeNodes = [...rasterShapeNodes, ...vectorShapeNodes];
          setState((s) => {
            const result = doBooleanOp(kind, allShapeNodes);
            let d = s.document;
            for (const id of allIds) d = removeNode(d, id);
            const { id: newId, doc: d2 } = nextNodeId(d);
            const newNode = { ...result, id: newId } as import('@strata/scene').ShapeNode;
            d = addNode(d2, newNode);
            announcerRef.current?.announce('Boolean operation complete');
            return { ...s, document: d, selection: [newId], dirty: true };
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          announcerRef.current?.announce(`Boolean operation failed: ${message}`);
        }
      },

      upscaleSelectedImage: async (options) => {
        const imageNode = selectedImageShape(state.document, state.selection);
        if (!imageNode) {
          announcerRef.current?.announce('Select an image layer first');
          return;
        }
        const processingNodeId = imageNode.id;
        imageProcessingAbortRef.current?.abort();
        const controller = new AbortController();
        imageProcessingAbortRef.current = controller;
        processingImageNodeRef.current = processingNodeId;
        announcerRef.current?.announce('Upscaling image...');
        try {
          const { getImageCache, dispatchUpscale } = await import('@strata/engine');
          const { imageShapeSrc } = await import('@strata/scene');
          const sourceSrc = imageShapeSrc(imageNode);
          const image = await getImageCache().load(sourceSrc);
          if (controller.signal.aborted) return;
          const width = Math.max(1, image.naturalWidth || image.width);
          const height = Math.max(1, image.naturalHeight || image.height);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas pixel processing is unavailable');
          context.drawImage(image, 0, 0, width, height);
          const source = context.getImageData(0, 0, width, height);
          const output = await dispatchUpscale(source, options, controller.signal);
          if (controller.signal.aborted) return;
          const outputCanvas = document.createElement('canvas');
          outputCanvas.width = output.width;
          outputCanvas.height = output.height;
          const outputContext = outputCanvas.getContext('2d');
          if (!outputContext) throw new Error('Canvas image encoding is unavailable');
          outputContext.putImageData(output, 0, 0);
          const dataUrl = outputCanvas.toDataURL('image/png');
          const current = stateRef.current;
          if (
            !current.selection.includes(processingNodeId) ||
            current.document.nodes[processingNodeId] !== imageNode
          )
            return;
          const scaleLabel = options.method === 'ai' ? '4x-ai' : `${options.scale ?? 2}x`;
          const inserted = insertDerivedImageShape(current.document, processingNodeId, {
            dataUrl,
            width: output.width,
            height: output.height,
            suffix: scaleLabel,
          });
          updateDoc(() => inserted.doc);
          patch({ selection: [inserted.nodeId] });
          announcerRef.current?.announce(
            `Image upscaled to ${output.width} by ${output.height} pixels`,
          );
        } catch (error) {
          if (controller.signal.aborted) throw new Error('cancelled');
          const message = error instanceof Error ? error.message : 'Unknown error';
          announcerRef.current?.announce(`Image upscaling failed: ${message}`);
          throw error;
        } finally {
          if (processingImageNodeRef.current === processingNodeId) {
            imageProcessingAbortRef.current = null;
            processingImageNodeRef.current = null;
          }
        }
      },

      traceSelectedImage: async (options) => {
        const imageNode = selectedImageShape(state.document, state.selection);
        if (!imageNode) {
          announcerRef.current?.announce('Select an image layer first');
          return;
        }
        const processingNodeId = imageNode.id;
        imageProcessingAbortRef.current?.abort();
        const controller = new AbortController();
        imageProcessingAbortRef.current = controller;
        processingImageNodeRef.current = processingNodeId;
        announcerRef.current?.announce('Tracing image...');
        try {
          const { getImageCache, dispatchTrace } = await import('@strata/engine');
          const { imageShapeSrc } = await import('@strata/scene');
          const sourceSrc = imageShapeSrc(imageNode);
          const image = await getImageCache().load(sourceSrc);
          if (controller.signal.aborted) return;
          let width = Math.max(1, image.naturalWidth || image.width);
          let height = Math.max(1, image.naturalHeight || image.height);
          const MAX_TRACE_DIM = 4096;
          if (width > MAX_TRACE_DIM || height > MAX_TRACE_DIM) {
            const scale = Math.min(MAX_TRACE_DIM / width, MAX_TRACE_DIM / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas pixel processing is unavailable');
          context.drawImage(image, 0, 0, width, height);
          const imageData = context.getImageData(0, 0, width, height);

          const tracedPaths = await dispatchTrace(imageData, options, controller.signal);

          if (controller.signal.aborted) return;
          if (tracedPaths.paths.length === 0) throw new Error('No foreground contours were found');
          const current = stateRef.current;
          if (
            !current.selection.includes(processingNodeId) ||
            current.document.nodes[processingNodeId] !== imageNode
          )
            return;

          // Live trace mode: generate a trace group at the source's position,
          // hide the source, and link the group via the source's liveTrace state.
          if (options.liveTrace) {
            const existingTraceGroupId =
              current.document.nodes[processingNodeId]?.liveTrace?.traceGroupId;
            if (existingTraceGroupId) {
              current.document = removeNode(current.document, existingTraceGroupId);
            }

            const ltParams: LiveTraceParams = {
              mode: options.mode ?? 'monochrome',
              threshold: options.threshold ?? 128,
              foreground: options.foreground ?? 'dark',
              alphaThreshold: options.alphaThreshold ?? 1,
              minArea: options.minArea ?? 4,
              simplifyTolerance: options.simplifyTolerance ?? 0.75,
              maxPaths: options.maxPaths ?? 1000,
              maxColors: options.maxColors ?? 8,
              compoundHoles: options.compoundHoles ?? true,
              cornerAngle: options.cornerAngle ?? 135,
            };
            const withParams = setLiveTraceParamsDoc(current.document, processingNodeId, ltParams);
            const inserted = insertLiveTraceGroup(withParams, processingNodeId, tracedPaths);
            const withResolved = setLiveTraceResolvedDoc(
              inserted.doc,
              processingNodeId,
              Date.now(),
              inserted.nodeId,
            );
            updateDoc(() => withResolved);
            announcerRef.current?.announce(
              `Traced ${tracedPaths.paths.length} paths as live trace`,
            );
            return;
          }

          const inserted = insertTraceGroup(current.document, processingNodeId, tracedPaths);
          updateDoc(() => inserted.doc);
          patch({ selection: [inserted.nodeId] });
          const holeNote =
            tracedPaths.omittedHoles > 0
              ? ` (${tracedPaths.omittedHoles} unpaired holes omitted)`
              : '';
          announcerRef.current?.announce(
            `Created ${tracedPaths.paths.length} vector paths${holeNote}`,
          );
        } catch (error) {
          if (controller.signal.aborted) throw new Error('cancelled');
          const message = error instanceof Error ? error.message : 'Unknown error';
          // Record the error on the live-traced node if we're in liveTrace mode
          if (options.liveTrace) {
            updateDoc((d) => setLiveTraceErrorDoc(d, processingNodeId, message));
          }
          announcerRef.current?.announce(`Image tracing failed: ${message}`);
          throw error;
        } finally {
          if (processingImageNodeRef.current === processingNodeId) {
            imageProcessingAbortRef.current = null;
            processingImageNodeRef.current = null;
          }
        }
      },

      cancelImageProcessing: () => {
        imageProcessingAbortRef.current?.abort();
        imageProcessingAbortRef.current = null;
        processingImageNodeRef.current = null;
      },

      setSelectedLiveTraceParams: (params) => {
        const sel = stateRef.current.selection;
        const node = sel.length > 0 ? stateRef.current.document.nodes[sel[0]!] : undefined;
        if (node?.kind !== 'shape') {
          announcerRef.current?.announce('Select a live-traced image layer first');
          return;
        }
        updateDoc((d) => setLiveTraceParamsDoc(d, sel[0]!, params));
        announcerRef.current?.announce('Updated live trace parameters');
      },

      flattenSelectedLiveTrace: () => {
        const sel = stateRef.current.selection;
        const node = sel.length > 0 ? stateRef.current.document.nodes[sel[0]!] : undefined;
        if (node?.kind !== 'shape' || !('liveTrace' in node) || !node.liveTrace) {
          announcerRef.current?.announce('Select a live-traced image layer first');
          return;
        }
        updateDoc((d) => flattenLiveTraceDoc(d, sel[0]!));
        announcerRef.current?.announce('Live trace flattened');
      },

      clearSelectedLiveTrace: () => {
        const sel = stateRef.current.selection;
        const node = sel.length > 0 ? stateRef.current.document.nodes[sel[0]!] : undefined;
        if (node?.kind !== 'shape' || !('liveTrace' in node) || !node.liveTrace) {
          announcerRef.current?.announce('Select a live-traced image layer first');
          return;
        }
        updateDoc((d) => clearLiveTraceDoc(d, sel[0]!));
        announcerRef.current?.announce('Live trace cancelled');
      },

      removeBackground: bgRemoval.removeBackground,

      cancelBackgroundRemoval: bgRemoval.cancelBackgroundRemoval,

      removeBackgroundWithOptions: bgRemoval.removeBackgroundWithOptions,

      setShowOriginalBg: bgRemoval.setShowOriginalBg,
      setMaskPreviewMode: bgRemoval.setMaskPreviewMode,
      setRefineMaskOptions: bgRemoval.setRefineMaskOptions,

      setTrimapEditOptions: bgRemoval.setTrimapEditOptions,

      setBrushSetting: bgRemoval.setBrushSetting,

      confirmSubjectPicker: bgRemoval.confirmSubjectPicker,

      cancelSubjectPicker: bgRemoval.cancelSubjectPicker,

      refineHairEdges: bgRemoval.refineHairEdges,

      startTrimapEdit: bgRemoval.startTrimapEdit,

      applyTrimapMatting: bgRemoval.applyTrimapMatting,

      getTrimapData: bgRemoval.getTrimapData,

      setTrimapData: bgRemoval.setTrimapData,

      ...(protoValue ?? PROTO_NOOP),

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

      ...(motionValue ?? MOTION_NOOP),

      setTrackNestedTimeline: (timelineId, trackId, nestedTimelineId, startProgress = 0) => {
        updateDoc((doc) =>
          updateTrackDoc(doc, timelineId, trackId, {
            nestedTimelineId: nestedTimelineId ?? undefined,
            nestedStartProgress: nestedTimelineId ? startProgress : undefined,
          }),
        );
        invalidateSamplerCache();
      },

      // ── Guide management implementations ─────────────────────────────────

      guides: getGuidesForPage(state.document, resolveGuidePageId(state.document)),

      addGuide: (axis, position) => {
        const id = createGuideId();
        const pageId = resolveGuidePageId(stateRef.current.document);
        updateDoc((doc) => addGuideDoc(doc, axis, position, { id, pageId }));
        return id;
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

      toggleLockAllGuides: () => {
        const pageId = resolveGuidePageId(stateRef.current.document);
        const guides = getGuidesForPage(stateRef.current.document, pageId);
        const anyUnlocked = guides.some((g) => !g.locked);
        updateDoc((doc) => setAllGuidesLocked(doc, anyUnlocked, pageId));
        announcerRef.current?.announce(anyUnlocked ? 'All guides locked' : 'All guides unlocked');
      },

      duplicateGuide: (id, position) => {
        const newId = createGuideId();
        updateDoc((doc) => duplicateGuideDoc(doc, id, position, newId));
        return newId;
      },

      clearAllGuides: () => {
        const pageId = resolveGuidePageId(stateRef.current.document);
        updateDoc((doc) => clearGuides(doc, pageId));
        patch({ selectedGuideId: null });
      },

      copySelectedGuide: () => {
        const guideId = stateRef.current.selectedGuideId;
        if (!guideId) return;
        const pageId = resolveGuidePageId(stateRef.current.document);
        const guide = getGuidesForPage(stateRef.current.document, pageId).find(
          (g) => g.id === guideId,
        );
        if (guide) {
          void writeGuidesToClipboard([guide]);
          announcerRef.current?.announce('Copied guide');
        }
      },

      pasteGuides: async () => {
        const guideClipboard = await readGuidesFromClipboard();
        if (!guideClipboard?.length) return;
        const pageId = resolveGuidePageId(stateRef.current.document);
        const pastedIds: string[] = [];
        updateDoc((doc) =>
          pasteGuidesDoc(
            doc,
            guideClipboard,
            pageId,
            () => {
              const id = createGuideId();
              pastedIds.push(id);
              return id;
            },
            10,
          ),
        );
        patch({ selectedGuideId: pastedIds[pastedIds.length - 1] ?? null });
        announcerRef.current?.announce(
          `Pasted ${guideClipboard.length} guide${guideClipboard.length > 1 ? 's' : ''}`,
        );
      },

      setGuidesVisible: (visible) => {
        patch({ guidesVisible: visible });
        persistViewportPrefs({ ...stateRef.current, guidesVisible: visible });
      },

      toggleGuidesVisible: () => {
        const next = !stateRef.current.guidesVisible;
        patch({ guidesVisible: next });
        persistViewportPrefs({ ...stateRef.current, guidesVisible: next });
        announcerRef.current?.announce(next ? 'Guides shown' : 'Guides hidden');
      },

      setSelectedGuideId: (id) => patch({ selectedGuideId: id }),

      nudgeSelectedGuide: (dx, dy) => {
        const guideId = stateRef.current.selectedGuideId;
        if (!guideId) return;
        const pageId = resolveGuidePageId(stateRef.current.document);
        const guide = getGuidesForPage(stateRef.current.document, pageId).find(
          (g) => g.id === guideId,
        );
        if (!guide || guide.locked) return;
        const delta = guide.axis === 'vertical' ? dx : dy;
        if (delta === 0) return;
        updateDoc((doc) => moveGuideDoc(doc, guideId, guide.position + delta));
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
            selectedGuideId: null,
            ...restoreViewportFields(saved?.viewport),
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
      setCamera,
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
      protoValue,
      bgRemoval,
      platform,
      motionValue,
      newDocument,
      serializeDocument,
      save,
      saveAs,
      loadDocument,
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
      distributeWithMode: value.distributeWithMode,
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
      addMaskToSelected: value.addMaskToSelected,
      removeMaskFromSelected: value.removeMaskFromSelected,
      toggleMask: value.toggleMask,
      invertMask: value.invertMask,
      setMaskFeather: value.setMaskFeather,
      setMaskDensity: value.setMaskDensity,
      setMaskHideSource: value.setMaskHideSource,
      setMaskLinked: value.setMaskLinked,
      setMaskType: value.setMaskType,
      setMaskSourceNode: value.setMaskSourceNode,
      setMaskFillRule: value.setMaskFillRule,
      setMaskVectorPath: value.setMaskVectorPath,
      createClippingMaskFromSelected: value.createClippingMaskFromSelected,
      releaseClippingMaskFromSelected: value.releaseClippingMaskFromSelected,
      detachSelected: value.detachSelected,
      copySelected: value.copySelected,
      cutSelected: value.cutSelected,
      paste: value.paste,
      importNode: value.importNode,
      booleanOp: value.booleanOp,
      booleanOpRaster: value.booleanOpRaster,
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
      toggleLockAllGuides: value.toggleLockAllGuides,
      duplicateGuide: value.duplicateGuide,
      clearAllGuides: value.clearAllGuides,
      setGuidesVisible: value.setGuidesVisible,
      toggleGuidesVisible: value.toggleGuidesVisible,
      setSelectedGuideId: value.setSelectedGuideId,
      nudgeSelectedGuide: value.nudgeSelectedGuide,
      copySelectedGuide: value.copySelectedGuide,
      pasteGuides: value.pasteGuides,
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
      addLutAdjustment: value.addLutAdjustment,
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
            <MotionProvider
              state={state}
              setState={setState}
              stateRef={stateRef}
              updateDoc={updateDoc}
              invalidateSamplerCache={invalidateSamplerCache}
              onReady={setMotionValue}
            >
              <PrototypeProvider
                state={state}
                setState={setState}
                stateRef={stateRef}
                updateDoc={updateDoc}
                prototypeRuntimeRef={prototypeRuntimeRef}
                smRuntimeRef={smRuntimeRef}
                onReady={setProtoValue}
              >
                {children}
              </PrototypeProvider>
            </MotionProvider>
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

export { useDocument, useMotion, usePrototype, useSelection, useViewport } from './context/index';

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
