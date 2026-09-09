import type { Virtualizer } from '@tanstack/react-virtual';
import type { NodeId } from '@varve/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applySelectionRange, selectionRangeBetween } from '../../selection/selectionRange';
import type { FlatEntry } from './useFlatTree';

const SCRUB_THRESHOLD_PX = 3;
const AUTO_SCROLL_EDGE_PX = 32;
const AUTO_SCROLL_MAX_PX_PER_FRAME = 12;

type SelectionOperation = 'replace' | 'add';

interface ScrubSession {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startIndex: number;
  anchorId: NodeId;
  extentId: NodeId;
  baseSelection: NodeId[];
  operation: SelectionOperation;
  active: boolean;
}

interface UseLayersSelectionScrubArgs {
  entriesRef: React.MutableRefObject<FlatEntry[]>;
  treeRef: React.MutableRefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  selection: readonly NodeId[];
  anchorIdRef: React.MutableRefObject<NodeId | null>;
  setFocusIdx: (index: number) => void;
  setSelectionRefs: (
    selection: readonly NodeId[],
    options?: { primary?: NodeId | null; origin?: 'layers' },
  ) => void;
  announce: (message: string) => void;
}

function pointerTargetIsControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element && Boolean(target.closest('button, input, [contenteditable="true"]'))
  );
}

function rowIndexAtClientY(
  clientY: number,
  entries: readonly FlatEntry[],
  tree: HTMLDivElement,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
): number {
  if (entries.length === 0) return -1;
  const rect = tree.getBoundingClientRect();
  const offset = clientY - rect.top + tree.scrollTop;
  const measurements = virtualizer.measurementsCache;
  let low = 0;
  let high = measurements.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const measurement = measurements[middle];
    if (!measurement) break;
    if (offset < measurement.start) high = middle - 1;
    else if (offset >= measurement.end) low = middle + 1;
    else return Math.max(0, Math.min(measurement.index, entries.length - 1));
  }

  // A pointer can briefly land in a gap while a virtual row is mounting. The
  // nearest measured row is a deterministic fallback until the cache catches
  // up; it never derives geometry from a fixed row-height guess.
  if (measurements.length > 0) {
    const nearest = measurements.reduce((best, measurement) => {
      const distance =
        offset < measurement.start ? measurement.start - offset : offset - measurement.end;
      const bestDistance =
        offset < best.start ? best.start - offset : offset > best.end ? offset - best.end : 0;
      return distance < bestDistance ? measurement : best;
    });
    return Math.max(0, Math.min(nearest.index, entries.length - 1));
  }
  return Math.max(0, Math.min(Math.floor(offset / 28), entries.length - 1));
}

