// COMPLEXITY: ~103 branch constructs (was 220) — see
// docs/plans/architecture-health-remediation-2026-07-26.md. Keyboard
// navigation lives in useTreeKeyboardNavigation.ts and the virtual row in
// SortableVirtualRow.tsx; next reduction: split the auto-reveal and
// search-index effects into dedicated hooks.

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
 * Keyboard navigation lives in useTreeKeyboardNavigation.ts;
 * SortableVirtualRow lives in SortableVirtualRow.tsx.
 *
 * Research basis: W3C APG Tree View pattern, @tanstack/react-virtual,
 * WICG virtual-scroller principles.
 */

import type { DragEndEvent, DragMoveEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Document, NodeId } from '@varve/scene';
import { getKeyframeCount, getNodesInTimeline, isContainer } from '@varve/scene';
import { EmptyState } from '@varve/ui';
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
import { setInvalidateThumbnailHandler, useEditor } from '../../context';
import {
  getOrCreateParentCache,
  getParentFast,
  isDescendantFast,
  type ParentIndexCache,
} from '../../scene/parentIndexCache';
import { resolvePrimarySelectionId } from '../../selection/selectionContext';
import { loadSettings } from '../../settings';
import type { LayerDropTarget } from './layerDropResolver';
import type { LayerFilterSpec } from './layerFilterTypes';
import { DEFAULT_FILTER } from './layerFilterTypes';
import {
  createSearchIndex,
  type LayerSearchIndex,
  removeFromIndex,
  searchIndex,
  updateIndex,
} from './layerSearchIndex';
import { SortableVirtualRow } from './SortableVirtualRow';
import { computeDocumentDiff, type FlatEntry, useFlatTree } from './useFlatTree';
import { useLayerNavigation } from './useLayerNavigation';
import { useLayersDnD } from './useLayersDnD';
import { sharedThumbnailCache } from './useThumbnail';
import { useTreeFocus } from './useTreeFocus';
import { useTreeKeyboardNavigation } from './useTreeKeyboardNavigation';
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
 * Move planning lives in `layerMovePlan`. Re-exported because these are part
 * of this module's established public surface.
 */
export { computeMultiMoveSteps, isNoOpMove } from './layerMovePlan';

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
 * Drop-target semantics live in `layerDropResolver` so the indicator, the
 * auto-expand timer and the final mutation all read one implementation.
 * Re-exported here because they are part of this module's established public
 * surface.
 */
export {
  computeDropZone,
  type DropClipTarget,
  type LayerDropTarget,
  type LayerDropZone,
  type RowGeometry,
  resolveDropClipTarget,
  resolveLayerDropTarget,
  resolveRootLevelSiblings,
} from './layerDropResolver';

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
  /** Keyboard-triggered context menu (Shift+F10 / Menu key) for the focused row. */
  onContextMenuKeyboard?: (id: NodeId) => void;
  /** Toggle the solo flag on a node (focus mode). */
  onToggleSolo?: (id: NodeId) => void;
}

