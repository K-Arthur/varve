/**
 * LayersPanel — container for the layers tree, search/filter, context menu,
 * and embedded VariablePanel.
 *
 * Research basis: W3C APG Tree View, Menu pattern (for context menu).
 */

import type { ContainerNode, LayerColor, NodeId, SceneNode } from '@varve/scene';
import { isContainer } from '@varve/scene';
import {
  ContextMenu,
  type MenuEntry,
  SOLID_CHROME_ICONS,
  SolidIcon,
  Tooltip,
  TooltipProvider,
} from '@varve/ui';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import {
  getOrCreateParentCache,
  getParentFast,
  type ParentIndexCache,
} from '../../scene/parentIndexCache';
import { loadSettings, updateSettings } from '../../settings';
import { applyThumbnailPreference } from '../../thumbnail/thumbnailCommands';
import { openThumbnailPicker } from '../../thumbnail/thumbnailPickerBridge';
import { PanelDragHandle } from '../PanelDragHandle';
import { LayerBulkBar } from './LayerBulkBar';
import { LayerFilterBar } from './LayerFilterBar';
import type { LayersDnDHandle } from './LayersTree';
import { LayersTree, resolveRootLevelSiblings } from './LayersTree';
import { computeActivePageLayerCount, countActivePageNodesMatching } from './layerCounts';
import type { LayerFilterSpec } from './layerFilterTypes';
import { DEFAULT_FILTER, isFiltering, nodeMatchesFilter } from './layerFilterTypes';
import './layers.css';
import { VariablePanel } from '../../VariablePanel';
import { IconBrowserDialog } from '../IconBrowser/IconBrowserDialog';
import { TokenSyncPanel } from '../TokenSync/TokenSyncPanel';
import { SelectionSetsSection } from './SelectionSetsSection';

