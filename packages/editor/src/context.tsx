// COMPLEXITY: 843 (ceiling 847) — EditorProvider is the central state hub;
// sub-contexts (MotionProvider, PrototypeProvider, ViewportProvider) are the
// planned extraction path. Dialog state (useDialogState) and interaction state
// (useInteractionState) already extracted. Next: extract tool state into
// useToolState (blocked: tightly coupled to createShapeAt).
/**
 * Editor state context — shared across all shell surfaces.
 *
 * Holds the editor's tool state, viewport (zoom/pan), selection, AND the scene
 * Document. Document actions are provided through the context so any surface
 * (toolbar, canvas, layers, inspector) can mutate the scene.
 */

/** Module-level bridge injected by Shell to forward toasts to @varve/ui ToastProvider. */
interface EditorToastOptions {
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

let toastHandler: ((opts: EditorToastOptions) => void) | null = null;

export function setToastHandler(fn: (opts: EditorToastOptions) => void): void {
  toastHandler = fn;
}

export { requestInspectorTab, setInspectorTabHandler } from './context/inspectorTabBridge';

/** Module-level bridge: invalidate a specific node's layer thumbnail
 *  after the node's fill, shape, or dimensions change. Registered by
 *  LayersTree on mount to forward to the sharedThumbnailCache. */
let invalidateThumbnailHandler: ((nodeId: string) => void) | null = null;

export function setInvalidateThumbnailHandler(fn: ((nodeId: string) => void) | null): void {
  invalidateThumbnailHandler = fn;
}

export function invalidateNodeThumbnail(nodeId: string): void {
  invalidateThumbnailHandler?.(nodeId);
}

import { getLayerNavigationCommands } from './components/LayersPanel/layerNavigationRegistry';
import { requestInspectorTab } from './context/inspectorTabBridge';
import { setBumpThemeRevisionHandler } from './context/sessionGlobals';
import { useAutoBackupServices } from './context/useAutoBackupServices';
import { pathPointsWorldToLocal } from './tools/pathCoords';

/** Module-level bridge giving the BackupSettingsPanel access to the editor's
 *  BackupService without threading it through the EditorContextValue interface.
 *  Registered by EditorProvider once the service initializes. */
let backupServiceGetter: (() => BackupService | null) | null = null;

export function setBackupServiceGetter(fn: (() => BackupService | null) | null): void {
  backupServiceGetter = fn;
}

export function getBackupService(): BackupService | null {
  return backupServiceGetter?.() ?? null;
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

import { getTransactionHooks } from '@varve/collab';
import type {
  Adjustment,
  Affine,
  PathPoint,
  PixelArtAlgorithm,
  Shape,
  UpscaleMethod,
} from '@varve/engine';
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
} from '@varve/engine';
import { type ImportFileInput, ImportService } from '@varve/import';
import type { Platform } from '@varve/platform';
import {
  PrototypeDebugConsole,
  type PrototypeRuntime,
  processDelays as protoProcessDelays,
} from '@varve/prototype';
import type {
  AdjustmentNode,
  ColorMode,
  ContainerNode,
  ExportPreset,
  FacingPagesConfig,
  Fill,
  ImageFillData,
  InstanceStatus,
  LiveTraceParams,
  ManagedColor,
  MasterAppliesTo,
  NodeId,
  Slot,
  SyncResult,
  TableModel,
} from '@varve/scene';
import {
  type ArrangeOp,
  addChild,
  addComponentProperty as addComponentPropertyDoc,
  addGuide as addGuideDoc,
  addInteraction as addInteractionDoc,
  addMask as addMaskDoc,
  addNode,
  addSMInput,
  addSMState,
  addSMTransition,
  addSpotToLibrary as addSpotToLibraryDoc,
  addToSelectionSet as addToSelectionSetDoc,
  addVariableToDocument,
  advanceSMTransition,
  appendFrameToChain as appendFrameToChainDoc,
  applyConstraints,
  applyFormatToSelection as applyFormatToSelectionOp,
  arrangeNode as arrangeNodeDoc,
  assignDocumentColorMode as assignDocumentColorModeDoc,
  assignMasterToPage as assignMasterToPageDoc,
  type BleedConfig,
  booleanAnchorForNode,
  buildParentIndexMap,
  canBeClipMaskSource,
  clearGuides,
  clearLiveTrace as clearLiveTraceDoc,
  convertDocumentColors as convertDocumentColorsDoc,
  createClippingMask as createClippingMaskDoc,
  createComponent,
  createDefaultIsometricGrid,
  createDocument,
  createEmptySelectionSetsData,
  createGuideId,
  createMaster as createMasterDoc,
  createNewDocument,
  createSelectionSet as createSelectionSetDoc,
  createSpotLibrary as createSpotLibraryDoc,
  createStateMachine,
  createStory as createStoryDoc,
  createVariableStore,
  createVariant as createVariantDoc,
  type Document,
  DocumentCodec,
  deepCloneSubtree,
  defaultConstraints,
  defaultProofConfig,
  deleteMaster as deleteMasterDoc,
  deleteSelectionSet as deleteSelectionSetDoc,
  deleteSpotLibrary as deleteSpotLibraryDoc,
  deleteTextChain as deleteTextChainDoc,
  deleteVariableFromDocument as deleteVariableFromDocumentDoc,
  detachInstance as detachInstanceDoc,
  booleanOp as doBooleanOp,
  duplicateGuide as duplicateGuideDoc,
  duplicateMaster as duplicateMasterDoc,
  duplicateSelectionSet as duplicateSelectionSetDoc,
  duplicateSMState,
  fillSlot as fillSlotDoc,
  findOrCreateEmbeddedAsset,
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
  linkFrame as linkFrameDoc,
  type MaskType,
  makeAdjustmentNode,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTableNode,
  makeTextNode,
  markMaskStale,
  moveGuide as moveGuideDoc,
  moveNode,
  nextNodeId,
  pageBoundsInWorld,
  pasteboardBounds,
  pasteGuides as pasteGuidesDoc,
  placeBooleanResult,
  promoteToRichText as promoteToRichTextOp,
  pushMasterChanges as pushMasterChangesDoc,
  rebuildSpreads as rebuildSpreadsDoc,
  releaseClippingMask as releaseClippingMaskDoc,
  removeFrameFromChain as removeFrameFromChainDoc,
  removeFromSelectionSet as removeFromSelectionSetDoc,
  removeGuide as removeGuideDoc,
  removeInteraction as removeInteractionDoc,
  removeMask as removeMaskDoc,
  removeNode,
  removeSMInput,
  removeSMState,
  removeSMTransition,
  removeSpotFromLibrary as removeSpotFromLibraryDoc,
  removeStateMachine,
  renameMaster as renameMasterDoc,
  renameNode,
  renameSelectionSet as renameSelectionSetDoc,
  renameSMState,
  renameSpotLibrary as renameSpotLibraryDoc,
  reparentNode as reparentNodeDoc,
  replaceNodesWithFlattened,
  resetInstanceOverrides as resetInstanceOverridesDoc,
  resolve,
  resolveGuidePageId,
  resolveNodeFills,
  resolveVariantPropertiesForNode as resolveVariantPropertiesForNodeDoc,
  type SafeAreaConfig,
  type SceneNode,
  type SelectionSet,
  type SelectionSetScope,
  type SlugConfig,
  type SMRuntime,
  initializeDefaultGridSettings as sceneInitializeGridSettings,
  setDocumentGrid as sceneSetDocumentGrid,
  setIsometricGrid as sceneSetIsometricGrid,
  scopeForTargets,
  setActivePage as setActivePageDoc,
  setActiveTimeline as setActiveTimelineDoc,
  setAllGuidesLocked,
  setDocumentProofConfig as setDocumentProofConfigDoc,
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
  setPagePlacement as setPagePlacementDoc,
  setPageSize as setPageSizeDoc,
  setPropertyOverride as setPropertyOverrideDoc,
  setSMStateEntry,
  setSMTransitionCondition,
  setSMTransitionPriority,
  setSMTransitionTarget,
  setSMTransitionTrigger,
  setVariableModeOnDocument as setVariableModeOnDocumentDoc,
  setVariantForInstance as setVariantForInstanceDoc,
  shapeHeight,
  shapeNodesInWorldSpace,
  shapeWidth,
  spreadBoundsInWorld,
  storyForFrame,
  swapInstance as swapInstanceDoc,
  syncAllInstances as syncAllInstancesDoc,
  syncInstance as syncInstanceDoc,
  toggleFacingPages as toggleFacingPagesDoc,
  toggleGuideLock as toggleGuideLockDoc,
  ungroupNode as ungroupNodeDoc,
  unlinkFrame as unlinkFrameDoc,
  updateInteraction as updateInteractionDoc,
  updateSelectionSetNodes as updateSelectionSetNodesDoc,
  updateSpotDef as updateSpotDefDoc,
  updateTrack as updateTrackDoc,
  updateVariableInDocument,
  type Variable,
  type VariableValue,
  validateDocument,
  validateStateMachine as validateSM,
  walkNodes,
} from '@varve/scene';
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
} from '@varve/shared';
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
import type { BackupService } from './backupService';
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
import type { SectionId } from './components/Inspector/sectionRegistry';
import {
  hideOptionalSections as hideAllOptional,
  hideSection,
  moveSectionDown as moveSectionDownDoc,
  moveSectionToEnd as moveSectionToEndDoc,
  moveSectionToStart as moveSectionToStartDoc,
  moveSectionUp as moveSectionUpDoc,
  resetSectionOrder as resetSectionOrderDoc,
  restoreDefaultSectionState as restoreAllDefaults,
  restoreDefaultCollapsed as restoreCollapsedDefaults,
  showAllSections,
  showSection,
  toggleCollapsed,
  toggleSubSectionCollapsed as toggleSubSectionCollapsedDoc,
} from './components/Inspector/sectionState';
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
import {
  applyToolChange,
  type DocumentContextValue,
  DocumentProvider,
  type MotionContextValue,
  MotionProvider,
  PrototypeProvider,
  SelectionProvider,
  ToolProvider,
  ViewportProvider,
} from './context/providerComposition';
import { isReducedMotion } from './context/reducedMotionManager';
import { resizeSceneNode, shapeForTool } from './context/sceneNodeGeometry';
import type {
  CanvasMode,
  EditorState,
  GridOverlayMode,
  InspectorTab,
  IntelligenceTab,
  LoadDocumentMeta,
  PersistentHistoryApi,
  RulerMode,
  SelectionOrigin,
  SessionFileMeta,
  SessionMeta,
  TableEditState,
  ToolId,
} from './context/types';
import {
  createDefaultDocumentGridSettings,
  DEFAULT_SELECTION_ORIGIN,
  newSessionId,
  nextSelectionPrimary,
} from './context/types';
import { useBackgroundRemoval } from './context/useBackgroundRemoval';
import { useDialogState } from './context/useDialogState';
import { useIconAssets } from './context/useIconAssets';
import { useInteractionState } from './context/useInteractionState';
import { useLogoGeometry } from './context/useLogoGeometry';
import { useLogoProject } from './context/useLogoProject';
import { resolveFontManifest, usePersistence } from './context/usePersistence';
import { usePersistentHistory } from './context/usePersistentHistory';
import { useRasterLod } from './context/useRasterLod';
import { useSam2Segmentation } from './context/useSam2Segmentation';
import { useSelectionCommands } from './context/useSelectionCommands';
import {
  BOOT_WORKSPACE_MODE,
  initialPanelVisibility,
  recordPanelVisibilityOverride,
  useWorkspaceMode,
} from './context/useWorkspaceMode';
import {
  computeFitAllCamera,
  computeZoomStep,
  computeZoomTo,
  getCanvasViewport,
} from './context/viewportOps';
import { applyDropPosition } from './dropUtils';
import type { FlattenOptions } from './flatten/types';
import { readGuidesFromClipboard, writeGuidesToClipboard } from './guideClipboard';
import { HitTestEngine } from './hitTest';
import { useSelectionHistory } from './hooks/useSelectionHistory';
import {
  expandBounds as expandBoundsDoc,
  resetToSourceBounds as resetToSourceBoundsDoc,
  trimToSubject as trimToSubjectDoc,
} from './imageCrop';
import {
  bakeAlphaMaskIntoImageData,
  insertDerivedImageShape,
  insertLiveTraceGroup,
  insertTraceGroup,
  selectedImageShape,
} from './imageOperations';
import { getActionTracker } from './intelligence/actionTracker';
import { autoName } from './intelligence/autoNamer';
import { computeCognitiveLoad } from './intelligence/cognitiveLoad';
import { fromFitSuggestion, suggestFit } from './intelligence/imageFitAdvisor';
import { reflowLayoutChildren } from './layout/reflow';
import { type MediaContextValue, MediaProvider } from './media/MediaContext';
import { applyAutoKeyframes } from './motion/autoKeyframe';
import { getSharedRecoveryManager, type RecoveryManager } from './recovery';
import { findContainingFrameInDoc } from './scene/findContainingFrame';
import {
  getOrCreateParentCache,
  getParentFast,
  type ParentIndexCache,
} from './scene/parentIndexCache';
import { resizeNodeGeometry } from './scene/resizeGeometry';
import { type FrameSpatialIndex, getOrCreateFrameSpatialIndex } from './scene/spatialIndex';
import {
  planLinkSelection,
  planUnlinkSelection,
  storySeedForFrame,
} from './scene/textThreadActions';
import {
  createTransformCache,
  getWorldBounds as getCachedWorldBounds,
  getWorldTransform as getCachedWorldTransform,
  invalidateAll as invalidateTransformCache,
  type TransformCache,
} from './scene/transformCache';
import {
  nodeLocalBounds,
  nodeWorldBounds,
  nodeWorldTransform,
  rebaseWorldTransformToParent,
  reparentLocalTransform,
  worldToParent,
} from './scene/world';
import { loadSettings, updateSettings } from './settings';
import { createInitialMediaState } from './state/media-state';
import { createInitialMotionState } from './state/motion-state';
import {
  applyTableModelOp,
  embedSceneContentInCell as embedSceneContentInCellDoc,
  updateTableCellTextInDoc,
} from './table/tableDocOps';
import { invalidateSamplerCache } from './timeline/TimelineSampler';
import type { DraftShape } from './tools/types';
import { captureViewport, normalizeSavedViewport, type SavedViewport } from './viewportSession';
import type { PanelId } from './workspace/workspaceTypes';

// Re-export for backward compatibility
export type { CanvasMode, EditorState, SessionMeta, ToolId };

/**
 * Flatten `ids` and all of their descendants into a single node list, for
 * clipboard serialization. Copying only the directly-selected node(s) (not
 * their descendants) means a pasted group/frame has nothing for
 * deepCloneSubtree to find its children in — they'd be silently dropped.
 */
/**
 * World coordinates at the centre of the visible canvas viewport — the
 * correct "place it where the user is looking" fallback for imports with no
 * explicit drop position. Goes through editorScreenToWorld so pan sign,
 * zoom, camera rotation, and the floating origin are all honoured; the
 * previous inline `(pan + canvasWidth/2) / zoom` maths at the import sites
 * added pan where screen->world must subtract it (and used the *source
 * document's* canvas size as the viewport), which mirrored placements
 * across the world origin the further the camera was panned.
 */
function viewportCenterWorld(cam: {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
}): { x: number; y: number } {
  const el = document.querySelector<HTMLElement>('.editor-canvas');
  const vp = el
    ? { width: el.clientWidth, height: el.clientHeight }
    : { width: window.innerWidth, height: window.innerHeight - 120 };
  const [x, y] = editorScreenToWorld(cam, vp.width / 2, vp.height / 2, vp);
  return { x, y };
}

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
  // Cross-document import/clipboard paste: mask and scope references that
  // point outside the pasted subtree must not leak source-document IDs —
  // foreign mattes/targets are dropped (the item is pasted unclipped) rather
  // than left dangling.
  const cloned = deepCloneSubtree(sourceDoc.nodes, targetDoc.nextId, rootId, {
    dropForeignReferences: true,
  });
  const root = cloned.nodes[cloned.rootId];
  if (!root || Object.keys(cloned.nodes).length === 0) return null;

  const nodes = { ...cloned.nodes, [cloned.rootId]: adjustRoot(root) };

  // Merge both asset tables from the source document into the target.
  // Cloned nodes retain their assetIds, so the referenced image bytes and
  // raster masks must travel with imported or clipboard-cloned subtrees.
  const mergedRasterAssets = sourceDoc.rasterMaskAssets
    ? { ...(targetDoc.rasterMaskAssets ?? {}), ...sourceDoc.rasterMaskAssets }
    : targetDoc.rasterMaskAssets;
  const mergedImageAssets = sourceDoc.assets
    ? { ...(targetDoc.assets ?? {}), ...sourceDoc.assets }
    : targetDoc.assets;
  const mergedIconAssets = sourceDoc.iconAssets
    ? { ...(targetDoc.iconAssets ?? {}), ...sourceDoc.iconAssets }
    : targetDoc.iconAssets;

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
        ...(mergedImageAssets !== targetDoc.assets ? { assets: mergedImageAssets } : {}),
        ...(mergedIconAssets !== targetDoc.iconAssets ? { iconAssets: mergedIconAssets } : {}),
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
      ...(mergedImageAssets !== targetDoc.assets ? { assets: mergedImageAssets } : {}),
      ...(mergedIconAssets !== targetDoc.iconAssets ? { iconAssets: mergedIconAssets } : {}),
    },
  };
}

