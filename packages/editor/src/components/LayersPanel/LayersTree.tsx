/**
 * LayersTree — virtualized APG Tree View with full keyboard navigation,
 * multi-select, expand/collapse, and type-ahead.
 *
 * Keyboard map (APG Tree View, multi-select variant):
 *   ↑↓          — move focus among visible rows
 *   →           — expand (if collapsed) or step into first child
 *   ←           — collapse (if expanded) or step to parent
 *   Home / End  — first / last row
 *   Enter       — select focused node
 *   Space       — toggle selection of focused node (multi-select)
 *   Shift+↑↓    — extend selection range
 *   Ctrl+A      — select all visible
 *   F2          — rename focused node
 *   Type-ahead  — quick-jump to node by name prefix
 *
 * DndContext is provided by the parent (Shell) for cross-panel drag support.
 * This component manages SortableContext and exposes DnD handlers via ref.
 *
 * Research basis: W3C APG Tree View pattern, @tanstack/react-virtual,
 * WICG virtual-scroller principles.
 */

import {
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ContainerNode, Document, NodeId } from '@strata/scene';
import {
  getInstanceStatus,
  getKeyframeCount,
  getNodesInTimeline,
  isContainer,
} from '@strata/scene';
import { EmptyState } from '@strata/ui';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import type React from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useEditor } from '../../context';
import type { DragNodeData } from '../../dnd-types';
import {
  getOrCreateParentCache,
  getParentFast,
  isDescendantFast,
  type ParentIndexCache,
} from '../../scene/parentIndexCache';
import { LayersRow } from './LayersRow';
import type { LayerFilterSpec } from './layerFilterTypes';
import { DEFAULT_FILTER } from './layerFilterTypes';
import {
  createSearchIndex,
  type LayerSearchIndex,
  removeFromIndex,
  searchIndex,
  updateIndex,
} from './layerSearchIndex';
import { usePresence } from './presenceStore';
import { computeDocumentDiff, type FlatEntry, useFlatTree } from './useFlatTree';
import { useTreeFocus } from './useTreeFocus';
import { useTypeAhead } from './useTypeAhead';

// ── Expand/Collapse utilities ───────────────────────────────────────────

export function expandAllDescendants(
  doc: Document,
  containerId: NodeId,
  expanded: Set<NodeId>,
): Set<NodeId> {
  const next = new Set(expanded);

  function walk(id: NodeId) {
    const node = doc.nodes[id];
    if (!node || !isContainer(node)) return;
    if (node.children.length === 0) return;

    next.add(id);
    for (const childId of node.children) {
      const child = doc.nodes[childId];
      if (child && isContainer(child) && child.children.length > 0) {
        walk(childId);
      }
    }
  }

  walk(containerId);
  return next;
}

export function collapseAllDescendants(
  doc: Document,
  containerId: NodeId,
  expanded: Set<NodeId>,
): Set<NodeId> {
  const next = new Set(expanded);

  function removeDescendants(id: NodeId) {
    const node = doc.nodes[id];
    if (!node || !isContainer(node)) return;
    for (const childId of node.children) {
      const child = doc.nodes[childId];
      if (child && isContainer(child)) {
        next.delete(childId);
        removeDescendants(childId);
      }
    }
  }

  next.delete(containerId);
  removeDescendants(containerId);
  return next;
}

export function collapseAll(
  doc: Document,
  selectedId: NodeId | undefined,
  _expanded: Set<NodeId>,
  parentCache?: ParentIndexCache | null,
): Set<NodeId> {
  if (!selectedId) return new Set();

  const ancestors: NodeId[] = [];
  let current: NodeId | undefined | null = selectedId;
  while (current) {
    ancestors.unshift(current);
    current = getParentFast(doc, current, parentCache);
  }

  const next = new Set<NodeId>();
  for (const id of ancestors) {
    const node = doc.nodes[id];
    if (node && isContainer(node)) {
      next.add(id);
    }
  }

  return next;
}

export function collapseOthers(
  doc: Document,
  containerId: NodeId,
  expanded: Set<NodeId>,
  parentCache?: ParentIndexCache | null,
): Set<NodeId> {
  const next = new Set<NodeId>();
  for (const id of expanded) {
    if (isDescendantFast(doc, containerId, id, parentCache) || id === containerId) {
      next.add(id);
    }
  }
  return next;
}

/**
 * Resolve which node ids should actually move when a drag starts on a row
 * that's part of a multi-selection. The whole selection is dragged together
 * (matching Figma/Sketch/Illustrator), but only "top-level" selected ids move
 * directly — a selected node whose parent is also selected is carried along
 * automatically as part of its parent's subtree, and must not be reparented
 * a second time on its own. Falls back to `[activeId]` when the dragged row
 * isn't part of a multi-selection, preserving today's single-item behavior.
 *
 * The returned ids are ordered to match their visual (flattened) order so
 * callers can reparent them one at a time at consecutive target indices.
 */
