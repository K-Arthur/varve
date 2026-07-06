/**
 * LayersPanel — container for the layers tree, search/filter, context menu,
 * and embedded VariablePanel.
 *
 * Research basis: W3C APG Tree View, Menu pattern (for context menu).
 */

import type { ContainerNode, LayerColor, NodeId, SceneNode } from '@strata/scene';
import { isContainer } from '@strata/scene';
import { CHROME_ICONS, Icon } from '@strata/ui';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../../context';
import {
  getOrCreateParentCache,
  getParentFast,
  type ParentIndexCache,
} from '../../scene/parentIndexCache';
import { LayerBulkBar } from './LayerBulkBar';
import { LayerFilterBar } from './LayerFilterBar';
import type { LayersDnDHandle } from './LayersTree';
import { LayersTree } from './LayersTree';
import type { LayerFilterSpec } from './layerFilterTypes';
import { DEFAULT_FILTER, isFiltering, nodeMatchesFilter } from './layerFilterTypes';
import './layers.css';
import { VariablePanel } from '../../VariablePanel';

export function LayersPanel({ dndRef }: { dndRef?: React.RefObject<LayersDnDHandle | null> }) {
  const {
    state,
    setSelection,
    removeSelected,
    renameSelected,
    setNodeLocked,
    setNodeVisible,
    setLayerColor,
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
  } = useEditor();
  const [filterSpec, setFilterSpec] = useState<LayerFilterSpec>(DEFAULT_FILTER);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    id: NodeId;
  } | null>(null);

  // Parent index cache for O(1) lookups
  const parentCacheRef = useRef<ParentIndexCache | null>(null);
  parentCacheRef.current = getOrCreateParentCache(state.document, parentCacheRef.current);

  // Compute match count for the filter bar
  const totalCount = useMemo(
    () => Object.keys(state.document.nodes).length,
    [state.document.nodes],
  );
  const matchCount = useMemo(() => {
    if (!isFiltering(filterSpec)) return totalCount;
    let count = 0;
    for (const node of Object.values(state.document.nodes)) {
      if (nodeMatchesFilter(node as SceneNode, filterSpec)) count++;
    }
    return count;
  }, [state.document.nodes, filterSpec, totalCount]);

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
      const n = state.document.nodes[contextMenu.id];
      if (n) {
        const name = prompt('Rename layer', n.name);
        if (name) renameSelected(name);
      }
      closeMenu();
    }
  }, [contextMenu, state.document, renameSelected, closeMenu]);

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
          state.document.rootChildren)
        : state.document.rootChildren;
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
      for (const id of state.selection) setLayerColor(id, color);
      closeMenu();
    },
    [state.selection, setLayerColor, closeMenu],
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

  return (
    <div className="editor-layers layers-panel">
      <div className="layers-panel__header">
        <span>Layers</span>
        <button
          type="button"
          className="layers-panel__collapse-all-btn"
          onClick={handleCollapseAll}
          aria-label="Collapse all layers"
          title="Collapse all"
        >
          <Icon name={CHROME_ICONS.collapseAll} size="0.85em" />
        </button>
      </div>

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
          onDeleteAll={handleBulkDelete}
        />
      )}

      {contextMenu &&
        createPortal(
          <div
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
            {contextMenu && isContainer(state.document.nodes[contextMenu.id] as SceneNode) && (
              <ContextMenuItem label="Collapse Others" onAction={handleCollapseOthers} />
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
                  <Icon name="X" label={undefined} />
                </button>
              </div>
            </div>
            <hr className="layers-context-menu__separator" />
            <ContextMenuItem label="Select Same Type" onAction={handleSelectSameType} />
            <ContextMenuItem label="Select Same Color" onAction={handleSelectSameLayerColor} />
            <ContextMenuItem label="Select All of Type" onAction={handleSelectAllOfType} />
            <hr className="layers-context-menu__separator" />
            <ContextMenuItem label="Reveal on Canvas" onAction={handleRevealOnCanvas} />
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