export interface EditorContextValue {
  state: EditorState;
  /** The platform facade (Tauri/web/memory), undefined if none was provided. */
  platform: Platform | undefined;
  /** Persistent revision history session (M7/M8). */
  persistentHistory: PersistentHistoryApi;
  setTool: (t: ToolId) => void;
  /** ADR-0016: enter/exit table edit mode (cell selection + navigation). */
  /** ADR-0016: open the Create Table From Data dialog (clipboard parse). */
  openCreateTableFromDataDialog?: () => void;
  setTableEdit: (state: TableEditState | null) => void;
  /** ADR-0016: commit cell text through the normal undoable doc path. */
  updateTableCellText: (cellId: string, text: string) => void;
  /** ADR-0016: run an immutable table-model op on the owning node (undoable). */
  tableOp: (tableId: string, op: (model: TableModel) => TableModel) => void;
  /**
   * ADR-0016: embed a scene node as rich content in a table cell. The node
   * is removed from the document roots (renders inside the cell only) and
   * the cell content references it — one undoable op.
   */
  embedSceneContentInCell: (tableId: string, cellId: string, nodeId: string) => void;
  /** Commit zoom, pan, and rotation as one camera transaction. */
  setCamera: (camera: Camera) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  /**
   * Scroll the viewport by a delta, resolved against the newest pan rather
   * than the caller's snapshot. Scroll sources (wheel, inertia, auto-pan) fire
   * faster than React commits, so an absolute `setPan(snapshot + delta)` drops
   * every delta but the last one in a burst.
   */
  panBy: (dx: number, dy: number) => void;
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
  /** Toggle library panel visibility; follows workspace config defaults. */
  toggleLibraryPanel: () => void;
  /** Toggle codegen panel visibility; follows workspace config defaults. */
  toggleCodegenPanel: () => void;
  /** Toggle Logo panel visibility; persists to editor settings. */
  toggleLogoPanel: () => void;
  /** Toggle distraction-free canvas mode (hides chrome, keeps canvas/toolbar). */
  toggleDistractionFreeMode: () => void;
  /** Toggle before/after comparison for the selected image. */
  toggleBeforeAfterCompare: () => void;
  /** Active workspace mode (design/print/drawing). */
  workspaceMode: import('./workspace/workspaceTypes').WorkspaceMode;
  /** @internal — use requestWorkspaceSwitch instead. Direct call bypasses guards. */
  __setWorkspaceModeUnsafe: (mode: import('./workspace/workspaceTypes').WorkspaceMode) => void;
  /** Switch workspace mode with safety guards (interaction resolution, confirmation). */
  requestWorkspaceSwitch: (
    mode: import('./workspace/workspaceTypes').WorkspaceMode,
    options?: { force?: boolean },
  ) => Promise<boolean>;
  /** Reset current workspace to its default panel/tool configuration. */
  resetWorkspaceToDefault: () => void;
  /** Reset every workspace to its default panel/tool configuration. */
  resetAllWorkspacesToDefaults: () => void;
  /** Fit all nodes in the document to the viewport. */
  fitAll: () => void;
  /** Replace selection with a single node (or clear if null). */
  setSelection: (id: NodeId | null, origin?: SelectionOrigin) => void;
  /** Enter/exit warp edit mode (which node's modifier the overlay edits). */
  setWarpEdit: (target: { nodeId: NodeId; modifierId: string } | null) => void;
  /** Toggle one node in/out of the selection; additive keeps existing selection. */
  toggleSelection: (id: NodeId, additive?: boolean, origin?: SelectionOrigin) => void;
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
  /** Clear the entire selection. */
  selectNone: () => void;
  /** Invert the current selection across all visible unlocked nodes. */
  invertSelection: () => void;
  /** Select the parent of the primary node. */
  selectParent: () => void;
  /** Select the direct children of the primary container. */
  selectChildren: () => void;
  /** Select all siblings of the primary node. */
  selectSiblings: () => void;
  /** Select the next sibling of the primary node. */
  selectNextSibling: () => void;
  /** Select the previous sibling of the primary node. */
  selectPreviousSibling: () => void;
  /** Select all descendants of the primary container. */
  selectAllChildren: () => void;
  /** Select all nodes matching the primary node's stroke. */
  selectAllWithSameStroke: () => void;
  /** Select all nodes matching the primary node's opacity. */
  selectAllWithSameOpacity: () => void;
  /** Select all nodes matching the primary node's blend mode. */
  selectAllWithSameBlendMode: () => void;
  /** Select all text nodes matching the primary text node's font family. */
  selectAllWithSameFont: () => void;
  /** Select all nodes matching the primary node's corner radius. */
  selectAllWithSameCornerRadius: () => void;
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
  getWorldTransform: (id: NodeId) => import('@varve/shared').Affine;
  /** Cached world bounds — uses TransformCache for O(1) repeated lookups. */
  getWorldBounds: (id: NodeId) => import('@varve/shared').Rect | null;
  /** Convert canvas CSS-px coordinates to world coordinates. */
  canvasToWorld: (cx: number, cy: number) => { x: number; y: number };
  /** Convert world coordinates to canvas CSS-px coordinates. */
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
  /** Convert a canvas CSS-px delta to a world-space delta (divides by zoom). */
  canvasDeltaToWorld: (dx: number, dy: number) => { dx: number; dy: number };
  /** Efficient hit-test that returns the full node info. */
  hitTestNode: (world: { x: number; y: number }) => { nodeId: NodeId; node: SceneNode } | null;
  /** Hit-test with an explicit interaction policy (hover, click, touch, pen, etc.). */
  hitTestNodeWithPolicy: (
    world: { x: number; y: number },
    policyName: import('./hitTest').HitTestPolicyName,
  ) => { nodeId: NodeId; node: SceneNode } | null;
  /** Set the keyboard focus to a node without changing selection. */
  setFocusedNode: (id: NodeId | null) => void;
  /** Clear keyboard focus. */
  clearFocusedNode: () => void;
  /** Move focus to the next selected node in document order. */
  focusNextSelectedNode: () => void;
  /** Move focus to the previous selected node in document order. */
  focusPreviousSelectedNode: () => void;
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
  /** Rename a specific node, independent of the current selection. */
  renameNodeById: (id: NodeId, name: string) => void;
  /** Move a node to a new paint-order index. */
  moveNode: (id: NodeId, toIndex: number) => void;
  /** Duplicate all selected nodes with new IDs. */
  duplicateSelected: () => void;
  /** Repeat the last duplicate with the same offset (Cmd/Ctrl+D after initial duplicate). */
  repeatDuplicate: () => void;
  /** Update the fill of all selected nodes. */
  setSelectedFill: (color: ManagedColor) => void;
  /** P2: Set the entire fill stack on all selected nodes. */
  setSelectedFills: (fills: import('@varve/scene').Fill[]) => void;
  /** P2: Update a single fill in the stack at a given index on all selected nodes. */
  updateSelectedFillAt: (index: number, fill: import('@varve/scene').Fill) => void;
  /** P2: Add a fill to the stack on all selected nodes. */
  addSelectedFill: (fill: import('@varve/scene').Fill) => void;
  /** P2: Remove a fill at a given index from the stack on all selected nodes. */
  removeSelectedFillAt: (index: number) => void;
  /** P2: Reorder fills: move from one index to another on all selected nodes. */
  reorderSelectedFill: (from: number, to: number) => void;
  /** Update the position (transform) of a node. */
  setNodePosition: (id: NodeId, x: number, y: number) => void;
  /**
   * Batch-set absolute transforms for many nodes in ONE document update.
   * Multi-node drags/nudges previously issued one `setNodePosition` per node
   * per sample, each spreading the whole nodes map — an N-node selection cost
   * N*O(N) key copies per pointermove. One batched call costs a single O(N)
   * spread per sample; undo transaction boundaries are unchanged.
   */
  setNodePositions: (positions: ReadonlyArray<{ id: NodeId; x: number; y: number }>) => void;
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
  /**
   * Batch-apply per-node updaters in ONE document update (single nodes-map
   * spread). Per-node `updateNode` calls each spread the whole map; gestures
   * that transform N nodes per sample (ScaleTool) previously cost N*O(N).
   * Updaters must be pure and independent.
   */
  updateNodes: (
    updaters: ReadonlyArray<{ id: NodeId; update: (node: SceneNode) => SceneNode }>,
  ) => void;
  /** F6: batch-edit opacity on all selected nodes. */
  setSelectedOpacity: (value: number) => void;
  /** F6: batch-edit blend mode on all selected nodes. */
  setSelectedBlendMode: (mode: import('@varve/engine').BlendMode) => void;
  /** F6: batch-edit rotation on all selected nodes. */
  setSelectedRotation: (value: number) => void;
  /** F6: batch-edit flip horizontal on all selected nodes. */
  setSelectedFlipH: () => void;
  /** F6: batch-edit flip vertical on all selected nodes. */
  setSelectedFlipV: () => void;
  /** F6: batch-edit skew on all selected nodes (degrees). */
  setSelectedSkew: (skewX: number, skewY: number) => void;
  /** F6: batch-edit corner radius on all selected shape nodes. */
  setSelectedCornerRadius: (value: number | [number, number, number, number]) => void;
  /** F6: create a selection set from the current selection. */
  createSelectionSet: (name?: string) => SelectionSet | null;
  /** F6: replace a selection set's members with the current selection. */
  updateSelectionSet: (setId: string) => void;
  /** F6: delete a selection set. */
  deleteSelectionSet: (setId: string) => void;
  /** F6: rename a selection set. */
  renameSelectionSet: (setId: string, name: string) => void;
  /** F6: duplicate a selection set. */
  duplicateSelectionSet: (setId: string) => void;
  /** F6: select the members of a selection set that still exist. */
  selectSelectionSet: (setId: string) => void;
  /** F6: add the current selection to a selection set. */
  addToSelectionSet: (setId: string) => void;
  /** F6: remove the current selection from a selection set. */
  removeFromSelectionSet: (setId: string) => void;
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
  setSelectedLayoutSizing: (value: import('@varve/scene').LayoutSizing) => void;
  /** P3: batch-set grid item placement on all selected nodes. */
  setSelectedGridPlacement: (value: import('@varve/scene').GridItemPlacement) => void;
  /** P3: set the document canvas width. */
  setCanvasWidth: (value: number) => void;
  /** P3: set the document canvas height. */
  setCanvasHeight: (value: number) => void;
  /** P3: set the document canvas background color. */
  setCanvasBackground: (value: ManagedColor) => void;
  /** F6: batch-set a variable binding on all selected nodes. */
  setSelectedBinding: (
    target: string,
    binding: import('@varve/scene').PropertyBinding | null,
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
  /** Insert a sanitized icon asset into the active page; returns the node id. */
  insertIconAsset: (
    request: import('./context/useIconAssets').IconInsertRequest,
  ) => Promise<NodeId | null>;
  /** Replace icon nodes with a new icon, preserving their layout bounds. */
  replaceIconAsset: (
    nodeIds: NodeId[],
    request: import('./context/useIconAssets').IconInsertRequest,
  ) => Promise<NodeId | null>;
  /** Detach icon nodes into plain editable nodes (clears icon provenance). */
  detachIconNodes: (nodeIds: NodeId[]) => void;
  /** Look up a document icon asset by id. */
  getIconAsset: (assetId: string) => import('@varve/scene').DocumentIconAsset | undefined;
  /** Look up the icon asset referenced by a node, if any. */
  getIconAssetForNode: (nodeId: NodeId) => import('@varve/scene').DocumentIconAsset | undefined;
  /** Load a document from a JSON string. */
  loadDocument: (json: string, meta?: LoadDocumentMeta) => void;
  /** Save the current document via the platform. */
  save: () => Promise<boolean>;
  /** Save As the current document via the platform. */
  saveAs: () => Promise<boolean>;
  /** Save a duplicate to a new location without adopting it as the active
   *  destination and without clearing dirty state. */
  saveCopy: () => Promise<boolean>;
  /** Save state for display in the UI. */
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  /** When the document was last saved. */
  lastSavedAt: number | null;
  /** Most recent save problem requiring user attention (null = none). */
  saveIssue: import('./context/types').SaveIssue | null;
  /** Document Info dialog visibility. */
  documentInfoOpen: boolean;
  /** Open/close the Document Info surface. */
  setShowDocumentInfo: (show: boolean) => void;
  /**
   * Open a file into a tab: switches to an existing tab for the same file,
   * reuses a pristine blank tab, or opens a new tab. `json: null` creates a
   * fresh blank document (new-file flow).
   */
  openFile: (
    /** App-store id; omit for a file known only by path (Open Recent) or by
     *  neither (browser file picker) — save() mints one on first save. */
    fileId: string | undefined,
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
  installLibrary: (library: import('@varve/scene').Library) => void;
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
  setLayerColor: (id: NodeId, color: import('@varve/scene').LayerColor) => void;
  /** Batch: lock/unlock multiple nodes in one undo step. */
  bulkSetNodeLocked: (ids: NodeId[], locked: boolean) => void;
  /** Batch: show/hide multiple nodes in one undo step. */
  bulkSetNodeVisible: (ids: NodeId[], visible: boolean) => void;
  /** Batch: set a layer color tag on multiple nodes in one undo step. */
  bulkSetLayerColor: (ids: NodeId[], color: import('@varve/scene').LayerColor) => void;
  /** B2: set or update the layout style on a frame node. */
  setNodeLayout: (id: NodeId, layout: import('@varve/scene').LayoutStyle | undefined) => void;
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
  addMaskToSelected: (type?: import('@varve/scene').MaskType, sourceNodeId?: NodeId) => void;
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
  setMaskFillRule: (fillRule: import('@varve/scene').MaskFillRule) => void;
  /** Set a vector path mask on the selected container. */
  setMaskVectorPath: (points: import('@varve/engine').PathPoint[], closed: boolean) => void;
  /** Create a clipping mask group from selected nodes (mask shape + content). */
  createClippingMaskFromSelected: (selectionOverride?: NodeId[]) => void;
  /** Release a clipping mask, restoring original content and mask source. */
  releaseClippingMaskFromSelected: () => void;
  /** Create an adjustment layer node with optional initial adjustments and select it. */
  createAdjustmentLayer: (initialAdjustments?: import('@varve/engine').Adjustment[]) => void;
  /** Append an adjustment to an adjustment layer node. */
  addAdjustmentToLayer: (nodeId: NodeId, adjustment: import('@varve/engine').Adjustment) => void;
  /** Create a new adjustment layer node with a LUT adjustment. */
  addLutAdjustment: (lutAdjustment: import('@varve/engine').Adjustment) => void;
  /** Remove an adjustment by id from an adjustment layer node. */
  removeAdjustmentFromLayer: (nodeId: NodeId, adjustmentId: string) => void;
  /** Patch properties on an existing adjustment by id. */
  updateAdjustmentInLayer: (
    nodeId: NodeId,
    adjustmentId: string,
    patch: Partial<import('@varve/engine').Adjustment>,
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
    sourceDoc: import('@varve/scene').Document,
    options?: { position?: { x: number; y: number } },
  ) => void;
  /** Batch-import multiple nodes in a single state update (for drag-and-drop). */
  batchImportNodes: (
    items: {
      node: SceneNode;
      sourceDoc: import('@varve/scene').Document;
      position?: { x: number; y: number };
    }[],
    options?: { maskTargetId?: NodeId },
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
  /** Report the selected grapheme range within the focused text node. */
  setSelectionRange: (range: import('@varve/scene').RichSelection | null) => void;
  /** Set cursor position on canvas (null when pointer leaves). */
  setCursorPos: (pos: { x: number; y: number } | null) => void;
  /** Set the display unit type. */
  setUnitType: (t: 'px' | 'pt' | 'cm' | 'mm' | 'in' | '%') => void;
  /** Set the document's measurement unit (px, pt, mm, cm, in, pc). */
  setDocumentUnit: (unit: import('@varve/shared').DocumentUnit) => void;
  /** Toggle soft proofing overlay. */
  setSoftProofEnabled: (v: boolean) => void;
  /** Set color blindness simulation view (protanopia/deuteranopia/tritanopia). */
  setColorBlindnessView: (type: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia') => void;
  /** Toggle pixel grid overlay. */
  setPixelGridEnabled: (v: boolean) => void;
  /** Toggle snap-to-pixel-grid. */
  setPixelGridSnapEnabled: (v: boolean) => void;
  /** Reset grid origin to (0, 0). */
  resetGridOrigin: () => void;
  /** Toggle snap-to-grid. */
  setSnapEnabled: (v: boolean) => void;
  setSnapGrid: (v: number) => void;
  /** Set document grid settings (visible, subdivisions, color). */
  setDocumentGrid: (settings: import('./context/types').DocumentGridSettings) => void;
  /** Set isometric grid settings. */
  setIsometricGrid: (grid: import('@varve/scene').IsometricGrid) => void;
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
  /** Show the archive dialog modal. */
  showArchiveDialog: boolean;
  archiveDialogMode: 'backup' | 'restore';
  setShowArchiveDialog: (show: boolean, mode?: 'backup' | 'restore') => void;
  /** Whether the upscale dialog is open. */
  upscaleDialogOpen: boolean;
  /** Open the upscale dialog for the selected image. */
  openUpscaleDialog: () => void;
  /** Close the upscale dialog. */
  closeUpscaleDialog: () => void;
  /** Whether the Image Trace (vectorize) dialog is open. */
  vectorizeDialogOpen: boolean;
  /** Re-trace target for the Image Trace dialog (Edit Trace workflow). */
  vectorizeDialogPrefill: { replaceGroupId: string } | null;
  /** Open the Image Trace dialog for the selected image. */
  openVectorizeDialog: (prefill?: { replaceGroupId: string } | null) => void;
  /** Close the Image Trace dialog. */
  closeVectorizeDialog: () => void;
  /** Flatten/rasterize/merge the current selection (unified flatten system). */
  flattenSelected: (mode: import('./flatten/types').FlattenMode, scale?: number) => void;
  rasterizeSelected: (scale?: number) => void;
  mergeSelected: () => void;
  /** Convert the selected text node to vector path outlines. */
  convertTextToOutlines: () => void;
  /** Add an export preset to a node. */
  addPreset: (nodeId: NodeId, preset: ExportPreset) => void;
  /** Update an export preset on a node. */
  updatePreset: (nodeId: NodeId, preset: ExportPreset) => void;
  /** Remove an export preset from a node. */
  removePreset: (nodeId: NodeId, presetId: string) => void;
  /** Apply a boolean operation to all selected nodes; replaces selection with result. */
  booleanOp: (op: import('@varve/scene').BooleanOpKind) => void;
  /** Expand the selected nodes' strokes into filled outline geometry. */
  expandStrokeSelected: () => void;
  /** Offset the selected paths' outlines by `distance` (negative contracts). */
  offsetPathSelected: (distance: number, joinStyle?: 'miter' | 'round' | 'bevel') => void;
  /** Round path corners of the selected nodes with a fixed radius. */
  roundCornersSelected: (radius: number) => void;
  /** Simplify selected paths with a tolerance (larger = more aggressive). */
  simplifyPathSelected: (tolerance: number) => void;
  /** Duplicate the selection mirrored across an axis through its center. */
  mirrorDuplicateSelected: (axis: 'horizontal' | 'vertical') => void;
  /** Duplicate the selection in a circle around its center. */
  radialDuplicateSelected: (count: number, totalAngleDeg?: number) => void;
  // Logo project (concepts/variants/brief) — see useLogoProject.
  newLogoProject: (name?: string) => void;
  createLogoConcept: () => void;
  duplicateActiveConcept: () => void;
  setConceptStatus: (
    conceptId: import('@varve/scene').NodeId,
    status: import('@varve/scene').LogoConceptStatus,
  ) => void;
  createLogoVariant: (name: string, kind: import('@varve/scene').LogoVariantKind) => void;
  patchBrief: (
    patch: Parameters<import('./context/useLogoProject').LogoProjectAPI['patchBrief']>[0],
  ) => void;
  addClearSpaceGuides: (gap: number) => void;
  /**
   * Apply a boolean operation between raster image nodes (ShapeNodes with
   * image fills) and vector ShapeNodes. Extracts alpha contours from each
   * raster node, converts to ShapeNodes, combines with vector nodes, and
   * applies the boolean operation. Replaces all operand nodes with the result.
   */
  booleanOpRaster: (
    kind: import('@varve/scene').BooleanOpKind,
    rasterNodeIds: import('@varve/scene').NodeId[],
    vectorNodeIds: import('@varve/scene').NodeId[],
  ) => Promise<void>;

  /** Remove background from the selected image node. */
  removeBackground: (method: import('@varve/scene').BackgroundRemovalMethod) => Promise<void>;
  /** Remove background with custom feather and decontaminate options. */
  removeBackgroundWithOptions: (
    method: import('@varve/scene').BackgroundRemovalMethod,
    feather: number,
    decontaminate: boolean,
  ) => Promise<void>;
  /** Cancel an in-progress background removal job. */
  cancelBackgroundRemoval: () => void;
  applyBackgroundRemovalPreview: () => void;
  cancelBackgroundRemovalPreview: () => void;

  /** SAM2 interactive segmentation — run point/box-prompted segmentation on an image node. */
  applySam2Segmentation: (params: {
    nodeId: import('@varve/scene').NodeId;
    prompts: {
      points?: Array<{ x: number; y: number; label: 0 | 1 }>;
      box?: { x1: number; y1: number; x2: number; y2: number };
    };
    signal?: AbortSignal;
    operation: 'preview' | 'mask' | 'selection' | 'layer';
  }) => Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null>;
  cancelSam2Segmentation: () => void;

  /** Enlarge the selected image into a new editable image layer. */
  upscaleSelectedImage: (options: import('@varve/engine').UpscaleOptions) => Promise<void>;
  /** Trace the selected image into a new editable vector group. */
  traceSelectedImage: (
    options: import('@varve/engine').RasterTraceOptions & { liveTrace?: boolean },
  ) => Promise<void>;
  /** Update live trace parameters on the first selected live-traced node (marks pending re-trace). */
  setSelectedLiveTraceParams: (params: Partial<import('@varve/scene').LiveTraceParams>) => void;
  /** Flatten the first selected live-traced node to ordinary vector geometry. */
  flattenSelectedLiveTrace: () => void;
  /** Cancel the first selected live-traced node and restore the source image. */
  clearSelectedLiveTrace: () => void;
  /** Cancel an in-progress image enlargement or trace job. */
  cancelImageProcessing: () => void;
  /** Toggle preview of original image (without background removal mask). */
  setShowOriginalBg: (nodeId: import('@varve/scene').NodeId | null) => void;
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
  getNodeInteractions: (nodeId: NodeId) => import('@varve/scene').DocumentInteraction[];
  /** Add an interaction to a node. */
  addNodeInteraction: (
    nodeId: NodeId,
    interaction: Omit<import('@varve/scene').DocumentInteraction, 'id' | 'nodeId'>,
  ) => void;
  /** Remove an interaction by id. */
  removeNodeInteraction: (interactionId: string) => void;
  /** Update an interaction by id. */
  updateNodeInteraction: (
    interactionId: string,
    updates: Partial<Omit<import('@varve/scene').DocumentInteraction, 'id' | 'nodeId'>>,
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
  /** Media (animated images): play/pause/seek/step on the media clock. */
  playMedia: () => void;
  pauseMedia: () => void;
  toggleMedia: () => void;
  seekMedia: (timeMs: number) => void;
  stepMediaFrame: (direction: 1 | -1) => void;
  isMediaPlaying: () => boolean;
  mediaTime: () => number;
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
  toggleHistoryPanel: () => void;
  addTimelineMarker: (timelineId: string, name: string, progress: number) => void;
  removeTimelineMarker: (timelineId: string, markerId: string) => void;
  renameTimelineMarker: (timelineId: string, markerId: string, name: string) => void;
  createMotionPresetFromTimeline: (timelineId: string, name: string) => string;
  applyMotionPreset: (presetId: string, timelineId: string) => void;
  toggleAutoKeyframe: () => void;
  toggleGraphEditor: () => void;
  toggleStateMachinePanel: () => void;
  deleteKeyframe: (timelineId: string, trackId: string, progress: number) => void;
  moveKeyframe: (
    timelineId: string,
    trackId: string,
    fromProgress: number,
    toProgress: number,
  ) => void;
  updateKeyframeEasing: (
    timelineId: string,
    trackId: string,
    progress: number,
    easing: import('@varve/shared').EasingDefinition,
  ) => void;
  setTrackMuted: (timelineId: string, trackId: string, muted: boolean) => void;
  setTrackSolo: (timelineId: string, trackId: string, solo: boolean) => void;
  toggleOnionSkin: () => void;
  setMotionSelectedTracks: (trackIds: string[]) => void;
  /** Patch editor state directly (for transient UI state). */
  patch: (patch: Partial<EditorState>) => void;

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
  /** Show or hide print guides (bleed/trim/slug/safe area) — view-only, never exported. */
  setBleedGuidesVisible: (visible: boolean) => void;
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
  /** Link the selected text frames into one story (ADR-0159). */
  linkSelectedTextFrames: () => void;
  /** Remove the selected frames from their stories. */
  unlinkSelectedTextFrames: () => void;
  /** Move a page on the pasteboard (placement metadata only, ADR-0124). */
  movePageOnPasteboard: (pageId: string, x: number, y: number) => void;
  /** Resize a page's trim without scaling its content (page-only resize). */
  resizePage: (pageId: string, width: number, height: number) => void;
  /** Fit the viewport to the active page's spread bounds. */
  fitSpread: () => void;
  /** Fit the viewport to every page (pasteboard bounds). */
  fitAllPages: () => void;

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
  getSpreadForPage: (pageId: NodeId) => import('@varve/scene').Spread | undefined;
  /** Classify a page as left/right/none based on facing-pages mode. */
  getPageSide: (pageId: NodeId) => import('@varve/scene').PageSide;
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
  /** Assign the document color mode without rewriting stored values. */
  assignDocumentColorMode: (mode: ColorMode) => void;
  /** Rewrite stored process colors into the target mode. */
  convertDocumentColors: (mode: ColorMode) => void;

  // Soft proofing
  /** Persisted proof configuration (document print intent). */
  proofConfig: import('@varve/scene').ProofConfig;
  /** Session-scoped proof toggle. Never persisted into documents. */
  proofEnabled: boolean;
  setProofEnabled: (enabled: boolean) => void;
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
  extractPalette: (data: ImageData, colorCount?: number) => import('@varve/engine').PaletteResult;
  /** Generate a harmony palette (complementary, triadic, etc.) from a base color. */
  generateHarmony: (
    color: import('@varve/scene').ManagedColor,
    type: 'complementary' | 'triadic' | 'analogous' | 'splitComplementary' | 'monochromatic',
  ) => import('@varve/engine').HarmonyPalette;
  /** Compute Miller's-Law/Hick's-Law cognitive load for a node (or the whole document if null). */
  getCognitiveLoad: (
    nodeId: import('@varve/scene').NodeId | null,
  ) => import('./intelligence/cognitiveLoad').CognitiveLoadReport;

  /** Switch the inspector panel to a tab, optionally selecting an IntelligencePanel sub-tab. */
  setInspectorTab: (tab: InspectorTab, subTab?: IntelligenceTab) => void;

  /** Turn a componentDetector.ts duplicate-structure group into a real component:
   *  the first node becomes the master definition, the rest are replaced in
   *  place with instances. Non-frame nodes in the group are left untouched. */
  createComponentFromGroup: (nodeIds: NodeId[]) => void;
  /** Promotes variant candidates into a component set with properties and variants.
   *  Wraps the entire mutation in a single undo transaction. */
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
  // Section visibility
  toggleSectionCollapse: (
    sectionId: import('./components/Inspector/sectionRegistry').SectionId,
  ) => void;
  toggleSubSectionCollapse: (
    sectionId: import('./components/Inspector/sectionRegistry').SectionId,
    subSectionId: string,
  ) => void;
  hideInspectorSection: (
    sectionId: import('./components/Inspector/sectionRegistry').SectionId,
  ) => void;
  showInspectorSection: (
    sectionId: import('./components/Inspector/sectionRegistry').SectionId,
  ) => void;
  showAllInspectorSections: () => void;
  restoreDefaultSectionState: () => void;
  restoreDefaultCollapsed: () => void;
  hideOptionalSections: () => void;
  setSelectedConstraint: (constraint: import('@varve/scene').Constraints) => void;
  trimToSubject: (
    padding?: number,
    options?: import('./imageCrop').TrimToSubjectOptions,
  ) => Promise<void>;
  expandImageBounds: (
    padding: number,
    sides?: { top?: number; right?: number; bottom?: number; left?: number },
  ) => void;
  convertToCropAndExpand?: (
    padding: number,
    sides?: { top?: number; right?: number; bottom?: number; left?: number },
  ) => void;
  resetImageBounds: () => void;
  // State machines (delegated to context/types.ts EditorContextValue)
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

  /** Restore a document from a backup. If `asCopy`, loads into a new session
   *  with a "(restored)" suffix; otherwise replaces the current project after
   *  first creating a safety snapshot. */
  restoreFromBackup: (backupId: string, asCopy: boolean) => Promise<boolean>;
  /** Create a named snapshot of the current document (manual restore point). */
  createSnapshot: (notes: string) => Promise<string | null>;

  // Content-Aware Fill dialog
  openCafDialog: (nodeId: NodeId) => void;
  closeCafDialog: () => void;

  // Debug overlays (Workstream A)
  setDebugOverlayEnabled: (enabled: boolean) => void;
  setDebugOverlayChannel: (channel: string, value: boolean) => void;
  setDebugOverlayLabelDensity: (density: string) => void;
  setDebugOverlayFrozen: (frozen: boolean) => void;

  // Touch multi-select (Workstream D)
  setTouchMultiSelect: (active: boolean) => void;

  // Findings overlay (delegated to context/types.ts EditorContextValue)
  setFindingsOverlayVisible: (v: boolean) => void;
  setFindingsProviderOverride: (providerId: string) => void;

  // Layer navigation (registered by LayersTree when mounted)
  layerNavigation?: import('./components/LayersPanel/layerNavigationCommands').LayerNavigationCommands;
}

export const EditorCtx = createContext<EditorContextValue | null>(null);

/** F2: full snapshot of an inactive session stored in a ref (not state). */
interface SavedSession {
  document: Document;
  selection: NodeId[];
  primaryId: NodeId | null;
  focusedNodeId: NodeId | null;
  activeContainerId: NodeId | null;
  selectionMode: import('./context/selectionState').SelectionMode;
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
    primaryId: s.primaryId,
    focusedNodeId: s.focusedNodeId,
    activeContainerId: s.activeContainerId,
    selectionMode: s.selectionMode,
    viewport: captureViewport({
      ...s,
      gridVisible: s.documentGrid.visible,
      dotGridEnabled: s.dotGridEnabled,
    }),
    undo: [...undo],
    redo: [...redo],
    undoSel: [...undoSel],
    redoSel: [...redoSel],
  };
}

function restoreViewportFields(
  raw: Partial<SavedViewport> | undefined,
  doc: Document,
): Pick<
  EditorState,
  | 'zoom'
  | 'pan'
  | 'cameraRotation'
  | 'snapEnabled'
  | 'pixelGridEnabled'
  | 'pixelGridSnapEnabled'
  | 'dotGridEnabled'
  | 'rulerMode'
  | 'gridOverlayMode'
  | 'unitType'
  | 'guidesVisible'
  | 'snapGrid'
  | 'documentGrid'
  | 'isometricGrid'
> {
  const v = normalizeSavedViewport(raw);
  const initialized = sceneInitializeGridSettings(doc);
  const grid = initialized.gridSettings?.documentGrid ?? createDefaultDocumentGridSettings();
  const isoGrid =
    Object.values(initialized.gridSettings?.isometricGrids ?? {})[0] ??
    createDefaultIsometricGrid();
  return {
    zoom: v.zoom,
    pan: v.pan,
    cameraRotation: v.cameraRotation,
    snapEnabled: v.snapEnabled,
    pixelGridEnabled: v.pixelGridEnabled,
    pixelGridSnapEnabled: v.pixelGridSnapEnabled ?? false,
    dotGridEnabled: v.dotGridEnabled ?? false,
    rulerMode: v.rulerMode,
    gridOverlayMode: v.gridOverlayMode,
    unitType: v.unitType,
    guidesVisible: v.guidesVisible,
    snapGrid: v.snapGrid,
    documentGrid: { ...grid, visible: v.gridVisible ?? grid.visible },
    isometricGrid: isoGrid,
  };
}

function persistViewportPrefs(s: EditorState): void {
  updateSettings({
    viewport: {
      snapEnabled: s.snapEnabled,
      pixelGridEnabled: s.pixelGridEnabled,
      pixelGridSnapEnabled: s.pixelGridSnapEnabled,
      dotGridEnabled: s.dotGridEnabled,
      bleedGuidesVisible: s.bleedGuidesVisible,
      layoutGridVisible: s.layoutGridVisible,
      rulerMode: s.rulerMode,
      gridOverlayMode: s.gridOverlayMode,
      unitType: s.unitType,
      guidesVisible: s.guidesVisible,
      snapGrid: s.snapGrid,
      gridVisible: s.documentGrid.visible,
      gridSubdivisions: s.documentGrid.subdivisions,
    },
  });
}

/**
 * Union bounds are recomputed for every camera commit — every wheel event,
 * every inertia and auto-pan frame, every pinch step. The walk is O(nodes)
 * (measured 0.14 ms at 100 nodes, 3.7 ms at 5,000), so on a large document a
 * single scroll gesture spent more time re-deriving an unchanged answer than
 * rendering. Documents are immutable, so identity is a sound cache key.
 *
 * A WeakMap keeps the entry alive exactly as long as the document itself: a
 * closed or switched-away document is collected with its bounds, and nothing
 * needs to invalidate the cache explicitly.
 */
const documentUnionBoundsCache = new WeakMap<
  Document,
  { x: number; y: number; w: number; h: number } | null
>();

function computeDocumentUnionBounds(
  doc: Document,
): { x: number; y: number; w: number; h: number } | null {
  const cached = documentUnionBoundsCache.get(doc);
  if (cached !== undefined) return cached;
  const computed = computeDocumentUnionBoundsUncached(doc);
  documentUnionBoundsCache.set(doc, computed);
  return computed;
}

function computeDocumentUnionBoundsUncached(
  doc: Document,
): { x: number; y: number; w: number; h: number } | null {
  const entries = walkNodes(doc);
  // nodeWorldBounds walks the ancestor chain via getParent() (O(n) per call);
  // a full-document pass without an index would be O(n²). One O(n) parent
  // index keeps the union computation linear.
  const parents = buildParentIndexMap(doc);
  let union: { x: number; y: number; w: number; h: number } | null = null;
  for (const [id] of entries) {
    const b = nodeWorldBounds(doc, id, parents);
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

/** Live canvas viewport, falling back to the window when the canvas is unmounted. */
function resolveCanvasViewport(): Viewport {
  const canvasEl =
    typeof document !== 'undefined'
      ? document.querySelector<HTMLElement>('canvas.editor-canvas__content-layer')
      : null;
  return canvasEl
    ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
    : { width: window.innerWidth, height: window.innerHeight - 120 };
}

/**
 * Clamp a candidate pan against the document extent and apply it.
 *
 * Returns the *same* state object when the clamp leaves the pan unchanged, so
 * scrolling into a document edge stops re-rendering (and stops scheduling
 * canvas frames) instead of producing a stream of no-op frames.
 */
function applyPanToState(current: EditorState, pan: { x: number; y: number }): EditorState {
  const camera = clampCamera(
    { zoom: current.zoom, pan, rotation: current.cameraRotation },
    resolveCanvasViewport(),
    computeDocumentUnionBounds(current.document),
  );
  if (camera.pan.x === current.pan.x && camera.pan.y === current.pan.y) return current;
  return { ...current, pan: camera.pan };
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

const INITIAL_SESSION_ID = 'session-0';

// ─── standalone helpers ─────────────────────────────────────────────────

/**
 * Apply layout to a frame's children and return the updated doc.
 *
 * Delegates to `reflowLayoutChildren`, the shared reflow entry point that
 * canvas resize commits and inspector W/H edits also use (see
 * `layout/reflow.ts`).
 */
function applyFrameLayout(doc: Document, parentId: string | null | undefined): Document {
  return reflowLayoutChildren(doc, parentId);
}

/**
 * When a frame's dimensions change (via inspector or resize), propagate
 * constraints to its children so stretch/scale children get correct
 * position AND dimensions.  Mirrors TransformEngine.bakeNode's constraint
 * logic for the inspector-resize path.
 */
function propagateFrameConstraints(
  doc: Document,
  frameId: string,
  oldW: number,
  oldH: number,
): Record<string, SceneNode> {
  const frame = doc.nodes[frameId];
  if (frame?.kind !== 'frame' || !frame.children) return {};
  const updates: Record<string, SceneNode> = {};
  for (const childId of frame.children) {
    const child = doc.nodes[childId];
    if (!child) continue;
    const cs = child.constraints;
    if (!cs) continue; // No constraints: child stays in place
    const childBounds = nodeLocalBounds(child, doc);
    if (!childBounds) continue;
    const childX = child.transform[4] + childBounds.x;
    const childY = child.transform[5] + childBounds.y;
    const newW = frame.w ?? oldW;
    const newH = frame.h ?? oldH;
    const result = applyConstraints(
      cs,
      { x: childX, y: childY, w: childBounds.w, h: childBounds.h },
      oldW,
      oldH,
      newW,
      newH,
    );
    let updatedChild: SceneNode = child;
    const dimChanged =
      Math.abs(result.w - childBounds.w) > 0.001 || Math.abs(result.h - childBounds.h) > 0.001;
    if (dimChanged) {
      updatedChild = resizeNodeGeometry(child, result.w, result.h);
    }
    updates[childId] = {
      ...updatedChild,
      transform: [
        child.transform[0],
        child.transform[1],
        child.transform[2],
        child.transform[3],
        result.x,
        result.y,
      ] as Affine,
    } as SceneNode;
  }
  return updates;
}

/** No-op fallback for media methods used before MediaProvider mounts. */
const MEDIA_NOOP: MediaContextValue = {
  playMedia: () => {},
  pauseMedia: () => {},
  toggleMedia: () => {},
  seekMedia: () => {},
  stepMediaFrame: () => {},
  isMediaPlaying: () => false,
  mediaTime: () => 0,
};

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
  toggleGraphEditor: () => {},
  setGraphEditorProperty: () => {},
  deleteKeyframe: () => {},
  moveKeyframe: () => {},
  duplicateKeyframe: () => {},
  updateKeyframeEasing: () => {},
  addTrackToTimeline: () => {},
  setTrackMuted: () => {},
  setTrackSolo: () => {},
  setMotionSelectedTracks: () => {},
  toggleOnionSkin: () => {},
  setOnionSkinBeforeCount: () => {},
  setOnionSkinAfterCount: () => {},
  setOnionSkinOpacity: () => {},
  setTrackNestedTimeline: () => {},
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
  initialFileId,
  initialFilePath,
  platform,
  externalState,
  onMutation,
  onSelectionChange,
  disablePersistentHistory,
}: {
  children: ReactNode;
  onBackToHome?: () => void;
  initialDocumentJson?: string;
  initialDocumentName?: string;
  /**
   * Identity of the file `initialDocumentJson` was read from.
   *
   * The bootstrap session holds that document already, so without this it is
   * anonymous and `openFile`'s dedupe — which matches on file id or path —
   * cannot recognise it. The host passes the same request through both this
   * prop and `openFile`, so the file would then open a second time in a new
   * tab, leaving two tabs on one document.
   */
  initialFileId?: string;
  initialFilePath?: string;
  platform?: Platform;
  /**
   * Remote-session sync (auxiliary windows, ADR-0204).
   *
   * When provided, the provider replaces its document and selection with
   * the incoming values WITHOUT pushing undo steps (the primary window is
   * the undo authority). `revision` is used to skip stale/duplicate
   * applications. Null = no external state pending.
   */
  externalState?: { documentJson: string; selection: string[]; revision: number } | null;
  /**
   * Remote-session mutation callback (auxiliary windows).
   *
   * Called with the serialized document AFTER every local document
   * mutation. The auxiliary bridge forwards it to the primary window's
   * broker, which applies it as the authoritative edit. No-op in the
   * primary window (callback not provided there).
   */
  onMutation?: (documentJson: string) => void;
  /** Remote-session selection callback (auxiliary windows). */
  onSelectionChange?: (selection: string[]) => void;
  /** Disable persistent history (auxiliary projections, ADR-0204). */
  disablePersistentHistory?: boolean;
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
    doc = sceneInitializeGridSettings(doc);
    const docGrid = doc.gridSettings?.documentGrid ?? createDefaultDocumentGridSettings();
    const isoGrid =
      Object.values(doc.gridSettings?.isometricGrids ?? {})[0] ?? createDefaultIsometricGrid();
    const vpDefaults = loadSettings().viewport;
    return {
      tool: 'select',
      zoom: 1,
      pan: { x: 0, y: 0 },
      selection: [],
      primaryId: null,
      focusedNodeId: null,
      activeContainerId: null,
      selectionMode: 'object' as const,
      selectionOrigin: 'api' as const,
      selectionRevision: 0,
      document: doc,
      sessions: [
        {
          id: INITIAL_SESSION_ID,
          name,
          dirty: false,
          ...(initialFileId ? { fileId: initialFileId } : {}),
          ...(initialFilePath ? { filePath: initialFilePath } : {}),
        },
      ],
      activeId: INITIAL_SESSION_ID,
      dirty: false,
      cursorPos: null,
      unitType: vpDefaults.unitType,
      pixelGridEnabled: vpDefaults.pixelGridEnabled,
      pixelGridSnapEnabled: false,
      dotGridEnabled: false,
      bleedGuidesVisible: vpDefaults.bleedGuidesVisible ?? false,
      layoutGridVisible: vpDefaults.layoutGridVisible ?? false,
      findingsOverlayVisible: false,
      findingsProviderOverrides: {},
      canUndo: false,
      canRedo: false,
      undoLabel: 'Undo',
      redoLabel: 'Redo',
      snapEnabled: vpDefaults.snapEnabled,
      snapGrid: vpDefaults.snapGrid,
      documentGrid: docGrid,
      isometricGrid: isoGrid,
      saveState: 'idle' as const,
      lastSavedAt: null,
      saveIssue: null,
      documentInfoOpen: false,
      prototypeMode: false,
      prototypeRuntime: null,
      prototypeDebug: new PrototypeDebugConsole(),
      prototypeData: { interactions: {} },
      isPresenting: false,
      selectedStateMachineId: null,
      selectedSMStateId: null,
      selectedSMTransitionId: null,
      softProofEnabled: false,
      // Every panel boolean is a projection of the boot workspace's effective
      // config (built-in defaults + that workspace's persisted overrides), so
      // a per-workspace customization survives a restart and no other mode's
      // layout can leak in through the global settings mirror.
      ...initialPanelVisibility(BOOT_WORKSPACE_MODE),
      // Transient view state, not persisted — each session starts with full
      // chrome visible rather than silently reopening into a hidden-panel state.
      distractionFreeMode: false,
      beforeAfterCompare: false,
      logoPreviewDialogOpen: false,
      // Hidden by default regardless of config — motion/timeline editing is an
      // opt-in workflow the user reaches via its own toggle, not something
      // every document should open into.
      timelinePanelVisible: false,
      historyPanelVisible: false,
      motion: createInitialMotionState(),
      media: createInitialMediaState(),
      canvasMode: 'full',
      workspaceMode: BOOT_WORKSPACE_MODE,
      graphEditorVisible: false,
      // Hidden by default, same reasoning as timelinePanelVisible above:
      // state machines are a document-wide prototyping workflow, opt-in via
      // its own toggle rather than something every selection surfaces.
      stateMachinePanelVisible: false,
      selectedGraphProperty: null,
      pendingFormat: null,
      selectionRange: null,
      cameraRotation: 0,
      rulerMode: vpDefaults.rulerMode as RulerMode,
      gridOverlayMode: vpDefaults.gridOverlayMode as GridOverlayMode,
      guidesVisible: vpDefaults.guidesVisible,
      selectedGuideId: null,
      currentPageId: null,
      isolatedNodeId: null,
      createTableFromDataOpen: false,
      tableEdit: null,
      showOriginalBgNodeId: null,
      maskPreviewMode: 'checkerboard' as const,
      sectionVisibility: loadSettings().sections.sections,
      refineMaskOptions: { brushSize: 20, hardness: 0.8 },
      lastDuplicateOffset: null,
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
      subjectHighlightId: null,
      cafDialogNodeId: null,
      backgroundRemovalPreviewSession: null,
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
      themeRevision: 0,
      revision: 0,
      warpEdit: null,
      upscaleDialogOpen: false,
      vectorizeDialogOpen: false,
      vectorizeDialogPrefill: null,
      debugOverlay: {
        enabled: false,
        channels: {
          geometry: false,
          hitTest: false,
          spatialIndex: false,
          interaction: false,
          selection: false,
          performance: false,
        },
        labelDensity: 'sparse',
        frozen: false,
        maxItems: 100,
        sampleRate: 1,
      },
      touchMultiSelect: {
        active: false,
        suspended: false,
      },
    };
  });
  const dialogState = useDialogState();
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
  const undoLabelsRef = useRef<string[]>([]);
  const redoLabelsRef = useRef<string[]>([]);
  /** Persistent-history API ref (assigned after the hook runs; used by
   *  stable callbacks and the derived undo-state sync below). */
  const persistentHistoryRef = useRef<PersistentHistoryApi | null>(null);
  /** One-shot skip signal for the persistent-history document watcher: set
   *  when a transaction commit already captured the transition. */
  const historySkipRef = useRef(false);
  /** F2: snapshots of all inactive sessions, keyed by session ID. */
  const sessionStoreRef = useRef<Map<string, SavedSession>>(new Map());
  /** Shared aria-live announcer for screen-reader messages. */
  const announcerRef = useRef<CanvasAnnouncer>(null);
  if (!announcerRef.current) {
    announcerRef.current = new CanvasAnnouncer();
  }
  /** Re-entrancy guard for workspace mode switching. */
  const workspaceSwitchInProgressRef = useRef(false);
  /** RAF ID for smoothZoomTo/smoothPanTo animation cancellation. */
  const panAnimRef = useRef<number | null>(null);
  /** Selection history for back/forward navigation. */
  const selectionHistory = useSelectionHistory();

  /** Reset undo/redo stacks. */
  const resetUndo = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    undoSelStackRef.current = [];
    redoSelStackRef.current = [];
    undoLabelsRef.current = [];
    redoLabelsRef.current = [];
  }, []);

  /**
   * Open `doc` in a brand-new session (tab) and make it active.
   *
   * Every "create a document" entry point funnels through here — the tab
   * strip's "+" button and File → New / Ctrl+N alike. Creating a document must
   * never replace the active tab's document in place: that session keeps its
   * fileId and filePath, so the next save (manual or autosave) would write the
   * new empty document over the file the user still had open.
   *
   * `meta` binds the new tab to a file. Omit it (the create-a-document case)
   * and the tab stays unbound, so its first save routes through Save As.
   */
  const openInNewSession = useCallback((doc: Document, meta?: SessionFileMeta) => {
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
      const newId = newSessionId();
      const newDocGrid = doc.gridSettings?.documentGrid ?? createDefaultDocumentGridSettings();
      const vpDefaults = loadSettings().viewport;
      undoStackRef.current = [];
      redoStackRef.current = [];
      undoSelStackRef.current = [];
      redoSelStackRef.current = [];
      undoLabelsRef.current = [];
      redoLabelsRef.current = [];
      return {
        ...s,
        document: doc,
        selection: [],
        selectedGuideId: null,
        zoom: 1,
        pan: { x: 0, y: 0 },
        cameraRotation: 0,
        snapEnabled: vpDefaults.snapEnabled,
        pixelGridEnabled: vpDefaults.pixelGridEnabled,
        pixelGridSnapEnabled: false,
        dotGridEnabled: vpDefaults.dotGridEnabled ?? false,
        snapGrid: vpDefaults.snapGrid,
        rulerMode: vpDefaults.rulerMode,
        gridOverlayMode: vpDefaults.gridOverlayMode,
        unitType: vpDefaults.unitType,
        guidesVisible: vpDefaults.guidesVisible,
        documentGrid: { ...newDocGrid, visible: vpDefaults.gridVisible ?? newDocGrid.visible },
        isometricGrid: createDefaultIsometricGrid(),
        dirty: false,
        // Identity comes only from `meta`; it is never inherited from the
        // previously active tab, so a new session can't save over the
        // document that tab was pointing at.
        sessions: [
          ...syncedSessions,
          {
            id: newId,
            name: meta?.name ?? doc.name,
            dirty: false,
            filePath: meta?.filePath,
            fileId: meta?.fileId,
          },
        ],
        activeId: newId,
      };
    });
  }, []);

