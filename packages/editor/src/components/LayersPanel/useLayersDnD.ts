/**
 * The Layers panel's drag-and-drop pipeline.
 *
 * Extracted from LayersTree so the whole gesture — pointer tracking, target
 * resolution, auto-expand, auto-scroll, and the hierarchy mutation — lives in
 * one place and can be reasoned about as a unit. LayersTree keeps the tree
 * rendering; this owns the drag.
 *
 * The invariant the whole module exists to hold:
 *
 *   The location and hierarchy shown under the cursor before release is the
 *   location and hierarchy produced after release.
 *
 * That holds because exactly one value, the `LayerDropTarget` published by
 * `resolveLayerDropTarget`, drives both the preview and the commit. Drag end
 * recomputes nothing.
 */

import type { DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { Document, NodeId } from '@varve/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getParentFast,
  isDescendantFast,
  type ParentIndexCache,
} from '../../scene/parentIndexCache';
import {
  type LayerDropTarget,
  type RowGeometry,
  resolveLayerDropTarget,
  siblingsOf,
} from './layerDropResolver';
import { computeMultiMoveSteps, isNoOpMove } from './layerMovePlan';
import type { FlatEntry } from './useFlatTree';

/**
 * Edge band that triggers auto-scroll, and how fast the tree travels at the
 * very edge of it. Expressed per millisecond so the speed is identical on a
 * 60Hz and a 144Hz display — a frame-count-based step runs more than twice as
 * fast on a high-refresh monitor.
 */
const AUTO_SCROLL_THRESHOLD_PX = 56;
const AUTO_SCROLL_PX_PER_MS = 0.45;
/**
 * Longest frame allowed to contribute to a scroll step. A GC pause or a heavy
 * re-render produces a large `dt`, and without this cap that single frame
 * teleports the list past whatever the user was aiming at.
 */
const AUTO_SCROLL_MAX_FRAME_MS = 32;

/**
 * How long a container row must be hovered before it springs open. Long
 * enough that crossing a collapsed frame on the way somewhere else doesn't
 * expand it, short enough to feel like a deliberate affordance.
 */
const AUTO_EXPAND_DELAY_MS = 500;

/** Structural equality, so an unchanged target does not re-render the tree. */
export function sameDropTarget(a: LayerDropTarget | null, b: LayerDropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.targetId === b.targetId &&
    a.zone === b.zone &&
    a.targetParentId === b.targetParentId &&
    a.insertionIndex === b.insertionIndex &&
    a.clipInto === b.clipInto &&
    a.valid === b.valid &&
    a.reason === b.reason
  );
}

/** The screen-reader sentence for a committed drop. */
export function describeDrop(
  doc: Document,
  target: LayerDropTarget,
  moveIds: NodeId[],
  activeName: string,
): string {
  const count = moveIds.length;
  const subject = count > 1 ? `${count} layers` : activeName;
  if (target.targetId === null) return `Moved ${subject} to the top level`;
  const targetName = doc.nodes[target.targetId]?.name ?? 'layer';
  if (target.clipInto) {
    return count > 1
      ? `Moved ${subject} into the clipping group`
      : `Clipped ${subject} to ${targetName}`;
  }
  if (target.zone === 'into') return `Moved ${subject} into ${targetName}`;
  return `Moved ${subject} ${target.zone === 'before' ? 'above' : 'below'} ${targetName}`;
}

export interface UseLayersDnDArgs {
  doc: Document;
  selection: NodeId[];
  /** The tree's scroll container (the clip viewport). */
  treeRef: React.RefObject<HTMLDivElement | null>;
  /** The scrollable content element — its rect carries the scroll offset. */
  treeContentRef: React.RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Always-current flattened rows, read from inside pointer callbacks. */
  entriesRef: React.RefObject<FlatEntry[]>;
  /** Always-current expansion set, for the same reason. */
  expandedRef: React.RefObject<Set<NodeId>>;
  parentCacheRef: React.RefObject<ParentIndexCache | null>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<NodeId>>>;
  /**
   * Which ids a drag on `activeId` should carry. Supplied by the caller
   * because it depends on the panel's selection semantics.
   */
  resolveMoveIds: (activeId: NodeId) => NodeId[];
  reparentNode: (id: NodeId, newParentId: NodeId | null, toIndex: number) => void;
  announce: (message: string) => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
}

