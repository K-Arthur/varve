import type { Adjustment } from '@varve/engine';
import type {
  ArrangeOp,
  BleedConfig,
  BooleanOpKind,
  Document,
  ExportPreset,
  Fill,
  Guide,
  InstanceStatus,
  LayerColor,
  LayoutStyle,
  ManagedColor,
  NodeId,
  SafeAreaConfig,
  SceneNode,
  SelectionSet,
  Slot,
  SlugConfig,
  SyncResult,
  Variable,
  VariableValue,
} from '@varve/scene';
import type { DistributeMode } from '@varve/shared';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

export interface DocumentContextValue {
  createShapeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    pathPoints?: import('@varve/engine').PathPoint[],
    pathClosed?: boolean,
  ) => void;
  createTextNodeAt: (
    world: { x: number; y: number },
    size?: { w: number; h: number },
    parentId?: NodeId | null,
    text?: string,
  ) => void;
  applyFramePreset: (preset: { name: string; w: number; h: number }) => void;
  removeSelected: () => void;
  renameSelected: (name: string) => void;
  moveNode: (id: NodeId, toIndex: number) => void;
  duplicateSelected: () => void;
  repeatDuplicate: () => void;
  setSelectedFill: (color: ManagedColor) => void;
  setSelectedFills: (fills: Fill[]) => void;
  updateSelectedFillAt: (index: number, fill: Fill) => void;
  updateSelectedFillGradientAt: (index: number, gradient: import('@varve/scene').GradientFill) => void;
  addSelectedFill: (fill: Fill) => void;
  removeSelectedFillAt: (index: number) => void;
  reorderSelectedFill: (from: number, to: number) => void;
  setNodePosition: (id: NodeId, x: number, y: number) => void;
  setNodeSize: (id: NodeId, w: number, h: number) => void;
  updateNode: (id: NodeId, updater: (node: SceneNode) => SceneNode) => void;
  setSelectedOpacity: (value: number) => void;
  setSelectedBlendMode: (mode: import('@varve/engine').BlendMode) => void;
  setSelectedRotation: (value: number) => void;
  setSelectedFlipH: () => void;
  setSelectedFlipV: () => void;
  setSelectedCornerRadius: (value: number | [number, number, number, number]) => void;
  createSelectionSet: (name?: string) => SelectionSet | null;
  updateSelectionSet: (setId: string) => void;
  deleteSelectionSet: (setId: string) => void;
  renameSelectionSet: (setId: string, name: string) => void;
  duplicateSelectionSet: (setId: string) => void;
  selectSelectionSet: (setId: string) => void;
  addToSelectionSet: (setId: string) => void;
  removeFromSelectionSet: (setId: string) => void;
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
  beginTransaction: () => void;
  commitTransaction: () => void;
  abortTransaction: () => void;
  undo: () => void;
  redo: () => void;
  newDocument: () => void;
  serializeDocument: () => string;
  updateDoc: (fn: (doc: Document) => Document) => void;
  loadDocument: (json: string, meta?: import('./types').LoadDocumentMeta) => void;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  saveCopy: () => Promise<boolean>;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  saveIssue: import('./types').SaveIssue | null;
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
  arrangeSelected: (op: ArrangeOp) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  detachSelected: () => void;
  copySelected: () => void;
  cutSelected: () => void;
  paste: () => void;
  importNode: (
    node: SceneNode,
    sourceDoc: Document,
    options?: { position?: { x: number; y: number } },
  ) => void;
  booleanOp: (op: BooleanOpKind) => void;
  setNodeLocked: (id: NodeId, locked: boolean) => void;
  setNodeVisible: (id: NodeId, visible: boolean) => void;
  setNodeClipContent: (id: NodeId, clipContent: boolean) => void;
  setLayerColor: (id: NodeId, color: LayerColor) => void;
  setNodeLayout: (id: NodeId, layout: LayoutStyle | undefined) => void;
  guides: Guide[];
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
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;
  addPreset: (nodeId: NodeId, preset: ExportPreset) => void;
  updatePreset: (nodeId: NodeId, preset: ExportPreset) => void;
  removePreset: (nodeId: NodeId, presetId: string) => void;
  createComponentFromFrame: (name: string, masterRootId: NodeId, slots: Slot[]) => void;
  createComponentInstance: (componentId: NodeId) => void;
  fillSlot: (instanceId: NodeId, slotId: string, fillNodeId: NodeId) => void;
  swapComponentInstance: (instanceId: NodeId, newComponentId: NodeId) => void;
  resetInstanceOverrides: (instanceId: NodeId) => void;
  syncComponentInstances: (componentId: NodeId) => SyncResult;
  syncInstance: (instanceId: NodeId) => InstanceStatus;
  getInstanceStatus: (instanceId: NodeId) => InstanceStatus;
  syncAllInstances: () => SyncResult;
  resolveVariable: (nameOrId: string) => VariableValue;
  addVariable: (v: Omit<Variable, 'id'>) => void;
  updateVariable: (id: string, patch: Partial<Omit<Variable, 'id'>>) => void;
  deleteVariable: (id: string) => void;
  setVariableMode: (mode: string) => void;
  newTab: () => void;
  switchTab: (id: string) => void;
  closeTab: (id: string, force?: boolean) => boolean;
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
  setPageBleed: (pageId: string, bleed: BleedConfig) => void;
  setPageSafeArea: (pageId: string, safeArea: SafeAreaConfig) => void;
  setPageSlug: (pageId: string, slug: SlugConfig) => void;
  setActivePage: (pageId: NodeId) => void;
  setCurrentPageId: (id: string | null) => void;
  activePageNodes: () => NodeId[];
}

const DocumentCtx = createContext<DocumentContextValue | null>(null);

export function useDocument(): DocumentContextValue {
  const ctx = useContext(DocumentCtx);
  if (!ctx) throw new Error('useDocument must be used within EditorProvider');
  return ctx;
}

interface DocumentProviderProps {
  children: ReactNode;
  value: DocumentContextValue;
}

export function DocumentProvider({ children, value }: DocumentProviderProps) {
  return <DocumentCtx.Provider value={value}>{children}</DocumentCtx.Provider>;
}