export function LayersPanel({ dndRef }: { dndRef?: React.RefObject<LayersDnDHandle | null> }) {
  const {
    state,
    setSelection,
    removeSelected,
    setNodeLocked,
    setNodeVisible,
    reparentNode,
    groupSelected,
    ungroupSelected,
    detachSelected,
    announce,
    copySelected,
    cutSelected,
    paste,
    bulkSetNodeLocked,
    bulkSetNodeVisible,
    bulkSetLayerColor,
    selectAllWithSameType,
    selectAllWithSameLayerColor,
    selectAllOfType,
    updateNode,
    syncInstance,
    revealSelection,
    publishComponentToLibrary,
    enterIsolation,
    exitIsolation,
    addMaskToSelected,
    removeMaskFromSelected,
    toggleMask,
    invertMask,
    openUpscaleDialog,
    openVectorizeDialog,
    platform,
    showToast,
  } = useEditor();
  const [filterSpec, setFilterSpec] = useState<LayerFilterSpec>(DEFAULT_FILTER);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    id: NodeId;
  } | null>(null);
  // Viewport-edge clamping handled by shared ContextMenu component.

  // Parent index cache for O(1) lookups
  const parentCacheRef = useRef<ParentIndexCache | null>(null);
  parentCacheRef.current = getOrCreateParentCache(state.document, parentCacheRef.current);

  // Compute match count for the filter bar — scoped to the active page only
  // (document.nodes spans every page plus each page's own contentRoot group,
  // neither of which the tree ever shows as a row).
  const totalCount = useMemo(() => computeActivePageLayerCount(state.document), [state.document]);
  const matchCount = useMemo(() => {
    if (!isFiltering(filterSpec)) return totalCount;
    return countActivePageNodesMatching(state.document, (node) =>
      nodeMatchesFilter(node, filterSpec),
    );
  }, [state.document, filterSpec, totalCount]);

  // Outside click and Escape handled by shared ContextMenu component.
  // This effect remains for stale-context-menu cleanup on unmount.
  useEffect(() => {
    return () => setContextMenu(null);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, id: NodeId) => {
      e.preventDefault();
      if (!state.selection.includes(id)) {
        setSelection(id);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, id });
    },
    [state.selection, setSelection],
  );

  // Keyboard-triggered context menu (Shift+F10 / Menu key on the focused
  // row): position the menu at the row instead of a pointer location.
  const handleContextMenuKeyboard = useCallback(
    (id: NodeId) => {
      if (!state.selection.includes(id)) {
        setSelection(id);
      }
      const rowEl = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
      const rect = rowEl?.getBoundingClientRect();
      setContextMenu({
        x: rect ? rect.left + 16 : 320,
        y: rect ? rect.top + 16 : 160,
        id,
      });
    },
    [state.selection, setSelection],
  );

  const closeMenu = useCallback(() => setContextMenu(null), []);

  const handleRenameFromMenu = useCallback(() => {
    if (contextMenu) {
      dndRef?.current?.startRename(contextMenu.id);
      closeMenu();
    }
  }, [contextMenu, dndRef, closeMenu]);

  const handleDeleteFromMenu = useCallback(() => {
    if (state.selection.length > 0) removeSelected();
    closeMenu();
  }, [state.selection, removeSelected, closeMenu]);

  const handleLockFromMenu = useCallback(
    (locked: boolean) => {
      for (const id of state.selection) setNodeLocked(id, locked);
      closeMenu();
    },
    [state.selection, setNodeLocked, closeMenu],
  );

  const handleVisibilityFromMenu = useCallback(
    (visible: boolean) => {
      for (const id of state.selection) setNodeVisible(id, visible);
      closeMenu();
    },
    [state.selection, setNodeVisible, closeMenu],
  );

  const handleSnapExclusionToggle = useCallback(() => {
    for (const id of state.selection) {
      const node = state.document.nodes[id];
      if (node) {
        const current = node.snapExcluded === true;
        updateNode(id, (n: import('@varve/scene').SceneNode) => ({
          ...n,
          snapExcluded: !current,
        }));
      }
    }
    closeMenu();
  }, [state.selection, state.document.nodes, updateNode, closeMenu]);

  const handleMoveToFront = useCallback(() => {
    for (const id of state.selection) {
      const parentId = getParentFast(state.document, id, parentCacheRef.current);
      const siblings = parentId
        ? ((state.document.nodes[parentId] as ContainerNode | undefined)?.children ??
          resolveRootLevelSiblings(state.document))
        : resolveRootLevelSiblings(state.document);
      reparentNode(id, parentId, siblings.length - 1);
      announce('Moved to front');
    }
    closeMenu();
  }, [state.selection, state.document, reparentNode, announce, closeMenu]);

  const handleMoveToBack = useCallback(() => {
    for (const id of state.selection) {
      const parentId = getParentFast(state.document, id, parentCacheRef.current);
      reparentNode(id, parentId, 0);
      announce('Moved to back');
    }
    closeMenu();
  }, [state.selection, state.document, reparentNode, announce, closeMenu]);

  const handleGroup = useCallback(() => {
    groupSelected();
    closeMenu();
  }, [groupSelected, closeMenu]);

  const handleUngroup = useCallback(() => {
    ungroupSelected();
    closeMenu();
  }, [ungroupSelected, closeMenu]);

  const handleDetach = useCallback(() => {
    detachSelected();
    closeMenu();
  }, [detachSelected, closeMenu]);

  const handleSyncInstance = useCallback(() => {
    if (state.selection.length === 1) {
      syncInstance(state.selection[0]!);
    }
    closeMenu();
  }, [state.selection, syncInstance, closeMenu]);

  const handlePublishToLibrary = useCallback(() => {
    if (contextMenu) {
      publishComponentToLibrary(contextMenu.id);
      closeMenu();
    }
  }, [contextMenu, publishComponentToLibrary, closeMenu]);

  const handleIsolate = useCallback(() => {
    if (contextMenu) {
      enterIsolation(contextMenu.id);
      closeMenu();
    }
  }, [contextMenu, enterIsolation, closeMenu]);

  const handleCopy = useCallback(() => {
    copySelected();
    closeMenu();
  }, [copySelected, closeMenu]);

  const handleCut = useCallback(() => {
    cutSelected();
    closeMenu();
  }, [cutSelected, closeMenu]);

  const handlePaste = useCallback(() => {
    paste();
    closeMenu();
  }, [paste, closeMenu]);

  const handleSetLayerColor = useCallback(
    (color: LayerColor) => {
      bulkSetLayerColor(state.selection, color);
      closeMenu();
    },
    [state.selection, bulkSetLayerColor, closeMenu],
  );

  const handleBulkLockAll = useCallback(() => {
    bulkSetNodeLocked(state.selection, true);
  }, [state.selection, bulkSetNodeLocked]);

  const handleBulkUnlockAll = useCallback(() => {
    bulkSetNodeLocked(state.selection, false);
  }, [state.selection, bulkSetNodeLocked]);

  const handleBulkHideAll = useCallback(() => {
    bulkSetNodeVisible(state.selection, false);
  }, [state.selection, bulkSetNodeVisible]);

  const handleBulkShowAll = useCallback(() => {
    bulkSetNodeVisible(state.selection, true);
  }, [state.selection, bulkSetNodeVisible]);

  const handleBulkColorTag = useCallback(
    (color: LayerColor) => {
      bulkSetLayerColor(state.selection, color);
    },
    [state.selection, bulkSetLayerColor],
  );

  const handleBulkClearColorTag = useCallback(() => {
    bulkSetLayerColor(state.selection, null);
  }, [state.selection, bulkSetLayerColor]);

  const handleBulkDelete = useCallback(() => {
    removeSelected();
  }, [removeSelected]);

  const handleSelectSameType = useCallback(() => {
    selectAllWithSameType();
    closeMenu();
  }, [selectAllWithSameType, closeMenu]);

  const handleSelectSameLayerColor = useCallback(() => {
    selectAllWithSameLayerColor();
    closeMenu();
  }, [selectAllWithSameLayerColor, closeMenu]);

  const handleSelectAllOfType = useCallback(() => {
    selectAllOfType();
    closeMenu();
  }, [selectAllOfType, closeMenu]);

  const COLOR_LABELS: Record<NonNullable<LayerColor>, string> = {
    red: 'Red',
    orange: 'Orange',
    yellow: 'Yellow',
    green: 'Green',
    blue: 'Blue',
    purple: 'Purple',
    gray: 'Gray',
  };

  const LAYER_COLORS: NonNullable<LayerColor>[] = [
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'gray',
  ];

  const handleCollapseAll = useCallback(() => {
    dndRef?.current?.collapseAll();
  }, [dndRef]);

  const handleCollapseOthers = useCallback(() => {
    if (contextMenu) {
      dndRef?.current?.collapseOthers(contextMenu.id);
      closeMenu();
    }
  }, [dndRef, contextMenu, closeMenu]);

  const handleRevealOnCanvas = useCallback(() => {
    if (state.selection.length > 0) {
      revealSelection({ fit: true });
    }
    closeMenu();
  }, [state.selection, revealSelection, closeMenu]);

  const canGroup = state.selection.length >= 2;
  const firstSelId = state.selection[0];
  const firstSel = firstSelId ? state.document.nodes[firstSelId] : undefined;
  const isGroupSelected = state.selection.length === 1 && firstSel?.kind === 'group';
  const isInstanceSelected =
    state.selection.length === 1 &&
    firstSel?.kind === 'frame' &&
    !!('componentId' in firstSel && (firstSel as { componentId?: string }).componentId);

  const isolatedNode = state.isolatedNodeId ? state.document.nodes[state.isolatedNodeId] : null;
  const contextMenuNode = contextMenu ? state.document.nodes[contextMenu.id] : undefined;
  const canIsolateContextMenuNode =
    contextMenu != null &&
    contextMenuNode != null &&
    isContainer(contextMenuNode) &&
    contextMenu.id !== state.isolatedNodeId;

  const contextMenuIsContainer =
    contextMenu != null && contextMenuNode != null && isContainer(contextMenuNode);

  const contextMenuHasMask =
    contextMenuIsContainer && (contextMenuNode as { mask?: unknown }).mask != null;
  // Gated on the right-clicked node, not state.selection — a right-click on
  // a node that's already part of an existing multi-selection doesn't change
  // the selection, so gating this on selection.length === 1 would wrongly
  // disable the action for a valid target sitting inside a multi-select.
  const isComponentMasterSelected =
    contextMenu != null &&
    contextMenuNode?.kind === 'frame' &&
    Object.values(state.document.components).some((c) => c.masterRootId === contextMenu.id);

  const layerSettings = loadSettings().layers;
  const [iconBrowserOpen, setIconBrowserOpen] = useState(false);

  return (
    <div className="editor-layers layers-panel">
      <PanelDragHandle
        panelTypeId="layers"
        panelInstanceId="layers-primary"
        currentWindowId="main"
        title="Layers"
      >
        <div className="layers-panel__header">
          <span>Layers</span>
          <TooltipProvider>
            <div className="layers-panel__header-actions">
              <Tooltip
                label={
                  layerSettings.autoReveal
                    ? 'Disable auto-reveal in Layers panel'
                    : 'Enable auto-reveal in Layers panel'
                }
              >
                <button
                  type="button"
                  className={`layers-panel__auto-reveal-btn ${layerSettings.autoReveal ? 'layers-panel__auto-reveal-btn--active' : ''}`}
                  onClick={() =>
                    updateSettings({ layers: { autoReveal: !layerSettings.autoReveal } })
                  }
                  aria-label={`Auto-reveal canvas selection in Layers panel: ${layerSettings.autoReveal ? 'enabled' : 'disabled'}`}
                  aria-pressed={layerSettings.autoReveal}
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.visibility} size="0.85em" />
                </button>
              </Tooltip>
              <Tooltip
                label={
                  layerSettings.marqueeContainment
                    ? 'Marquee selects only fully-contained objects'
                    : 'Marquee selects any intersecting object'
                }
              >
                <button
                  type="button"
                  className={`layers-panel__auto-reveal-btn ${layerSettings.marqueeContainment ? 'layers-panel__auto-reveal-btn--active' : ''}`}
                  onClick={() =>
                    updateSettings({
                      layers: { marqueeContainment: !layerSettings.marqueeContainment },
                    })
                  }
                  aria-label={`Marquee containment: ${layerSettings.marqueeContainment ? 'enabled' : 'disabled'}`}
                  aria-pressed={layerSettings.marqueeContainment}
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.crosshair} size="0.85em" />
                </button>
              </Tooltip>
              <Tooltip label="Collapse all layers">
                <button
                  type="button"
                  className="layers-panel__collapse-all-btn"
                  onClick={handleCollapseAll}
                  aria-label="Collapse all layers"
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.collapseAll} size="0.85em" />
                </button>
              </Tooltip>
              <Tooltip label="Insert icon">
                <button
                  type="button"
                  className="layers-panel__collapse-all-btn"
                  onClick={() => setIconBrowserOpen(true)}
                  aria-label="Insert icon from library"
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.image} size="0.85em" />
                </button>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </PanelDragHandle>

      <IconBrowserDialog open={iconBrowserOpen} onClose={() => setIconBrowserOpen(false)} />

      {isolatedNode && (
        <div className="layers-panel__isolation-breadcrumb" role="status">
          <span className="layers-panel__isolation-label">Isolating: {isolatedNode.name}</span>
          <button type="button" onClick={() => exitIsolation()} aria-label="Exit isolation">
            Exit
          </button>
        </div>
      )}

      <LayerFilterBar
        filter={filterSpec}
        onChange={setFilterSpec}
        matchCount={matchCount}
        totalCount={totalCount}
      />

      <LayersTree
        ref={dndRef}
        filterSpec={filterSpec}
        onContextMenu={handleContextMenu}
        onContextMenuKeyboard={handleContextMenuKeyboard}
      />

      {state.selection.length >= 2 && !isFiltering(filterSpec) && (
        <LayerBulkBar
          selectedCount={state.selection.length}
          onGroup={handleGroup}
          onLockAll={handleBulkLockAll}
          onUnlockAll={handleBulkUnlockAll}
          onHideAll={handleBulkHideAll}
          onShowAll={handleBulkShowAll}
          onColorTag={handleBulkColorTag}
          onClearColorTag={handleBulkClearColorTag}
          onDeleteAll={handleBulkDelete}
        />
      )}

      {contextMenu && (
        <ContextMenu
          items={buildLayerContextMenuItems({
            nodeId: contextMenu.id,
            contextMenuNode,
            contextMenuIsContainer,
            contextMenuHasMask,
            canGroup,
            isGroupSelected,
            isInstanceSelected,
            isComponentMasterSelected,
            canIsolateContextMenuNode,
            selection: state.selection,
            documentNodes: state.document.nodes,
            handleRenameFromMenu,
            handleDeleteFromMenu,
            handleCopy,
            handleCut,
            handlePaste,
            handleGroup,
            handleUngroup,
            handleDetach,
            handleSyncInstance,
            handlePublishToLibrary,
            handleMoveToFront,
            handleMoveToBack,
            handleCollapseOthers,
            handleIsolate,
            handleLockFromMenu,
            handleVisibilityFromMenu,
            handleSnapExclusionToggle,
            handleSetLayerColor,
            handleSelectSameType,
            handleSelectSameLayerColor,
            handleSelectAllOfType,
            handleRevealOnCanvas,
            addMaskToSelected,
            removeMaskFromSelected,
            toggleMask,
            invertMask,
            setSelection,
            openUpscaleDialog,
            openVectorizeDialog,
            closeMenu,
            onUseFrameAsFileThumbnail: (nodeId) => {
              if (!platform) return;
              applyThumbnailPreference(
                {
                  platform,
                  document: state.document,
                  selection: [nodeId],
                  fileId: state.sessions.find((s) => s.id === state.activeId)?.fileId,
                  showToast: (opts) => showToast(opts),
                },
                { type: 'frame', nodeId },
                'File thumbnail now shows the frame',
              );
            },
            onSetFileThumbnail: () => {
              openThumbnailPicker();
            },
            LAYER_COLORS,
            COLOR_LABELS,
          })}
          position={contextMenu}
          onClose={closeMenu}
          label="Layer context menu"
        />
      )}

      <div className="layers-panel__variables">
        <VariablePanel />
        <TokenSyncPanel />
      </div>

      <SelectionSetsSection />
    </div>
  );
}