  /**
   * File → New / Ctrl+N. Uses the canonical creation service (an empty,
   * infinite-canvas document) and opens it in its own tab.
   */
  const newDocument = useCallback(() => {
    const created = createNewDocument({});
    openInNewSession(created.ok ? created.result.document : createDocument('Untitled', true));
  }, [openInNewSession]);

  // After each render, sync canUndo/canRedo/undoLabel/redoLabel if they
  // diverge from the derived values. Uses a ref to track what we last synced
  // to avoid infinite patch→render→patch loops.
  const lastSyncedUndo = useRef({
    canUndo: false,
    canRedo: false,
    undoLabel: 'Undo',
    redoLabel: 'Redo',
  });
  const undoLen = undoStackRef.current.length;
  const redoLen = redoStackRef.current.length;
  // When the persistent history session is attached with history, undo/redo
  // state derives from the revision store, not the shadow stacks.
  const persistentSessionActive =
    persistentHistoryRef.current?.attached &&
    ((persistentHistoryRef.current.session?.canUndo ?? false) ||
      (persistentHistoryRef.current.session?.canRedo ?? false));
  const derivedCanUndo = persistentSessionActive
    ? (persistentHistoryRef.current?.session?.canUndo ?? false)
    : undoLen > 0;
  const derivedCanRedo = persistentSessionActive
    ? (persistentHistoryRef.current?.session?.canRedo ?? false)
    : redoLen > 0;
  const derivedUndoLabel = persistentSessionActive
    ? (persistentHistoryRef.current?.session?.undoLabel ?? 'Undo')
    : (undoLabelsRef.current[undoLen - 1] ?? 'Undo');
  const derivedRedoLabel = persistentSessionActive
    ? (persistentHistoryRef.current?.session?.redoLabel ?? 'Redo')
    : (redoLabelsRef.current[redoLen - 1] ?? 'Redo');
  useEffect(() => {
    const last = lastSyncedUndo.current;
    if (
      last.canUndo !== derivedCanUndo ||
      last.canRedo !== derivedCanRedo ||
      last.undoLabel !== derivedUndoLabel ||
      last.redoLabel !== derivedRedoLabel
    ) {
      lastSyncedUndo.current = {
        canUndo: derivedCanUndo,
        canRedo: derivedCanRedo,
        undoLabel: derivedUndoLabel,
        redoLabel: derivedRedoLabel,
      };
      patch(lastSyncedUndo.current);
    }
  });