export function resolveDragMoveIds(
  doc: Document,
  selection: NodeId[],
  entries: FlatEntry[],
  activeId: NodeId,
  parentCache?: ParentIndexCache | null,
): NodeId[] {
  if (selection.length <= 1 || !selection.includes(activeId)) {
    return [activeId];
  }

  const selectedSet = new Set(selection);
  const isTopLevel = (id: NodeId): boolean => {
    let parent = getParentFast(doc, id, parentCache);
    while (parent) {
      if (selectedSet.has(parent)) return false;
      parent = getParentFast(doc, parent, parentCache);
    }
    return true;
  };

  const topLevelSet = new Set(selection.filter(isTopLevel));
  const ordered = entries.filter((e) => topLevelSet.has(e.node.id)).map((e) => e.node.id);
  for (const id of topLevelSet) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

/**
 * Compute (id, index) insertion steps for landing a multi-node move
 * contiguously at `basePosition` in `targetSiblings`, applied as a sequence
 * of single-item splice-style inserts (matching how `reparentNode` is called
 * one node at a time). `moveIdsVisualOrder` must be in panel/entries order
 * (front-most/highest-array-index first, since flattenTree walks children
 * back-to-front) — this function reverses it to ascending array-index order
 * so each call's index composes correctly against the previous ones and the
 * group's original relative order is preserved either way you read it.
 */
export function computeMultiMoveSteps(
  targetSiblings: NodeId[],
  moveIdsVisualOrder: NodeId[],
  basePosition: number,
): Array<{ id: NodeId; index: number }> {
  const shiftCount = moveIdsVisualOrder.filter((id) => {
    const idx = targetSiblings.indexOf(id);
    return idx !== -1 && idx < basePosition;
  }).length;
  const adjustedBase = basePosition - shiftCount;

  const ascendingOrder = [...moveIdsVisualOrder].reverse();
  return ascendingOrder.map((id, i) => ({ id, index: adjustedBase + i }));
}

/**
 * Decide whether the search index can be patched in place or needs a full
 * rebuild, given the previous and current document. `prevIndex` is mutated
 * in place when patching (cheap: only touched nodes are re-tokenized) — the
 * return value is always a fresh object reference so memoized consumers
 * keyed on it (e.g. matchedIds) correctly recompute after a patch.
 */
export function updateSearchIndexIncremental(
  prevDoc: Document | null,
  doc: Document,
  prevIndex: LayerSearchIndex | null,
): LayerSearchIndex {
  if (!prevIndex || !prevDoc) {
    return createSearchIndex(doc);
  }

  const diff = computeDocumentDiff(prevDoc, doc);
  if (diff.structureChanged) {
    return createSearchIndex(doc);
  }
  if (diff.changedNodeIds.length === 0) {
    return prevIndex;
  }

  for (const id of diff.changedNodeIds) {
    const node = doc.nodes[id];
    if (node) updateIndex(prevIndex, id, node);
    else removeFromIndex(prevIndex, id);
  }

  return { ...prevIndex };
}

/**
 * Precompute keyframe counts for every animated node in one pass per
 * document reference. `getKeyframeCount` scans all tracks in all timelines
 * per call — calling it once per row per render (as before) meant that cost
 * scaled with (visible rows × timelines × tracks) on *every* render, not just
 * document changes.
 */
export function computeKeyframeCounts(
  doc: Document,
  animatedNodes: Set<NodeId>,
): Map<NodeId, number> {
  const counts = new Map<NodeId, number>();
  for (const id of animatedNodes) {
    counts.set(id, getKeyframeCount(doc, id));
  }
  return counts;
}

/**
 * Compute the drop zone for a drag-over row from the pointer's relative
 * vertical position within that row (0 = top edge, 1 = bottom edge). The
 * middle third of a container row (and only a container, and never a
 * descendant of the node being dragged — that would create a cycle) is the
 * "into" band; otherwise the row is split top/bottom into before/after.
 */
export function computeDropZone(
  relativeY: number,
  overIsContainer: boolean,
  isDescendant: boolean,
): 'before' | 'after' | 'into' {
  if (overIsContainer && !isDescendant && relativeY > 0.33 && relativeY < 0.67) {
    return 'into';
  }
  return relativeY < 0.5 ? 'before' : 'after';
}

/**
 * The sibling list for "top level of the active page" — NOT doc.rootChildren,
 * which holds each page's contentRoot group id, not page content. Must match
 * what reparentNode resolves a null parentId to, or drop/reorder indices are
 * computed against the wrong list.
 */
export function resolveRootLevelSiblings(doc: Document): NodeId[] {
  const activePage = doc.pages?.find((p) => p.id === doc.activePageId);
  const contentRootId = activePage?.contentRoot;
  const contentRoot = contentRootId ? doc.nodes[contentRootId] : undefined;
  return contentRoot && isContainer(contentRoot) ? contentRoot.children : doc.rootChildren;
}

export function expandToDepth1(
  doc: Document,
  containerId: NodeId,
  expanded: Set<NodeId>,
): Set<NodeId> {
  const next = new Set(expanded);
  const node = doc.nodes[containerId];
  if (!node || !isContainer(node)) return next;
  if (node.children.length === 0) return next;

  next.add(containerId);
  return next;
}

export interface LayersTreeProps {
  filterSpec?: LayerFilterSpec;
  onContextMenu?: (e: React.MouseEvent, id: NodeId) => void;
}

/** Handlers exposed to the parent DndContext and LayersPanel via ref. */
export interface LayersDnDHandle {
  handleDragStart: (event: DragStartEvent) => void;
  handleDragMove: (event: DragMoveEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  activeId: NodeId | null;
  dropIndicator: { nodeId: NodeId; zone: 'before' | 'after' | 'into' } | null;
  collapseAll: () => void;
  collapseOthers: (containerId: NodeId) => void;
}

export const LayersTree = forwardRef<LayersDnDHandle, LayersTreeProps>(function LayersTree(
  { filterSpec = DEFAULT_FILTER, onContextMenu },
  ref,
) {
  const {
    state,
    isSelected,
    toggleSelection,
    renameSelected,
    setNodeVisible,
    setNodeLocked,
    reparentNode,
    announce,
    revealSelection,
    beginTransaction,
    commitTransaction,
    exitIsolation,
  } = useEditor();

  // Pre-expand all containers with children on init so every layer is visible
  // on first paint — no useEffect flicker or collapsed-subtree blindness.
  const [expanded, setExpanded] = useState<Set<NodeId>>(() => {
    const init = new Set<NodeId>();
    for (const [id, node] of Object.entries(state.document.nodes)) {
      const n = node as { kind: string; children?: string[] };
      if ((n.kind === 'frame' || n.kind === 'group') && n.children && n.children.length > 0) {
        init.add(id);
      }
    }
    return init;
  });
  const [renamingId, setRenamingId] = useState<NodeId | null>(null);
  const [activeId, setActiveId] = useState<NodeId | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    nodeId: NodeId;
    zone: 'before' | 'after' | 'into';
  } | null>(null);

  // Search index: patched incrementally on property-only document changes
  // (renames are the common case while a search/filter is active) instead of
  // a full O(n) rebuild on every document reference change. Structural
  // changes (add/remove/reparent) still fall back to a full rebuild.
  const searchIndexRef = useRef<LayerSearchIndex | null>(null);
  const prevDocForIndexRef = useRef<Document | null>(null);
  const searchIdx = useMemo(() => {
    const next = updateSearchIndexIncremental(
      prevDocForIndexRef.current,
      state.document,
      searchIndexRef.current,
    );
    searchIndexRef.current = next;
    prevDocForIndexRef.current = state.document;
    return next;
  }, [state.document]);

  // Pre-compute matched IDs via search index when filtering by name
  const matchedIds = useMemo<Set<NodeId> | undefined>(() => {
    if (!filterSpec.search) return undefined;
    const ids = searchIndex(searchIdx, filterSpec.search);
    return new Set(ids);
  }, [searchIdx, filterSpec.search]);

  // Pre-compute animated nodes for motion indicators
  const animatedNodes = useMemo(() => getNodesInTimeline(state.document), [state.document]);
  const keyframeCounts = useMemo(
    () => computeKeyframeCounts(state.document, animatedNodes),
    [state.document, animatedNodes],
  );

  const entries = useFlatTree(
    state.document,
    expanded,
    filterSpec,
    matchedIds,
    state.document.activePageId ?? undefined,
    state.isolatedNodeId ?? undefined,
  );

  // Dev-mode performance benchmark: log when flatten takes > 50ms
  // (timing is measured inside useFlatTree — this tracks entry count changes)
  const prevEntryCountRef = useRef(entries.length);
  if (process.env.NODE_ENV === 'development' && entries.length > 0) {
    const prevCount = prevEntryCountRef.current;
    if (prevCount !== entries.length) {
      prevEntryCountRef.current = entries.length;
    }
  }

  const treeRef = useRef<HTMLDivElement>(null);
  const { focusIdx, anchorIdx, setFocusIdx, setAnchorIdx, jumpToStart, jumpToEnd } = useTreeFocus(
    entries.length,
  );
  const { handleTypeAhead } = useTypeAhead();

  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rowRefs = useRef<Map<NodeId, HTMLDivElement>>(new Map());
  const autoExpandTimerRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);

  // Roving tabindex: move actual DOM focus to the newly-focused row whenever
  // focusIdx changes *while the user is already keyboard-navigating inside
  // this tree* (an element within treeRef currently holds focus). Guarded so
  // mounting the panel, or focusIdx changing because selection changed from
  // the canvas, never steals focus from elsewhere in the app.
  const focusedNodeId = entries[focusIdx]?.node.id;
  useEffect(() => {
    if (!treeRef.current?.contains(document.activeElement)) return;
    if (!focusedNodeId) return;
    rowRefs.current.get(focusedNodeId)?.focus();
    // Depends on the focused id itself, not the whole `entries` array —
    // useFlatTree's property-only fast path allocates a new `entries`
    // reference on any single-node edit (rename, recolor, ...) even when the
    // node at focusIdx hasn't changed, which would otherwise re-run this on
    // every unrelated edit instead of only on real focus movement.
  }, [focusIdx, focusedNodeId]);

  // Parent index cache for O(1) getParent lookups
  const parentCacheRef = useRef<ParentIndexCache | null>(null);
  parentCacheRef.current = getOrCreateParentCache(state.document, parentCacheRef.current);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => treeRef.current,
    estimateSize: () => 28,
    getItemKey: (i) => {
      const entry = entries[i];
      if (!entry) throw new Error('entry not found');
      return entry.node.id;
    },
    overscan: 10,
  });

  // Sync focus to selection when selection changes externally (e.g. canvas click)
  useEffect(() => {
    if (state.selection.length > 0) {
      const firstSel = state.selection[0];
      if (!firstSel) return;
      const idx = entries.findIndex((e) => e.node.id === firstSel);
      if (idx >= 0) {
        setFocusIdx(idx);
        virtualizer.scrollToIndex(idx, { align: 'auto' });
      }
    }
  }, [state.selection, entries, setFocusIdx, virtualizer]);

  // Keep containers auto-expanded when new nodes are added (e.g. after import or paste).
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const [id, node] of Object.entries(state.document.nodes)) {
        const n = node as { kind: string; children?: string[] };
        if ((n.kind === 'frame' || n.kind === 'group') && n.children && n.children.length > 0) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [state.document.nodes]);

  const toggleExpand = useCallback((id: NodeId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExpandSubtree = useCallback(
    (id: NodeId) => {
      setExpanded((prev) => expandAllDescendants(state.document, id, prev));
    },
    [state.document],
  );

  const handleCollapseSubtree = useCallback(
    (id: NodeId) => {
      setExpanded((prev) => collapseAllDescendants(state.document, id, prev));
    },
    [state.document],
  );

  const handleExpandToDepth1 = useCallback(
    (id: NodeId) => {
      setExpanded((prev) => expandToDepth1(state.document, id, prev));
    },
    [state.document],
  );

  const handleCollapseAll = useCallback(() => {
    setExpanded((prev) =>
      collapseAll(state.document, state.selection[0], prev, parentCacheRef.current),
    );
  }, [state.document, state.selection]);

  const handleCollapseOthers = useCallback(
    (containerId: NodeId) => {
      setExpanded((prev) =>
        collapseOthers(state.document, containerId, prev, parentCacheRef.current),
      );
    },
    [state.document],
  );

  const handleSelect = useCallback(
    (id: NodeId, shift: boolean, ctrl: boolean) => {
      if (shift && anchorIdx >= 0) {
        const clickIdx = entries.findIndex((e) => e.node.id === id);
        if (clickIdx >= 0) {
          const start = Math.min(anchorIdx, clickIdx);
          const end = Math.max(anchorIdx, clickIdx);
          const startEntry = entries[start];
          if (!startEntry) throw new Error('start entry not found');
          toggleSelection(startEntry.node.id, false);
          for (let i = start + 1; i <= end; i++) {
            const entry = entries[i];
            if (!entry) throw new Error('entry not found');
            toggleSelection(entry.node.id, true);
          }
          return;
        }
      }
      toggleSelection(id, ctrl);
      if (!ctrl) {
        setAnchorIdx(entries.findIndex((e) => e.node.id === id));
        // Center and fit the selected node in the canvas viewport.
        revealSelection({ nodeId: id, fit: true });
      }
    },
    [anchorIdx, entries, toggleSelection, setAnchorIdx, revealSelection],
  );

  const handleRenameStart = useCallback((id: NodeId, _name: string) => {
    setRenamingId(id);
  }, []);

  const handleRename = useCallback(
    (_id: NodeId, name: string) => {
      renameSelected(name);
      setRenamingId(null);
    },
    [renameSelected],
  );

  const handleRenameCommit = useCallback(() => {
    setRenamingId(null);
  }, []);

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null);
  }, []);

  const handleRenameCycle = useCallback(
    (direction: 'next' | 'previous') => {
      setRenamingId((currentId) => {
        if (!currentId) return null;
        const idx = entries.findIndex((e) => e.node.id === currentId);
        if (idx < 0) return null;
        const delta = direction === 'next' ? 1 : -1;
        const newIdx = (idx + delta + entries.length) % entries.length;
        const nextEntry = entries[newIdx];
        return nextEntry?.node.id ?? null;
      });
    },
    [entries],
  );

  const selectAll = useCallback(() => {
    if (entries.length === 0) return;
    const firstEntry = entries[0];
    if (!firstEntry) throw new Error('first entry not found');
    toggleSelection(firstEntry.node.id, false);
    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) throw new Error('entry not found');
      toggleSelection(entry.node.id, true);
    }
  }, [entries, toggleSelection]);

  const doKeyboardMove = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(focusIdx + delta, entries.length - 1));
      setFocusIdx(next);
      const nextEntry = entries[next];
      if (!nextEntry) throw new Error('next entry not found');
      toggleSelection(nextEntry.node.id);
      setAnchorIdx(next);
      virtualizer.scrollToIndex(next, { align: 'auto' });
    },
    [focusIdx, entries, setFocusIdx, toggleSelection, setAnchorIdx, virtualizer],
  );

  const handleRowFocus = useCallback(
    (idx: number) => {
      setFocusIdx(idx);
    },
    [setFocusIdx],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Escape exits isolation/focus view regardless of filter state.
      if (e.key === 'Escape' && state.isolatedNodeId) {
        e.preventDefault();
        exitIsolation();
        return;
      }

      if (entries.length === 0) return;

      const focusedNode = entries[focusIdx]?.node;

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

      // Shift+Arrow: extend selection
      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = Math.max(0, Math.min(focusIdx + delta, entries.length - 1));
        setFocusIdx(next);
        const nextEntry = entries[next];
        if (!nextEntry) throw new Error('next entry not found');
        toggleSelection(nextEntry.node.id, true);
        virtualizer.scrollToIndex(next, { align: 'auto' });
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
                toggleSelection(childId);
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
              toggleSelection(parentId);
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
        toggleSelection(homeEntry.node.id);
        setAnchorIdx(0);
        virtualizer.scrollToIndex(0, { align: 'start' });
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        jumpToEnd(entries.length);
        const endEntry = entries[entries.length - 1];
        if (!endEntry) throw new Error('end entry not found');
        toggleSelection(endEntry.node.id);
        setAnchorIdx(entries.length - 1);
        virtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
        return;
      }

      // Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedNode) {
          toggleSelection(focusedNode.id);
          setAnchorIdx(focusIdx);
        }
        return;
      }

      // Space: toggle selection
      if (e.key === ' ') {
        e.preventDefault();
        if (focusedNode) {
          toggleSelection(focusedNode.id, true);
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
          setRenamingId(focusedNode.id);
        }
        return;
      }

      // Keyboard reorder: Ctrl+[ move up, Ctrl+] move down
      if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const focusEntry = entries[focusIdx];
        if (!focusEntry) return;
        const parentId = focusEntry.parentId;
        const doc = state.document;
        const siblings = parentId
          ? ((doc.nodes[parentId] as ContainerNode | undefined)?.children ??
            resolveRootLevelSiblings(doc))
          : resolveRootLevelSiblings(doc);
        const myIdx = siblings.indexOf(focusEntry.node.id);
        if (myIdx < 0) return;
        const delta = e.key === '[' ? -1 : 1;
        const newIdx = myIdx + delta;
        if (newIdx < 0 || newIdx >= siblings.length) return;
        reparentNode(focusEntry.node.id, parentId, newIdx);
        const siblingId = siblings[newIdx];
        if (!siblingId) throw new Error('sibling not found');
        const otherNode = doc.nodes[siblingId];
        announce(
          delta < 0
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
          toggleSelection(matchEntry.node.id);
          setAnchorIdx(matchIdx);
          virtualizer.scrollToIndex(matchIdx, { align: 'auto' });
        }
      }
    },
    [
      entries,
      focusIdx,
      expanded,
      state.document,
      state.isolatedNodeId,
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
    ],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
      const id = el?.dataset.nodeId as NodeId | undefined;
      if (id) {
        onContextMenu?.(e, id);
      }
    },
    [onContextMenu],
  );

  // DnD ----------------------------------------------------------------

  const cancelAutoExpand = useCallback(() => {
    if (autoExpandTimerRef.current !== null) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
  }, []);

  const startAutoExpand = useCallback(
    (nodeId: NodeId) => {
      cancelAutoExpand();
      autoExpandTimerRef.current = window.setTimeout(() => {
        setExpanded((prev) => {
          if (prev.has(nodeId)) return prev;
          const next = new Set(prev);
          next.add(nodeId);
          return next;
        });
        autoExpandTimerRef.current = null;
      }, 600);
    },
    [cancelAutoExpand],
  );

  const cancelAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  const handleAutoScroll = useCallback((pointerY: number) => {
    if (autoScrollRafRef.current !== null) return;
    const container = treeRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const threshold = 80;

    if (pointerY - rect.top < threshold) {
      const speed = ((threshold - (pointerY - rect.top)) / threshold) * 12;
      autoScrollRafRef.current = requestAnimationFrame(() => {
        container.scrollBy(0, -Math.max(1, speed));
        autoScrollRafRef.current = null;
      });
    } else if (rect.bottom - pointerY < threshold) {
      const speed = ((threshold - (rect.bottom - pointerY)) / threshold) * 12;
      autoScrollRafRef.current = requestAnimationFrame(() => {
        container.scrollBy(0, Math.max(1, speed));
        autoScrollRafRef.current = null;
      });
    }
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveId(event.active.id as NodeId);
      cancelAutoScroll();
    },
    [cancelAutoScroll],
  );

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const { activatorEvent, delta } = event;
    if (activatorEvent instanceof MouseEvent || activatorEvent instanceof PointerEvent) {
      lastPointerRef.current = {
        x: activatorEvent.clientX + delta.x,
        y: activatorEvent.clientY + delta.y,
      };
    }
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over, active } = event;
      const overId = over?.id as NodeId | undefined;
      const activeNodeId = active.id as NodeId;
      if (!overId || overId === activeNodeId) {
        setDropIndicator(null);
        cancelAutoExpand();
        return;
      }

      const overEl = rowRefs.current.get(overId);
      if (!overEl) return;

      const rect = overEl.getBoundingClientRect();
      const relativeY = (lastPointerRef.current.y - rect.top) / rect.height;
      const doc = state.document;
      const overNode = doc.nodes[overId];
      const overIsContainer = overNode && isContainer(overNode);

      const isDescendant =
        overIsContainer &&
        (function isAncestor(id: NodeId, target: NodeId): boolean {
          if (id === target) return true;
          const node = doc.nodes[target];
          if (!node || !isContainer(node)) return false;
          return node.children.some((c) => isAncestor(id, c));
        })(activeNodeId, overId);

      const zone = computeDropZone(relativeY, !!overIsContainer, !!isDescendant);
      setDropIndicator({ nodeId: overId, zone });

      if (!isDescendant && overIsContainer && zone === 'into' && !expanded.has(overId)) {
        startAutoExpand(overId);
      } else {
        cancelAutoExpand();
      }

      handleAutoScroll(lastPointerRef.current.y);
    },
    [state.document, expanded, cancelAutoExpand, startAutoExpand, handleAutoScroll],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      cancelAutoExpand();
      cancelAutoScroll();
      if (!over || active.id === over.id) {
        setDropIndicator(null);
        return;
      }
      if (!dropIndicator) {
        setDropIndicator(null);
        return;
      }

      const activeNodeId = active.id as NodeId;
      const overId = over.id as NodeId;
      const { zone } = dropIndicator;
      setDropIndicator(null);

      const doc = state.document;
      const overNode = doc.nodes[overId];
      const activeNode = doc.nodes[activeNodeId];
      if (!overNode || !activeNode) return;

      // Dragging a row that's part of a multi-selection carries the whole
      // selection along (Figma/Sketch/Illustrator convention), not just the
      // row under the pointer.
      const moveIds = resolveDragMoveIds(
        doc,
        state.selection,
        entries,
        activeNodeId,
        parentCacheRef.current,
      );

      // Never drop a moving node's own subtree onto/into itself.
      if (moveIds.some((id) => isDescendantFast(doc, id, overId, parentCacheRef.current))) {
        return;
      }

      const isMulti = moveIds.length > 1;

      if (zone === 'into') {
        const overContainer = doc.nodes[overId];
        const children =
          overContainer && isContainer(overContainer)
            ? (overContainer as ContainerNode).children
            : [];
        const steps = computeMultiMoveSteps(children, moveIds, children.length);

        if (isMulti) beginTransaction();
        for (const step of steps) reparentNode(step.id, overId, step.index);
        if (isMulti) commitTransaction();

        announce(
          isMulti
            ? `Moved ${moveIds.length} layers into ${overNode.name}`
            : `Moved ${activeNode.name} into ${overNode.name}`,
        );
        return;
      }

      const overEntry = entries.find((e) => e.node.id === overId);
      const targetParentId = overEntry?.parentId ?? null;
      const targetSiblings = targetParentId
        ? ((doc.nodes[targetParentId] as ContainerNode | undefined)?.children ??
          resolveRootLevelSiblings(doc))
        : resolveRootLevelSiblings(doc);

      let overIdx = targetSiblings.indexOf(overId);
      if (overIdx < 0) overIdx = targetSiblings.length;

      const basePosition = zone === 'before' ? overIdx : overIdx + 1;
      const steps = computeMultiMoveSteps(targetSiblings, moveIds, basePosition);

      if (isMulti) beginTransaction();
      for (const step of steps) reparentNode(step.id, targetParentId, step.index);
      if (isMulti) commitTransaction();

      announce(
        isMulti
          ? `Moved ${moveIds.length} layers ${zone === 'before' ? 'above' : 'below'} ${overNode.name}`
          : zone === 'before'
            ? `Moved ${activeNode.name} above ${overNode.name}`
            : `Moved ${activeNode.name} below ${overNode.name}`,
      );
    },
    [
      state.document,
      state.selection,
      entries,
      dropIndicator,
      reparentNode,
      announce,
      cancelAutoExpand,
      cancelAutoScroll,
      beginTransaction,
      commitTransaction,
    ],
  );

  // Expose DnD handlers and collapse methods to parent via ref
  useImperativeHandle(
    ref,
    () => ({
      handleDragStart,
      handleDragMove,
      handleDragOver,
      handleDragEnd,
      activeId,
      dropIndicator,
      collapseAll: handleCollapseAll,
      collapseOthers: handleCollapseOthers,
    }),
    [
      handleDragStart,
      handleDragMove,
      handleDragOver,
      handleDragEnd,
      activeId,
      dropIndicator,
      handleCollapseAll,
      handleCollapseOthers,
    ],
  );

  const isFiltering =
    filterSpec.search !== '' ||
    filterSpec.kinds.length > 0 ||
    Object.values(filterSpec.attributes).some((v) => v !== undefined) ||
    filterSpec.blendModes.length > 0;

  if (entries.length === 0 && !isFiltering) {
    return (
      <div className="layers-panel__empty" role="tree" aria-label="Layers">
        <EmptyState
          illustration={
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <title>No layers</title>
              <rect x="8" y="6" width="32" height="10" rx="2" opacity="0.6" />
              <rect x="8" y="20" width="32" height="10" rx="2" opacity="0.4" />
              <rect x="8" y="34" width="32" height="10" rx="2" opacity="0.2" />
            </svg>
          }
          headline="No layers yet"
          description="Add a shape to get started"
        />
      </div>
    );
  }

  if (entries.length === 0 && isFiltering) {
    return (
      <div className="layers-panel__empty" role="tree" aria-label="Layers">
        <EmptyState
          illustration={
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <title>No results</title>
              <circle cx="20" cy="20" r="10" opacity="0.4" />
              <line x1="27" y1="27" x2="36" y2="36" opacity="0.4" />
            </svg>
          }
          headline="No results found"
          description="No layers match the current filters"
        />
      </div>
    );
  }

  const activeEntry = activeId ? entries.find((e) => e.node.id === activeId) : null;

  return (
    <>
      <div
        ref={treeRef}
        className="layers-panel__tree"
        role="tree"
        aria-label="Layers"
        aria-multiselectable="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          <SortableContext
            items={entries.map((e) => e.node.id)}
            strategy={verticalListSortingStrategy}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const entry = entries[virtualItem.index];
              if (!entry) return null;
              const { node, depth } = entry;
              const selected = isSelected(node.id);
              const focused = virtualItem.index === focusIdx;
              const isExpanded = expanded.has(node.id);
              const dropClass =
                dropIndicator?.nodeId === node.id ? `layers-row--drop-${dropIndicator.zone}` : '';

              return (
                <SortableVirtualRow
                  key={virtualItem.key}
                  node={node}
                  depth={depth}
                  selected={selected}
                  focused={focused}
                  expanded={isExpanded}
                  editing={renamingId === node.id}
                  virtualItem={virtualItem}
                  virtualizer={virtualizer}
                  dropClass={dropClass}
                  hasMotion={animatedNodes.has(node.id)}
                  keyframeCount={keyframeCounts.get(node.id) ?? 0}
                  onToggleExpand={toggleExpand}
                  onExpandSubtree={handleExpandSubtree}
                  onCollapseSubtree={handleCollapseSubtree}
                  onExpandToDepth1={handleExpandToDepth1}
                  onSelect={handleSelect}
                  onRename={handleRenameStart}
                  onRenameCommit={handleRenameCommit}
                  onRenameCancel={handleRenameCancel}
                  onRenameCycle={handleRenameCycle}
                  onToggleVisibility={(id) => {
                    const n = state.document.nodes[id];
                    if (n) setNodeVisible(id, !n.visible);
                  }}
                  onToggleLock={(id) => {
                    const n = state.document.nodes[id];
                    if (n) setNodeLocked(id, !n.locked);
                  }}
                  onFocus={handleRowFocus}
                  idx={virtualItem.index}
                  rowRefs={rowRefs}
                />
              );
            })}
          </SortableContext>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeEntry && (
          <div className="layers-row layers-row--dragging" style={{ width: 260 }}>
            <LayersRow
              node={activeEntry.node}
              depth={activeEntry.depth}
              selected={false}
              focused={false}
              expanded={false}
              editing={false}
              onToggleExpand={() => {}}
              onSelect={() => {}}
              onRename={() => {}}
              onRenameCommit={() => {}}
              onRenameCancel={() => {}}
              onToggleVisibility={() => {}}
              onToggleLock={() => {}}
              onFocus={() => {}}
              idx={-1}
              onDoubleClickIcon={undefined}
            />
          </div>
        )}
      </DragOverlay>
    </>
  );
});

