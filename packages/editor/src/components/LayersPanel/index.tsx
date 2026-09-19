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
  canReceiveEffectStack,
  createEffectStackPayload,
  documentHasSolo,
  type EffectStackKind,
  type EffectStackPayload,
  getNodesInTimeline,
  isContainer,
  isVisualMaskTarget,
  LAYER_COLOR_LABELS,
  LAYER_COLORS,
  type LayerColor,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import {
  ContextMenu,
  elementAnchor,
  Menu,
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
import { getOrCreateParentCache, type ParentIndexCache } from '../../scene/parentIndexCache';
import { isNodeEffectivelyHidden, isNodeEffectivelyLocked } from '../../scene/world';
import { type LayersSettingsStore, loadSettings, updateSettings } from '../../settings';
import { applyThumbnailPreference } from '../../thumbnail/thumbnailCommands';
import { openThumbnailPicker } from '../../thumbnail/thumbnailPickerBridge';
import { usePanelLocalState } from '../../workspace/panelLocalState';
import { useEffectiveWorkspaceConfig } from '../../workspace/useWorkspaceConfig';
import { resolveLayersPanelConfig } from '../../workspace/workspaceTypes';
import { BatchRenameDialog } from '../BatchRename/BatchRenameDialog';
import { PanelDetachButton, PanelDragHandle } from '../PanelDragHandle';
import { LayerBulkBar } from './LayerBulkBar';
import { LayerDetailsPopover } from './LayerDetailsPopover';
import { LayerFilterBar } from './LayerFilterBar';
import { buildLayerContextMenuItems } from './layerContextMenu';

export type { LayersDnDHandle } from './LayersTree';

import type { LayersDnDHandle } from './LayersTree';
import { LayersTree } from './LayersTree';
import { computeActiveSurfaceLayerCount, countActiveSurfaceNodesMatching } from './layerCounts';
import type { LayerFilterSpec } from './layerFilterTypes';
import { DEFAULT_FILTER, isFiltering, nodeMatchesFilter } from './layerFilterTypes';
import './layers.css';
import type { LayerColorPickerValue } from './LayerColorTagPicker';
import { SelectionSetsSection } from './SelectionSetsSection';
import { flattenTree } from './useFlatTree';

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
    ? (node.effects?.length ?? 0)
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
    arrangeSelected,
    revealSelection,
    publishComponentToLibrary,
    enterIsolation,
    exitIsolation,
    addMaskToSelected,
    removeMaskFromSelected,
    toggleMask,
    invertMask,
    openCafDialog,
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
  const [thumbnailPreference, setThumbnailPreference] = usePanelLocalState<'images' | 'off'>(
    'layers',
    'thumbnailPreference',
    'images',
  );
  // One resolver: the active workspace's Layers projection. Every field is
  // consumed below (badges/row actions by the tree, quick filters and
  // placeholder by the filter bar); see docs/design-system/layers-panel-spec.md.
  const workspaceConfig = useEffectiveWorkspaceConfig(state.workspaceMode);
  const layersPanelConfig = useMemo(
    () => resolveLayersPanelConfig(workspaceConfig),
    [workspaceConfig],
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
  const [batchRenameOpen, setBatchRenameOpen] = useState(false);
  const [detailsNodeId, setDetailsNodeId] = useState<NodeId | null>(null);
  // Viewport-edge clamping handled by shared ContextMenu component.
  // The panel queries its own tree through this root rather than the global
  // document: a detached Layers window lives in a different Document, where
  // `document.querySelector('.layers-panel__tree')` finds nothing.
  const panelRootRef = useRef<HTMLDivElement>(null);

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
    const animatedIds =
      filterSpec.attributes.animated === true ? getNodesInTimeline(state.document) : undefined;
    return countActiveSurfaceNodesMatching(
      state.document,
      (node) => nodeMatchesFilter(node, filterSpec, { doc: state.document, animatedIds }),
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

  const handleDetailsFromMenu = useCallback(() => {
    if (contextMenu) {
      setDetailsNodeId(contextMenu.id);
      closeMenu();
    }
  }, [contextMenu, closeMenu]);

  const handleBatchRenameFromMenu = useCallback(() => {
    closeMenu();
    setBatchRenameOpen(true);
  }, [closeMenu]);

  // Every named layer on the active surface, in tree order, for the rename
  // preview. Computed only while the dialog is open: the walk is O(nodes).
  const allLayerNames = useMemo(() => {
    if (!batchRenameOpen) return [];
    const expanded = new Set(Object.keys(state.document.nodes));
    return flattenTree(
      state.document,
      expanded,
      DEFAULT_FILTER,
      undefined,
      state.document.activePageId,
      undefined,
      undefined,
      designCanvasId,
    ).map((entry) => ({ nodeId: entry.node.id, name: entry.node.name }));
  }, [batchRenameOpen, state.document, designCanvasId]);

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

  // One canonical arrange path for all four commands. The previous
  // bring-front/send-back loops reparented each selected id against a stale
  // captured document and announced once per node; `arrangeSelected` is the
  // scene-level transaction the global Ctrl+[/] shortcuts already use, so
  // multi-selection order, layout reflow, and undo stay identical across
  // entry points. The context-menu selection is committed to the editor
  // selection when the menu opens, so the command's target set is the same
  // one the menu displayed.
  const handleArrange = useCallback(
    (op: 'front' | 'forward' | 'backward' | 'back') => {
      arrangeSelected(op);
      closeMenu();
    },
    [arrangeSelected, closeMenu],
  );

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

  const revealSelectionInPanel = useCallback(() => {
    const root = panelRootRef.current;
    if (!root) return;
    root
      .querySelector('.layers-panel__tree')
      ?.querySelector('[role="treeitem"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, []);

  const handleCollapseOthers = useCallback(() => {
    if (contextMenu) {
      dndRef?.current?.collapseOthers(contextMenu.id);
      closeMenu();
    }
  }, [dndRef, contextMenu, closeMenu]);

  // Non-drag reparenting routes through the tree's own handlers so the menu,
  // the keyboard, and any future surface share one implementation. The
  // context row is passed explicitly: the roving focus may be elsewhere.
  const handleIndentFromMenu = useCallback(() => {
    if (!contextMenu) return;
    dndRef?.current?.indentSelection(contextMenu.id);
    closeMenu();
  }, [dndRef, contextMenu, closeMenu]);

  const handleOutdentFromMenu = useCallback(() => {
    if (!contextMenu) return;
    dndRef?.current?.outdentSelection(contextMenu.id);
    closeMenu();
  }, [dndRef, contextMenu, closeMenu]);

  const contextSelection = contextMenu?.selection ?? state.selection;
  const handleCanvasNavigation = useCallback(
    (behavior: 'reveal' | 'center' | 'fit') => {
      const selection = contextMenu?.selection ?? state.selection;
      if (selection.length > 0) {
        const singleId = selection.length === 1 ? selection[0] : undefined;
        revealSelection({ nodeId: singleId, behavior });
      }
      closeMenu();
    },
    [contextMenu?.selection, state.selection, revealSelection, closeMenu],
  );
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
  const contextMenuIsVisualLeaf = contextMenuNode != null && isVisualMaskTarget(contextMenuNode);

  const contextMenuHasMask =
    (contextMenuIsContainer || contextMenuIsVisualLeaf) &&
    (contextMenuNode as { mask?: unknown }).mask != null;
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
  const [navigationMenuOpen, setNavigationMenuOpen] = useState(false);
  const navigationMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const updateLayerSettings = useCallback((patch: Partial<LayersSettingsStore>) => {
    const next = updateSettings({ layers: patch });
    setLayerSettings(next.layers);
  }, []);
  const navigationMenuItems = useMemo<MenuEntry[]>(
    () => [
      { id: 'navigation-label', label: 'When selecting layers', type: 'label' },
      ...[
        ['select-only', 'Select only', 'Keep the current camera'] as const,
        ['reveal', 'Reveal when needed', 'Pan only when the layer is outside the canvas'] as const,
        ['center', 'Center selection', 'Keep zoom and center the layer'] as const,
        ['fit', 'Fit selection', 'Center and adjust zoom to show the layer'] as const,
      ].map(([value, label, description]) => ({
        id: `selection-navigation-${value}`,
        label,
        description,
        type: 'radio' as const,
        group: 'layer-selection-navigation',
        checked: layerSettings.selectionNavigation === value,
        onToggle: () => updateLayerSettings({ selectionNavigation: value }),
      })),
      { id: 'navigation-separator', separator: true },
      {
        id: 'tree-auto-reveal',
        label: 'Reveal canvas selection in Layers panel',
        description: 'Expand and scroll the tree when selection comes from the canvas',
        type: 'checkbox',
        checked: layerSettings.autoReveal,
        onToggle: () => updateLayerSettings({ autoReveal: !layerSettings.autoReveal }),
      },
      { id: 'view-label', label: 'View', type: 'label' },
      {
        id: 'layer-thumbnails',
        label: 'Image previews in rows',
        description: 'Generate previews only for image-filled layers',
        type: 'checkbox',
        checked: thumbnailPreference === 'images',
        onToggle: () =>
          setThumbnailPreference((current) => (current === 'images' ? 'off' : 'images')),
      },
    ],
    [layerSettings, thumbnailPreference, setThumbnailPreference, updateLayerSettings],
  );
  // A context-menu details action may target one row inside a multi-selection.
  // Keep that target as the popover anchor even though the compact header
  // button is normally offered only for a single selected layer.
  const detailsTargetId =
    (detailsNodeId && state.document.nodes[detailsNodeId] ? detailsNodeId : null) ??
    (state.selection.length === 1 ? state.selection[0] : null);
  const detailsTarget = detailsTargetId ? state.document.nodes[detailsTargetId] : undefined;
  const detailsTargetIsSelected =
    state.selection.length === 1 && detailsTargetId === state.selection[0];

  return (
    <div ref={panelRootRef} className="editor-layers layers-panel" data-panel-root="layers">
      <PanelDragHandle
        panelTypeId="layers"
        panelInstanceId="layers-primary"
        currentWindowId="main"
        title="Layers"
      >
        <div className="layers-panel__header">
          <div className="layers-panel__heading">
            <h2 className="layers-panel__title">Layers</h2>
            <span className="layers-panel__count">{totalCount}</span>
            {isFiltering(filterSpec) && (
              <span className="layers-panel__filter-badge" title="Filter applied">
                Filtered
              </span>
            )}
          </div>
          <TooltipProvider>
            <div className="layers-panel__header-actions">
              {detailsTarget && (
                <LayerDetailsPopover
                  node={detailsTarget}
                  doc={state.document}
                  parentCache={parentCacheRef.current}
                  open={detailsNodeId === detailsTarget.id}
                  onOpenChange={(open) => setDetailsNodeId(open ? detailsTarget.id : null)}
                  onSelectAncestor={(id) => setSelection(id)}
                >
                  <button
                    type="button"
                    className="layers-panel__header-btn"
                    aria-label={
                      detailsTargetIsSelected
                        ? 'Show selected layer details'
                        : `Show details for ${detailsTarget.name}`
                    }
                    title={
                      detailsTargetIsSelected
                        ? 'Show selected layer details'
                        : `Show details for ${detailsTarget.name}`
                    }
                    onClick={() => setDetailsNodeId(detailsTarget.id)}
                  >
                    <SolidIcon name={SOLID_CHROME_ICONS.info} size="0.85em" />
                  </button>
                </LayerDetailsPopover>
              )}
              <button
                ref={navigationMenuTriggerRef}
                type="button"
                className="layers-panel__header-btn"
                aria-haspopup="menu"
                aria-expanded={navigationMenuOpen}
                aria-controls="layers-navigation-menu"
                aria-label="Layer navigation settings"
                onClick={() => setNavigationMenuOpen((open) => !open)}
              >
                <SolidIcon name={SOLID_CHROME_ICONS.settings} size="0.85em" />
              </button>
              {navigationMenuOpen && (
                <Menu
                  items={navigationMenuItems}
                  triggerRef={navigationMenuTriggerRef}
                  open={navigationMenuOpen}
                  onClose={() => setNavigationMenuOpen(false)}
                  label="Layer navigation settings"
                  id="layers-navigation-menu"
                  size="rich"
                />
              )}
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
        quickFilters={layersPanelConfig.quickFilters}
        searchPlaceholder={layersPanelConfig.searchPlaceholder}
        onSelectMatches={() => dndRef?.current?.selectMatches()}
      />

      <LayersTree
        ref={dndRef}
        filterSpec={filterSpec}
        layersConfig={layersPanelConfig}
        thumbnailEnabled={thumbnailPreference === 'images'}
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
            handleDetailsFromMenu,
            handleBatchRenameFromMenu,
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
            handleMoveToFront: () => handleArrange('front'),
            handleBringForward: () => handleArrange('forward'),
            handleSendBackward: () => handleArrange('backward'),
            handleMoveToBack: () => handleArrange('back'),
            handleCollapseOthers,
            handleIndentFromMenu,
            handleOutdentFromMenu,
            handleIsolate,
            handleLockFromMenu,
            handleVisibilityFromMenu,
            isEffectivelyLocked: (id) => isNodeEffectivelyLocked(state.document, id),
            isEffectivelyHidden: (id) => isNodeEffectivelyHidden(state.document, id),
            handleSnapExclusionToggle,
            handleSetLayerColor,
            handleSelectSameType,
            handleSelectSameLayerColor,
            handleSelectAllOfType,
            handleSoloFromMenu,
            handleCanvasNavigation,
            revealSelectionInPanel,
            enableAutoReveal: () => updateLayerSettings({ autoReveal: true }),
            addMaskToSelected,
            removeMaskFromSelected,
            toggleMask,
            invertMask,
            setSelection,
            openCafDialog,
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
          size="default"
        />
      )}

      <BatchRenameDialog
        open={batchRenameOpen}
        onClose={() => setBatchRenameOpen(false)}
        scopeNodeIds={state.selection}
        allNodeNames={allLayerNames}
      />

      <SelectionSetsSection />
    </div>
  );
}
