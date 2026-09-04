/**
 * useTreeKeyboardNavigation — extracts the keyboard handler for the APG
 * Tree View from LayersTree, keeping the main component below its
 * cyclomatic-complexity ceiling.
 *
 * Handles: Arrow keys, Home/End, Enter, Space, Ctrl+A, F2, Ctrl+[/],
 * Shift+F10/ContextMenu, Escape (isolation exit), and type-ahead.
 */

import type { Virtualizer } from '@tanstack/react-virtual';
import type { ContainerNode, Document, NodeId } from '@varve/scene';
import { isContainer } from '@varve/scene';
import { useCallback } from 'react';
import type { SelectionOrigin } from '../../context/selectionState';
import { resolveRootLevelSiblings } from './layerDropResolver';
import type { FlatEntry } from './useFlatTree';

interface UseTreeKeyboardNavigationArgs {
  entries: FlatEntry[];
  focusIdx: number;
  expanded: Set<NodeId>;
  doc: Document;
  isolatedNodeId: NodeId | null;
  workspaceMode: string;
  exitIsolation: () => void;
  doKeyboardMove: (delta: number) => void;
  toggleExpand: (id: NodeId) => void;
  toggleSelection: (id: NodeId, additive?: boolean, origin?: SelectionOrigin) => void;
  setFocusIdx: (idx: number) => void;
  setAnchorIdx: (idx: number) => void;
  jumpToStart: () => void;
  jumpToEnd: (length: number) => void;
  selectAll: () => void;
  handleTypeAhead: (
    key: string,
    getName: (i: number) => string,
    currentIdx: number,
    length: number,
  ) => number | null;
  handleRename: (id: NodeId, name: string) => void;
  reparentNode: (id: NodeId, parentId: NodeId | null, toIndex: number) => void;
  announce: (message: string) => void;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  onContextMenuKeyboard?: (id: NodeId, focusedRow?: HTMLElement) => void;
}