export function useLayersSelectionScrub({
  entriesRef,
  treeRef,
  virtualizer,
  selection,
  anchorIdRef,
  setFocusIdx,
  setSelectionRefs,
  announce,
}: UseLayersSelectionScrubArgs) {
  const sessionRef = useRef<ScrubSession | null>(null);
  const rafRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [previewIds, setPreviewIds] = useState<ReadonlySet<NodeId>>(new Set());

  const updatePreview = useCallback(
    (session: ScrubSession, extentIndex: number) => {
      const entries = entriesRef.current;
      const extent = entries[extentIndex]?.node.id;
      if (!extent) return;
      session.extentId = extent;
      setFocusIdx(extentIndex);
      const range = selectionRangeBetween(
        entries.map((entry) => entry.node),
        session.anchorId,
        extent,
      );
      setPreviewIds(new Set(applySelectionRange(session.baseSelection, range, session.operation)));
    },
    [entriesRef, setFocusIdx],
  );

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const finish = useCallback(
    (cancelled: boolean) => {
      const session = sessionRef.current;
      if (!session) return;
      stopAutoScroll();
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      sessionRef.current = null;
      setPreviewIds(new Set());
      if (cancelled || !session.active) return;

      const entries = entriesRef.current;
      const range = selectionRangeBetween(
        entries.map((entry) => entry.node),
        session.anchorId,
        session.extentId,
      );
      const next = applySelectionRange(session.baseSelection, range, session.operation);
      anchorIdRef.current = session.anchorId;
      setSelectionRefs(next, { primary: session.extentId, origin: 'layers' });
      announce(`${next.length} layer${next.length === 1 ? '' : 's'} selected`);
      suppressClickRef.current = true;
    },
    [anchorIdRef, announce, entriesRef, setSelectionRefs, stopAutoScroll],
  );

  const updateFromPointer = useCallback(
    (session: ScrubSession) => {
      const tree = treeRef.current;
      if (!tree) return;
      const index = rowIndexAtClientY(session.lastY, entriesRef.current, tree, virtualizer);
      if (index < 0) return;
      if (
        !session.active &&
        Math.hypot(session.lastX - session.startX, session.lastY - session.startY) <=
          SCRUB_THRESHOLD_PX &&
        index === session.startIndex
      ) {
        return;
      }
      session.active = true;
      updatePreview(session, index);
    },
    [entriesRef, treeRef, updatePreview, virtualizer],
  );

  const autoScroll = useCallback(() => {
    const session = sessionRef.current;
    const tree = treeRef.current;
    if (!session?.active || !tree) return;
    const rect = tree.getBoundingClientRect();
    const distanceFromTop = session.lastY - rect.top;
    const distanceFromBottom = rect.bottom - session.lastY;
    let velocity = 0;
    if (distanceFromTop < AUTO_SCROLL_EDGE_PX) {
      velocity = -Math.min(
        AUTO_SCROLL_MAX_PX_PER_FRAME,
        AUTO_SCROLL_MAX_PX_PER_FRAME * (1 - Math.max(0, distanceFromTop) / AUTO_SCROLL_EDGE_PX),
      );
    } else if (distanceFromBottom < AUTO_SCROLL_EDGE_PX) {
      velocity = Math.min(
        AUTO_SCROLL_MAX_PX_PER_FRAME,
        AUTO_SCROLL_MAX_PX_PER_FRAME * (1 - Math.max(0, distanceFromBottom) / AUTO_SCROLL_EDGE_PX),
      );
    }
    if (velocity !== 0) {
      tree.scrollTop += velocity;
      updateFromPointer(session);
    }
    rafRef.current = requestAnimationFrame(autoScroll);
  }, [treeRef, updateFromPointer]);

  const handleWindowPointerMove = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      session.lastX = event.clientX;
      session.lastY = event.clientY;
      updateFromPointer(session);
      if (session.active) {
        event.preventDefault();
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(autoScroll);
      }
    },
    [autoScroll, updateFromPointer],
  );

  const handleWindowPointerUp = useCallback(() => finish(false), [finish]);
  const handleWindowPointerCancel = useCallback(() => finish(true), [finish]);
  const handleWindowBlur = useCallback(() => finish(true), [finish]);

  const onSelectionPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.button !== 0 ||
        event.pointerType === 'touch' ||
        pointerTargetIsControl(event.target)
      ) {
        return;
      }
      const row = event.currentTarget;
      const id = row.dataset.nodeId as NodeId | undefined;
      if (!id) return;
      const entries = entriesRef.current;
      const startIndex = entries.findIndex((entry) => entry.node.id === id);
      if (startIndex < 0) return;
      const anchorId = event.shiftKey ? (anchorIdRef.current ?? id) : id;
      const operation: SelectionOperation = event.shiftKey
        ? event.ctrlKey || event.metaKey
          ? 'add'
          : 'replace'
        : event.ctrlKey || event.metaKey
          ? 'add'
          : 'replace';
      const session: ScrubSession = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        startIndex,
        anchorId,
        extentId: id,
        baseSelection: [...selection],
        operation,
        active: false,
      };
      sessionRef.current = session;
      row.setPointerCapture?.(event.pointerId);
      window.addEventListener('pointermove', handleWindowPointerMove, { passive: false });
      window.addEventListener('pointerup', handleWindowPointerUp, { once: true });
      window.addEventListener('pointercancel', handleWindowPointerCancel, { once: true });
      window.addEventListener('blur', handleWindowBlur, { once: true });
    },
    [
      anchorIdRef,
      entriesRef,
      handleWindowBlur,
      handleWindowPointerCancel,
      handleWindowPointerMove,
      handleWindowPointerUp,
      selection,
    ],
  );

  const consumeSelectionClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  useEffect(() => () => finish(true), [finish]);

  return { previewIds, onSelectionPointerDown, consumeSelectionClick };
}