interface BuildLayerMenuItemsArgs {
  nodeId: string;
  contextMenuNode: SceneNode | undefined;
  contextMenuIsContainer: boolean;
  contextMenuHasMask: boolean;
  canGroup: boolean;
  isGroupSelected: boolean;
  isInstanceSelected: boolean;
  isComponentMasterSelected: boolean;
  canIsolateContextMenuNode: boolean;
  selection: string[];
  documentNodes: Record<string, SceneNode>;
  handleRenameFromMenu: () => void;
  handleDeleteFromMenu: () => void;
  handleCopy: () => void;
  handleCut: () => void;
  handlePaste: () => void;
  handleGroup: () => void;
  handleUngroup: () => void;
  handleDetach: () => void;
  handleSyncInstance: () => void;
  handlePublishToLibrary: () => void;
  handleMoveToFront: () => void;
  handleMoveToBack: () => void;
  handleCollapseOthers: () => void;
  handleIsolate: () => void;
  handleLockFromMenu: (locked: boolean) => void;
  handleVisibilityFromMenu: (visible: boolean) => void;
  handleSnapExclusionToggle: () => void;
  handleSetLayerColor: (color: NonNullable<LayerColor> | null) => void;
  handleSelectSameType: () => void;
  handleSelectSameLayerColor: () => void;
  handleSelectAllOfType: () => void;
  handleRevealOnCanvas: () => void;
  addMaskToSelected: (type: 'alpha' | 'clip' | 'luminance', sourceNodeId?: string) => void;
  removeMaskFromSelected: () => void;
  toggleMask: () => void;
  invertMask: () => void;
  setSelection: (id: string) => void;
  openUpscaleDialog: () => void;
  openVectorizeDialog: (prefill?: { replaceGroupId: string } | null) => void;
  closeMenu: () => void;
  /** Use the frame/group as the file thumbnail (persists the preference). */
  onUseFrameAsFileThumbnail?: (nodeId: string) => void;
  /** Open the file thumbnail picker dialog. */
  onSetFileThumbnail?: () => void;
  LAYER_COLORS: NonNullable<LayerColor>[];
  COLOR_LABELS: Record<NonNullable<LayerColor>, string>;
}