export function useTreeKeyboardNavigation({
  entries,
  focusIdx,
  expanded,
  doc,
  isolatedNodeId,
  workspaceMode,
  exitIsolation,
  doKeyboardMove,
  toggleExpand,
  toggleSelection,
  setFocusIdx,
  setAnchorIdx,
  jumpToStart,
  jumpToEnd,
  selectAll,
  handleTypeAhead,
  handleRename,
  reparentNode,
  announce,
  virtualizer,
  onContextMenuKeyboard,
}: UseTreeKeyboardNavigationArgs) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const focused = entries[focusIdx];
        if (focused) {
          // Resolve the row from the event's owner document. A detached
          // Layers window must not query the main application document, and
          // a virtualized row may not exist until the navigation hook has
          // revealed it.
          const active = e.currentTarget.ownerDocument.activeElement as HTMLElement | null;
          const focusedRow =
            active?.closest<HTMLElement>('[data-node-id]') ??
            (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-node-id]');
          onContextMenuKeyboard?.(focused.node.id, focusedRow ?? undefined);
        }
        return;
      }

      // Escape exits isolation/focus view regardless of filter state.
      if (e.key === 'Escape' && isolatedNodeId) {
        e.preventDefault();
        exitIsolation();
        return;
      }

      if (entries.length === 0) return;

      const focusedNode = entries[focusIdx]?.node;

      // Shift+Arrow: extend selection
      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = Math.max(0, Math.min(focusIdx + delta, entries.length - 1));
        setFocusIdx(next);
        const nextEntry = entries[next];
        if (!nextEntry) throw new Error('next entry not found');
        toggleSelection(nextEntry.node.id, true, 'layers');
        virtualizer.scrollToIndex(next, { align: 'auto' });
        return;
      }

      // Arrow navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        doKeyboardMove(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        doKeyboardMove(-1);
        return;
      }

      // Right arrow: expand or step into children
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (focusedNode && isContainer(focusedNode)) {
          if (expanded.has(focusedNode.id)) {
            // Step into first child
            const childId = focusedNode.children[0];
            if (childId) {
              const childIdx = entries.findIndex((e) => e.node.id === childId);
              if (childIdx >= 0) {
                setFocusIdx(childIdx);
                toggleSelection(childId, false, 'layers');
                setAnchorIdx(childIdx);
                virtualizer.scrollToIndex(childIdx, { align: 'auto' });
              }
            }
          } else {
            toggleExpand(focusedNode.id);
          }
        }
        return;
      }

      // Left arrow: collapse or step to parent
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (focusedNode && isContainer(focusedNode) && expanded.has(focusedNode.id)) {
          toggleExpand(focusedNode.id);
        } else if (focusedNode) {
          const parentId = entries[focusIdx]?.parentId;
          if (parentId) {
            const parentIdx = entries.findIndex((e) => e.node.id === parentId);
            if (parentIdx >= 0) {
              setFocusIdx(parentIdx);
              toggleSelection(parentId, false, 'layers');
              setAnchorIdx(parentIdx);
              virtualizer.scrollToIndex(parentIdx, { align: 'auto' });
            }
          }
        }
        return;
      }

      // Home/End
      if (e.key === 'Home') {
        e.preventDefault();
        jumpToStart();
        const homeEntry = entries[0];
        if (!homeEntry) throw new Error('home entry not found');
        toggleSelection(homeEntry.node.id, false, 'layers');
        setAnchorIdx(0);
        virtualizer.scrollToIndex(0, { align: 'start' });
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        jumpToEnd(entries.length);
        const endEntry = entries[entries.length - 1];
        if (!endEntry) throw new Error('end entry not found');
        toggleSelection(endEntry.node.id, false, 'layers');
        setAnchorIdx(entries.length - 1);
        virtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
        return;
      }

      // Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedNode) {
          toggleSelection(focusedNode.id, false, 'layers');
          setAnchorIdx(focusIdx);
        }
        return;
      }

      // Space: toggle selection
      if (e.key === ' ') {
        e.preventDefault();
        if (focusedNode) {
          toggleSelection(focusedNode.id, true, 'layers');
        }
        return;
      }

      // Ctrl+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }

      // F2: rename
      if (e.key === 'F2') {
        e.preventDefault();
        if (focusedNode) {
          handleRename(focusedNode.id, focusedNode.name);
        }
        return;
      }

      // Keyboard reorder: Ctrl+[ move up (visually, toward front-most),
      // Ctrl+] move down (visually, toward back-most).
      if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const focusEntry = entries[focusIdx];
        if (!focusEntry) return;
        const parentId = focusEntry.parentId;
        const designCanvasId = workspaceMode !== 'print' ? doc.activeDesignCanvasId : undefined;
        const siblings = parentId
          ? ((doc.nodes[parentId] as ContainerNode | undefined)?.children ??
            resolveRootLevelSiblings(doc, designCanvasId))
          : resolveRootLevelSiblings(doc, designCanvasId);
        const myIdx = siblings.indexOf(focusEntry.node.id);
        if (myIdx < 0) return;
        // `entries` (panel/visual order) is front-most-first, the reverse of
        // `siblings` (raw document array, back-to-front) — see
        // computeMultiMoveSteps above. Moving "up" visually means moving
        // toward the *end* of the raw array, so the array-index delta is the
        // negation of the visual delta.
        const visualDelta = e.key === '[' ? -1 : 1;
        const rawDelta = -visualDelta;
        const newIdx = myIdx + rawDelta;
        if (newIdx < 0 || newIdx >= siblings.length) return;
        reparentNode(focusEntry.node.id, parentId, newIdx);
        const siblingId = siblings[newIdx];
        if (!siblingId) throw new Error('sibling not found');
        const otherNode = doc.nodes[siblingId];
        announce(
          visualDelta < 0
            ? `Moved ${focusEntry.node.name} above ${otherNode?.name || ''}`
            : `Moved ${focusEntry.node.name} below ${otherNode?.name || ''}`,
        );
        return;
      }

      // Type-ahead: single character
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        const matchIdx = handleTypeAhead(
          e.key,
          (i) => entries[i]?.node.name ?? '',
          focusIdx,
          entries.length,
        );
        if (matchIdx !== null) {
          setFocusIdx(matchIdx);
          const matchEntry = entries[matchIdx];
          if (!matchEntry) throw new Error('match entry not found');
          toggleSelection(matchEntry.node.id, false, 'layers');
          setAnchorIdx(matchIdx);
          virtualizer.scrollToIndex(matchIdx, { align: 'auto' });
        }
      }
    },
    [
      entries,
      focusIdx,
      expanded,
      doc,
      isolatedNodeId,
      workspaceMode,
      exitIsolation,
      doKeyboardMove,
      toggleExpand,
      toggleSelection,
      setFocusIdx,
      setAnchorIdx,
      jumpToStart,
      jumpToEnd,
      selectAll,
      handleTypeAhead,
      handleRename,
      reparentNode,
      announce,
      virtualizer,
      onContextMenuKeyboard,
    ],
  );

  return { handleKeyDown };
}