  /** F6: transaction state for single-undo scrubbing. */
  const inTransactionRef = useRef(false);
  const txSnapshotRef = useRef<Document | null>(null);
  const txSelRef = useRef<NodeId[] | null>(null);
  const interactionState = useInteractionState();
  /** Auto-save + versioned-backup services (own their lifecycle). */
  const recoveryRef = useRef<RecoveryManager | null>(null);
  /** Initialize recovery once. */
  if (!recoveryRef.current) {
    recoveryRef.current = getSharedRecoveryManager();
  }
  const { autoSaveRef, backupRef } = useAutoBackupServices(platform, stateRef, recoveryRef);
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

  /** Notify auto-save + backup on every document mutation. */
  useEffect(() => {
    if (state.dirty) {
      autoSaveRef.current?.notifyEdit();
      const meta = state.sessions.find((sess) => sess.id === state.activeId);
      const pid = meta?.fileId ?? state.activeId;
      // Pass the serialized document so the scheduler can back it up without
      // needing to re-serialize at tick time (the snapshot is frozen here).
      try {
        const json = serializeDocument();
        backupRef.current?.markDirty(
          pid,
          json,
          meta?.name ?? 'Untitled',
          state.revision,
          meta?.fileId,
        );
      } catch {
        // serialization failure — skip backup this tick
      }
    }
  }, [state.document, state.dirty, state.sessions, state.activeId, state.revision]);

  /** Cleanup background-removal worker state and worker pool on unmount. */
  useEffect(() => {
    return () => {
      bgRemovalAbortRef.current?.abort();
      bgRemovalAbortRef.current = null;
      processingBgNodeRef.current = null;
      imageProcessingAbortRef.current?.abort();
      imageProcessingAbortRef.current = null;
      processingImageNodeRef.current = null;
      void import('@varve/engine').then(({ terminateWorkerPool }) => terminateWorkerPool());
    };
  }, []);

  const patch = useCallback((partial: Partial<EditorState>) => {
    // Update stateRef synchronously so async callbacks (menu actions,
    // keyboard shortcuts) see the latest state even before React flushes.
    stateRef.current = { ...stateRef.current, ...partial };
    setState((s) => ({ ...s, ...partial }));
  }, []);

  // Register the theme-revision bridge so Menubar / SettingsDialog can bump
  // the counter without importing EditorContextValue.
  useEffect(() => {
    setBumpThemeRevisionHandler(() => {
      patch({ themeRevision: stateRef.current.themeRevision + 1 });
    });
    return () => setBumpThemeRevisionHandler(null);
  }, [patch]);

  // Register the backup service bridge so SettingsDialog's BackupSettingsPanel
  // can reach the live service without context drilling.
  useEffect(() => {
    setBackupServiceGetter(() => backupRef.current);
    return () => setBackupServiceGetter(null);
  }, []);

  /** Persistence (save/load/document lifecycle). */
  const { serializeDocument, save, saveAs, saveCopy, loadDocument } = usePersistence(
    state,
    patch,
    stateRef,
    platform,
    resetUndo,
    openInNewSession,
    recoveryRef,
    computeFitAllCamera,
  );

  // Remote-session sync (auxiliary windows, ADR-0204): mutation + selection
  // callbacks are kept in refs so updateDoc/setSelection stay dependency-free.
  const onMutationRef = useRef(onMutation);
  onMutationRef.current = onMutation;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const lastMutatedDocRef = useRef<string | null>(null);
  const lastExternalRevisionRef = useRef(-1);

  // Forward local mutations to the auxiliary bridge (post-commit drain).
  useEffect(() => {
    if (lastMutatedDocRef.current !== null) {
      onMutationRef.current?.(lastMutatedDocRef.current);
      lastMutatedDocRef.current = null;
    }
  });

  // Apply externally-sourced document/selection (primary → auxiliary).
  // Never pushes undo steps — the primary window is the undo authority.
  useEffect(() => {
    if (!externalState) return;
    if (externalState.revision <= lastExternalRevisionRef.current) return;
    lastExternalRevisionRef.current = externalState.revision;
    const decoded = DocumentCodec.decode(externalState.documentJson);
    if (!decoded.ok) return;
    const synced = editorGridFromDoc(decoded.document);
    setState((s) => ({
      ...s,
      document: decoded.document,
      documentGrid: synced.documentGrid,
      isometricGrid: synced.isometricGrid,
      snapGrid: synced.documentGrid.spacingX,
      selection: externalState.selection,
      primaryId: externalState.selection[0] ?? null,
      focusedNodeId: externalState.selection[0] ?? null,
      selectionRevision: s.selectionRevision + 1,
    }));
  }, [externalState]);

  function editorGridFromDoc(doc: Document) {
    const initialized = sceneInitializeGridSettings(doc);
    const dg = initialized.gridSettings?.documentGrid ?? createDefaultDocumentGridSettings();
    const ig =
      Object.values(initialized.gridSettings?.isometricGrids ?? {})[0] ??
      createDefaultIsometricGrid();
    return { documentGrid: dg, isometricGrid: ig };
  }

  const selectionCommands = useSelectionCommands({
    document: state.document,
    primaryId: state.primaryId,
    currentSelection: state.selection,
    patch,
    announce: (msg: string) => announcerRef.current?.announce(msg),
  });