function buildLayerContextMenuItems(args: BuildLayerMenuItemsArgs): MenuEntry[] {
  const {
    nodeId,
    contextMenuNode,
    contextMenuIsContainer,
    contextMenuHasMask,
    canGroup,
    isGroupSelected,
    isInstanceSelected,
    isComponentMasterSelected,
    canIsolateContextMenuNode,
    selection,
    documentNodes,
    handleRenameFromMenu,
    handleDeleteFromMenu,
    handleCopy,
    handleCut,
    handlePaste,
    handleGroup,
    handleUngroup,
    handleDetach,
    handleSyncInstance,
    handlePublishToLibrary,
    handleMoveToFront,
    handleMoveToBack,
    handleCollapseOthers,
    handleIsolate,
    handleLockFromMenu,
    handleVisibilityFromMenu,
    handleSnapExclusionToggle,
    handleSetLayerColor,
    handleSelectSameType,
    handleSelectSameLayerColor,
    handleSelectAllOfType,
    handleRevealOnCanvas,
    addMaskToSelected,
    removeMaskFromSelected,
    toggleMask,
    invertMask,
    setSelection,
    openUpscaleDialog,
    openVectorizeDialog,
    closeMenu,
    LAYER_COLORS,
    COLOR_LABELS,
  } = args;

  const items: MenuEntry[] = [
    { id: 'rename', label: 'Rename', badge: 'F2', onAction: handleRenameFromMenu },
    { id: 'delete', label: 'Delete', badge: 'Del', onAction: handleDeleteFromMenu },
    { id: 'sep1', separator: true },
    { id: 'copy', label: 'Copy', badge: 'Ctrl+C', onAction: handleCopy },
    { id: 'cut', label: 'Cut', badge: 'Ctrl+X', onAction: handleCut },
    { id: 'paste', label: 'Paste', badge: 'Ctrl+V', onAction: handlePaste },
  ];

  if (contextMenuNode?.kind === 'group' && contextMenuNode.traceMetadata !== undefined) {
    items.push(
      { id: 'sep-retrace', separator: true },
      {
        id: 'retrace',
        label: 'Edit Trace…',
        onAction: () => {
          setSelection(nodeId);
          openVectorizeDialog({ replaceGroupId: nodeId });
          closeMenu();
        },
      },
    );
  }

  if (
    contextMenuNode?.kind === 'shape' &&
    contextMenuNode.fills?.some((f) => f.type === 'image' && f.image?.src)
  ) {
    items.push(
      { id: 'sep-upscale', separator: true },
      {
        id: 'vectorize',
        label: 'Vectorize Image…',
        onAction: () => {
          setSelection(nodeId);
          openVectorizeDialog();
          closeMenu();
        },
      },
      {
        id: 'upscale',
        label: 'Enhance Image…',
        onAction: () => {
          setSelection(nodeId);
          openUpscaleDialog();
          closeMenu();
        },
      },
    );
  }

  // File thumbnail entries: a frame/group row can directly become the file
  // thumbnail; every row can open the picker.
  if (contextMenuNode?.kind === 'frame' || contextMenuNode?.kind === 'group') {
    items.push(
      { id: 'sep-thumb', separator: true },
      {
        id: 'use-as-file-thumbnail',
        label: 'Use Frame as File Thumbnail',
        onAction: () => {
          setSelection(nodeId);
          args.onUseFrameAsFileThumbnail?.(nodeId);
          closeMenu();
        },
      },
    );
  }
  items.push({
    id: 'set-file-thumbnail',
    label: 'Set File Thumbnail…',
    onAction: () => {
      setSelection(nodeId);
      args.onSetFileThumbnail?.();
      closeMenu();
    },
  });

  items.push(
    { id: 'sep2', separator: true },
    { id: 'group', label: 'Group', badge: 'Ctrl+G', disabled: !canGroup, onAction: handleGroup },
    {
      id: 'ungroup',
      label: 'Ungroup',
      badge: 'Ctrl+Shift+G',
      disabled: !isGroupSelected,
      onAction: handleUngroup,
    },
    {
      id: 'detach',
      label: 'Detach Instance',
      disabled: !isInstanceSelected,
      onAction: handleDetach,
    },
    {
      id: 'sync',
      label: 'Sync Component',
      disabled: !isInstanceSelected,
      onAction: handleSyncInstance,
    },
    {
      id: 'publish',
      label: 'Publish to Library',
      disabled: !isComponentMasterSelected,
      onAction: handlePublishToLibrary,
    },
    { id: 'sep3', separator: true },
    { id: 'front', label: 'Bring to Front', badge: 'Ctrl+Shift+]', onAction: handleMoveToFront },
    { id: 'back', label: 'Send to Back', badge: 'Ctrl+Shift+[', onAction: handleMoveToBack },
  );

  if (contextMenuIsContainer && !contextMenuHasMask) {
    items.push(
      { id: 'sep-mask-add', separator: true },
      {
        id: 'mask-alpha',
        label: 'Add Alpha Mask',
        onAction: () => {
          addMaskToSelected('alpha');
          closeMenu();
        },
      },
      {
        id: 'mask-clip',
        label: 'Add Clip Mask',
        onAction: () => {
          addMaskToSelected('clip');
          closeMenu();
        },
      },
      {
        id: 'mask-luminance',
        label: 'Add Luminance Mask',
        onAction: () => {
          addMaskToSelected('luminance');
          closeMenu();
        },
      },
    );
  }

  if (contextMenuHasMask) {
    items.push(
      { id: 'sep-mask-edit', separator: true },
      {
        id: 'mask-remove',
        label: 'Remove Mask',
        onAction: () => {
          removeMaskFromSelected();
          closeMenu();
        },
      },
      {
        id: 'mask-toggle',
        label: 'Toggle Mask',
        onAction: () => {
          toggleMask();
          closeMenu();
        },
      },
      {
        id: 'mask-invert',
        label: 'Invert Mask',
        onAction: () => {
          invertMask();
          closeMenu();
        },
      },
    );
  }

  items.push({ id: 'sep4', separator: true });

  const isContainerNode = isContainer(documentNodes[nodeId] as SceneNode);
  if (isContainerNode) {
    items.push({ id: 'collapse-others', label: 'Collapse Others', onAction: handleCollapseOthers });
  }
  if (canIsolateContextMenuNode) {
    items.push({ id: 'isolate', label: 'Isolate', onAction: handleIsolate });
  }
  items.push(
    { id: 'lock', label: 'Lock', onAction: () => handleLockFromMenu(true) },
    { id: 'hide', label: 'Hide', onAction: () => handleVisibilityFromMenu(false) },
  );

  const snapExcluded = documentNodes[nodeId]?.snapExcluded;
  items.push({
    id: 'snap-toggle',
    label: snapExcluded ? 'Include in Snapping' : 'Exclude from Snapping',
    onAction: handleSnapExclusionToggle,
  });

  items.push(
    { id: 'sep5', separator: true },
    {
      id: 'color-tag',
      label: 'Color Tag',
      type: 'submenu' as const,
      submenu: [
        ...LAYER_COLORS.map((c) => ({
          id: `color-${c}`,
          label: COLOR_LABELS[c],
          onAction: () => handleSetLayerColor(c),
        })),
        { id: 'color-none', label: 'No Color', onAction: () => handleSetLayerColor(null) },
      ],
    },
    { id: 'sep6', separator: true },
    { id: 'select-type', label: 'Select Same Type', onAction: handleSelectSameType },
    { id: 'select-color', label: 'Select Same Color', onAction: handleSelectSameLayerColor },
    { id: 'select-all-type', label: 'Select All of Type', onAction: handleSelectAllOfType },
    { id: 'sep7', separator: true },
    { id: 'reveal-canvas', label: 'Reveal on Canvas', onAction: handleRevealOnCanvas },
    {
      id: 'reveal-layers',
      label: 'Reveal in Layers panel',
      onAction: () => {
        if (selection.length > 0) {
          updateSettings({ layers: { autoReveal: true } });
          document
            .querySelector('.layers-panel__tree')
            ?.querySelector('[role="treeitem"][aria-selected="true"]')
            ?.scrollIntoView({ block: 'nearest' });
        }
        closeMenu();
      },
    },
  );

  return items;
}
