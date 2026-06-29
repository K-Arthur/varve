/**
 * LayersPanel — container for the layers tree, search/filter, context menu,
 * and embedded VariablePanel.
 *
 * Research basis: W3C APG Tree View, Menu pattern (for context menu).
 */

import type { ContainerNode, NodeId } from '@strata/scene';
import { getParent } from '@strata/scene';
import { CHROME_ICONS, Icon } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../../context';
import { LayersTree } from './LayersTree';
import './layers.css';
import { VariablePanel } from '../../VariablePanel';

export function LayersPanel() {
  const {
    state,
    setSelection,
    removeSelected,
    renameSelected,
    setNodeLocked,
    setNodeVisible,
    reparentNode,
    groupSelected,
    ungroupSelected,
    detachSelected,
    announce,
  } = useEditor();
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    id: NodeId;
  } | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

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

  const clearFilter = useCallback(() => {
    setFilter('');
    filterRef.current?.focus();
  }, []);

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

  const handleMoveToFront = useCallback(() => {
    for (const id of state.selection) {
      const parentId = getParent(state.document, id);
      const siblings = parentId
        ? ((state.document.nodes[parentId] as ContainerNode | undefined)?.children ?? state.document.rootChildren)
        : state.document.rootChildren;
      reparentNode(id, parentId, siblings.length - 1);
      announce('Moved to front');
    }
    closeMenu();
  }, [state.selection, state.document, reparentNode, announce, closeMenu]);

  const handleMoveToBack = useCallback(() => {
    for (const id of state.selection) {
      const parentId = getParent(state.document, id);
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

  const canGroup = state.selection.length >= 2;
  const isGroupSelected = state.selection.length === 1 && state.document.nodes[state.selection[0]!]?.kind === 'group';
  const isInstanceSelected = state.selection.length === 1 && state.document.nodes[state.selection[0]!]?.kind === 'frame' && !!(state.document.nodes[state.selection[0]!] as { componentId?: string }).componentId;

  return (
    <div className="editor-layers layers-panel">
      <div className="layers-panel__header">
        <span>Layers</span>
      </div>

      <div className="layers-panel__filter">
        <Icon name={CHROME_ICONS.search} size="0.85em" aria-hidden />
        <input
          ref={filterRef}
          className="layers-panel__filter-input"
          type="search"
          placeholder="Filter layers..."
          aria-label="Filter layers"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button
            type="button"
            className="layers-panel__filter-clear"
            onClick={clearFilter}
            aria-label="Clear filter"
          >
            <Icon name={CHROME_ICONS.close} size="0.75em" />
          </button>
        )}
      </div>

      <LayersTree filter={filter} onContextMenu={handleContextMenu} />

      {contextMenu && createPortal(
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
          <div className="layers-context-menu__separator" role="separator" />
          <ContextMenuItem
            label="Copy"
            shortcut="Ctrl+C"
            disabled
            onAction={closeMenu}
          />
          <ContextMenuItem
            label="Cut"
            shortcut="Ctrl+X"
            disabled
            onAction={closeMenu}
          />
          <ContextMenuItem
            label="Paste"
            shortcut="Ctrl+V"
            disabled
            onAction={closeMenu}
          />
          <div className="layers-context-menu__separator" role="separator" />
          <ContextMenuItem label="Group" shortcut="Ctrl+G" disabled={!canGroup} onAction={handleGroup} />
          <ContextMenuItem label="Ungroup" shortcut="Ctrl+Shift+G" disabled={!isGroupSelected} onAction={handleUngroup} />
          <ContextMenuItem label="Detach Instance" disabled={!isInstanceSelected} onAction={handleDetach} />
          <div className="layers-context-menu__separator" role="separator" />
          <ContextMenuItem label="Bring to Front" shortcut="Ctrl+Shift+]" onAction={handleMoveToFront} />
          <ContextMenuItem label="Send to Back" shortcut="Ctrl+Shift+[" onAction={handleMoveToBack} />
          <div className="layers-context-menu__separator" role="separator" />
          <ContextMenuItem label="Lock" onAction={() => handleLockFromMenu(true)} />
          <ContextMenuItem label="Hide" onAction={() => handleVisibilityFromMenu(false)} />
        </div>,
        document.body,
      )}

      <div
        style={{
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-2)',
          borderTop: '1px solid var(--color-border-subtle)',
        }}
      >
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
