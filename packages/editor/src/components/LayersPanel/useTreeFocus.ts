/**
 * useTreeFocus — manages roving tabindex and anchor for multi-select range.
 *
 * Exactly one row has tabIndex={0} (the "roving" focus). Arrow keys move the
 * focus index. For multi-select, an "anchor" index tracks the range start so
 * Shift+click and Shift+Arrow extend the selection from that anchor.
 *
 * Research basis: APG Tree View pattern — roving tabindex,
 * aria-activedescendant alternative not used because we need focus on each
 * treeitem for drag-and-drop interoperability.
 */
import { useCallback, useState } from 'react';

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

export function useTreeFocus(): TreeFocusState {
  const [focusIdx, setFocusIdx] = useState(0);
  const [anchorIdx, setAnchorIdx] = useState(0);

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