interface SortableVirtualRowProps {
  node: import('@strata/scene').SceneNode;
  depth: number;
  selected: boolean;
  focused: boolean;
  expanded: boolean;
  editing: boolean;
  virtualItem: import('@tanstack/react-virtual').VirtualItem;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  dropClass: string;
  hasMotion: boolean;
  keyframeCount: number;
  onToggleExpand: (id: NodeId) => void;
  onExpandSubtree: (id: NodeId) => void;
  onCollapseSubtree: (id: NodeId) => void;
  onExpandToDepth1: (id: NodeId) => void;
  onSelect: (id: NodeId, shift: boolean, ctrl: boolean) => void;
  onRename: (id: NodeId, name: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameCycle?: (direction: 'next' | 'previous') => void;
  onToggleVisibility: (id: NodeId) => void;
  onToggleLock: (id: NodeId) => void;
  onFocus: (idx: number) => void;
  idx: number;
  /** Shared map of currently-mounted row elements, keyed by node id — used by
   * the parent's DnD handlers to resolve a row's rect for drop-zone math. */
  rowRefs: React.MutableRefObject<Map<NodeId, HTMLDivElement>>;
}

function SortableVirtualRow({
  node,
  depth,
  selected,
  focused,
  expanded,
  editing,
  virtualItem,
  virtualizer,
  dropClass,
  hasMotion,
  keyframeCount,
  onToggleExpand,
  onExpandSubtree,
  onCollapseSubtree,
  onExpandToDepth1,
  onSelect,
  onRename,
  onRenameCommit,
  onRenameCancel,
  onRenameCycle,
  onToggleVisibility,
  onToggleLock,
  onFocus,
  idx,
  rowRefs,
}: SortableVirtualRowProps) {
  const { state: editorState, revealSelection } = useEditor();
  const presences = usePresence(node.id);
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id,
    data: {
      type: 'layer',
      nodeId: node.id,
      parentId: null, // resolved at drop time
    } satisfies DragNodeData,
  });

  // Resolve variant name for component instances
  const variantName =
    node.kind === 'frame' && node.componentId && node.variant
      ? (() => {
          const comp = editorState.document.components[node.componentId];
          if (!comp?.variants) return undefined;
          const v = comp.variants.find((v) => v.id === node.variant);
          return v?.name;
        })()
      : undefined;

  // Resolve sync status for component instances
  const syncStatus: import('@strata/scene').InstanceStatus | undefined =
    node.kind === 'frame' && node.componentId
      ? (() => {
          try {
            return getInstanceStatus(editorState.document, node.id);
          } catch {
            return undefined;
          }
        })()
      : undefined;

  // CSS.Transform.toString(null) returns undefined; interpolating that yields
  // "undefined translateY(…)" — an invalid transform the browser drops
  // entirely, stacking every row at top:0. Only compose it when present.
  const dndTransform = transform ? CSS.Transform.toString(transform) : '';
  const style = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    transform: isDragging
      ? `translateY(${virtualItem.start}px)`
      : `translateY(${virtualItem.start}px) ${dndTransform}`.trimEnd(),
    transition: `${transition || ''}`,
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <div
      ref={(el) => {
        setSortableRef(el);
        virtualizer.measureElement(el);
        if (el) rowRefs.current.set(node.id, el);
        else rowRefs.current.delete(node.id);
      }}
      data-index={virtualItem.index}
      style={style}
      className={dropClass}
    >
      <LayersRow
        node={node}
        depth={depth}
        selected={selected}
        focused={focused}
        expanded={expanded}
        editing={editing}
        onToggleExpand={onToggleExpand}
        onExpandSubtree={onExpandSubtree}
        onCollapseSubtree={onCollapseSubtree}
        onExpandToDepth1={onExpandToDepth1}
        onSelect={onSelect}
        onRename={onRename}
        onRenameCommit={onRenameCommit}
        onRenameCancel={onRenameCancel}
        onRenameCycle={onRenameCycle}
        onToggleVisibility={onToggleVisibility}
        onToggleLock={onToggleLock}
        onFocus={onFocus}
        idx={idx}
        dragListeners={isDragging ? undefined : listeners}
        dragAttributes={isDragging ? undefined : attributes}
        variantName={variantName}
        hasMotion={hasMotion}
        keyframeCount={keyframeCount}
        syncStatus={syncStatus}
        presences={presences}
        docId={editorState.document.id}
        onDoubleClickIcon={(id) => revealSelection({ nodeId: id, fit: true })}
      />
    </div>
  );
}
