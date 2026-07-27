/**
 * LayersPanel — container for the layers tree, search/filter, context menu,
 * and embedded VariablePanel.
 *
 * Research basis: W3C APG Tree View, Menu pattern (for context menu).
 */

import type { ContainerNode, LayerColor, NodeId, SceneNode } from '@strata/scene';
import { isContainer } from '@strata/scene';
import { SOLID_CHROME_ICONS, SolidIcon } from '@strata/ui';
import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../../context';
import {
  getOrCreateParentCache,
  getParentFast,
  type ParentIndexCache,
} from '../../scene/parentIndexCache';
import { loadSettings, updateSettings } from '../../settings';
import { LayerBulkBar } from './LayerBulkBar';
import { LayerFilterBar } from './LayerFilterBar';
import type { LayersDnDHandle } from './LayersTree';
import { LayersTree, resolveRootLevelSiblings } from './LayersTree';
import { computeActivePageLayerCount, countActivePageNodesMatching } from './layerCounts';
import type { LayerFilterSpec } from './layerFilterTypes';
import { DEFAULT_FILTER, isFiltering, nodeMatchesFilter } from './layerFilterTypes';
import './layers.css';
import { VariablePanel } from '../../VariablePanel';

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
  } = useEditor();
  const [filterSpec, setFilterSpec] = useState<LayerFilterSpec>(DEFAULT_FILTER);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    id: NodeId;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // The menu is anchored at the raw click point with no viewport-edge
  // awareness — a right-click near the panel's top/right edge (the layers
  // panel is a narrow sidebar, so this is the common case, not an edge
  // case) pushes items like the color-tag row or bottom actions off
  // screen. Clamp after the real size is known, before paint.
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const margin = 4;
    let left = contextMenu.x;
    let top = contextMenu.y;
    if (rect.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (rect.bottom > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [contextMenu]);

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

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

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
        updateNode(id, (n: import('@strata/scene').SceneNode) => ({
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

  const handleRevealInLayers = useCallback(() => {
    if (state.selection.length > 0) {
      const settings = updateSettings({ layers: { autoReveal: true } });
      // Force a selection change to trigger the reveal effect by re-toggling
      // the primary selection through itself (no-op on state but effect re-runs).
      // Use setSelection to fire the origin change mechanism.
    }
    closeMenu();
  }, [state.selection, closeMenu]);

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

  return (
    <div className="editor-layers layers-panel">
      <div className="layers-panel__header">
        <span>Layers</span>
        <div className="layers-panel__header-actions">
          <button
            type="button"
            className={`layers-panel__auto-reveal-btn ${layerSettings.autoReveal ? 'layers-panel__auto-reveal-btn--active' : ''}`}
            onClick={() => updateSettings({ layers: { autoReveal: !layerSettings.autoReveal } })}
            aria-label={`Auto-reveal canvas selection in Layers panel: ${layerSettings.autoReveal ? 'enabled' : 'disabled'}`}
            aria-pressed={layerSettings.autoReveal}
            title={`Auto-reveal selection: ${layerSettings.autoReveal ? 'on' : 'off'}`}
          >
            <SolidIcon name={SOLID_CHROME_ICONS.eye} size="0.85em" />
          </button>
          <button
            type="button"
            className="layers-panel__collapse-all-btn"
            onClick={handleCollapseAll}
            aria-label="Collapse all layers"
            title="Collapse all"
          >
            <SolidIcon name={SOLID_CHROME_ICONS.collapseAll} size="0.85em" />
          </button>
        </div>
      </div>

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

      <LayersTree ref={dndRef} filterSpec={filterSpec} onContextMenu={handleContextMenu} />

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

      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="layers-context-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeMenu();
            }}
          >
            <ContextMenuItem label="Rename" shortcut="F2" onAction={handleRenameFromMenu} />
            <ContextMenuItem label="Delete" shortcut="Del" onAction={handleDeleteFromMenu} />
            <hr className="layers-context-menu__separator" />
            <ContextMenuItem label="Copy" shortcut="Ctrl+C" onAction={handleCopy} />
            <ContextMenuItem label="Cut" shortcut="Ctrl+X" onAction={handleCut} />
            <ContextMenuItem label="Paste" shortcut="Ctrl+V" onAction={handlePaste} />
            {contextMenu != null &&
              contextMenuNode?.kind === 'shape' &&
              contextMenuNode.fills?.some((f) => f.type === 'image' && f.image?.src) && (
                <>
                  <hr className="layers-context-menu__separator" />
                  <ContextMenuItem
                    label="Upscale Image"
                    onAction={() => {
                      setSelection(contextMenu.id);
                      openUpscaleDialog();
                      closeMenu();
                    }}
                  />
                </>
              )}
            <hr className="layers-context-menu__separator" />
            <ContextMenuItem
              label="Group"
              shortcut="Ctrl+G"
              disabled={!canGroup}
              onAction={handleGroup}
            />
            <ContextMenuItem
              label="Ungroup"
              shortcut="Ctrl+Shift+G"
              disabled={!isGroupSelected}
              onAction={handleUngroup}
            />
            <ContextMenuItem
              label="Detach Instance"
              disabled={!isInstanceSelected}
              onAction={handleDetach}
            />
            <ContextMenuItem
              label="Sync Component"
              disabled={!isInstanceSelected}
              onAction={handleSyncInstance}
            />
            <ContextMenuItem
              label="Publish to Library"
              disabled={!isComponentMasterSelected}
              onAction={handlePublishToLibrary}
            />
            <hr className="layers-context-menu__separator" />
            <ContextMenuItem
              label="Bring to Front"
              shortcut="Ctrl+Shift+]"
              onAction={handleMoveToFront}
            />
            <ContextMenuItem
              label="Send to Back"
              shortcut="Ctrl+Shift+["
              onAction={handleMoveToBack}
            />
            <hr className="layers-context-menu__separator" />
            {contextMenuIsContainer && !contextMenuHasMask && (
              <>
                <ContextMenuItem
                  label="Add Alpha Mask"
                  onAction={() => {
                    addMaskToSelected('alpha');
                    closeMenu();
                  }}
                />
                <ContextMenuItem
                  label="Add Clip Mask"
                  onAction={() => {
                    addMaskToSelected('clip');
                    closeMenu();
                  }}
                />
                <ContextMenuItem
                  label="Add Luminance Mask"
                  onAction={() => {
                    addMaskToSelected('luminance');
                    closeMenu();
                  }}
                />
              </>
            )}
            {contextMenuHasMask && (
              <>
                <ContextMenuItem
                  label="Remove Mask"
                  onAction={() => {
                    removeMaskFromSelected();
                    closeMenu();
                  }}
                />
                <ContextMenuItem
                  label="Toggle Mask"
                  onAction={() => {
                    toggleMask();
                    closeMenu();
                  }}
                />
                <ContextMenuItem
                  label="Invert Mask"
                  onAction={() => {
                    invertMask();
                    closeMenu();
                  }}
                />
              </>
            )}
            <hr className="layers-context-menu__separator" />
            {contextMenu && isContainer(state.document.nodes[contextMenu.id] as SceneNode) && (
              <ContextMenuItem label="Collapse Others" onAction={handleCollapseOthers} />
            )}
            {canIsolateContextMenuNode && (
              <ContextMenuItem label="Isolate" onAction={handleIsolate} />
            )}
            <ContextMenuItem label="Lock" onAction={() => handleLockFromMenu(true)} />
            <ContextMenuItem label="Hide" onAction={() => handleVisibilityFromMenu(false)} />
            {contextMenu && (
              <ContextMenuItem
                label={
                  state.document.nodes[contextMenu.id]?.snapExcluded
                    ? 'Include in Snapping'
                    : 'Exclude from Snapping'
                }
                onAction={handleSnapExclusionToggle}
              />
            )}
            <hr className="layers-context-menu__separator" />
            <div className="layers-context-menu__color-tag-section">
              <span className="layers-context-menu__section-label">Color Tag</span>
              <div className="layers-context-menu__color-tag-grid">
                {LAYER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`layers-context-menu__color-tag-btn layers-context-menu__color-tag-btn--${c}`}
                    aria-label={COLOR_LABELS[c]}
                    onClick={() => handleSetLayerColor(c)}
                    title={COLOR_LABELS[c]}
                  />
                ))}
                <button
                  type="button"
                  className="layers-context-menu__color-tag-btn layers-context-menu__color-tag-btn--none"
                  aria-label="No color"
                  onClick={() => handleSetLayerColor(null)}
                  title="No color"
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.close} label={undefined} />
                </button>
              </div>
            </div>
            <hr className="layers-context-menu__separator" />
            <ContextMenuItem label="Select Same Type" onAction={handleSelectSameType} />
            <ContextMenuItem label="Select Same Color" onAction={handleSelectSameLayerColor} />
            <ContextMenuItem label="Select All of Type" onAction={handleSelectAllOfType} />
            <hr className="layers-context-menu__separator" />
            <ContextMenuItem label="Reveal on Canvas" onAction={handleRevealOnCanvas} />
            <ContextMenuItem
              label="Reveal in Layers panel"
              onAction={() => {
                if (state.selection.length > 0) {
                  updateSettings({ layers: { autoReveal: true } });
                  document
                    .querySelector('.layers-panel__tree')
                    ?.querySelector('[role="treeitem"][aria-selected="true"]')
                    ?.scrollIntoView({ block: 'nearest' });
                }
                closeMenu();
              }}
            />
          </div>,
          document.body,
        )}

      <div className="layers-panel__variables">
        <VariablePanel />
      </div>
    </div>
  );
}

interface ContextMenuItemProps {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onAction: () => void;
}

function ContextMenuItem({ label, shortcut, disabled, onAction }: ContextMenuItemProps) {
  return (
    <button
      type="button"
      className="layers-context-menu__item"
      role="menuitem"
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onAction}
    >
      <span>{label}</span>
      {shortcut && <span className="layers-context-menu__shortcut">{shortcut}</span>}
    </button>
  );
}