/** Handlers exposed to the parent DndContext and LayersPanel via ref. */
export interface LayersDnDHandle {
  handleDragStart: (event: DragStartEvent) => void;
  handleDragMove: (event: DragMoveEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: () => void;
  activeId: NodeId | null;
  /**
   * The one resolved answer to "where does this drag land?" — the same value
   * that paints the indicator and that drag end commits. `null` means the
   * pointer is not over the Layers tree at all.
   */
  dropIndicator: LayerDropTarget | null;
  collapseAll: () => void;
  collapseOthers: (containerId: NodeId) => void;
  startRename: (id: NodeId) => void;
  expandAncestors: (nodeId: NodeId) => void;
}

export const LayersTree = forwardRef<LayersDnDHandle, LayersTreeProps>(function LayersTree(
  { filterSpec = DEFAULT_FILTER, onContextMenu, onContextMenuKeyboard, onToggleSolo },
  ref,
) {
  const {
    state,
    isSelected,
    toggleSelection,
    renameNodeById,
    setNodeVisible,
    setNodeLocked,
    reparentNode,
    copyEffectStackToNodes,
    announce,
    revealSelection,
    setSelection,
    setInspectorTab,
    showInspectorSection,
    toggleSectionCollapse,
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
  // True while DOM focus is inside the tree (or was dropped to body by a
  // focused row being removed) — drives focus retargeting after deletes,
  // filtering, and collapse.
  const treeHadFocusRef = useRef(false);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const handleFocusIn = () => {
      treeHadFocusRef.current = true;
    };
    const handleFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !tree.contains(next)) treeHadFocusRef.current = false;
    };
    tree.addEventListener('focusin', handleFocusIn);
    tree.addEventListener('focusout', handleFocusOut);
    return () => {
      tree.removeEventListener('focusin', handleFocusIn);
      tree.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // Return focus to a row after its inline rename ends (the rename input
  // unmounts and drops focus to body otherwise).
  const prevRenamingRef = useRef<NodeId | null>(null);
  useEffect(() => {
    const prev = prevRenamingRef.current;
    prevRenamingRef.current = renamingId;
    if (prev && !renamingId) {
      requestAnimationFrame(() => {
        rowRefs.current.get(prev)?.focus({ preventScroll: true });
      });
    }
  }, [renamingId]);

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

  // Convert selection array to a Set for O(1) lookup in row toggle handlers
  const selectedIdSet = useMemo(() => new Set(state.selection), [state.selection]);
  const handleCopyEffectStack = useCallback(
    (
      sourceId: NodeId,
      kind: import('@varve/scene').EffectStackKind,
      mode: import('@varve/scene').EffectStackTransferMode = 'replace',
    ) => {
      copyEffectStackToNodes(
        sourceId,
        state.selection.filter((id) => id !== sourceId),
        kind,
        mode,
      );
    },
    [copyEffectStackToNodes, state.selection],
  );
  const handleOpenEffectStack = useCallback(
    (id: NodeId, kind: import('@varve/scene').EffectStackKind) => {
      const sectionId = kind === 'layer-effects' ? 'effects' : 'smart-filters';
      setSelection(id, 'layers');
      setInspectorTab('appearance');
      const section = state.sectionVisibility[sectionId];
      if (section?.hidden) {
        showInspectorSection(sectionId);
      } else if (section?.collapsed) {
        toggleSectionCollapse(sectionId);
      }
    },
    [
      setInspectorTab,
      setSelection,
      showInspectorSection,
      state.sectionVisibility,
      toggleSectionCollapse,
    ],
  );
  const handleOpenAdjustment = useCallback(
    (id: NodeId) => {
      setSelection(id, 'layers');
      setInspectorTab('adjustments');
    },
    [setInspectorTab, setSelection],
  );
  const primarySelectionId = useMemo(
    () => resolvePrimarySelectionId(state.document, state.selection, state.primaryId),
    [state.document, state.selection, state.primaryId],
  );

  const entries = useFlatTree(
    state.document,
    expanded,
    filterSpec,
    matchedIds,
    state.workspaceMode === 'print' ? (state.document.activePageId ?? undefined) : undefined,
    state.isolatedNodeId ?? undefined,
    state.masterEditId ?? undefined,
    state.workspaceMode !== 'print' ? state.document.activeDesignCanvasId : undefined,
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

  /** Mounted row elements, for roving-tabindex focus management. */
  const rowRefs = useRef<Map<NodeId, HTMLDivElement>>(new Map());
  /** The scrollable content element — its rect carries the scroll offset. */
  const treeContentRef = useRef<HTMLDivElement | null>(null);

  // Roving tabindex: move actual DOM focus to the newly-focused row whenever
  // focusIdx changes *while the user is already keyboard-navigating inside
  // this tree* (an element within treeRef currently holds focus). Guarded so
  // mounting the panel, or focusIdx changing because selection changed from
  // the canvas, never steals focus from elsewhere in the app.
  const focusedNodeId = entries[focusIdx]?.node.id;
  // Register thumbnail invalidation bridge so context mutation methods
  // (setNodeFill, setNodeSize, etc.) can clear stale thumbnail cache entries.
  useEffect(() => {
    setInvalidateThumbnailHandler((nodeId: string) => {
      sharedThumbnailCache.invalidate(nodeId);
    });
    return () => setInvalidateThumbnailHandler(null);
  }, []);

  useEffect(() => {
    if (!treeHadFocusRef.current) return;
    if (!focusedNodeId) return;
    // Only move focus when the tree owns it, or the focused row was removed
    // and focus fell to body (delete/filter/collapse retarget).
    const active = document.activeElement;
    if (active !== document.body && !treeRef.current?.contains(active)) return;
    rowRefs.current.get(focusedNodeId)?.focus({ preventScroll: true });
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

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // Read inside the drag pipeline, which runs from a document-level pointer
  // listener and must never see a render-stale expansion set.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const virtualizerRef = useRef<{
    scrollToIndex: (index: number, options?: Record<string, unknown>) => void;
    getVirtualItems: () => Array<{ index: number }>;
  } | null>(null);
  virtualizerRef.current = virtualizer as unknown as {
    scrollToIndex: (index: number, options?: Record<string, unknown>) => void;
    getVirtualItems: () => Array<{ index: number }>;
  };
  const focusIdxRef = useRef(focusIdx);
  focusIdxRef.current = focusIdx;

  useLayerNavigation({
    expanded,
    setExpanded,
    parentCacheRef,
    virtualizerRef,
    entriesRef,
    treeRef,
    focusIdxRef,
    setFocusIdx,
  });

  // Sync focus to selection when selection changes externally (e.g. canvas click).
  // Respects the auto-reveal preference: when enabled, scrolls the primary selection
  // into view and expands ancestors; when disabled, only highlights if already visible.
  // Selection changes originating from within the Layers panel (origin === 'layers')
  // are skipped to avoid stealing the user's scroll position during multi-select.
  useEffect(() => {
    if (!loadSettings().layers.autoReveal) return;
    if (state.selectionOrigin === 'layers' || state.selectionOrigin === 'navigation') return;
    if (primarySelectionId) {
      const firstSel = primarySelectionId;
      // Expand ancestors so the selected node is visible in the tree
      setExpanded((prev) => {
        const next = new Set(prev);
        let changed = false;
        let parent = getParentFast(state.document, firstSel, parentCacheRef.current);
        while (parent) {
          if (!next.has(parent)) {
            next.add(parent);
            changed = true;
          }
          parent = getParentFast(state.document, parent, parentCacheRef.current);
        }
        return changed ? next : prev;
      });
      const idx = entries.findIndex((e) => e.node.id === firstSel);
      if (idx >= 0) {
        setFocusIdx(idx);
        virtualizer.scrollToIndex(idx, { align: 'auto' });
      }
    }
  }, [
    primarySelectionId,
    state.selectionOrigin,
    entries,
    setFocusIdx,
    virtualizer,
    state.document,
  ]);

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
      collapseAll(state.document, primarySelectionId ?? undefined, prev, parentCacheRef.current),
    );
  }, [state.document, primarySelectionId]);

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
          toggleSelection(startEntry.node.id, false, 'layers');
          for (let i = start + 1; i <= end; i++) {
            const entry = entries[i];
            if (!entry) throw new Error('entry not found');
            toggleSelection(entry.node.id, true, 'layers');
          }
          return;
        }
      }
      toggleSelection(id, ctrl, 'layers');
      if (!ctrl) {
        setAnchorIdx(entries.findIndex((e) => e.node.id === id));
        // Center and fit the selected node in the canvas viewport.
        revealSelection({ nodeId: id, fit: true });
      }
    },
    [anchorIdx, entries, toggleSelection, setAnchorIdx, revealSelection],
  );

  const handleRenameStart = useCallback((id: NodeId) => {
    setRenamingId(id);
  }, []);

  const handleRename = useCallback(
    (id: NodeId, name: string) => {
      // By id, not `renameSelected`: the row being renamed is not necessarily
      // first in the selection.
      renameNodeById(id, name);
      setRenamingId(null);
    },
    [renameNodeById],
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
    toggleSelection(firstEntry.node.id, false, 'layers');
    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) throw new Error('entry not found');
      toggleSelection(entry.node.id, true, 'layers');
    }
  }, [entries, toggleSelection]);

  const doKeyboardMove = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(focusIdx + delta, entries.length - 1));
      setFocusIdx(next);
      const nextEntry = entries[next];
      if (!nextEntry) throw new Error('next entry not found');
      toggleSelection(nextEntry.node.id, false, 'layers');
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

  const handleTreeFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      treeHadFocusRef.current = true;
      // The tree root is a Tab stop so keyboard users can enter the panel,
      // but APG tree navigation is row-based. Promote the current roving row
      // immediately when focus lands on the root; otherwise the first Arrow
      // key changes state while the browser still reports the root as focused.
      //
      // However, when focus arrives from inside the tree (e.g. Tab from a
      // row back to the root), do NOT promote — that would re-trap focus
      // inside the tree and prevent Tab/Shift+Tab from leaving.
      if (event.target !== event.currentTarget) return;
      const related = event.relatedTarget as HTMLElement | null;
      if (related && event.currentTarget.contains(related)) return;
      const nodeId = entries[focusIdx]?.node.id;
      const row = nodeId ? rowRefs.current.get(nodeId) : undefined;
      row?.focus({ preventScroll: true });
    },
    [entries, focusIdx],
  );

  const { handleKeyDown } = useTreeKeyboardNavigation({
    entries,
    focusIdx,
    expanded,
    doc: state.document,
    isolatedNodeId: state.isolatedNodeId,
    workspaceMode: state.workspaceMode,
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
  });

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

  // Dragging a row that's part of a multi-selection carries the whole
  // selection along (Figma/Sketch/Illustrator convention), not just the row
  // under the pointer.
  const resolveMoveIds = useCallback(
    (activeNodeId: NodeId) =>
      resolveDragMoveIds(
        state.document,
        state.selection,
        entriesRef.current,
        activeNodeId,
        parentCacheRef.current,
      ),
    [state.document, state.selection],
  );

  const {
    activeId,
    dropIndicator,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useLayersDnD({
    doc: state.document,
    designCanvasId:
      state.workspaceMode !== 'print' ? state.document.activeDesignCanvasId : undefined,
    selection: state.selection,
    treeRef,
    treeContentRef,
    virtualizer,
    entriesRef,
    expandedRef,
    parentCacheRef,
    setExpanded,
    resolveMoveIds,
    reparentNode,
    announce,
    beginTransaction,
    commitTransaction,
  });

  // Expose DnD handlers and collapse methods to parent via ref
  useImperativeHandle(
    ref,
    () => ({
      handleDragStart,
      handleDragMove,
      handleDragOver,
      handleDragEnd,
      handleDragCancel,
      activeId,
      dropIndicator,
      collapseAll: handleCollapseAll,
      collapseOthers: handleCollapseOthers,
      startRename: setRenamingId,
      expandAncestors: (nodeId: NodeId) => {
        setExpanded((prev) => {
          const next = new Set(prev);
          let changed = false;
          let parent = getParentFast(state.document, nodeId, parentCacheRef.current);
          while (parent) {
            if (!next.has(parent)) {
              next.add(parent);
              changed = true;
            }
            parent = getParentFast(state.document, parent, parentCacheRef.current);
          }
          if (changed) {
            const idx = entries.findIndex((e) => e.node.id === nodeId);
            if (idx >= 0) {
              setTimeout(() => virtualizer.scrollToIndex(idx, { align: 'auto' }), 0);
            }
          }
          return changed ? next : prev;
        });
      },
    }),
    [
      handleDragStart,
      handleDragMove,
      handleDragOver,
      handleDragEnd,
      handleDragCancel,
      activeId,
      dropIndicator,
      handleCollapseAll,
      handleCollapseOthers,
      setRenamingId,
      state.document,
      entries,
      virtualizer,
    ],
  );

  const isFiltering =
    filterSpec.search !== '' ||
    filterSpec.kinds.length > 0 ||
    Object.values(filterSpec.attributes).some((v) => v !== undefined) ||
    filterSpec.blendModes.length > 0;

  const emptyState = (() => {
    if (entries.length > 0) return null;
    if (!isFiltering) {
      return (
        <div className="layers-panel__empty">
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
    return (
      <div className="layers-panel__empty">
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
  })();

  return (
    <div
      ref={treeRef}
      className="layers-panel__tree"
      role="tree"
      aria-label="Layers"
      aria-multiselectable="true"
      // Keep the tree root in the normal Tab order. Rows still use roving
      // tabindex for arrow navigation, but keyboard users must have a
      // reliable way to reach the panel without guessing its Tab position.
      tabIndex={0}
      onFocus={handleTreeFocus}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      {emptyState}
      <div
        ref={treeContentRef}
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
            const { node, depth, parentId } = entry;
            const parentMask = parentId ? state.document.nodes[parentId]?.mask : undefined;
            const maskRole = parentMask?.sourceNodeId
              ? parentMask.sourceNodeId === node.id
                ? 'source'
                : 'content'
              : undefined;
            const selected = isSelected(node.id);
            const focused = virtualItem.index === focusIdx;
            const isExpanded = expanded.has(node.id);
            const dropClass =
              dropIndicator?.targetId === node.id
                ? `layers-row--drop-${dropIndicator.zone}${dropIndicator.valid ? '' : ' layers-row--drop-invalid'}`
                : '';
            const dropClip = dropIndicator?.targetId === node.id && dropIndicator.clipInto === true;

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
                dropClip={dropClip}
                hasMotion={animatedNodes.has(node.id)}
                keyframeCount={keyframeCounts.get(node.id) ?? 0}
                maskRole={maskRole}
                onToggleExpand={toggleExpand}
                onExpandSubtree={handleExpandSubtree}
                onCollapseSubtree={handleCollapseSubtree}
                onExpandToDepth1={handleExpandToDepth1}
                onSelect={handleSelect}
                onRename={handleRename}
                onRenameStart={handleRenameStart}
                onRenameCommit={handleRenameCommit}
                onRenameCancel={handleRenameCancel}
                onRenameCycle={handleRenameCycle}
                onToggleVisibility={(id) => {
                  // If the clicked node is part of a multi-selection, toggle
                  // all selected nodes (Figma/Sketch behaviour). Otherwise
                  // toggle just the single node.
                  const ids =
                    state.selection.length > 1 && state.selection.includes(id)
                      ? state.selection
                      : [id];
                  const anyVisible = ids.some((sid) => state.document.nodes[sid]?.visible);
                  for (const sid of ids) setNodeVisible(sid, !anyVisible);
                }}
                onToggleSolo={onToggleSolo}
                onToggleLock={(id) => {
                  const ids =
                    state.selection.length > 1 && state.selection.includes(id)
                      ? state.selection
                      : [id];
                  const anyLocked = ids.some((sid) => state.document.nodes[sid]?.locked);
                  for (const sid of ids) setNodeLocked(sid, !anyLocked);
                }}
                onToggleSelectionCheckbox={(id) => {
                  toggleSelection(id, true, 'layers');
                }}
                onFocus={handleRowFocus}
                idx={virtualItem.index}
                siblingIndex={entry.siblingIndex}
                siblingCount={entry.siblingCount}
                rowRefs={rowRefs}
                selectedIds={selectedIdSet}
                onCopyEffectStack={handleCopyEffectStack}
                onOpenEffectStack={handleOpenEffectStack}
                onOpenAdjustment={handleOpenAdjustment}
              />
            );
          })}
        </SortableContext>
      </div>
      {/* Sits after the rows so it neither displaces them nor implies "drop at
          the top"; sticky so it stays reachable once the list is scrolled. */}
      {dropIndicator && dropIndicator.targetId === null ? (
        <div
          className={`layers-panel__drop-root${dropIndicator.valid ? '' : ' layers-panel__drop-root--invalid'}`}
          role="status"
        >
          Move to top level
        </div>
      ) : null}
    </div>
  );
});