  const updateDoc = useCallback((fn: (doc: Document) => Document) => {
    setState((s) => {
      if (!inTransactionRef.current) {
        undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
        undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
        undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
        redoStackRef.current = [];
        redoSelStackRef.current = [];
        redoLabelsRef.current = [];
      }
      const newDoc = fn(s.document);
      if (onMutationRef.current) {
        lastMutatedDocRef.current = JSON.stringify(newDoc);
      }
      const synced = editorGridFromDoc(newDoc);
      return {
        ...s,
        document: newDoc,
        documentGrid: synced.documentGrid,
        isometricGrid: synced.isometricGrid,
        snapGrid: synced.documentGrid.spacingX,
        dirty: true,
        canUndo: true,
        canRedo: false,
        undoLabel: 'Edit',
        redoLabel: 'Redo',
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: true } : sess,
        ),
      };
    });
  }, []);

  /** Icon asset operations (insert/replace/detach) — see useIconAssets.ts. */
  const iconAssets = useIconAssets({
    stateRef,
    updateDoc,
    patch,
    announce: (message: string) => announcerRef.current?.announce(message),
    insertSubtree: insertImportedSubtree,
    viewportCenterWorld,
  });

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
  // P5: Wired to @varve/collab transaction hooks for Yjs integration
  const beginTransaction = useCallback(() => {
    inTransactionRef.current = true;
    txSnapshotRef.current = state.document;
    txSelRef.current = state.selection;
    getTransactionHooks().onBeginTransaction();
  }, [state.document, state.selection]);

  const commitTransaction = useCallback(() => {
    // Queue finalization behind any document updater scheduled by the same
    // pointer event. Ending the transaction synchronously lets that updater
    // observe `inTransaction=false` and push the already-transformed document
    // on top of the real snapshot, making the first Undo appear to do nothing.
    setState((current) => {
      if (inTransactionRef.current) {
        inTransactionRef.current = false;
        // Only record an undo entry if the transaction actually changed the
        // document. The document is updated immutably (structural sharing), so
        // a transaction that mutated nothing leaves the reference identical to
        // the begin-time snapshot. Empty transactions are common — a plain
        // click that only selects a node still begins+commits one, and the
        // drag-end reparent pass opens one even when no node is reparented.
        // Pushing those produced spurious "undo does nothing" steps, so one
        // gesture took several undos to reverse. Comparing by reference here
        // fixes every empty-transaction source at once and can never skip a
        // real edit, which always yields a fresh document reference.
        const changed =
          txSnapshotRef.current !== null && txSnapshotRef.current !== current.document;
        if (changed) {
          undoStackRef.current = [...undoStackRef.current.slice(-49), txSnapshotRef.current!];
          undoSelStackRef.current = [...undoSelStackRef.current.slice(-49), txSelRef.current ?? []];
          undoLabelsRef.current = [...undoLabelsRef.current.slice(-49), 'Edit'];
          redoStackRef.current = [];
          redoSelStackRef.current = [];
          redoLabelsRef.current = [];
          // Persistent history (M7): route the committed transaction into the
          // revision store. Diffed against the begin-state document; empty
          // transactions are suppressed by the reference check above.
          const before = txSnapshotRef.current;
          const persistentNow = persistentHistoryRef.current;
          if (before && persistentNow?.attached) {
            historySkipRef.current = true;
            persistentNow.capture(before, current.document, 'Edit', 'modify');
          }
        }
        txSnapshotRef.current = null;
        txSelRef.current = null;
        getTransactionHooks().onCommitTransaction();
      }
      return current;
    });
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
      // v2.18 (ADR-0159): chains are created as authoritative stories —
      // the first frame's rich text seeds the story, and every frame is
      // linked into its thread.
      updateDoc((doc) => {
        const firstFrame = doc.nodes[frameIds[0] ?? ''];
        const content =
          firstFrame && firstFrame.kind === 'text' && firstFrame.richText
            ? firstFrame.richText
            : { paragraphs: [] as import('@varve/scene').Paragraph[] };
        const { story, doc: withStory } = createStoryDoc(doc, { name, content });
        let d = withStory;
        for (const fid of frameIds) d = linkFrameDoc(d, story.id, fid);
        return d;
      });
    },
    [updateDoc],
  );

  const linkSelectedTextFrames = useCallback(() => {
    const sel = stateRef.current.selection;
    if (sel.length === 0) return;
    updateDoc((doc) => {
      const plan = planLinkSelection(doc, sel);
      if (plan.kind === 'noop') {
        announcerRef.current?.announce(plan.reason);
        return doc;
      }
      if (plan.kind === 'create-story') {
        const { story, doc: d1 } = createStoryDoc(doc, {
          name: plan.name,
          content: storySeedForFrame(doc, plan.frames[0]!),
        });
        let d = d1;
        for (const fid of plan.frames) d = linkFrameDoc(d, story.id, fid);
        announcerRef.current?.announce(`Text frames linked into story "${story.name}"`);
        return d;
      }
      let d = doc;
      for (const fid of plan.frames) d = linkFrameDoc(d, plan.storyId, fid);
      announcerRef.current?.announce('Text frames linked to existing story');
      return d;
    });
  }, [updateDoc, announcerRef]);

  const unlinkSelectedTextFrames = useCallback(() => {
    const sel = stateRef.current.selection;
    if (sel.length === 0) return;
    updateDoc((doc) => {
      let d = doc;
      let count = 0;
      for (const fid of planUnlinkSelection(doc, sel)) {
        const story = storyForFrame(d, fid);
        if (story) {
          d = unlinkFrameDoc(d, story.id, fid);
          count++;
        }
      }
      if (count > 0)
        announcerRef.current?.announce(`${count} text frame${count === 1 ? '' : 's'} unlinked`);
      return d;
    });
  }, [updateDoc, announcerRef]);
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
      const viewport = resolveCanvasViewport();
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
  const [mediaValue, setMediaValue] = useState<MediaContextValue | null>(null);
  const [protoValue, setProtoValue] = useState<
    import('./context/PrototypeContext').PrototypeContextValue | null
  >(null);
  /** Session-scoped soft-proof toggle (never persisted into documents). */
  const [proofEnabledState, setProofEnabledState] = useState(false);
  /** Raster LOD pyramid: viewport + budget wiring for the engine seam (ADR-0214). */
  const rasterLodSettings = loadSettings();
  useRasterLod(rasterLodSettings.render.memoryBudget);
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

  const sam2Seg = useSam2Segmentation(state, stateRef, setState, updateDoc, announcerRef);

  const logoGeometry = useLogoGeometry(
    setState,
    stateRef,
    announcerRef,
    undoStackRef,
    undoSelStackRef,
    redoStackRef,
    redoSelStackRef,
    inTransactionRef,
  );

  const logoProject = useLogoProject(setState, stateRef, updateDoc, announcerRef);

  const workspaceModeCtx = useWorkspaceMode(
    state,
    patch,
    toolRef,
    announcerRef,
    workspaceSwitchInProgressRef,
    platform,
  );

  const persistentHistory = usePersistentHistory({
    document: state.document,
    selection: state.selection,
    patch,
    inTransactionRef,
    historySkipRef,
    disabled: disablePersistentHistory,
  });
  /** Ref to the persistent-history API for use inside stable callbacks. */
  persistentHistoryRef.current = persistentHistory;

  const value = useMemo<EditorContextValue>(
    () => ({
      state,
      platform,
      persistentHistory,
      updateDoc,
      patch,
      insertIconAsset: iconAssets.insertIconAsset,
      replaceIconAsset: iconAssets.replaceIconAsset,
      detachIconNodes: iconAssets.detachIconNodes,
      getIconAsset: iconAssets.getIconAsset,
      getIconAssetForNode: iconAssets.getIconAssetForNode,
      setTool: (t) => applyToolChange(t, toolRef, patch),
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
        setState((current) => applyPanToState(current, p));
      },
      panBy: (dx, dy) => {
        if (dx === 0 && dy === 0) return;
        // Advance the imperative snapshot immediately. Auto-pan moves the
        // camera and then re-dispatches the held pointer in the same frame, so
        // tool coordinate conversion must observe this exact camera rather
        // than waiting for React to commit. The functional updater still
        // accumulates bursts against React's latest queued state.
        stateRef.current = applyPanToState(stateRef.current, {
          x: stateRef.current.pan.x + dx,
          y: stateRef.current.pan.y + dy,
        });
        setState((current) =>
          applyPanToState(current, { x: current.pan.x + dx, y: current.pan.y + dy }),
        );
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
        if (panAnimRef.current !== null) cancelAnimationFrame(panAnimRef.current);
        const clamped = clampZoom(targetZoom);
        if (isReducedMotion()) {
          patch({ zoom: clamped });
          return;
        }
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
        const endCam = zoomAboutPoint(startCam, centre, clamped, vp);
        const startTime = performance.now();
        const tick = (now: number) => {
          const elapsed = now - startTime;
          const { camera, done } = animateCamera(startCam, endCam, elapsed, durationMs);
          patch({ zoom: camera.zoom, pan: camera.pan, cameraRotation: camera.rotation ?? 0 });
          if (!done) {
            panAnimRef.current = requestAnimationFrame(tick);
          } else {
            panAnimRef.current = null;
          }
        };
        panAnimRef.current = requestAnimationFrame(tick);
      },
      smoothPanTo: (target, durationMs = 150) => {
        if (panAnimRef.current !== null) cancelAnimationFrame(panAnimRef.current);
        if (isReducedMotion()) {
          patch({ pan: { x: target.x, y: target.y } });
          return;
        }
        const startCam = { pan: stateRef.current.pan, zoom: stateRef.current.zoom };
        const endCam = { pan: target, zoom: startCam.zoom };
        const startTime = performance.now();
        const tick = (now: number) => {
          const elapsed = now - startTime;
          const { camera, done } = animateCamera(startCam, endCam, elapsed, durationMs);
          patch({ zoom: camera.zoom, pan: camera.pan });
          if (!done) {
            panAnimRef.current = requestAnimationFrame(tick);
          } else {
            panAnimRef.current = null;
          }
        };
        panAnimRef.current = requestAnimationFrame(tick);
      },
      smoothReveal: (bounds, opts) => {
        if (panAnimRef.current !== null) cancelAnimationFrame(panAnimRef.current);
        if (isReducedMotion()) {
          const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
          const vp: Viewport = canvasEl
            ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
            : { width: window.innerWidth, height: window.innerHeight - 120 };
          const endCam = fitBoundsCamera(bounds, vp, opts?.padding ?? 40);
          patch({ zoom: endCam.zoom, pan: endCam.pan });
          return;
        }
        const startCam = { pan: stateRef.current.pan, zoom: stateRef.current.zoom };
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        const endCam = fitBoundsCamera(bounds, vp, opts?.padding ?? 40);
        const durationMs = opts?.durationMs ?? 250;
        const startTime = performance.now();
        const tick = (now: number) => {
          const elapsed = now - startTime;
          const { camera, done } = animateCamera(startCam, endCam, elapsed, durationMs);
          patch({ zoom: camera.zoom, pan: camera.pan });
          if (!done) {
            panAnimRef.current = requestAnimationFrame(tick);
          } else {
            panAnimRef.current = null;
          }
        };
        panAnimRef.current = requestAnimationFrame(tick);
      },
      // Each toggle records a per-workspace override so the choice is
      // re-applied the next time this mode is entered, and after a restart.
      toggleLeftPanel: () => {
        const next = !state.leftPanelVisible;
        patch({ leftPanelVisible: next });
        recordPanelVisibilityOverride(state.workspaceMode, 'layers', next);
        updateSettings({ panel: { leftPanelVisible: next } });
      },
      toggleRightPanel: () => {
        const next = !state.rightPanelVisible;
        patch({ rightPanelVisible: next });
        recordPanelVisibilityOverride(state.workspaceMode, 'inspector', next);
        updateSettings({ panel: { rightPanelVisible: next } });
      },
      toggleLibraryPanel: () => {
        const next = !state.libraryPanelVisible;
        patch({ libraryPanelVisible: next });
        recordPanelVisibilityOverride(state.workspaceMode, 'library', next);
      },
      toggleCodegenPanel: () => {
        const next = !state.codegenPanelVisible;
        patch({ codegenPanelVisible: next });
        recordPanelVisibilityOverride(state.workspaceMode, 'codegen', next);
      },
      toggleLogoPanel: () => {
        if (state.workspaceMode !== 'logo') {
          announcerRef.current?.announce('Switch to the Logo workspace to use the Logo panel');
          return;
        }
        const next = !state.logoPanelVisible;
        patch({ logoPanelVisible: next });
        recordPanelVisibilityOverride(state.workspaceMode, 'logo', next);
        updateSettings({ panel: { logoPanelVisible: next } });
      },
      toggleHistoryPanel: () => {
        const next = !state.historyPanelVisible;
        patch({ historyPanelVisible: next });
        recordPanelVisibilityOverride(state.workspaceMode, 'history', next);
      },
      restoreAllPanels: () => {
        // Recovery path for accidentally hidden panels: show every panel the
        // active workspace knows, and record the choice as an override so the
        // restored layout is what the next session boots into.
        const patchObj: Partial<EditorState> = {
          leftPanelVisible: true,
          rightPanelVisible: true,
          timelinePanelVisible: true,
          libraryPanelVisible: true,
          codegenPanelVisible: true,
          logoPanelVisible: true,
          historyPanelVisible: true,
        };
        patch(patchObj);
        const mode = state.workspaceMode;
        const panelIds: PanelId[] = [
          'layers',
          'inspector',
          'timeline',
          'library',
          'codegen',
          'logo',
          'history',
        ];
        for (const panelId of panelIds) {
          recordPanelVisibilityOverride(mode, panelId, true);
        }
        announcerRef.current?.announce('All panels restored');
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
      ...workspaceModeCtx,
      // Section visibility
      toggleSectionCollapse: (sectionId: SectionId) => {
        const next = toggleCollapsed(state.sectionVisibility, sectionId);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
      },
      toggleSubSectionCollapse: (sectionId: SectionId, subSectionId: string) => {
        const next = toggleSubSectionCollapsedDoc(state.sectionVisibility, sectionId, subSectionId);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
      },
      hideInspectorSection: (sectionId: SectionId) => {
        const next = hideSection(state.sectionVisibility, sectionId);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
        announcerRef.current?.announce(`Section hidden`);
      },
      showInspectorSection: (sectionId: SectionId) => {
        const next = showSection(state.sectionVisibility, sectionId);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
        announcerRef.current?.announce(`Section shown`);
      },
      showAllInspectorSections: () => {
        const next = showAllSections(state.sectionVisibility);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
        announcerRef.current?.announce(`All sections shown`);
      },
      restoreDefaultSectionState: () => {
        const next = restoreAllDefaults(state.sectionVisibility);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
        announcerRef.current?.announce(`Section visibility restored to defaults`);
      },
      restoreDefaultCollapsed: () => {
        const next = restoreCollapsedDefaults(state.sectionVisibility);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
        announcerRef.current?.announce(`Section collapse state restored to defaults`);
      },
      hideOptionalSections: () => {
        const next = hideAllOptional(state.sectionVisibility);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
        announcerRef.current?.announce(`Optional sections hidden`);
      },
      // Section ordering
      moveSectionUp: (sectionId: SectionId) => {
        const next = moveSectionUpDoc(state.sectionVisibility, sectionId);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
      },
      moveSectionDown: (sectionId: SectionId) => {
        const next = moveSectionDownDoc(state.sectionVisibility, sectionId);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
      },
      moveSectionToStart: (sectionId: SectionId) => {
        const next = moveSectionToStartDoc(state.sectionVisibility, sectionId);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
      },
      moveSectionToEnd: (sectionId: SectionId) => {
        const next = moveSectionToEndDoc(state.sectionVisibility, sectionId);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
      },
      resetSectionOrder: () => {
        const next = resetSectionOrderDoc(state.sectionVisibility);
        patch({ sectionVisibility: next });
        updateSettings({ sections: { version: 1, sections: next } });
        announcerRef.current?.announce(`Section order restored`);
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
          const current: import('@varve/shared').Camera = {
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
      setSelection: (id: NodeId | null, origin?: SelectionOrigin) => {
        const newSelection = id ? [id] : [];
        const resolvedOrigin = origin ?? DEFAULT_SELECTION_ORIGIN;
        if (resolvedOrigin !== 'api') {
          selectionHistory.push(newSelection);
        }
        patch({
          selection: newSelection,
          primaryId: id,
          focusedNodeId: id,
          selectionRevision: state.selectionRevision + 1,
          selectionOrigin: resolvedOrigin,
        });
        if (onSelectionChangeRef.current) {
          onSelectionChangeRef.current(newSelection);
        }
      },

      // ADR-0016: table edit session + undoable table model ops.
      setTableEdit: (tableEdit: import('./context/types').TableEditState | null) => {
        patch({ tableEdit });
      },
      openCreateTableFromDataDialog: () => {
        patch({ createTableFromDataOpen: true });
      },
      updateTableCellText: (cellId: string, text: string) => {
        updateDoc((doc) => updateTableCellTextInDoc(doc, cellId, text));
      },
      tableOp: (
        tableId: string,
        op: (model: import('@varve/scene').TableModel) => import('@varve/scene').TableModel,
      ) => {
        updateDoc((doc) => applyTableModelOp(doc, tableId, op));
      },
      embedSceneContentInCell: (tableId, cellId, nodeId) => {
        updateDoc((doc) => embedSceneContentInCellDoc(doc, tableId, cellId, nodeId));
      },

      // F1: additive = shift+click behaviour.
      // Read from stateRef.current.selection (not the closed-over state.selection)
      // so callers that batch setSelection + toggleSelection (e.g. selectAll)
      // see the accumulation from prior calls in the same synchronous tick.
      toggleSelection: (id: NodeId, additive: boolean = false, origin?: SelectionOrigin) => {
        const currentSel = stateRef.current.selection;
        const nextSelection = (() => {
          if (additive) {
            const already = currentSel.includes(id);
            return already ? currentSel.filter((x) => x !== id) : [...currentSel, id];
          }
          return [id];
        })();
        const hasChanges = JSON.stringify(currentSel) !== JSON.stringify(nextSelection);
        if (!hasChanges) return;
        const resolvedOrigin = origin ?? DEFAULT_SELECTION_ORIGIN;
        if (resolvedOrigin !== 'api') {
          selectionHistory.push(nextSelection);
        }
        const newPrimaryId = nextSelectionPrimary(
          currentSel,
          nextSelection,
          stateRef.current.primaryId,
          id,
          additive,
        );
        const newFocusedNodeId = additive
          ? currentSel.includes(id)
            ? stateRef.current.focusedNodeId === id
              ? null
              : stateRef.current.focusedNodeId
            : id
          : id;
        stateRef.current = {
          ...stateRef.current,
          selection: nextSelection,
          primaryId: newPrimaryId,
          focusedNodeId: newFocusedNodeId,
          selectionRevision: stateRef.current.selectionRevision + 1,
          selectionOrigin: resolvedOrigin,
        };
        setState((s) => ({
          ...s,
          selection: nextSelection,
          primaryId: newPrimaryId,
          focusedNodeId: newFocusedNodeId,
          selectionRevision: s.selectionRevision + 1,
          selectionOrigin: resolvedOrigin,
        }));
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
          patch({
            selection: ids,
            primaryId: ids[0]!,
            focusedNodeId: ids[0]!,
            selectionRevision: state.selectionRevision + 1,
          });
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
          patch({
            selection: [firstNode.id, ...matchingIds],
            primaryId: firstNode.id,
            focusedNodeId: firstNode.id,
            selectionRevision: state.selectionRevision + 1,
          });
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
          undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
          redoStackRef.current = [];
          redoLabelsRef.current = [];

          const { id, doc: d2 } = nextNodeId(s.document);
          const transform: Affine = [1, 0, 0, 1, world.x, world.y];

          let node: SceneNode;
          let isFrame = false;
          if (activeTool === 'table') {
            // ADR-0016: a native table with a data-backed model, header row,
            // and fraction-filled columns sized to the dragged rect.
            const w = Math.max(80, size?.w ?? 480);
            const h = Math.max(60, size?.h ?? 240);
            node = makeTableNode(id, {
              name: 'Table',
              transform,
              rows: 4,
              columns: 4,
              headerRows: 1,
              w,
              h,
              columnSizing: { kind: 'fraction', value: 1 },
            });
          } else if (activeTool === 'frame' || activeTool === 'slice') {
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
            const localPos = worldToParent(d2, effectiveParentId, [world.x, world.y]) ?? [
              world.x,
              world.y,
            ];
            const localTransform: Affine = [1, 0, 0, 1, localPos[0], localPos[1]];
            node = {
              ...node,
              transform: localTransform,
              constraints: defaultConstraints(),
            } as SceneNode;
            // Path geometry under a transformed parent: anchors were rebased
            // by translation only above, which is correct for identity
            // parents but drifts by the parent's linear part (rotation/
            // scale). Remap through the full inverse so the composed
            // parent·node·point reproduces the drawn world path. Handles are
            // vectors and are handled by pathPointsWorldToLocal.
            if (
              pathPoints &&
              pathPoints.length > 0 &&
              node.kind === 'shape' &&
              node.shape.kind === 'path'
            ) {
              const parentWorld = nodeWorldTransform(d2, effectiveParentId);
              const absoluteLocal = pathPointsWorldToLocal(pathPoints, parentWorld);
              const localPoints = absoluteLocal.map((p) => ({
                ...p,
                x: p.x - localPos[0],
                y: p.y - localPos[1],
              }));
              node = {
                ...node,
                shape: { ...node.shape, points: localPoints },
              } as SceneNode;
            }
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
            const frameNode = newDoc.nodes[id] as import('@varve/scene').FrameNode;
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
            dirty: true,
            canUndo: true,
            canRedo: false,
            undoLabel: 'Edit',
            redoLabel: 'Redo',
            sessions: s.sessions.map((sess) =>
              sess.id === s.activeId ? { ...sess, dirty: true } : sess,
            ),
          };
        });
      },

      createTextNodeAt: (world, size, parentId, text = '') => {
        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
          redoStackRef.current = [];
          redoLabelsRef.current = [];

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
            const localNode = {
              ...node,
              transform: localTransform,
              constraints: defaultConstraints(),
            } as SceneNode;
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

          return {
            ...s,
            document: newDoc,
            selection: [id],
            tool: 'select' as ToolId,
            dirty: true,
            canUndo: true,
            canRedo: false,
            undoLabel: 'Edit',
            redoLabel: 'Redo',
            sessions: s.sessions.map((sess) =>
              sess.id === s.activeId ? { ...sess, dirty: true } : sess,
            ),
          };
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
          undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
          redoStackRef.current = [];
          redoLabelsRef.current = [];

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

      nodeWorldBounds: (n) =>
        getCachedWorldBounds(transformCacheRef.current, state.document, n.id) ??
        nodeWorldBounds(state.document, n.id),
      getWorldTransform: (id) =>
        getCachedWorldTransform(transformCacheRef.current, state.document, id),
      getWorldBounds: (id) => getCachedWorldBounds(transformCacheRef.current, state.document, id),

      canvasToWorld: (cx, cy) => {
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: 1920, height: 1080 };
        // Resolve against stateRef, not the render-closure `state`: panBy and
        // commitCamera advance stateRef synchronously (auto-pan re-dispatches
        // the held pointer in the same tick), so a render-stale camera here
        // makes the dragged object lag the pan by a full tick — measured as a
        // ~17px gap under 50ms frame times during edge auto-pan.
        const camState = {
          zoom: stateRef.current.zoom,
          pan: stateRef.current.pan,
          cameraRotation: stateRef.current.cameraRotation,
        };
        const [wx, wy] = editorScreenToWorld(camState, cx, cy, vp);
        return { x: wx, y: wy };
      },

      worldToCanvas: (wx, wy) => {
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: 1920, height: 1080 };
        const [sx, sy] = editorWorldToScreen(
          {
            zoom: stateRef.current.zoom,
            pan: stateRef.current.pan,
            cameraRotation: stateRef.current.cameraRotation,
          },
          wx,
          wy,
          vp,
        );
        return { x: sx, y: sy };
      },

      canvasDeltaToWorld: (dx, dy) => {
        const [wdx, wdy] = screenDeltaToWorld(
          toCamera({
            zoom: stateRef.current.zoom,
            pan: stateRef.current.pan,
            cameraRotation: stateRef.current.cameraRotation,
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

      // Policy-aware hit-test for interactions needing different tolerance/behaviour
      hitTestNodeWithPolicy: (
        world: { x: number; y: number },
        policyName: import('./hitTest').HitTestPolicyName,
      ) => {
        const engine = HitTestEngine.withPolicy(state.document, policyName, {
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

      renameNodeById: (id, name) => {
        updateDoc((doc) => (doc.nodes[id] ? renameNode(doc, id, name) : doc));
      },

      moveNode: (id, toIndex) => {
        updateDoc((doc) => moveNode(doc, id, toIndex));
      },

      duplicateSelected: () => {
        const sel = state.selection;
        if (sel.length === 0) return;

        const offsetX = 20;
        const offsetY = 20;

        // Track the offset for repeat duplicate
        setState((s) => ({
          ...s,
          lastDuplicateOffset: { x: offsetX, y: offsetY },
        }));

        /**
         * Deep clone a node and all its container descendants.
         * @returns [newId, updatedDoc, oldId -> newId map for the cloned tree]
         */
        function cloneNodeDeep(
          nodeId: string,
          doc: Document,
          offset: { x: number; y: number },
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
              node.transform[4] + offset.x,
              node.transform[5] + offset.y,
            ] as typeof node.transform,
          };

          // If container with children, recursively deep-clone all descendants
          if (isContainer(node)) {
            const newChildIds: string[] = [];
            for (const childId of node.children) {
              const [newChildId, d2, childMap] = cloneNodeDeep(childId, d, offset);
              d = d2;
              newChildIds.push(newChildId);
              idMap = { ...idMap, ...childMap };
            }
            const clonedContainer = cloned as import('@varve/scene').ContainerNode;
            clonedContainer.children = newChildIds;

            // Node-to-node references must follow the cloned subtree. Leaving
            // a mask pointed at the original source makes the duplicate fail
            // validation and couple its rendering to the original artwork.
            if (clonedContainer.mask?.sourceNodeId) {
              clonedContainer.mask = {
                ...clonedContainer.mask,
                sourceNodeId:
                  idMap[clonedContainer.mask.sourceNodeId] ?? clonedContainer.mask.sourceNodeId,
              };
            }

            if ('slots' in clonedContainer && clonedContainer.slots) {
              clonedContainer.slots = Object.fromEntries(
                Object.entries(clonedContainer.slots)
                  .map(([slotId, childId]) => [slotId, idMap[childId]] as const)
                  .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
              );
            }
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
            const [newId, d2] = cloneNodeDeep(id, d, { x: offsetX, y: offsetY });
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

      repeatDuplicate: () => {
        const sel = state.selection;
        if (sel.length === 0) return;

        const offset = state.lastDuplicateOffset;
        if (!offset) {
          // If no offset tracked, fall back to default duplicate with default offset
          const offsetX = 20;
          const offsetY = 20;
          setState((s) => ({
            ...s,
            lastDuplicateOffset: { x: offsetX, y: offsetY },
          }));
          // Call the duplicate logic inline
          const sel = state.selection;
          if (sel.length === 0) return;

          function cloneNodeDeep(
            nodeId: string,
            doc: Document,
            offset: { x: number; y: number },
          ): [string, Document, Record<string, string>] {
            const node = doc.nodes[nodeId];
            if (!node) return [nodeId, doc, {}];

            const { id: newId, doc: d1 } = nextNodeId(doc);
            let d = d1;
            let idMap: Record<string, string> = { [nodeId]: newId };

            const cloned = {
              ...node,
              id: newId,
              name: `${node.name} copy`,
              transform: [
                node.transform[0],
                node.transform[1],
                node.transform[2],
                node.transform[3],
                node.transform[4] + offset.x,
                node.transform[5] + offset.y,
              ] as typeof node.transform,
            };

            if (isContainer(node)) {
              const newChildIds: string[] = [];
              for (const childId of node.children) {
                const [newChildId, d2, childMap] = cloneNodeDeep(childId, d, offset);
                d = d2;
                newChildIds.push(newChildId);
                idMap = { ...idMap, ...childMap };
              }
              const clonedContainer = cloned as import('@varve/scene').ContainerNode;
              clonedContainer.children = newChildIds;

              if (clonedContainer.mask?.sourceNodeId) {
                clonedContainer.mask = {
                  ...clonedContainer.mask,
                  sourceNodeId:
                    idMap[clonedContainer.mask.sourceNodeId] ?? clonedContainer.mask.sourceNodeId,
                };
              }

              if ('slots' in clonedContainer && clonedContainer.slots) {
                clonedContainer.slots = Object.fromEntries(
                  Object.entries(clonedContainer.slots)
                    .map(([slotId, childId]) => [slotId, idMap[childId]] as const)
                    .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
                );
              }
            }

            d = { ...d, nodes: { ...d.nodes, [newId]: cloned } };
            return [newId, d, idMap];
          }

          setState((s) => {
            if (!inTransactionRef.current) {
              undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
              undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
              redoStackRef.current = [];
              redoSelStackRef.current = [];
            }

            let d = s.document;
            const newIds: string[] = [];
            for (const id of sel) {
              const [newId, d2] = cloneNodeDeep(id, d, { x: offsetX, y: offsetY });
              d = d2;

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
          return;
        }

        // Use the same clone logic but with the tracked offset
        function cloneNodeDeep(
          nodeId: string,
          doc: Document,
          offset: { x: number; y: number },
        ): [string, Document, Record<string, string>] {
          const node = doc.nodes[nodeId];
          if (!node) return [nodeId, doc, {}];

          const { id: newId, doc: d1 } = nextNodeId(doc);
          let d = d1;
          let idMap: Record<string, string> = { [nodeId]: newId };

          const cloned = {
            ...node,
            id: newId,
            name: `${node.name} copy`,
            transform: [
              node.transform[0],
              node.transform[1],
              node.transform[2],
              node.transform[3],
              node.transform[4] + offset.x,
              node.transform[5] + offset.y,
            ] as typeof node.transform,
          };

          if (isContainer(node)) {
            const newChildIds: string[] = [];
            for (const childId of node.children) {
              const [newChildId, d2, childMap] = cloneNodeDeep(childId, d, offset);
              d = d2;
              newChildIds.push(newChildId);
              idMap = { ...idMap, ...childMap };
            }
            const clonedContainer = cloned as import('@varve/scene').ContainerNode;
            clonedContainer.children = newChildIds;

            if (clonedContainer.mask?.sourceNodeId) {
              clonedContainer.mask = {
                ...clonedContainer.mask,
                sourceNodeId:
                  idMap[clonedContainer.mask.sourceNodeId] ?? clonedContainer.mask.sourceNodeId,
              };
            }

            if ('slots' in clonedContainer && clonedContainer.slots) {
              clonedContainer.slots = Object.fromEntries(
                Object.entries(clonedContainer.slots)
                  .map(([slotId, childId]) => [slotId, idMap[childId]] as const)
                  .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
              );
            }
          }

          d = { ...d, nodes: { ...d.nodes, [newId]: cloned } };
          return [newId, d, idMap];
        }

        setState((s) => {
          if (!inTransactionRef.current) {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
            redoStackRef.current = [];
            redoSelStackRef.current = [];
          }

          let d = s.document;
          const newIds: string[] = [];
          for (const id of sel) {
            const [newId, d2] = cloneNodeDeep(id, d, offset);
            d = d2;

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

      setNodePositions: (positions) => {
        if (positions.length === 0) return;
        updateDoc((doc) => {
          // Collect updated nodes first (no map copies), then ONE spread —
          // per-node spreads inside the loop would cost N*O(N) again.
          let changed = false;
          const updated: Record<string, SceneNode> = {};
          for (const { id, x, y } of positions) {
            const node = doc.nodes[id];
            if (!node) continue;
            updated[id] = {
              ...node,
              transform: [
                node.transform?.[0] ?? 1,
                node.transform?.[1] ?? 0,
                node.transform?.[2] ?? 0,
                node.transform?.[3] ?? 1,
                x,
                y,
              ] as Affine,
            };
            changed = true;
          }
          if (!changed) return doc;
          return { ...doc, nodes: { ...doc.nodes, ...updated } };
        });
      },

      setNodeSize: (id, w, h) => {
        updateNodeProp(id, (n) => resizeSceneNode(n, w, h));
        invalidateNodeThumbnail(id);
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
            const oldW = node.kind === 'frame' ? (node.w ?? bounds.w) : bounds.w;
            nodes[id] = resizeNodeGeometry(node, w, bounds.h);
            invalidateNodeThumbnail(id);
            // Propagate constraints to frame children. Layout frames reflow
            // instead — layout owns child positions (and fill/grow sizes).
            if (node.kind === 'frame') {
              if (node.layoutStyle && node.layoutStyle.mode !== 'none') {
                const reflowed = reflowLayoutChildren({ ...doc, nodes }, id);
                for (const [cid, child] of Object.entries(reflowed.nodes)) {
                  if (cid === id) continue;
                  nodes[cid] = child;
                  invalidateNodeThumbnail(cid);
                }
              } else {
                const childUpdates = propagateFrameConstraints(
                  { ...doc, nodes },
                  id,
                  oldW,
                  node.kind === 'frame' ? (node.h ?? bounds.h) : bounds.h,
                );
                for (const [cid, child] of Object.entries(childUpdates)) {
                  nodes[cid] = child;
                  invalidateNodeThumbnail(cid);
                }
              }
            }
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
            const oldH = node.kind === 'frame' ? (node.h ?? bounds.h) : bounds.h;
            nodes[id] = resizeNodeGeometry(node, bounds.w, h);
            invalidateNodeThumbnail(id);
            // Propagate constraints to frame children. Layout frames reflow
            // instead — layout owns child positions (and fill/grow sizes).
            if (node.kind === 'frame') {
              if (node.layoutStyle && node.layoutStyle.mode !== 'none') {
                const reflowed = reflowLayoutChildren({ ...doc, nodes }, id);
                for (const [cid, child] of Object.entries(reflowed.nodes)) {
                  if (cid === id) continue;
                  nodes[cid] = child;
                  invalidateNodeThumbnail(cid);
                }
              } else {
                const childUpdates = propagateFrameConstraints(
                  { ...doc, nodes },
                  id,
                  node.kind === 'frame' ? (node.w ?? bounds.w) : bounds.w,
                  oldH,
                );
                for (const [cid, child] of Object.entries(childUpdates)) {
                  nodes[cid] = child;
                  invalidateNodeThumbnail(cid);
                }
              }
            }
          }
          return { ...doc, nodes };
        });
      },

      // F6: public updateNode for any property
      updateNode: updateNodeProp,

      updateNodes: (updaters) => {
        if (updaters.length === 0) return;
        updateDoc((doc) => {
          let changed = false;
          const updated: Record<string, SceneNode> = {};
          for (const { id, update } of updaters) {
            const node = doc.nodes[id];
            if (!node) continue;
            updated[id] = update(node);
            if (updated[id] !== node) changed = true;
          }
          if (!changed) return doc;
          return { ...doc, nodes: { ...doc.nodes, ...updated } };
        });
      },

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

      // F6: batch-edit skew — apply shear to the affine transform.
      setSelectedSkew: (skewXDeg: number, skewYDeg: number) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        const skewXRad = (skewXDeg * Math.PI) / 180;
        const skewYRad = (skewYDeg * Math.PI) / 180;
        const tanSkewX = Math.tan(skewXRad);
        const tanSkewY = Math.tan(skewYRad);
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            const [a, b, c, d, e, f] = node.transform as Affine;
            nodes[id] = {
              ...node,
              transform: [
                a + c * tanSkewY,
                b + d * tanSkewY,
                c + a * tanSkewX,
                d + b * tanSkewX,
                e,
                f,
              ] as Affine,
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

      // F6: selection sets — save, restore, and manage named selections
      createSelectionSet: (name) => {
        const sel = state.selection;
        if (sel.length === 0) return null;
        const scope: SelectionSetScope = state.document.activePageId
          ? { type: 'page', id: state.document.activePageId }
          : { type: 'document' };
        const setsData = state.document.selectionSets ?? createEmptySelectionSetsData();
        const baseName = name?.trim() || `Selection ${setsData.sets.length + 1}`;
        const set = createSelectionSetDoc(baseName, sel, scope);
        updateDoc((doc) => ({
          ...doc,
          selectionSets: { ...setsData, sets: [...setsData.sets, set] },
        }));
        return set;
      },

      updateSelectionSet: (setId) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const setsData = doc.selectionSets ?? createEmptySelectionSetsData();
          return { ...doc, selectionSets: updateSelectionSetNodesDoc(setsData, setId, sel) };
        });
      },

      deleteSelectionSet: (setId) => {
        updateDoc((doc) => {
          const setsData = doc.selectionSets ?? createEmptySelectionSetsData();
          return { ...doc, selectionSets: deleteSelectionSetDoc(setsData, setId) };
        });
      },

      renameSelectionSet: (setId, name) => {
        if (!name.trim()) return;
        updateDoc((doc) => {
          const setsData = doc.selectionSets ?? createEmptySelectionSetsData();
          return { ...doc, selectionSets: renameSelectionSetDoc(setsData, setId, name.trim()) };
        });
      },

      duplicateSelectionSet: (setId) => {
        updateDoc((doc) => {
          const setsData = doc.selectionSets ?? createEmptySelectionSetsData();
          return { ...doc, selectionSets: duplicateSelectionSetDoc(setsData, setId) };
        });
      },

      selectSelectionSet: (setId) => {
        const setsData = state.document.selectionSets ?? createEmptySelectionSetsData();
        const set = setsData.sets.find((s) => s.id === setId);
        if (!set || set.nodeIds.length === 0) return;
        const available = set.nodeIds.filter((id) => state.document.nodes[id]);
        if (available.length === 0) return;
        const origin: SelectionOrigin = 'command';
        selectionHistory.push(available);
        patch({
          selection: available,
          primaryId: available[0],
          selectionRevision: state.selectionRevision + 1,
          selectionOrigin: origin,
        });
      },

      addToSelectionSet: (setId) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const setsData = doc.selectionSets ?? createEmptySelectionSetsData();
          return { ...doc, selectionSets: addToSelectionSetDoc(setsData, setId, sel) };
        });
      },

      removeFromSelectionSet: (setId) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const setsData = doc.selectionSets ?? createEmptySelectionSetsData();
          return { ...doc, selectionSets: removeFromSelectionSetDoc(setsData, setId, sel) };
        });
      },

      setSelectedConstraint: (constraint: import('@varve/scene').Constraints) => {
        const sel = stateRef.current.selection;
        if (sel.length === 0) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (!node) continue;
            const parentId = getParent(doc, id);
            if (!parentId) continue;
            const parent = nodes[parentId];
            if (parent?.kind !== 'frame') continue;
            nodes[id] = { ...node, constraints: constraint } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      // M5b: rich-text span formatting — apply a character format to the
      // selected range of the focused text node's rich text.
      applyFormatToSelection: (format: import('@varve/scene').CharacterFormat) => {
        const sel = stateRef.current.selection;
        if (sel.length === 0) return;
        const range = stateRef.current.selectionRange;
        if (!range) return;
        updateDoc((doc) => {
          const nodes = { ...doc.nodes };
          for (const id of sel) {
            const node = nodes[id];
            if (node?.kind !== 'text') continue;
            const rich = promoteToRichTextOp(node.richText, node.text);
            const next = applyFormatToSelectionOp(rich, range, format);
            nodes[id] = { ...node, richText: next } as SceneNode;
          }
          return { ...doc, nodes };
        });
      },

      setPendingFormat: (format: import('@varve/scene').CharacterFormat | null) => {
        setState((s) => ({ ...s, pendingFormat: format }));
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

      // Image bounds operations
      trimToSubject: async (
        padding?: number,
        options?: import('./imageCrop').TrimToSubjectOptions,
      ) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        let nextDoc = state.document;
        for (const id of sel) {
          nextDoc = await trimToSubjectDoc(nextDoc, id, padding, options);
        }
        updateDoc(() => nextDoc);
      },
      expandImageBounds: (
        padding: number,
        sides?: { top?: number; right?: number; bottom?: number; left?: number },
      ) => {
        const sel = state.selection;
        if (sel.length === 0) return;
        for (const id of sel) {
          updateDoc((doc) => expandBoundsDoc(doc, id, { padding, paddingSides: sides }));
        }
      },
      resetImageBounds: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        for (const id of sel) {
          updateDoc((doc) => resetToSourceBoundsDoc(doc, id));
        }
      },

      // F6: transaction API
      beginTransaction,
      commitTransaction,
      abortTransaction,

      // Text chain operations
      createTextChain,
      linkSelectedTextFrames,
      unlinkSelectedTextFrames,
      deleteTextChain,
      appendFrameToChain,
      removeFrameFromChain,

      undo: () => {
        // Persistent history (ADR-0019 Model A): when attached, undo moves
        // the branch head through the revision store. Falls back to the
        // in-memory stack for mutation paths not yet migrated.
        const persistent = persistentHistoryRef.current;
        if (persistent?.attached && persistent.session?.canUndo) {
          void persistent.undo();
          return;
        }
        const prev = undoStackRef.current.pop();
        const prevSel = undoSelStackRef.current.pop();
        const prevLabel = undoLabelsRef.current.pop();
        if (!prev) return;
        redoStackRef.current = [...redoStackRef.current, state.document];
        redoSelStackRef.current = [...redoSelStackRef.current, state.selection];
        redoLabelsRef.current = [...redoLabelsRef.current, prevLabel ?? 'Undo'];
        const synced = editorGridFromDoc(prev);
        patch({
          document: prev,
          selection: prevSel ?? [],
          documentGrid: synced.documentGrid,
          isometricGrid: synced.isometricGrid,
          snapGrid: synced.documentGrid.spacingX,
          canUndo: undoStackRef.current.length > 0,
          canRedo: true,
          undoLabel: undoLabelsRef.current[undoLabelsRef.current.length - 1] ?? 'Undo',
          redoLabel: prevLabel ?? 'Undo',
        });
      },

      redo: () => {
        // Persistent history: redo returns to the most recently abandoned
        // child of the current head.
        const persistent = persistentHistoryRef.current;
        if (persistent?.attached && persistent.session?.canRedo) {
          void persistent.redo();
          return;
        }
        const next = redoStackRef.current.pop();
        const nextSel = redoSelStackRef.current.pop();
        const nextLabel = redoLabelsRef.current.pop();
        if (!next) return;
        undoStackRef.current = [...undoStackRef.current, state.document];
        undoSelStackRef.current = [...undoSelStackRef.current, state.selection];
        undoLabelsRef.current = [...undoLabelsRef.current, nextLabel ?? 'Redo'];
        const synced = editorGridFromDoc(next);
        patch({
          document: next,
          selection: nextSel ?? [],
          documentGrid: synced.documentGrid,
          isometricGrid: synced.isometricGrid,
          snapGrid: synced.documentGrid.spacingX,
          canUndo: true,
          canRedo: redoStackRef.current.length > 0,
          undoLabel: nextLabel ?? 'Redo',
          redoLabel: redoLabelsRef.current[redoLabelsRef.current.length - 1] ?? 'Redo',
        });
      },

      newDocument,
      serializeDocument,
      save,
      saveAs,
      saveCopy,

      saveState: state.saveState,
      lastSavedAt: state.lastSavedAt,
      saveIssue: state.saveIssue,
      documentInfoOpen: state.documentInfoOpen,
      setShowDocumentInfo: (show: boolean) => patch({ documentInfoOpen: show }),
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

      promoteVariantCandidates: (componentName, masterNodeId, properties, variantAssignments) => {
        const master = state.document.nodes[masterNodeId];
        if (master?.kind !== 'frame') {
          toastHandler?.({ message: 'Master node must be a frame.', type: 'warning' });
          return { error: 'Master node must be a frame' };
        }
        let resultComponentId: NodeId | undefined;
        let resultError: string | undefined;
        beginTransaction();
        updateDoc((doc) => {
          const { component, doc: withDef } = createComponent(doc, componentName, masterNodeId, []);
          let next: Document = withDef;

          for (const propDef of properties) {
            const defaultVal = propDef.memberValues[masterNodeId] ?? '';
            const result = addComponentPropertyDoc(next, component.id, {
              name: propDef.name,
              type: propDef.type,
              defaultValue: defaultVal,
            });
            next = result.doc;
          }

          for (const assignment of variantAssignments) {
            if (assignment.nodeId === masterNodeId) continue;
            const propValues: Record<string, string | boolean | NodeId> = {};
            for (const propDef of properties) {
              const value = propDef.memberValues[assignment.nodeId];
              if (value !== undefined) propValues[propDef.name] = value;
            }
            const result = createVariantDoc(next, component.id, assignment.variantName, propValues);
            next = result.doc;
          }

          for (const assignment of variantAssignments) {
            if (assignment.nodeId === masterNodeId) continue;
            const original = next.nodes[assignment.nodeId];
            if (original?.kind !== 'frame') continue;

            const parentId = getParent(next, assignment.nodeId);
            const { node: instanceNode, doc: withInstance } = instantiateComponent(next, component);
            next = withInstance;

            const placed: SceneNode = {
              ...instanceNode,
              transform: original.transform,
              opacity: original.opacity,
              rotation: original.rotation,
              visible: original.visible,
              locked: original.locked,
              variant: assignment.variantName,
            };

            next = removeNode(next, assignment.nodeId);
            next = parentId ? addChild(next, parentId, placed) : addNode(next, placed);
          }

          resultComponentId = component.id;
          return next;
        });
        commitTransaction();
        if (resultError) toastHandler?.({ message: resultError, type: 'error' });
        return { componentId: resultComponentId, error: resultError };
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
          return result.doc as Document;
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

      movePageOnPasteboard: (pageId, x, y) => {
        updateDoc((doc) => setPagePlacementDoc(doc, pageId, { x, y }));
      },
      resizePage: (pageId, width, height) => {
        const w = Number(width);
        const h = Number(height);
        if (!Number.isFinite(w) || !Number.isFinite(h)) return;
        updateDoc((doc) => setPageSizeDoc(doc, pageId, w, h));
      },
      fitSpread: () => {
        const doc = state.document;
        const pageId = doc.activePageId;
        const spread = pageId ? doc.spreads?.find((s) => s.pageIds.includes(pageId)) : undefined;
        const bounds = spread
          ? spreadBoundsInWorld(doc, spread.id)
          : pageId
            ? pageBoundsInWorld(doc, pageId)
            : null;
        if (!bounds) return;
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        patch(fitBoundsToState(bounds, vp));
      },
      fitAllPages: () => {
        const doc = state.document;
        const bounds = pasteboardBounds(doc);
        if (!bounds) return;
        const canvasEl = document.querySelector<HTMLElement>('.editor-canvas');
        const vp: Viewport = canvasEl
          ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight - 120 };
        patch(fitBoundsToState(bounds, vp));
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
        color: import('@varve/scene').ManagedColor,
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
      getCognitiveLoad: (nodeId: import('@varve/scene').NodeId | null) => {
        return computeCognitiveLoad(state.document, nodeId);
      },

      setInspectorTab: (tab: InspectorTab, subTab?: IntelligenceTab) => {
        if (!state.rightPanelVisible) {
          patch({ rightPanelVisible: true });
          updateSettings({ panel: { rightPanelVisible: true } });
        }
        requestInspectorTab(tab, subTab);
      },

      openCafDialog: (nodeId) => {
        patch({ cafDialogNodeId: nodeId });
      },

      closeCafDialog: () => {
        patch({ cafDialogNodeId: null });
      },

      setDebugOverlayEnabled: (enabled: boolean) => {
        const current = stateRef.current.debugOverlay;
        patch({ debugOverlay: { ...current, enabled } });
      },

      setDebugOverlayChannel: (channel: string, val: boolean) => {
        const current = stateRef.current.debugOverlay;
        patch({
          debugOverlay: {
            ...current,
            channels: { ...current.channels, [channel as keyof typeof current.channels]: val },
          },
        });
      },

      setDebugOverlayLabelDensity: (density: string) => {
        const current = stateRef.current.debugOverlay;
        patch({
          debugOverlay: {
            ...current,
            labelDensity: density as 'none' | 'sparse' | 'normal' | 'full',
          },
        });
      },

      setDebugOverlayFrozen: (frozen: boolean) => {
        const current = stateRef.current.debugOverlay;
        patch({ debugOverlay: { ...current, frozen } });
      },

      setTouchMultiSelect: (active: boolean) => {
        const current = stateRef.current.touchMultiSelect;
        patch({ touchMultiSelect: { ...current, active } });
      },

      get layerNavigation():
        | import('./components/LayersPanel/layerNavigationCommands').LayerNavigationCommands
        | undefined {
        return getLayerNavigationCommands() ?? undefined;
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
          patch({
            selection: ids,
            primaryId: ids[0]!,
            focusedNodeId: ids[0]!,
            selectionRevision: state.selectionRevision + 1,
          });
          announcerRef.current?.announce(`Selected ${ids.length} nodes with color tag`);
        }
      },

      selectAllOfType: () => {
        const ids = findAllOfKindIds(state.document, state.selection);
        if (ids.length > 0) {
          const kind = state.document.nodes[ids[0]!]?.kind;
          patch({
            selection: ids,
            primaryId: ids[0]!,
            focusedNodeId: ids[0]!,
            selectionRevision: state.selectionRevision + 1,
          });
          announcerRef.current?.announce(`Selected ${ids.length} ${kind} nodes`);
        }
      },

      // Selection commands — hierarchy navigation and select-similar
      // (delegated to useSelectionCommands hook to keep complexity under ceiling)
      ...selectionCommands,

      selectPreviousSelection: () => {
        const prev = selectionHistory.selectPrevious();
        if (prev && prev.length > 0) {
          patch({
            selection: prev,
            primaryId: prev[0]!,
            focusedNodeId: prev[0]!,
            selectionRevision: state.selectionRevision + 1,
          });
          announcerRef.current?.announce('Selection history back');
        }
      },

      selectNextSelection: () => {
        const next = selectionHistory.selectNext();
        if (next && next.length > 0) {
          patch({
            selection: next,
            primaryId: next[0]!,
            focusedNodeId: next[0]!,
            selectionRevision: state.selectionRevision + 1,
          });
          announcerRef.current?.announce('Selection history forward');
        }
      },

      setFocusedNode: (id) => {
        patch({ focusedNodeId: id, selectionRevision: state.selectionRevision + 1 });
      },

      clearFocusedNode: () => {
        patch({ focusedNodeId: null, selectionRevision: state.selectionRevision + 1 });
      },

      focusNextSelectedNode: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        const currentFocus = state.focusedNodeId;
        const idx = currentFocus ? sel.indexOf(currentFocus) : -1;
        if (idx < 0 || idx >= sel.length - 1) {
          patch({ focusedNodeId: sel[0]!, selectionRevision: state.selectionRevision + 1 });
        } else {
          patch({ focusedNodeId: sel[idx + 1]!, selectionRevision: state.selectionRevision + 1 });
        }
      },

      focusPreviousSelectedNode: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        const currentFocus = state.focusedNodeId;
        const idx = currentFocus ? sel.indexOf(currentFocus) : -1;
        if (idx <= 0) {
          patch({
            focusedNodeId: sel[sel.length - 1]!,
            selectionRevision: state.selectionRevision + 1,
          });
        } else {
          patch({ focusedNodeId: sel[idx - 1]!, selectionRevision: state.selectionRevision + 1 });
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
          const newLocal = reparentLocalTransform(doc, id, effectiveParentId);
          if (effectiveParentId) {
            // Convert old world pos → new parent's local space.
            if (newLocal) {
              newDoc = reparentNodeDoc(doc, id, effectiveParentId, toIndex, newLocal);
            } else {
              newDoc = doc;
            }
          } else {
            // Move to root: local = world (root has identity transform).
            newDoc = newLocal ? reparentNodeDoc(doc, id, null, toIndex, newLocal) : doc;
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

      addMaskToSelected: (type: MaskType = 'alpha', sourceNodeId?: NodeId) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => {
          const container = doc.nodes[id];
          if (!container || (container.kind !== 'adjustment' && !('children' in container))) {
            return doc;
          }
          const children = 'children' in container ? container.children : [];
          // Structural containers use a direct child by default. Adjustment
          // layers have no children, so their spatial mask must be supplied by
          // an explicit source (the inspector's target picker does this).
          const maskSource =
            sourceNodeId ??
            (container.kind === 'adjustment'
              ? sel.find((selectedId) => selectedId !== id && doc.nodes[selectedId])
              : children.find((childId) => doc.nodes[childId] !== undefined));
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

      setMaskFillRule: (fillRule: import('@varve/scene').MaskFillRule) => {
        const sel = state.selection;
        const id = sel[0];
        if (!id) return;
        updateDoc((doc) => setMaskFillRuleDoc(doc, id, fillRule));
      },

      setMaskVectorPath: (points: import('@varve/engine').PathPoint[], closed: boolean) => {
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
          // Match vector-editor convention: the topmost compatible selected
          // object becomes the clipping path, independent of click order.
          const maskNodeId = sel
            .filter((id) => {
              const node = s.document.nodes[id];
              return node ? canBeClipMaskSource(node) : false;
            })
            .sort((a, b) => {
              const aOrder = s.document.nodes[a]?.order ?? '';
              const bOrder = s.document.nodes[b]?.order ?? '';
              return bOrder.localeCompare(aOrder);
            })[0];
          if (!maskNodeId) {
            announcerRef.current?.announce(
              'No node in selection can be used as a clipping mask shape',
            );
            return s;
          }
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

      setWarpEdit: (target) => {
        setState((s) => {
          const next = target ? { nodeId: target.nodeId, modifierId: target.modifierId } : null;
          if (
            (s.warpEdit === null && next === null) ||
            (s.warpEdit !== null &&
              next !== null &&
              s.warpEdit.nodeId === next.nodeId &&
              s.warpEdit.modifierId === next.modifierId)
          ) {
            return s;
          }
          return { ...s, warpEdit: next };
        });
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

      flattenSelected: (mode, scale) => {
        const sel = state.selection;
        if (sel.length === 0) {
          announcerRef.current?.announce('Select layers to flatten');
          return;
        }
        const opts: FlattenOptions = {
          mode,
          scale: scale ?? 1,
          background: 'transparent',
          textPolicy: 'rasterize',
        };
        import('./flatten/renderSubtree').then(({ flattenNodes }) => {
          flattenNodes(state.document, sel, opts)
            .then((result) => {
              const replacementId = `flat-${Date.now()}`;
              updateDoc((doc) => {
                let d = replaceNodesWithFlattened(doc, sel, {
                  nodeId: replacementId,
                  bounds: result.sourceBounds,
                  dataUrl: result.dataUrl,
                  assetId: result.assetId,
                  placement: result.placement,
                  cssWidth: result.cssWidth,
                  cssHeight: result.cssHeight,
                });
                d = findOrCreateEmbeddedAsset(d, {
                  dataUrl: result.dataUrl,
                  mimeType: 'image/png',
                  naturalWidth: result.pixelWidth,
                  naturalHeight: result.pixelHeight,
                }).document;
                return d;
              });
              announcerRef.current?.announce(
                mode === 'rasterize'
                  ? 'Selection rasterized'
                  : mode === 'merge'
                    ? 'Layers merged'
                    : 'Selection flattened',
              );
            })
            .catch((err) => {
              announcerRef.current?.announce(
                `Flatten failed: ${err instanceof Error ? err.message : 'unknown error'}`,
              );
            });
        });
      },

      rasterizeSelected: (scale) => {
        value.flattenSelected('rasterize', scale);
      },

      mergeSelected: () => {
        value.flattenSelected('merge', 1);
      },

      convertTextToOutlines: () => {
        const sel = state.selection;
        if (sel.length !== 1) {
          announcerRef.current?.announce('Select a single text node to convert to outlines');
          return;
        }
        const nodeId = sel[0]!;
        const node = state.document.nodes[nodeId];
        if (node?.kind !== 'text') {
          announcerRef.current?.announce('Selected node is not a text node');
          toastHandler?.({ message: 'Select a text node first.', type: 'warning' });
          return;
        }

        const textNode = node as unknown as { text?: string; name?: string; fontFamily?: string };
        const fontFamily = textNode.fontFamily ?? 'sans-serif';
        const text = textNode.text ?? '';
        const charCount = text.length;

        // Warn for large text
        if (
          charCount > 5000 &&
          !window.confirm(
            `This text has ${charCount} characters and will produce ${charCount} vector paths. Proceed?`,
          )
        )
          return;

        // Confirmation copy: lossy operation
        if (
          !window.confirm(
            'Convert this text to vector outlines?\n\n' +
              'Outlined text can no longer be edited as text.\n' +
              'Undo is available within this session, but the change is permanent after save and reopen.\n\n' +
              'Proceed?',
          )
        )
          return;

        // Dynamic import to avoid circular deps
        void import('./context/convertTextOutline').then(({ convertTextOutline }) =>
          convertTextOutline(state.document, nodeId, fontFamily, {
            onWarn: (msg) => {
              announcerRef.current?.announce(msg);
              toastHandler?.({ message: msg, type: 'warning', duration: 5000 });
            },
            onResult: (newDoc) => {
              updateDoc(() => newDoc);
              announcerRef.current?.announce('Text converted to outlines');
              toastHandler?.({ message: 'Text converted to vector paths.', type: 'success' });
            },
            onError: (err) => {
              toastHandler?.({ message: err, type: 'error' });
            },
          }),
        );
      },

      createAdjustmentLayer: (initialAdjustments) => {
        undoStackRef.current = [...undoStackRef.current.slice(-50), state.document];
        undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
        redoStackRef.current = [];
        redoLabelsRef.current = [];
        const { id, doc: newDoc } = nextNodeId(state.document);
        const adjs = initialAdjustments ?? [];
        const sel = state.selection;
        // Default scope: image-local when single eligible node selected,
        // explicit-targets for multi-selection, undefined (legacy) otherwise
        let scope: import('@varve/scene').AdjustmentScope | undefined;
        if (sel.length === 1) {
          const firstId = sel[0]!;
          const target = state.document.nodes[firstId];
          if (target && (target.kind === 'shape' || target.kind === 'rasterLayer')) {
            scope = { mode: 'image-local', targetNodeId: firstId };
          }
        } else if (sel.length > 1) {
          scope = scopeForTargets(state.document, sel);
        }
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
            scope,
          },
        );
        const withAdjustments = { ...node, adjustments: adjs };
        // Scope the adjustment to the active page like every other node
        // (createShapeAt). Adding it to rootChildren would orphan it from the
        // page content root that the renderer walks, making it invisible on
        // the canvas.
        const activePage = newDoc.pages?.find((p) => p.id === newDoc.activePageId);
        const contentRootId = activePage?.contentRoot;
        const doc =
          contentRootId && newDoc.nodes[contentRootId]
            ? addChild(newDoc, contentRootId, withAdjustments as import('@varve/scene').SceneNode)
            : addNode(newDoc, withAdjustments as import('@varve/scene').SceneNode);
        patch({ document: doc, selection: [id] });
        const scopeName =
          scope?.mode === 'image-local'
            ? ' (image)'
            : scope?.mode === 'explicit-targets'
              ? ` (${sel.length} targets)`
              : '';
        announcerRef.current?.announce(`Created adjustment layer${scopeName}`);
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
        undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
        redoStackRef.current = [];
        redoLabelsRef.current = [];
        const { id, doc: newDoc } = nextNodeId(state.document);
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
            opacity: 1,
            blendMode: 'normal',
            effects: [],
          },
        );
        const withLut = { ...node, adjustments: [lutAdjustment] };
        const doc = addNode(newDoc, withLut as import('@varve/scene').SceneNode);
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

      createLinkedAdjustment: (
        targetIds: import('@varve/scene').NodeId[],
        initialAdjustments: import('@varve/scene').Adjustment[] | undefined,
      ) => {
        undoStackRef.current = [...undoStackRef.current.slice(-50), state.document];
        undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
        redoStackRef.current = [];
        redoLabelsRef.current = [];
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
            name: `Linked adj ${id.slice(0, 4)}`,
            opacity: 1,
            blendMode: 'normal',
            effects: [],
            scope:
              targetIds.length > 0
                ? scopeForTargets(state.document, targetIds)
                : { mode: 'document' },
          },
        );
        const withAdjustments = { ...node, adjustments: adjs };
        const doc = addNode(newDoc, withAdjustments as import('@varve/scene').SceneNode);
        patch({ document: doc, selection: [id] });
        announcerRef.current?.announce(
          `Created linked adjustment for ${targetIds.length} target(s)`,
        );
      },

      copyEditsToSelected: (
        sourceNodeId: import('@varve/scene').NodeId,
        targetIds: import('@varve/scene').NodeId[],
        adjustmentIds: string[] | undefined,
      ) => {
        const sourceNode = state.document.nodes[sourceNodeId];
        if (sourceNode?.kind !== 'adjustment') return;
        const sourceAdjustments = (sourceNode as AdjustmentNode).adjustments ?? [];
        const toCopy = adjustmentIds
          ? sourceAdjustments.filter((a: Adjustment) => adjustmentIds.includes(a.id))
          : sourceAdjustments;
        if (toCopy.length === 0) return;

        undoStackRef.current = [...undoStackRef.current.slice(-50), state.document];
        undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
        redoStackRef.current = [];
        redoLabelsRef.current = [];
        let doc = state.document;
        const newIds: string[] = [];

        for (const targetId of targetIds) {
          const { id, doc: d } = nextNodeId(doc);
          doc = d;
          const targetNode = doc.nodes[targetId];
          if (!targetNode) continue;
          const isImage = targetNode.kind === 'shape' || targetNode.kind === 'rasterLayer';
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
              name: `Edit ${id.slice(0, 4)}`,
              opacity: 1,
              blendMode: 'normal',
              effects: [],
              scope: isImage ? { mode: 'image-local', targetNodeId: targetId } : undefined,
            },
          );
          const withCopied = {
            ...node,
            adjustments: [...toCopy.map((a: Adjustment) => ({ ...a }))],
          };
          doc = addNode(doc, withCopied as import('@varve/scene').SceneNode);
          newIds.push(id);
        }

        patch({ document: doc, selection: newIds });
        announcerRef.current?.announce(`Copied edits to ${targetIds.length} target(s)`);
      },

      setAdjustmentScope: (
        nodeId: import('@varve/scene').NodeId,
        scope: import('@varve/scene').AdjustmentScope,
      ) => {
        updateNodeProp(nodeId, (n) => {
          if (n.kind !== 'adjustment') return n;
          return { ...n, scope } as SceneNode;
        });
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
        // World anchor per selection root (placed world): lets paste rebuild
        // the exact world pose inside a destination frame/artboard.
        const worldAnchor: Record<string, Affine> = {};
        for (const id of sel) {
          worldAnchor[id] = nodeWorldTransform(state.document, id);
        }
        writeToClipboard(
          nodes,
          closure.rasterMaskAssets,
          closure.assets,
          closure.iconAssets,
          worldAnchor,
        );
        announcerRef.current?.announce(`Copied ${sel.length} layer${sel.length > 1 ? 's' : ''}`);
      },

      cutSelected: () => {
        const sel = state.selection;
        if (sel.length === 0) return;
        const nodes = gatherSubtreeNodes(state.document, sel);
        if (nodes.length === 0) return;
        const nodeIds = nodes.map((n) => n.id);
        const closure = DocumentCodec.collectNodeClosure(state.document, nodeIds);
        const worldAnchor: Record<string, Affine> = {};
        for (const id of sel) {
          worldAnchor[id] = nodeWorldTransform(state.document, id);
        }
        writeToClipboard(
          nodes,
          closure.rasterMaskAssets,
          closure.assets,
          closure.iconAssets,
          worldAnchor,
        );
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
        // navigator.clipboard.read() for menu-triggered pastes, then to a
        // native OS clipboard read on Tauri for WebKitGTK/Wayland.
        const unified = await readClipboardUnifiedWithFallback(platform);
        const varveData = unified.varveData;

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

        if (!varveData && importResults.length === 0) return;

        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
          redoStackRef.current = [];
          redoLabelsRef.current = [];
          let doc = s.document;
          const newIds: NodeId[] = [];

          // Paste target: the deepest selected unlocked/visible frame or
          // group receives pasted content. Pasting converts the source
          // world pose into that parent's local space instead of
          // reinterpreting local coordinates in the destination frame.
          const targetFrameId: NodeId | null =
            s.selection
              .map((id) => s.document.nodes[id])
              .find(
                (n): n is import('@varve/scene').FrameNode =>
                  n !== undefined &&
                  !n.locked &&
                  n.visible !== false &&
                  (n.kind === 'frame' || n.kind === 'group'),
              )?.id ?? null;

          if (varveData) {
            const tempNodes: Record<string, SceneNode> = {};
            for (const node of varveData.nodes) {
              tempNodes[node.id] = node;
            }
            const tempDoc: Document = {
              ...doc,
              nodes: tempNodes,
              ...(varveData.rasterMaskAssets
                ? { rasterMaskAssets: varveData.rasterMaskAssets }
                : {}),
              ...(varveData.assets ? { assets: varveData.assets } : {}),
              ...(varveData.iconAssets ? { iconAssets: varveData.iconAssets } : {}),
            };
            // copySelected()/cutSelected() serialize each selected node plus
            // its full descendant subtree (gatherSubtreeNodes), so a node
            // referenced as another copied node's child is a descendant, not
            // an independent paste target — only the roots of the original
            // selection should become new top-level pastes.
            const childIds = new Set<NodeId>();
            for (const node of varveData.nodes) {
              if (isContainer(node)) {
                for (const childId of node.children) childIds.add(childId);
              }
            }
            const worldAnchor = varveData.worldAnchor ?? {};
            for (const node of varveData.nodes) {
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
              // World-pose preservation: the copy records each root's
              // placed-world transform; rebase it into the destination
              // frame's local space (or use it directly at the document
              // top level). Without an anchor (legacy clipboard payloads)
              // the source local coordinates are kept verbatim.
              const anchor = worldAnchor[node.id];
              if (anchor) {
                if (targetFrameId && doc.nodes[targetFrameId]) {
                  const parentWorld = nodeWorldTransform(doc, targetFrameId);
                  const local = rebaseWorldTransformToParent(parentWorld, anchor);
                  if (local) {
                    const parent = doc.nodes[targetFrameId] as ContainerNode;
                    doc = reparentNodeDoc(
                      doc,
                      inserted.rootId,
                      targetFrameId,
                      parent?.children?.length ?? 0,
                      local,
                    );
                  }
                } else {
                  const root = doc.nodes[inserted.rootId];
                  if (root) {
                    doc = {
                      ...doc,
                      nodes: { ...doc.nodes, [inserted.rootId]: { ...root, transform: anchor } },
                    };
                  }
                }
              }
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
              // Paste into the selected frame: rebase the viewport-centred
              // placement into the frame's local space so the imported
              // content lands at the intended world point INSIDE the frame.
              if (targetFrameId && doc.nodes[targetFrameId]) {
                const root = doc.nodes[inserted.rootId];
                if (root) {
                  const parentWorld = nodeWorldTransform(doc, targetFrameId);
                  const local = rebaseWorldTransformToParent(parentWorld, root.transform as Affine);
                  if (local) {
                    const parent = doc.nodes[targetFrameId] as ContainerNode;
                    doc = reparentNodeDoc(
                      doc,
                      inserted.rootId,
                      targetFrameId,
                      parent?.children?.length ?? 0,
                      local,
                    );
                  }
                }
              }
              newIds.push(inserted.rootId);
              pasteIndex += 1;
            }
          }

          if (newIds.length === 0) return s;
          return { ...s, document: doc, selection: newIds };
        });

        const totalCount = (varveData?.nodes.length ?? 0) + importResults.length;
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
          undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
          redoStackRef.current = [];
          redoLabelsRef.current = [];
          const inserted = insertImportedSubtree(s.document, sourceDoc, node.id, (clonedRoot) =>
            applyDropPosition(
              clonedRoot,
              options?.position ??
                viewportCenterWorld({ zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation }),
            ),
          );
          if (!inserted) return s;
          return { ...s, document: inserted.doc, selection: [inserted.rootId] };
        });
        announcerRef.current?.announce('Imported layer');
      },

      batchImportNodes: (items, options) => {
        setState((s) => {
          undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
          undoLabelsRef.current = [...undoLabelsRef.current.slice(-50), 'Edit'];
          redoStackRef.current = [];
          redoLabelsRef.current = [];
          let doc = s.document;
          const newIds: NodeId[] = [];
          let batchIndex = 0;
          for (const { node, sourceDoc, position } of items) {
            // Cascade positionless items from the viewport centre so a
            // multi-file import doesn't stack every node on one point.
            const fallback = viewportCenterWorld({
              zoom: s.zoom,
              pan: s.pan,
              cameraRotation: s.cameraRotation,
            });
            const target = position ?? {
              x: fallback.x + batchIndex * 40,
              y: fallback.y + batchIndex * 40,
            };
            batchIndex += 1;
            const inserted = insertImportedSubtree(doc, sourceDoc, node.id, (clonedRoot) =>
              applyDropPosition(clonedRoot, target),
            );
            if (!inserted) continue;
            doc = inserted.doc;
            const insertedNode = doc.nodes[inserted.rootId];
            if (insertedNode && isImageShape(insertedNode)) {
              const shape = insertedNode as import('@varve/scene').ShapeNode;
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
          const maskTargetId = options?.maskTargetId;
          const maskTarget = maskTargetId ? doc.nodes[maskTargetId] : undefined;
          if (
            maskTargetId &&
            maskTarget &&
            canBeClipMaskSource(maskTarget) &&
            newIds.length > 0 &&
            newIds.every((id) => {
              const node = doc.nodes[id];
              return node ? isImageShape(node) : false;
            })
          ) {
            const targetParentId = getParent(doc, maskTargetId);
            for (const importedId of newIds) {
              if (getParent(doc, importedId) === targetParentId) continue;
              const importedWorld = nodeWorldTransform(doc, importedId);
              const parentWorld = targetParentId
                ? nodeWorldTransform(doc, targetParentId)
                : ([1, 0, 0, 1, 0, 0] as const);
              const localTransform = multiplyAffine(invertAffine(parentWorld), importedWorld);
              const imported = doc.nodes[importedId];
              if (!imported) continue;
              doc = {
                ...doc,
                nodes: {
                  ...doc.nodes,
                  [importedId]: { ...imported, rotation: 0 },
                },
              };
              const parent = targetParentId ? doc.nodes[targetParentId] : undefined;
              const toIndex =
                parent && isContainer(parent) ? parent.children.length : doc.rootChildren.length;
              doc = reparentNodeDoc(doc, importedId, targetParentId, toIndex, localTransform);
            }
            try {
              const clipped = createClippingMaskDoc(doc, maskTargetId, newIds, {
                type: 'clip',
                hideMaskSource: true,
                linked: true,
              });
              return {
                ...s,
                document: clipped.doc,
                selection: [clipped.groupId],
                dirty: true,
              };
            } catch (error) {
              announcerRef.current?.announce(
                error instanceof Error ? error.message : 'Imported images could not be masked',
              );
            }
          }
          return {
            ...s,
            document: doc,
            selection: newIds,
            dirty: newIds.length > 0 || s.dirty,
          };
        });
        announcerRef.current?.announce(
          `Imported ${items.length} layer${items.length > 1 ? 's' : ''}`,
        );
      },

      bindingField: interactionState.bindingField,
      setBindingField: interactionState.setBindingField,
      focusedField: interactionState.focusedField,
      setFocusedField: interactionState.setFocusedField,

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
      setPixelGridSnapEnabled: (v) => {
        patch({ pixelGridSnapEnabled: v });
        persistViewportPrefs({ ...stateRef.current, pixelGridSnapEnabled: v });
      },
      resetGridOrigin: () => {
        const dg = stateRef.current.documentGrid;
        updateDoc((doc) => sceneSetDocumentGrid(doc, { ...dg, offsetX: 0, offsetY: 0 }));
      },
      setSnapEnabled: (v) => {
        patch({ snapEnabled: v });
        persistViewportPrefs({ ...stateRef.current, snapEnabled: v });
      },
      setSnapGrid: (v) => {
        const clamped = Math.max(1, Math.min(256, Math.round(v)));
        const nextGrid = { ...stateRef.current.documentGrid, spacingX: clamped, spacingY: clamped };
        updateDoc((doc) => sceneSetDocumentGrid(doc, nextGrid));
        patch({ snapGrid: clamped, documentGrid: nextGrid });
        persistViewportPrefs({ ...stateRef.current, snapGrid: clamped, documentGrid: nextGrid });
      },
      setDotGridEnabled: (v: boolean) => {
        patch({ dotGridEnabled: v });
      },
      setBleedGuidesVisible: (v: boolean) => {
        patch({ bleedGuidesVisible: v });
        persistViewportPrefs({ ...stateRef.current, bleedGuidesVisible: v });
      },
      setLayoutGridVisible: (v: boolean) => {
        patch({ layoutGridVisible: v });
      },
      setDocumentGrid: (settings) => {
        const grid = {
          ...settings,
          id: settings.id ?? 'grid-document-default',
          type: 'document' as const,
        };
        updateDoc((doc) => sceneSetDocumentGrid(doc, grid));
        patch({ documentGrid: grid });
        persistViewportPrefs({ ...stateRef.current, documentGrid: grid });
      },
      setIsometricGrid: (grid: import('@varve/scene').IsometricGrid) => {
        const g = { ...grid, id: grid.id ?? 'grid-isometric-default', type: 'isometric' as const };
        updateDoc((doc) => sceneSetIsometricGrid(doc, g.id, g));
        patch({ isometricGrid: g });
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
      setFindingsOverlayVisible: (v: boolean) => patch({ findingsOverlayVisible: v }),
      setFindingsProviderOverride: (providerId: string) =>
        patch({
          findingsProviderOverrides: {
            ...state.findingsProviderOverrides,
            [providerId]: !state.findingsProviderOverrides[providerId],
          },
        }),
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

      // Soft proofing: config is document state (print intent); the toggle
      // is session state and never persists into portable documents.
      proofConfig: state.document.proofConfig ?? defaultProofConfig(),
      proofEnabled: proofEnabledState,
      setProofEnabled: setProofEnabledState,
      setProofConfig: (config: import('@varve/scene').ProofConfig) => {
        updateDoc((doc) => setDocumentProofConfigDoc(doc, config));
      },

      // Spot-color libraries ----------------------------------------------
      createSpotLibrary: (name: string) => {
        updateDoc((doc) => createSpotLibraryDoc(doc, name).doc);
      },
      addSpotToLibrary: (libraryId: string, def: import('@varve/scene').SpotColorDef) => {
        updateDoc((doc) => addSpotToLibraryDoc(doc, libraryId, def).doc);
      },
      updateSpotDef: (
        libraryId: string,
        spotId: string,
        patch: Partial<Omit<import('@varve/scene').SpotColorDef, 'id'>>,
      ) => {
        updateDoc((doc) => updateSpotDefDoc(doc, libraryId, spotId, patch).doc);
      },
      removeSpotFromLibrary: (libraryId: string, spotId: string) => {
        updateDoc((doc) => removeSpotFromLibraryDoc(doc, libraryId, spotId).doc);
      },
      renameSpotLibrary: (libraryId: string, name: string) => {
        updateDoc((doc) => renameSpotLibraryDoc(doc, libraryId, name).doc);
      },
      deleteSpotLibrary: (libraryId: string) => {
        updateDoc((doc) => deleteSpotLibraryDoc(doc, libraryId).doc);
      },

      // Assign: change document working mode WITHOUT rewriting stored
      // values (non-destructive interpretation change).
      assignDocumentColorMode: (mode: ColorMode) => {
        const current = state.document.colorConfig?.mode;
        if (current === mode) return;
        updateDoc((doc) => assignDocumentColorModeDoc(doc, mode));
      },

      // Convert: rewrite stored process colors into the target mode
      // (analytical in browser, explicitly reported as approximate).
      convertDocumentColors: (mode: ColorMode) => {
        const current = state.document.colorConfig?.mode;
        if (current === mode) return;
        updateDoc((doc) => convertDocumentColorsDoc(doc, mode).doc);
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

      newTab: () => openInNewSession(createDocument('Untitled')),

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
          const restoredSelection = (saved?.selection ?? []).filter((id) => restoredDoc.nodes[id]);
          const restoredPrimary =
            saved?.primaryId && restoredDoc.nodes[saved.primaryId]
              ? saved.primaryId
              : (restoredSelection[0] ?? null);
          const restoredFocused =
            saved?.focusedNodeId && restoredDoc.nodes[saved.focusedNodeId]
              ? saved.focusedNodeId
              : restoredPrimary;
          const restoredContainer =
            saved?.activeContainerId && restoredDoc.nodes[saved.activeContainerId]
              ? saved.activeContainerId
              : null;
          return {
            ...s,
            document: restoredDoc,
            selection: restoredSelection,
            primaryId: restoredPrimary,
            focusedNodeId: restoredFocused,
            activeContainerId: restoredContainer,
            selectionMode: saved?.selectionMode ?? 'object',
            selectedGuideId: null,
            ...restoreViewportFields(saved?.viewport, restoredDoc),
            dirty: targetMeta?.dirty ?? false,
            sessions: syncedSessions,
            activeId: id,
          };
        });
      },

      openFile: (
        /** App-store id; omit for a file known only by path (Open Recent) or by
         *  neither (browser file picker) — save() mints one on first save. */
        fileId: string | undefined,
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
          // Re-resolve fonts against this device's catalog, as loadDocument
          // does — a document authored elsewhere arrives with a manifest
          // pointing at fonts this machine may not have.
          doc = resolveFontManifest(doc);
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
            const restoredSel = (saved?.selection ?? []).filter((id) => savedDoc.nodes[id]);
            const restoredPri =
              saved?.primaryId && savedDoc.nodes[saved.primaryId]
                ? saved.primaryId
                : (restoredSel[0] ?? null);
            return {
              ...s,
              document: savedDoc,
              selection: restoredSel,
              primaryId: restoredPri,
              focusedNodeId:
                saved?.focusedNodeId && savedDoc.nodes[saved.focusedNodeId]
                  ? saved.focusedNodeId
                  : restoredPri,
              activeContainerId:
                saved?.activeContainerId && savedDoc.nodes[saved.activeContainerId]
                  ? saved.activeContainerId
                  : null,
              selectionMode: saved?.selectionMode ?? 'object',
              selectedGuideId: null,
              ...restoreViewportFields(saved?.viewport, savedDoc),
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
          const newId = newSessionId();
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

      showExportDialog: dialogState.showExportDialog,
      setShowExportDialog: dialogState.setShowExportDialog,
      showArchiveDialog: dialogState.showArchiveDialog,
      archiveDialogMode: dialogState.archiveDialogMode,
      setShowArchiveDialog: dialogState.setShowArchiveDialog,

      upscaleDialogOpen: state.upscaleDialogOpen,
      openUpscaleDialog: () => {
        patch({ upscaleDialogOpen: true });
      },
      closeUpscaleDialog: () => {
        patch({ upscaleDialogOpen: false });
      },
      vectorizeDialogOpen: state.vectorizeDialogOpen,
      vectorizeDialogPrefill: state.vectorizeDialogPrefill,
      openVectorizeDialog: (prefill) => {
        patch({ vectorizeDialogOpen: true, vectorizeDialogPrefill: prefill ?? null });
      },
      closeVectorizeDialog: () => {
        patch({ vectorizeDialogOpen: false, vectorizeDialogPrefill: null });
      },

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
            .filter((n): n is import('@varve/scene').ShapeNode => n?.kind === 'shape');
          if (shapeNodes.length < 2) return s;
          if (!inTransactionRef.current) {
            undoStackRef.current = [...undoStackRef.current.slice(-50), s.document];
            undoSelStackRef.current = [...undoSelStackRef.current.slice(-50), s.selection];
            redoStackRef.current = [];
            redoSelStackRef.current = [];
          }
          // Boolean operands are clipped in WORLD space so selections
          // spanning artboards/groups/pasteboard clip correctly; the result
          // is then re-anchored at the first operand's home (parent + z) in
          // that parent's local coordinates.
          const anchorNode = shapeNodes[0]!;
          const anchor = booleanAnchorForNode(s.document, anchorNode.id);
          const worldNodes = shapeNodesInWorldSpace(s.document, shapeNodes);
          const result = doBooleanOp(op, worldNodes);
          let d = s.document;
          for (const id of sel) d = removeNode(d, id);
          const placed = placeBooleanResult(d, result, anchor);
          return { ...s, document: placed.doc, selection: [placed.nodeId], dirty: true };
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
          const { extractAlphaContours, alphaContoursToShapeNodes } = await import('@varve/engine');
          const { getImageCache } = await import('@varve/engine');
          const { isImageShape, imageShapeSrc, imageShapeW, imageShapeH } = await import(
            '@varve/scene'
          );
          const doc = stateRef.current.document;

          // Process raster nodes: extract alpha contours, convert to ShapeNodes
          const rasterShapeNodes: import('@varve/scene').ShapeNode[] = [];
          for (const nodeId of rasterNodeIds) {
            const node = doc.nodes[nodeId] as import('@varve/scene').ShapeNode | undefined;
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
            // alphaContoursToShapeNodes lives in @varve/engine, which can't depend on
            // @varve/scene's ShapeNode/Stroke types (would create a package cycle), so
            // it returns a structurally-equivalent ContourShapeNodeData with loosened
            // fill/fills/strokes/effects typing. The values are passed straight through
            // from `node` (a real ShapeNode), so the runtime shape matches ShapeNode.
            const nodes = alphaContoursToShapeNodes(
              contours,
              node.id,
              node as unknown as Parameters<typeof alphaContoursToShapeNodes>[2],
            ) as unknown as import('@varve/scene').ShapeNode[];
            // Contours are in image-source space with the source's LOCAL
            // transform; boolean clipping happens in world space, so lift
            // each derived shape to the image node's world transform.
            const worldTransform = nodeWorldTransform(doc, node.id);
            rasterShapeNodes.push(...nodes.map((n) => ({ ...n, transform: worldTransform })));
          }

          // Collect vector nodes
          const vectorShapeNodes: import('@varve/scene').ShapeNode[] = [];
          for (const nodeId of vectorNodeIds) {
            const node = doc.nodes[nodeId] as import('@varve/scene').ShapeNode | undefined;
            if (node?.kind !== 'shape') continue;
            vectorShapeNodes.push(node);
          }

          if (rasterShapeNodes.length === 0 && vectorShapeNodes.length === 0) {
            announcerRef.current?.announce('No valid nodes for boolean operation');
            return;
          }

          setState((s) => {
            // World-space operands: raster-derived shapes were lifted to
            // their image node's world transform at extraction; vector
            // shapes are lifted here. The result is re-anchored at the
            // first real operand's home in that parent's local space.
            const anchorNode = doc.nodes[allIds[0]!];
            const anchor = anchorNode
              ? booleanAnchorForNode(s.document, anchorNode.id)
              : { parentId: null as string | null, index: 0 };
            const worldVectorNodes = shapeNodesInWorldSpace(s.document, vectorShapeNodes);
            const result = doBooleanOp(kind, [...rasterShapeNodes, ...worldVectorNodes]);
            let d = s.document;
            for (const id of allIds) d = removeNode(d, id);
            const placed = placeBooleanResult(d, result, anchor);
            announcerRef.current?.announce('Boolean operation complete');
            return { ...s, document: placed.doc, selection: [placed.nodeId], dirty: true };
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
          const engine = await import('@varve/engine');
          const { imageShapeSrc, getImageFill, findOrCreateEmbeddedAsset, mimeTypeFromDataUrl } =
            await import('@varve/scene');
          const sourceSrc = imageShapeSrc(imageNode);
          const image = await engine.getImageCache().load(sourceSrc);
          if (controller.signal.aborted) return;
          const { width, height } = engine.cachedImageDims(image);
          const safeWidth = Math.max(1, width);
          const safeHeight = Math.max(1, height);
          const canvas = document.createElement('canvas');
          canvas.width = safeWidth;
          canvas.height = safeHeight;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas pixel processing is unavailable');
          context.drawImage(image, 0, 0, safeWidth, safeHeight);
          let source = context.getImageData(0, 0, safeWidth, safeHeight);

          // A background-removal mask lives beside the image and is composited
          // at render time, so these pixels are still the unmasked original.
          // Without baking it in, the upscaled layer comes back with the
          // removed background restored — the derived node carries no mask.
          const { resolveRasterMaskAsset } = await import('@varve/scene');
          const maskDataUrl =
            resolveRasterMaskAsset(stateRef.current.document, imageNode)?.dataUrl ??
            imageNode.backgroundRemoval?.maskDataUrl;
          if (maskDataUrl) {
            source = await bakeAlphaMaskIntoImageData(source, maskDataUrl);
          }

          const denoiseStrength = options.denoiseStrength;
          const pixelArtAlgo = options.pixelArtAlgorithm;
          const usePixelArt =
            options.method === 'nearest' && pixelArtAlgo && pixelArtAlgo !== 'nearest';
          let outputImage: ImageData;
          if (denoiseStrength && denoiseStrength !== 'none') {
            const pipelineResult = await engine.runEnhancementPipeline({
              source,
              denoiseStrength,
              upscaleMethod: (usePixelArt ? 'pixel-art' : options.method) as
                | UpscaleMethod
                | 'pixel-art',
              upscaleScale: options.scale ?? 2,
              upscaleModelId: options.modelId,
              pixelArtAlgorithm: usePixelArt ? (pixelArtAlgo as PixelArtAlgorithm) : undefined,
              signal: controller.signal,
              onProgress: options.onProgress,
            });
            outputImage = pipelineResult.imageData;
          } else if (usePixelArt) {
            outputImage = engine.scalePixelArt(source, {
              algorithm: pixelArtAlgo as PixelArtAlgorithm,
              scale: options.scale ?? 2,
            });
          } else {
            outputImage = await engine.dispatchUpscale(source, options, controller.signal);
          }
          if (controller.signal.aborted) return;
          const outputCanvas = document.createElement('canvas');
          outputCanvas.width = outputImage.width;
          outputCanvas.height = outputImage.height;
          const outputContext = outputCanvas.getContext('2d');
          if (!outputContext) throw new Error('Canvas image encoding is unavailable');
          outputContext.putImageData(outputImage, 0, 0);
          const dataUrl = outputCanvas.toDataURL('image/png');
          const current = stateRef.current;
          if (
            !current.selection.includes(processingNodeId) ||
            current.document.nodes[processingNodeId] !== imageNode
          )
            return;

          const fill = getImageFill(imageNode);
          const currentFill =
            fill?.type === 'image' && fill.image ? (fill.image as ImageFillData) : undefined;
          const assetInput = {
            dataUrl,
            mimeType: mimeTypeFromDataUrl(dataUrl),
            naturalWidth: outputImage.width,
            naturalHeight: outputImage.height,
          };

          if (options.replaceSource || options.output === 'replace-source') {
            // Replace the source image in place: register the upscaled bytes as
            // a deduped embedded asset in the document's asset table, then patch
            // the node's image fill. Atomic — the old src is only overwritten
            // after the upscaled image is fully produced and stored, so a
            // failure mid-inference never corrupts the source.
            updateDoc((doc) => {
              const node = doc.nodes[processingNodeId];
              if (node?.kind !== 'shape') return doc;
              const { document: docWithAsset, assetId } = findOrCreateEmbeddedAsset(
                doc,
                assetInput,
              );
              const imageFill: ImageFillData = {
                src: dataUrl,
                assetId,
                fit: currentFill?.fit ?? 'fill',
                x: currentFill?.x ?? 0,
                y: currentFill?.y ?? 0,
                scale: currentFill?.scale ?? 1,
                imageWidth: outputImage.width,
                imageHeight: outputImage.height,
              };
              const nextFill: Fill = {
                type: 'image',
                opacity: fill?.opacity ?? 1,
                blendMode: fill?.blendMode ?? 'normal',
                visible: fill?.visible ?? true,
                image: imageFill,
              };
              return {
                ...docWithAsset,
                nodes: {
                  ...docWithAsset.nodes,
                  // The cutout is baked into the new pixels, so the node's
                  // own mask must go with it — leaving it would composite the
                  // mask a second time, misaligned against the new size.
                  [processingNodeId]: {
                    ...node,
                    fills: [nextFill],
                    mask: maskDataUrl ? undefined : node.mask,
                    backgroundRemoval: maskDataUrl ? undefined : node.backgroundRemoval,
                  },
                },
              };
            });
          } else if (options.output === 'non-destructive') {
            // Non-destructive: create upscaled asset, store upscale metadata on fill
            updateDoc((doc) => {
              const node = doc.nodes[processingNodeId];
              if (node?.kind !== 'shape') return doc;
              const { document: docWithAsset, assetId: upscaleAssetId } = findOrCreateEmbeddedAsset(
                doc,
                assetInput,
              );
              const sourceAssetId = currentFill?.assetId;
              const imageFill: ImageFillData = {
                src: dataUrl,
                assetId: upscaleAssetId,
                fit: currentFill?.fit ?? 'fill',
                x: currentFill?.x ?? 0,
                y: currentFill?.y ?? 0,
                scale: currentFill?.scale ?? 1,
                imageWidth: outputImage.width,
                imageHeight: outputImage.height,
                upscale: sourceAssetId
                  ? {
                      sourceAssetId,
                      upscaleAssetId,
                      mode: options.method ?? 'unknown',
                      scale: options.scale ?? 2,
                      modelId: options.modelId,
                    }
                  : undefined,
              };
              const nextFill: Fill = {
                type: 'image',
                opacity: fill?.opacity ?? 1,
                blendMode: fill?.blendMode ?? 'normal',
                visible: fill?.visible ?? true,
                image: imageFill,
              };
              return {
                ...docWithAsset,
                nodes: {
                  ...docWithAsset.nodes,
                  // The cutout is baked into the new pixels, so the node's
                  // own mask must go with it — leaving it would composite the
                  // mask a second time, misaligned against the new size.
                  [processingNodeId]: {
                    ...node,
                    fills: [nextFill],
                    mask: maskDataUrl ? undefined : node.mask,
                    backgroundRemoval: maskDataUrl ? undefined : node.backgroundRemoval,
                  },
                },
              };
            });
          } else {
            // Default: create a new layer beside the non-destructive source.
            const scaleLabel = options.method === 'ai' ? '4x-ai' : `${options.scale ?? 2}x`;
            const inserted = insertDerivedImageShape(current.document, processingNodeId, {
              dataUrl,
              width: outputImage.width,
              height: outputImage.height,
              suffix: scaleLabel,
              maskBakedIn: maskDataUrl !== undefined,
            });
            updateDoc(() => inserted.doc);
            patch({ selection: [inserted.nodeId] });
          }
          announcerRef.current?.announce(
            `Image upscaled to ${outputImage.width} by ${outputImage.height} pixels`,
          );
        } catch (error) {
          if (controller.signal.aborted) throw new Error('cancelled');
          // Tauri rejects with a bare string, so preserve it as an Error rather
          // than rethrowing a raw value the UI boundary cannot read.
          const normalized =
            error instanceof Error ? error : new Error(String(error) || 'Unknown error');
          announcerRef.current?.announce(`Image upscaling failed: ${normalized.message}`);
          throw normalized;
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
          const { cachedImageDims, getImageCache, dispatchTrace } = await import('@varve/engine');
          const { imageShapeSrc } = await import('@varve/scene');
          const sourceSrc = imageShapeSrc(imageNode);
          const image = await getImageCache().load(sourceSrc);
          if (controller.signal.aborted) return;
          let { width, height } = cachedImageDims(image);
          width = Math.max(1, width);
          height = Math.max(1, height);
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

      applyBackgroundRemovalPreview: bgRemoval.applyBackgroundRemovalPreview,

      cancelBackgroundRemovalPreview: bgRemoval.cancelBackgroundRemovalPreview,

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

      // Logo geometry operations
      ...logoGeometry,
      // Logo project operations
      ...logoProject,

      // SAM2 segmentation
      applySam2Segmentation: sam2Seg.applySam2Segmentation,
      cancelSam2Segmentation: sam2Seg.cancelSam2Segmentation,

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

      // --- State machines ---
      toggleStateMachinePanel: () => {
        patch({ stateMachinePanelVisible: !stateRef.current.stateMachinePanelVisible });
      },
      getStateMachines: () => {
        const sms = stateRef.current.document.stateMachines ?? {};
        return Object.values(sms);
      },
      getPrimaryStateMachineId: () => {
        const sms = stateRef.current.document.stateMachines ?? {};
        const ids = Object.keys(sms);
        return ids.length > 0 ? ids[0]! : null;
      },
      createStateMachine: (name: string) => {
        const smId = `sm-${Math.random().toString(36).slice(2, 8)}`;
        updateDoc((doc) => createStateMachine(doc, smId, name));
        patch({ selectedStateMachineId: smId });
        return smId;
      },
      removeStateMachine: (smId: string) => {
        updateDoc((doc) => removeStateMachine(doc, smId));
        if (stateRef.current.selectedStateMachineId === smId) {
          patch({
            selectedStateMachineId: null,
            selectedSMStateId: null,
            selectedSMTransitionId: null,
          });
        }
      },
      renameStateMachine: (smId: string, name: string) => {
        updateDoc((doc) => {
          const sm = doc.stateMachines?.[smId];
          if (!sm) return doc;
          return { ...doc, stateMachines: { ...doc.stateMachines, [smId]: { ...sm, name } } };
        });
      },
      addSMState: (smId: string, name: string, timelineId: string) => {
        let newId = '';
        updateDoc((doc) => {
          const result = addSMState(doc, smId, name, timelineId);
          newId = result.stateId;
          return result.doc;
        });
        if (newId) patch({ selectedSMStateId: newId });
        return newId;
      },
      removeSMState: (smId: string, stateId: string) => {
        updateDoc((doc) => removeSMState(doc, smId, stateId));
        if (stateRef.current.selectedSMStateId === stateId) {
          patch({ selectedSMStateId: null, selectedSMTransitionId: null });
        }
      },
      renameSMState: (smId: string, stateId: string, name: string) => {
        updateDoc((doc) => renameSMState(doc, smId, stateId, name));
      },
      duplicateSMState: (smId: string, stateId: string) => {
        let newId = '';
        updateDoc((doc) => {
          const result = duplicateSMState(doc, smId, stateId);
          newId = result.stateId;
          return result.doc;
        });
        if (newId) patch({ selectedSMStateId: newId });
      },
      setSMEntryState: (smId: string, stateId: string) => {
        updateDoc((doc) => setSMStateEntry(doc, smId, stateId));
      },
      addSMTransition: (
        smId: string,
        fromStateId: string,
        toStateId: string,
        trigger: import('@varve/scene').SMTransitionTrigger,
      ) => {
        let newId = '';
        updateDoc((doc) => {
          const result = addSMTransition(doc, smId, fromStateId, toStateId, trigger);
          newId = result.transitionId;
          return result.doc;
        });
        if (newId) patch({ selectedSMTransitionId: newId });
        return newId;
      },
      removeSMTransition: (smId: string, transitionId: string) => {
        updateDoc((doc) => removeSMTransition(doc, smId, transitionId));
        if (stateRef.current.selectedSMTransitionId === transitionId) {
          patch({ selectedSMTransitionId: null });
        }
      },
      setSMTransitionTrigger: (
        smId: string,
        transitionId: string,
        trigger: import('@varve/scene').SMTransitionTrigger,
      ) => {
        updateDoc((doc) => setSMTransitionTrigger(doc, smId, transitionId, trigger));
      },
      setSMTransitionTarget: (smId: string, transitionId: string, toStateId: string) => {
        updateDoc((doc) => setSMTransitionTarget(doc, smId, transitionId, toStateId));
      },
      setSMTransitionCondition: (
        smId: string,
        transitionId: string,
        condition: string | undefined,
      ) => {
        updateDoc((doc) => setSMTransitionCondition(doc, smId, transitionId, condition));
      },
      setSMTransitionPriority: (smId: string, transitionId: string, priority: number) => {
        updateDoc((doc) => setSMTransitionPriority(doc, smId, transitionId, priority));
      },
      setSMTransitionDuration: (smId: string, transitionId: string, duration: number) => {
        updateDoc((doc) => {
          const sm = doc.stateMachines?.[smId];
          if (!sm) return doc;
          const transitions = sm.transitions.map((t) =>
            t.id === transitionId ? { ...t, duration } : t,
          );
          return {
            ...doc,
            stateMachines: { ...doc.stateMachines, [smId]: { ...sm, transitions } },
          };
        });
      },
      setSMTransitionEasing: (
        smId: string,
        transitionId: string,
        easing: import('@varve/shared').EasingDefinition,
      ) => {
        updateDoc((doc) => {
          const sm = doc.stateMachines?.[smId];
          if (!sm) return doc;
          const transitions = sm.transitions.map((t) =>
            t.id === transitionId ? { ...t, easing } : t,
          );
          return {
            ...doc,
            stateMachines: { ...doc.stateMachines, [smId]: { ...sm, transitions } },
          };
        });
      },
      addSMInput: (smId: string, name: string, type: import('@varve/scene').SMInputType) => {
        let newId = '';
        updateDoc((doc) => {
          const result = addSMInput(doc, smId, name, type);
          newId = result.inputId;
          return result.doc;
        });
        return newId;
      },
      removeSMInput: (smId: string, inputId: string) => {
        updateDoc((doc) => removeSMInput(doc, smId, inputId));
      },
      validateStateMachine: (smId: string) => {
        return validateSM(stateRef.current.document, smId);
      },
      selectedStateMachineId: state.selectedStateMachineId,
      selectStateMachine: (smId: string | null) => {
        patch({
          selectedStateMachineId: smId,
          selectedSMStateId: null,
          selectedSMTransitionId: null,
        });
      },
      selectedSMStateId: state.selectedSMStateId,
      selectSMState: (_smId: string, stateId: string | null) => {
        patch({ selectedSMStateId: stateId, selectedSMTransitionId: null });
      },
      selectedSMTransitionId: state.selectedSMTransitionId,
      selectSMTransition: (_smId: string, transitionId: string | null) => {
        patch({ selectedSMTransitionId: transitionId });
      },

      ...(motionValue ?? MOTION_NOOP),

      ...(mediaValue ?? MEDIA_NOOP),

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

      setSelectionRange: (range: import('@varve/scene').RichSelection | null) =>
        patch({ selectionRange: range }),

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
          const restoredSel = (saved?.selection ?? []).filter((id) => nextDoc.nodes[id]);
          const restoredPri =
            saved?.primaryId && nextDoc.nodes[saved.primaryId]
              ? saved.primaryId
              : (restoredSel[0] ?? null);
          return {
            ...s,
            document: nextDoc,
            selection: restoredSel,
            primaryId: restoredPri,
            focusedNodeId:
              saved?.focusedNodeId && nextDoc.nodes[saved.focusedNodeId]
                ? saved.focusedNodeId
                : restoredPri,
            activeContainerId:
              saved?.activeContainerId && nextDoc.nodes[saved.activeContainerId]
                ? saved.activeContainerId
                : null,
            selectionMode: saved?.selectionMode ?? 'object',
            selectedGuideId: null,
            ...restoreViewportFields(saved?.viewport, nextDoc),
            dirty: next.dirty,
            sessions: remaining,
            activeId: next.id,
          };
        });
        return true;
      },

      // Phase 3: restore from backup with safety snapshot
      restoreFromBackup: async (backupId: string, asCopy: boolean) => {
        const svc = getBackupService();
        if (!svc) return false;
        const entry = await svc.getBackupDocument(backupId);
        if (!entry) return false;
        if (asCopy) {
          // Its own tab, bound to no file: the current work stays open, and
          // saving the copy routes through Save As rather than the original.
          loadDocument(entry.documentJson, {
            name: `${entry.manifest.sourceName} (restored)`,
            newSession: true,
          });
        } else {
          // Replace mode: create a safety snapshot first.
          try {
            const currentJson = serializeDocument();
            const meta = state.sessions.find((sess) => sess.id === state.activeId);
            await svc.createBackup(
              meta?.fileId ?? state.activeId,
              'pre-migration',
              currentJson,
              `${meta?.name ?? 'Untitled'} (pre-restore)`,
              state.revision,
              'Safety snapshot before restore',
              meta?.fileId,
            );
          } catch {
            // Safety snapshot failure should not block restore
          }
          // Replace mode: same file, older content — keep the binding so the
          // restore saves back where it came from.
          loadDocument(entry.documentJson, {
            name: entry.manifest.sourceName,
            keepIdentity: true,
          });
        }
        return true;
      },

      // Phase 3: manual named snapshot
      createSnapshot: async (notes: string) => {
        const svc = getBackupService();
        if (!svc) return null;
        const meta = state.sessions.find((sess) => sess.id === state.activeId);
        const pid = meta?.fileId ?? state.activeId;
        const json = serializeDocument();
        const result = await svc.createSnapshot(
          pid,
          json,
          meta?.name ?? 'Untitled',
          notes,
          state.revision,
          meta?.fileId,
        );
        if (!result) return null;
        return result.success && result.backupId ? result.backupId : null;
      },
    }),
    [
      state,
      patch,
      persistentHistory,
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
      interactionState.bindingField,
      interactionState.setBindingField,
      interactionState.focusedField,
      interactionState.setFocusedField,
      dialogState.showExportDialog,
      dialogState.showArchiveDialog,
      dialogState.archiveDialogMode,
      dialogState.setShowArchiveDialog,
      protoValue,
      bgRemoval,
      logoProject,
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
      renameNodeById: value.renameNodeById,
      moveNode: value.moveNode,
      duplicateSelected: value.duplicateSelected,
      repeatDuplicate: value.repeatDuplicate,
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
      setSelectedSkew: value.setSelectedSkew,
      setSelectedCornerRadius: value.setSelectedCornerRadius,
      createSelectionSet: value.createSelectionSet,
      updateSelectionSet: value.updateSelectionSet,
      deleteSelectionSet: value.deleteSelectionSet,
      renameSelectionSet: value.renameSelectionSet,
      duplicateSelectionSet: value.duplicateSelectionSet,
      selectSelectionSet: value.selectSelectionSet,
      addToSelectionSet: value.addToSelectionSet,
      removeFromSelectionSet: value.removeFromSelectionSet,
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
      linkSelectedTextFrames: value.linkSelectedTextFrames,
      unlinkSelectedTextFrames: value.unlinkSelectedTextFrames,
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
      saveCopy: value.saveCopy,
      saveState: value.saveState,
      lastSavedAt: value.lastSavedAt,
      saveIssue: value.saveIssue,
      documentInfoOpen: value.documentInfoOpen,
      setShowDocumentInfo: value.setShowDocumentInfo,
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
      flattenSelected: value.flattenSelected,
      rasterizeSelected: value.rasterizeSelected,
      mergeSelected: value.mergeSelected,
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
      showArchiveDialog: value.showArchiveDialog,
      archiveDialogMode: value.archiveDialogMode,
      setShowArchiveDialog: value.setShowArchiveDialog,
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
        <ToolProvider state={state} toolRef={toolRef} patch={patch}>
          <ViewportProvider
            state={state}
            setState={setState}
            stateRef={stateRef}
            panAnimationRef={panAnimRef}
          >
            <SelectionProvider state={state} setState={setState}>
              <MotionProvider
                state={state}
                setState={setState}
                stateRef={stateRef}
                updateDoc={updateDoc}
                invalidateSamplerCache={invalidateSamplerCache}
                onReady={setMotionValue}
              >
                <MediaProvider
                  state={state}
                  setState={setState}
                  stateRef={stateRef}
                  onReady={setMediaValue}
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
                </MediaProvider>
              </MotionProvider>
            </SelectionProvider>
          </ViewportProvider>
        </ToolProvider>
      </DocumentProvider>
    </EditorCtx.Provider>
  );
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}

/** Like `useEditor` but returns null when rendered outside `EditorProvider`
 *  (e.g. the Home screen settings dialog, which has no open document). */
export function useOptionalEditor(): EditorContextValue | null {
  return useContext(EditorCtx);
}

export { useDocument } from './context/DocumentContext';
export { useMotion } from './context/MotionContext';
export { usePrototype } from './context/PrototypeContext';
export { useSelection } from './context/SelectionContext';
export {
  bumpThemeRevision,
  setStartTextEditingHandler,
  startTextEditing,
} from './context/sessionGlobals';
export { useTool } from './context/ToolContext';
export { useViewport } from './context/ViewportContext';

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