export interface UseLayersDnDResult {
  activeId: NodeId | null;
  dropIndicator: LayerDropTarget | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragMove: (event: DragMoveEvent) => void;
  handleDragOver: () => void;
  handleDragEnd: () => void;
  handleDragCancel: () => void;
}

export function useLayersDnD(args: UseLayersDnDArgs): UseLayersDnDResult {
  const {
    doc,
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
  } = args;

  const [activeId, setActiveId] = useState<NodeId | null>(null);
  const [dropIndicator, setDropIndicator] = useState<LayerDropTarget | null>(null);

  // The live pointer position, read straight off the document rather than
  // reconstructed from dnd-kit's `delta`. dnd-kit folds scroll compensation
  // into that delta, so during auto-scroll the reconstructed point drifts away
  // from the real cursor by exactly the distance scrolled — which is when
  // accurate hit-testing matters most.
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dropIndicatorRef = useRef<LayerDropTarget | null>(null);
  const activeIdRef = useRef<NodeId | null>(null);
  const autoExpandTimerRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollLastTsRef = useRef<number>(0);
  const pointerListenerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const swallowClickRef = useRef<((e: MouseEvent) => void) | null>(null);

  const docRef = useRef(doc);
  docRef.current = doc;

  const cancelAutoExpand = useCallback(() => {
    if (autoExpandTimerRef.current !== null) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
  }, []);

  const startAutoExpand = useCallback(
    (nodeId: NodeId) => {
      if (autoExpandTimerRef.current !== null) return;
      autoExpandTimerRef.current = window.setTimeout(() => {
        autoExpandTimerRef.current = null;
        setExpanded((prev) => {
          if (prev.has(nodeId)) return prev;
          const next = new Set(prev);
          next.add(nodeId);
          return next;
        });
      }, AUTO_EXPAND_DELAY_MS);
    },
    [setExpanded],
  );

  const cancelAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    autoScrollLastTsRef.current = 0;
  }, []);

  /**
   * Snapshot every row's extent for this pointer sample.
   *
   * The virtualizer measures all `count` rows, not just the mounted window,
   * so a row that has scrolled out of view (or has not scrolled in yet) is
   * still addressable. That is what keeps the target stable while auto-scroll
   * mounts and unmounts rows underneath the cursor.
   */
  const readGeometry = useCallback((): RowGeometry[] => {
    const measurements = virtualizer.measurementsCache;
    const geometry: RowGeometry[] = new Array(measurements.length);
    for (let i = 0; i < measurements.length; i++) {
      const m = measurements[i]!;
      geometry[i] = { start: m.start, end: m.end };
    }
    return geometry;
  }, [virtualizer]);

  /**
   * Resolve — and publish — the one authoritative drop target for the current
   * pointer position. Everything downstream (indicator, auto-expand,
   * announcement, mutation) reads the value this writes.
   */
  const refreshDropTarget = useCallback(() => {
    const activeNodeId = activeIdRef.current;
    const container = treeRef.current;
    const content = treeContentRef.current;
    if (!activeNodeId || !container || !content) return;

    const currentDoc = docRef.current;
    const moveIds = resolveMoveIds(activeNodeId);

    // Two constant-cost rect reads per sample. The content element scrolls
    // with the list, so its top edge already carries the scroll offset.
    const viewportRect = container.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    // `reparentNode` refuses a move when the node — or any ancestor — is
    // locked, so the preview has to test the same thing. Testing only the
    // node's own flag let the panel promise a drop that was then silently
    // refused on release, which is the failure mode invalid feedback exists
    // to prevent.
    const isEffectivelyLocked = (nodeId: NodeId): boolean => {
      let current: NodeId | null | undefined = nodeId;
      while (current) {
        if (currentDoc.nodes[current]?.locked === true) return true;
        current = getParentFast(currentDoc, current, parentCacheRef.current);
      }
      return false;
    };

    let target = resolveLayerDropTarget({
      doc: currentDoc,
      entries: entriesRef.current ?? [],
      geometry: readGeometry(),
      pointerY: lastPointerRef.current.y,
      viewport: { top: viewportRect.top, bottom: viewportRect.bottom },
      contentTop: contentRect.top,
      activeIds: moveIds,
      isDescendant: (ancestorId, nodeId) =>
        isDescendantFast(currentDoc, ancestorId, nodeId, parentCacheRef.current),
      isLocked: isEffectivelyLocked,
    });

    // A locked *source* is equally unmovable. Keep the resolved location so
    // the user still sees where it would have gone, just marked invalid.
    if (target?.valid && moveIds.some(isEffectivelyLocked)) {
      target = { ...target, valid: false, reason: 'locked' };
    }

    dropIndicatorRef.current = target;
    setDropIndicator((prev) => (sameDropTarget(prev, target) ? prev : target));

    const expanded = expandedRef.current ?? new Set<NodeId>();
    if (
      target?.valid &&
      target.zone === 'into' &&
      target.targetId &&
      !expanded.has(target.targetId)
    ) {
      startAutoExpand(target.targetId);
    } else {
      cancelAutoExpand();
    }
  }, [
    treeRef,
    treeContentRef,
    entriesRef,
    expandedRef,
    parentCacheRef,
    resolveMoveIds,
    readGeometry,
    cancelAutoExpand,
    startAutoExpand,
  ]);

  const refreshDropTargetRef = useRef(refreshDropTarget);
  refreshDropTargetRef.current = refreshDropTarget;

  /**
   * Continuous, time-based edge scrolling.
   *
   * Scheduling a single rAF per pointer event means holding the cursor still
   * at the panel edge — the entire point of the gesture — scrolls nothing at
   * all. This runs until the pointer leaves the edge band or the drag ends,
   * moves a distance derived from elapsed time, and re-resolves the target
   * every frame so the indicator tracks the rows sliding past under a
   * stationary cursor.
   */
  const runAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) return;

    const step = (ts: number) => {
      autoScrollRafRef.current = null;
      const container = treeRef.current;
      if (!container || !activeIdRef.current) {
        autoScrollLastTsRef.current = 0;
        return;
      }

      const elapsed = autoScrollLastTsRef.current === 0 ? 16 : ts - autoScrollLastTsRef.current;
      const dt = Math.min(elapsed, AUTO_SCROLL_MAX_FRAME_MS);
      autoScrollLastTsRef.current = ts;

      const rect = container.getBoundingClientRect();
      const pointerY = lastPointerRef.current.y;
      const threshold = AUTO_SCROLL_THRESHOLD_PX;
      const withinPanel = pointerY >= rect.top - threshold && pointerY <= rect.bottom + threshold;

      let direction = 0;
      let intensity = 0;
      if (withinPanel && pointerY - rect.top < threshold) {
        direction = -1;
        intensity = Math.min(1, (threshold - (pointerY - rect.top)) / threshold);
      } else if (withinPanel && rect.bottom - pointerY < threshold) {
        direction = 1;
        intensity = Math.min(1, (threshold - (rect.bottom - pointerY)) / threshold);
      }
      // Squared ramp: barely creeping at the outer edge of the band, full
      // speed only right at the panel edge. A linear ramp makes the useful
      // slow range too narrow to aim with.
      intensity *= intensity;

      if (direction === 0) {
        autoScrollLastTsRef.current = 0;
        return;
      }

      container.scrollTop += direction * intensity * AUTO_SCROLL_PX_PER_MS * dt;
      // Rows moved under a possibly stationary pointer: the target the user
      // is being shown has to follow them.
      refreshDropTargetRef.current();
      autoScrollRafRef.current = requestAnimationFrame(step);
    };

    autoScrollRafRef.current = requestAnimationFrame(step);
  }, [treeRef]);

  const detachPointerTracking = useCallback(() => {
    if (pointerListenerRef.current) {
      window.removeEventListener('pointermove', pointerListenerRef.current);
      pointerListenerRef.current = null;
    }
  }, []);

  // The real cursor, straight from the document, for as long as a drag runs.
  const trackPointer = useCallback(
    (event: PointerEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      refreshDropTargetRef.current();
      runAutoScroll();
    },
    [runAutoScroll],
  );

  const trackPointerRef = useRef(trackPointer);
  trackPointerRef.current = trackPointer;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = event.active.id as NodeId;
      activeIdRef.current = id;
      setActiveId(id);
      dropIndicatorRef.current = null;
      setDropIndicator(null);
      cancelAutoScroll();

      const activator = event.activatorEvent;
      if (activator instanceof MouseEvent || activator instanceof PointerEvent) {
        lastPointerRef.current = { x: activator.clientX, y: activator.clientY };
      }
      const listener = (e: PointerEvent) => trackPointerRef.current(e);
      pointerListenerRef.current = listener;
      window.addEventListener('pointermove', listener, { passive: true });
      refreshDropTargetRef.current();
    },
    [cancelAutoScroll],
  );

  // dnd-kit still drives these, but only as an extra tick — the pointer
  // listener above is what keeps the target current, including while the
  // cursor is held still at a scroll edge.
  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { activatorEvent, delta } = event;
      if (
        pointerListenerRef.current === null &&
        (activatorEvent instanceof MouseEvent || activatorEvent instanceof PointerEvent)
      ) {
        lastPointerRef.current = {
          x: activatorEvent.clientX + delta.x,
          y: activatorEvent.clientY + delta.y,
        };
      }
      refreshDropTargetRef.current();
      runAutoScroll();
    },
    [runAutoScroll],
  );

  const handleDragOver = useCallback(() => {
    refreshDropTargetRef.current();
  }, []);

  /**
   * Eat the `click` the browser synthesises on pointer-up at the end of a
   * drag. Without this the dropped row's own onClick runs immediately after
   * the reorder and replaces the selection (or, on a container, toggles it
   * open), so every successful drag was followed by an unasked-for selection
   * change.
   */
  const swallowNextClick = useCallback(() => {
    if (swallowClickRef.current) return;
    const listener = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      window.removeEventListener('click', listener, true);
      swallowClickRef.current = null;
    };
    swallowClickRef.current = listener;
    window.addEventListener('click', listener, true);
    // A drag that ends without a synthetic click (keyboard cancel, pointer
    // released outside the window) must not leave the trap armed.
    window.setTimeout(() => {
      if (swallowClickRef.current === listener) {
        window.removeEventListener('click', listener, true);
        swallowClickRef.current = null;
      }
    }, 0);
  }, []);

  const handleDragEnd = useCallback(() => {
    const activeNodeId = activeIdRef.current;
    setActiveId(null);
    activeIdRef.current = null;
    cancelAutoExpand();
    cancelAutoScroll();
    detachPointerTracking();

    // The target the user was shown, committed verbatim. Nothing is
    // recomputed here: recomputing is exactly how the preview and the
    // mutation used to disagree.
    const target = dropIndicatorRef.current;
    dropIndicatorRef.current = null;
    setDropIndicator(null);
    if (!target?.valid || !activeNodeId) return;

    const currentDoc = docRef.current;
    const activeNode = currentDoc.nodes[activeNodeId];
    if (!activeNode) return;

    const moveIds = resolveMoveIds(activeNodeId);
    const targetParentId = target.targetParentId;

    // Re-check the cycle guard against the document as it stands *now*: a
    // drag outlives several renders and a collaborator (or an auto-expand
    // driven rerender) can move the hierarchy under it.
    if (
      targetParentId &&
      moveIds.some((id) => isDescendantFast(currentDoc, id, targetParentId, parentCacheRef.current))
    ) {
      return;
    }

    const targetSiblings = siblingsOf(currentDoc, targetParentId);
    const steps = computeMultiMoveSteps(targetSiblings, moveIds, target.insertionIndex);
    if (isNoOpMove(targetSiblings, steps)) {
      // Releasing a row where it already sits must not spend an undo step.
      swallowNextClick();
      return;
    }

    const isMulti = moveIds.length > 1;
    if (isMulti) beginTransaction();
    for (const step of steps) reparentNode(step.id, targetParentId, step.index);
    if (isMulti) commitTransaction();

    swallowNextClick();
    announce(describeDrop(currentDoc, target, moveIds, activeNode.name));
  }, [
    parentCacheRef,
    resolveMoveIds,
    reparentNode,
    announce,
    cancelAutoExpand,
    cancelAutoScroll,
    detachPointerTracking,
    swallowNextClick,
    beginTransaction,
    commitTransaction,
  ]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    activeIdRef.current = null;
    dropIndicatorRef.current = null;
    setDropIndicator(null);
    cancelAutoExpand();
    cancelAutoScroll();
    detachPointerTracking();
  }, [cancelAutoExpand, cancelAutoScroll, detachPointerTracking]);

  // A drag can end with the component unmounting (panel detach, page switch).
  // Leaving a window-level pointermove listener behind would keep the whole
  // tree closure alive and keep resolving targets for a drag that is over.
  useEffect(
    () => () => {
      detachPointerTracking();
      cancelAutoExpand();
      cancelAutoScroll();
    },
    [detachPointerTracking, cancelAutoExpand, cancelAutoScroll],
  );

  return {
    activeId,
    dropIndicator,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
