/**
 * LayersPanel — the authoritative layer hierarchy, search/filter, context
 * menu, and structure navigation surface. Saved Layer States are owned by
 * the Inspector's selection/state workflow rather than being rendered as a
 * second list below this tree.
 *
 * Research basis: W3C APG Tree View, Menu pattern (for context menu).
 */

import {
  applyEffectStackPayload,
  type ContainerNode,
  canReceiveEffectStack,
  createEffectStackPayload,
  documentHasSolo,
  type EffectStackKind,
  type EffectStackPayload,
  isContainer,
  LAYER_COLOR_LABELS,
  LAYER_COLORS,
  type LayerColor,
  type LayerColorName,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import {
  ContextMenu,
  elementAnchor,
  type MenuEntry,
  type OverlayAnchor,
  pointAnchor,
  SOLID_CHROME_ICONS,
  SolidIcon,
  Tooltip,
  TooltipProvider,
  viewportPoint,
} from '@varve/ui';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import {
  getOrCreateParentCache,
  getParentFast,
  type ParentIndexCache,
} from '../../scene/parentIndexCache';
import { isNodeEffectivelyLocked } from '../../scene/world';
import { type LayersSettingsStore, loadSettings, updateSettings } from '../../settings';
import { applyThumbnailPreference } from '../../thumbnail/thumbnailCommands';
import { openThumbnailPicker } from '../../thumbnail/thumbnailPickerBridge';
import { usePanelLocalState } from '../../workspace/panelLocalState';
import { PanelDetachButton, PanelDragHandle } from '../PanelDragHandle';
import { LayerBulkBar } from './LayerBulkBar';
import { LayerFilterBar } from './LayerFilterBar';

export type { LayersDnDHandle } from './LayersTree';

import type { LayersDnDHandle } from './LayersTree';
import { LayersTree, resolveRootLevelSiblings } from './LayersTree';
import { computeActiveSurfaceLayerCount, countActiveSurfaceNodesMatching } from './layerCounts';
import type { LayerFilterSpec } from './layerFilterTypes';
import { DEFAULT_FILTER, isFiltering, nodeMatchesFilter } from './layerFilterTypes';
import './layers.css';
import type { LayerColorPickerValue } from './LayerColorTagPicker';
import { SelectionSetsSection } from './SelectionSetsSection';

interface EffectStackClipboard {
  sourceId: NodeId;
  sourceName: string;
  kind: EffectStackKind;
  payload: EffectStackPayload;
  entryCount: number;
}

function effectStackLabel(kind: EffectStackKind): string {
  return kind === 'layer-effects' ? 'Layer Effects' : 'Object Filters';
}

function effectStackEntryCount(node: SceneNode, kind: EffectStackKind): number {
  return kind === 'layer-effects' && 'effects' in node
    ? node.effects.length
    : (node.smartFilters?.length ?? 0);
}

export function LayersPanel({ dndRef }: { dndRef?: React.RefObject<LayersDnDHandle | null> }) {
  const {
    state,
    setSelection,
    removeSelected,
    setNodeLocked,
    setNodeVisible,
    setNodeSolo,
    exitSolo,
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
    updateDoc,
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
  const [filterSpec, setFilterSpec] = usePanelLocalState<LayerFilterSpec>(
    'layers',
    'filterSpec',
    DEFAULT_FILTER,
  );
  const anySolo = useMemo(() => documentHasSolo(state.document), [state.document]);
  const [contextMenu, setContextMenu] = useState<{
    anchor: OverlayAnchor;
    id: NodeId;
    /** Selection captured when the menu opened; actions must not use a stale
     * selection while the row's context-menu selection settles. */
    selection: NodeId[];
  } | null>(null);
  const [effectStackClipboard, setEffectStackClipboard] = useState<EffectStackClipboard | null>(
    null,
  );
  // Viewport-edge clamping handled by shared ContextMenu component.

  // Parent index cache for O(1) lookups
  const parentCacheRef = useRef<ParentIndexCache | null>(null);
  parentCacheRef.current = getOrCreateParentCache(state.document, parentCacheRef.current);

  // Compute match count for the filter bar — scoped to the active surface only
  // (document.nodes spans every canvas/page plus each surface's contentRoot,
  // neither of which the tree ever shows as a row).
  const designCanvasId =
    state.workspaceMode !== 'print' ? state.document.activeDesignCanvasId : undefined;
  const totalCount = useMemo(
    () => computeActiveSurfaceLayerCount(state.document, designCanvasId),
    [state.document, designCanvasId],
  );
  const matchCount = useMemo(() => {
    if (!isFiltering(filterSpec)) return totalCount;
    return countActiveSurfaceNodesMatching(
      state.document,
      (node) => nodeMatchesFilter(node, filterSpec),
      designCanvasId,
    );
  }, [state.document, filterSpec, totalCount, designCanvasId]);
  const selectedLayerColor = useMemo<LayerColorPickerValue>(() => {
    if (state.selection.length < 2) return undefined;
    const colors = state.selection.map((id) => state.document.nodes[id]?.layerColor ?? null);
    const first = colors[0];
    return colors.every((color) => color === first) ? first : 'mixed';
  }, [state.document.nodes, state.selection]);

  // Outside click and Escape handled by shared ContextMenu component.
  // This effect remains for stale-context-menu cleanup on unmount.
  useEffect(() => {
    return () => setContextMenu(null);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, id: NodeId) => {
      e.preventDefault();
      e.stopPropagation();
      const selection = state.selection.includes(id) ? [...state.selection] : [id];
      if (!state.selection.includes(id)) {
        setSelection(id);
      }
      const contextElement = e.currentTarget as HTMLElement;
      setContextMenu({
        anchor: pointAnchor(
          viewportPoint(e.clientX, e.clientY),
          contextElement.ownerDocument,
          contextElement,
        ),
        id,
        selection,
      });
    },
    [state.selection, setSelection],
  );

  // Keyboard-triggered context menu (Shift+F10 / Menu key on the focused
  // row): position the menu at the row instead of a pointer location.
  const handleContextMenuKeyboard = useCallback(
    (id: NodeId, focusedRow?: HTMLElement) => {
      const selection = state.selection.includes(id) ? [...state.selection] : [id];
      if (!state.selection.includes(id)) {
        setSelection(id);
      }
      const rowEl = focusedRow;
      if (!rowEl?.isConnected) return;
      rowEl.scrollIntoView({ block: 'nearest' });
      setContextMenu({
        anchor: elementAnchor(rowEl),
        id,
        selection,
      });
    },
    [state.selection, setSelection],
  );

  // A context menu snapshots its target, but it must not outlive the target
  // itself. The shared overlay also guards DOM anchors; this state guard keeps
  // command construction from exposing actions for a deleted scene node.
  useEffect(() => {
    if (contextMenu && !state.document.nodes[contextMenu.id]) {
      setContextMenu(null);
    }
  }, [contextMenu, state.document]);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  const handleRenameFromMenu = useCallback(() => {
    if (contextMenu) {
      dndRef?.current?.startRename(contextMenu.id);
      closeMenu();
    }
  }, [contextMenu, dndRef, closeMenu]);

  const handleDeleteFromMenu = useCallback(() => {
    const selection = contextMenu?.selection ?? state.selection;
    if (selection.length > 0) removeSelected(selection);
    closeMenu();
  }, [contextMenu?.selection, state.selection, removeSelected, closeMenu]);

  const handleLockFromMenu = useCallback(
    (locked: boolean) => {
      const selection = contextMenu?.selection ?? state.selection;
      for (const id of selection) setNodeLocked(id, locked);
      closeMenu();
    },
    [contextMenu?.selection, state.selection, setNodeLocked, closeMenu],
  );

  const handleVisibilityFromMenu = useCallback(
    (visible: boolean) => {
      const selection = contextMenu?.selection ?? state.selection;
      for (const id of selection) setNodeVisible(id, visible);
      closeMenu();
    },
    [contextMenu?.selection, state.selection, setNodeVisible, closeMenu],
  );

  const handleSnapExclusionToggle = useCallback(() => {
    const selection = contextMenu?.selection ?? state.selection;
    for (const id of selection) {
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
  }, [contextMenu?.selection, state.selection, state.document.nodes, updateNode, closeMenu]);

  const handleMoveToFront = useCallback(() => {
    const selection = contextMenu?.selection ?? state.selection;
    for (const id of selection) {
      const parentId = getParentFast(state.document, id, parentCacheRef.current);
      const siblings = parentId
        ? ((state.document.nodes[parentId] as ContainerNode | undefined)?.children ??
          resolveRootLevelSiblings(state.document))
        : resolveRootLevelSiblings(state.document);
      reparentNode(id, parentId, siblings.length - 1);
      announce('Moved to front');
    }
    closeMenu();
  }, [contextMenu?.selection, state.selection, state.document, reparentNode, announce, closeMenu]);

  const handleMoveToBack = useCallback(() => {
    const selection = contextMenu?.selection ?? state.selection;
    for (const id of selection) {
      const parentId = getParentFast(state.document, id, parentCacheRef.current);
      reparentNode(id, parentId, 0);
      announce('Moved to back');
    }
    closeMenu();
  }, [contextMenu?.selection, state.selection, state.document, reparentNode, announce, closeMenu]);

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

  const handleCopyEffectStackFromMenu = useCallback(
    (kind: EffectStackKind) => {
      const sourceId = contextMenu?.id;
      const source = sourceId ? state.document.nodes[sourceId] : undefined;
      const payload = source ? createEffectStackPayload(source, kind) : null;
      const stackName = effectStackLabel(kind);
      if (!sourceId || !source || !payload) {
        const message = `${source?.name ?? 'This layer'} has no ${stackName} to copy`;
        announce(message);
        showToast({ message, type: 'info' });
        closeMenu();
        return;
      }

      const entryCount = effectStackEntryCount(source, kind);
      setEffectStackClipboard({
        sourceId,
        sourceName: source.name,
        kind,
        payload,
        entryCount,
      });
      const message = `Copied ${entryCount} ${stackName} from ${source.name}. Right-click a destination layer to paste.`;
      announce(message);
      showToast({ message, type: 'success' });
      closeMenu();
    },
    [announce, closeMenu, contextMenu?.id, showToast, state.document.nodes],
  );

  const handlePasteEffectStackFromMenu = useCallback(
    (mode: 'replace' | 'append') => {
      const clipboard = effectStackClipboard;
      const targetId = contextMenu?.id;
      if (!clipboard || !targetId) {
        closeMenu();
        return;
      }

      const target = state.document.nodes[targetId];
      const stackName = effectStackLabel(clipboard.kind);
      const fail = (message: string) => {
        announce(message);
        showToast({ message, type: 'warning' });
        closeMenu();
      };
      if (!target) {
        fail('The destination layer is no longer available');
        return;
      }
      if (targetId === clipboard.sourceId) {
        fail('Choose a different destination layer for the copied appearance stack');
        return;
      }
      if (isNodeEffectivelyLocked(state.document, targetId)) {
        fail(`${target.name} is locked, so its ${stackName} cannot be changed`);
        return;
      }
      if (!canReceiveEffectStack(target, clipboard.kind)) {
        fail(`${target.name} does not support ${stackName}`);
        return;
      }

      const feedback: {
        applied: boolean;
        omittedMaskCount: number;
        convertedBypassedObjectFilterCount: number;
      } = {
        applied: false,
        omittedMaskCount: 0,
        convertedBypassedObjectFilterCount: 0,
      };
      updateDoc((doc) => {
        const result = applyEffectStackPayload(doc, targetId, clipboard.payload, mode);
        if (!result) return doc;
        feedback.applied = true;
        feedback.omittedMaskCount = result.omittedMaskCount;
        feedback.convertedBypassedObjectFilterCount = result.convertedBypassedObjectFilterCount;
        return {
          ...doc,
          nodes: { ...doc.nodes, [targetId]: result.node },
        };
      });

      if (!feedback.applied) {
        fail(`Could not paste ${stackName}; the destination changed while the menu was open`);
        return;
      }

      const message = `${mode === 'append' ? 'Appended' : 'Pasted'} ${clipboard.entryCount} ${stackName} on ${target.name}`;
      announce(message);
      showToast({ message, type: 'success' });
      if (feedback.omittedMaskCount > 0) {
        showToast({
          message: `${feedback.omittedMaskCount} invalid or cyclic effect mask${
            feedback.omittedMaskCount === 1 ? ' was' : 's were'
          } omitted`,
          type: 'warning',
        });
      }
      if (feedback.convertedBypassedObjectFilterCount > 0) {
        showToast({
          message:
            'Bypassed Object Filters were pasted as disabled entries to preserve appearance.',
          type: 'warning',
        });
      }
      closeMenu();
    },
    [
      announce,
      closeMenu,
      contextMenu?.id,
      effectStackClipboard,
      showToast,
      state.document,
      updateDoc,
    ],
  );

  const handleSetLayerColor = useCallback(
    (color: LayerColor) => {
      bulkSetLayerColor(contextMenu?.selection ?? state.selection, color);
      closeMenu();
    },
    [contextMenu?.selection, state.selection, bulkSetLayerColor, closeMenu],
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

  const handleSoloFromMenu = useCallback(() => {
    if (contextMenu) {
      const id = contextMenu.id;
      setNodeSolo(id, !state.document.nodes[id]?.solo);
    }
    closeMenu();
  }, [contextMenu, setNodeSolo, state.document.nodes, closeMenu]);

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

  const contextSelection = contextMenu?.selection ?? state.selection;
  const canGroup = contextSelection.length >= 2;
  const firstSelId = contextSelection[0];
  const firstSel = firstSelId ? state.document.nodes[firstSelId] : undefined;
  const isGroupSelected = contextSelection.length === 1 && firstSel?.kind === 'group';
  const isInstanceSelected =
    contextSelection.length === 1 &&
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
  const canPasteEffectStack =
    contextMenu != null &&
    contextMenuNode != null &&
    effectStackClipboard != null &&
    contextMenu.id !== effectStackClipboard.sourceId &&
    !isNodeEffectivelyLocked(state.document, contextMenu.id) &&
    canReceiveEffectStack(contextMenuNode, effectStackClipboard.kind);
  // Gated on the right-clicked node, not state.selection — a right-click on
  // a node that's already part of an existing multi-selection doesn't change
  // the selection, so gating this on selection.length === 1 would wrongly
  // disable the action for a valid target sitting inside a multi-select.
  const isComponentMasterSelected =
    contextMenu != null &&
    contextMenuNode?.kind === 'frame' &&
    Object.values(state.document.components).some((c) => c.masterRootId === contextMenu.id);

  const [layerSettings, setLayerSettings] = useState<LayersSettingsStore>(
    () => loadSettings().layers,
  );
  const updateLayerSettings = useCallback((patch: Partial<LayersSettingsStore>) => {
    const next = updateSettings({ layers: patch });
    setLayerSettings(next.layers);
  }, []);

  return (
    <div className="editor-layers layers-panel" data-panel-root="layers">
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
                  className={`layers-panel__header-btn ${layerSettings.autoReveal ? 'layers-panel__header-btn--active' : ''}`}
                  onClick={() => updateLayerSettings({ autoReveal: !layerSettings.autoReveal })}
                  aria-label={`Auto-reveal canvas selection in Layers panel: ${layerSettings.autoReveal ? 'enabled' : 'disabled'}`}
                  aria-pressed={layerSettings.autoReveal}
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.visibility} size="0.85em" />
                </button>
              </Tooltip>
              <Tooltip label="Collapse all layers">
                <button
                  type="button"
                  className="layers-panel__header-btn"
                  onClick={handleCollapseAll}
                  aria-label="Collapse all layers"
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.collapseAll} size="0.85em" />
                </button>
              </Tooltip>
              {anySolo && (
                <Tooltip label="Exit solo — show all layers">
                  <button
                    type="button"
                    className="layers-panel__solo-exit-btn"
                    onClick={() => exitSolo()}
                    aria-label="Exit solo view"
                  >
                    <SolidIcon name={SOLID_CHROME_ICONS.star} size="0.85em" />
                    <span>Exit Solo</span>
                  </button>
                </Tooltip>
              )}
              <PanelDetachButton />
            </div>
          </TooltipProvider>
        </div>
      </PanelDragHandle>

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
        onToggleSolo={(id) => {
          const ids =
            state.selection.length > 1 && state.selection.includes(id) ? state.selection : [id];
          const anySolo = ids.some((sid) => state.document.nodes[sid]?.solo);
          for (const sid of ids) setNodeSolo(sid, !anySolo);
        }}
      />

      {state.selection.length >= 2 && !isFiltering(filterSpec) && (
        <LayerBulkBar
          selectedCount={state.selection.length}
          selectedColor={selectedLayerColor}
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
            selection: contextSelection,
            documentNodes: state.document.nodes,
            handleRenameFromMenu,
            handleDeleteFromMenu,
            handleCopy,
            handleCut,
            handlePaste,
            effectStackClipboard,
            canPasteEffectStack,
            handleCopyEffectStackFromMenu,
            handlePasteEffectStackFromMenu,
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
            handleSoloFromMenu,
            handleRevealOnCanvas,
            enableAutoReveal: () => updateLayerSettings({ autoReveal: true }),
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
            COLOR_LABELS: LAYER_COLOR_LABELS,
          })}
          anchor={contextMenu.anchor}
          onClose={closeMenu}
          label="Layer context menu"
        />
      )}

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
  effectStackClipboard: EffectStackClipboard | null;
  canPasteEffectStack: boolean;
  handleCopyEffectStackFromMenu: (kind: EffectStackKind) => void;
  handlePasteEffectStackFromMenu: (mode: 'replace' | 'append') => void;
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
  handleSetLayerColor: (color: LayerColor) => void;
  handleSelectSameType: () => void;
  handleSelectSameLayerColor: () => void;
  handleSelectAllOfType: () => void;
  handleSoloFromMenu: () => void;
  handleRevealOnCanvas: () => void;
  enableAutoReveal: () => void;
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
  LAYER_COLORS: readonly LayerColorName[];
  COLOR_LABELS: Readonly<Record<LayerColorName, string>>;
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
    effectStackClipboard,
    canPasteEffectStack,
    handleCopyEffectStackFromMenu,
    handlePasteEffectStackFromMenu,
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
    handleSoloFromMenu,
    handleRevealOnCanvas,
    enableAutoReveal,
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

  const layerEffectCount =
    contextMenuNode && 'effects' in contextMenuNode ? contextMenuNode.effects.length : 0;
  const objectFilterCount = contextMenuNode?.smartFilters?.length ?? 0;
  if (layerEffectCount > 0 || objectFilterCount > 0 || effectStackClipboard) {
    items.push({ id: 'sep-appearance-stack', separator: true });
    if (layerEffectCount > 0) {
      items.push({
        id: 'copy-layer-effects',
        label: 'Copy Layer Effects',
        onAction: () => handleCopyEffectStackFromMenu('layer-effects'),
      });
    }
    if (objectFilterCount > 0) {
      items.push({
        id: 'copy-object-filters',
        label: 'Copy Object Filters',
        onAction: () => handleCopyEffectStackFromMenu('object-filters'),
      });
    }
    if (effectStackClipboard) {
      const stackName = effectStackLabel(effectStackClipboard.kind);
      items.push(
        {
          id: `paste-${effectStackClipboard.kind}`,
          label: `Paste ${stackName}`,
          disabled: !canPasteEffectStack,
          onAction: () => handlePasteEffectStackFromMenu('replace'),
        },
        {
          id: `append-${effectStackClipboard.kind}`,
          label: `Append ${stackName}`,
          disabled: !canPasteEffectStack,
          onAction: () => handlePasteEffectStackFromMenu('append'),
        },
      );
    }
  }

  items.push(
    { id: 'sep-order', separator: true },
    { id: 'front', label: 'Bring to Front', badge: 'Ctrl+Shift+]', onAction: handleMoveToFront },
    { id: 'back', label: 'Send to Back', badge: 'Ctrl+Shift+[', onAction: handleMoveToBack },
  );

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

  // Structure submenu — group/ungroup and component operations
  const hasStructuralOps =
    canGroup || isGroupSelected || isInstanceSelected || isComponentMasterSelected;
  if (hasStructuralOps) {
    items.push(
      { id: 'sep2', separator: true },
      {
        id: 'structure-submenu',
        label: 'Structure',
        type: 'submenu' as const,
        submenu: [
          {
            id: 'group',
            label: 'Group',
            badge: 'Ctrl+G',
            disabled: !canGroup,
            onAction: handleGroup,
          },
          {
            id: 'ungroup',
            label: 'Ungroup',
            badge: 'Ctrl+Shift+G',
            disabled: !isGroupSelected,
            onAction: handleUngroup,
          },
          { id: 'struct-sep', separator: true },
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
        ],
      },
    );
  }

  // Masking submenu
  const hasMaskOps = contextMenuIsContainer || contextMenuHasMask;
  if (hasMaskOps) {
    const maskEntries: MenuEntry[] = [];
    if (contextMenuIsContainer && !contextMenuHasMask) {
      maskEntries.push(
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
      if (maskEntries.length > 0) maskEntries.push({ id: 'mask-sep', separator: true });
      maskEntries.push(
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
    items.push(
      { id: 'sep-mask', separator: true },
      {
        id: 'masking-submenu',
        label: 'Masking',
        type: 'submenu' as const,
        submenu: maskEntries,
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

  const soloed = documentNodes[nodeId]?.solo === true;
  items.push({
    id: 'solo',
    label: soloed ? 'Unsolo' : 'Solo',
    onAction: handleSoloFromMenu,
  });

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
    {
      id: 'select-submenu',
      label: 'Select',
      type: 'submenu' as const,
      submenu: [
        { id: 'select-type', label: 'Select Same Type', onAction: handleSelectSameType },
        { id: 'select-color', label: 'Select Same Color', onAction: handleSelectSameLayerColor },
        { id: 'select-all-type', label: 'Select All of Type', onAction: handleSelectAllOfType },
      ],
    },
    { id: 'sep7', separator: true },
    { id: 'reveal-canvas', label: 'Reveal on Canvas', onAction: handleRevealOnCanvas },
    {
      id: 'reveal-layers',
      label: 'Reveal in Layers panel',
      onAction: () => {
        if (selection.length > 0) {
          enableAutoReveal();
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
