/**
 * useTreeFocus — tracks the roving-tabindex index and range-select anchor.
 *
 * `focusIdx` drives which row's treeitem gets tabIndex={0} (every other row
 * gets -1) in LayersTree/LayersRow, and LayersTree's own effect moves actual
 * DOM focus to match when the user is already navigating inside the tree.
 * Arrow keys move focusIdx; for multi-select, `anchorIdx` tracks the range
 * start so Shift+click and Shift+Arrow extend the selection from there.
 *
 * Research basis: APG Tree View pattern — roving tabindex over
 * aria-activedescendant, since real per-item DOM focus is what drag-and-drop
 * interoperability and native Tab-into-tree behavior need.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface TreeFocusState {
  focusIdx: number;
  anchorIdx: number;
  setFocusIdx: (i: number) => void;
  setAnchorIdx: (i: number) => void;
  moveFocus: (delta: number, max: number) => void;
  jumpToStart: () => void;
  jumpToEnd: (max: number) => void;
  resetAnchor: () => void;
}

export function useTreeFocus(entriesLength: number): TreeFocusState {
  const [focusIdx, setFocusIdx] = useState(0);
  const [anchorIdx, setAnchorIdx] = useState(0);

  // Clamp focusIdx and anchorIdx when entries length changes
  const prevLengthRef = useRef(entriesLength);
  useEffect(() => {
    if (entriesLength !== prevLengthRef.current) {
      setFocusIdx((prev) => Math.max(0, Math.min(prev, entriesLength - 1)));
      setAnchorIdx((prev) => Math.max(0, Math.min(prev, entriesLength - 1)));
      prevLengthRef.current = entriesLength;
    }
  }, [entriesLength]);

  const clamp = useCallback((i: number, max: number) => {
    if (max <= 0) return 0;
    return Math.max(0, Math.min(i, max - 1));
  }, []);

  const moveFocus = useCallback(
    (delta: number, max: number) => {
      setFocusIdx((prev) => clamp(prev + delta, max));
    },
    [clamp],
  );

  const jumpToStart = useCallback(() => {
    setFocusIdx(0);
  }, []);

  const jumpToEnd = useCallback((max: number) => {
    setFocusIdx(max > 0 ? max - 1 : 0);
  }, []);

  const resetAnchor = useCallback(() => {
    setAnchorIdx(focusIdx);
  }, [focusIdx]);

  return {
    focusIdx,
    anchorIdx,
    setFocusIdx,
    setAnchorIdx,
    moveFocus,
    jumpToStart,
    jumpToEnd,
    resetAnchor,
  };
}
