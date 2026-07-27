/**
 * useRovingTabIndex — generic roving tabindex for composite widgets.
 *
 * One item in the collection gets tabIndex={0}; all others get tabIndex={-1}.
 * Arrow keys, Home, and End move which item is the "current" (tabbable) one.
 * Supports disabled/hidden item skipping, orientation, wrapping, and
 * dynamic item mutation.
 *
 * Research basis: APG Roving TabIndex pattern
 *   https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_roving_tabindex
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface RovingTabIndexOptions {
  orientation?: 'horizontal' | 'vertical' | 'both';
  wrap?: boolean;
  /** If true, disabled items are skipped during arrow navigation. */
  skipDisabled?: boolean;
  /** If true, hidden items are skipped during arrow navigation. */
  skipHidden?: boolean;
  /** If provided, called when the current index changes. */
  onIndexChange?: (index: number) => void;
}

export interface RovingTabIndexResult {
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  getTabIndex: (index: number, disabled?: boolean, hidden?: boolean) => number;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Move focus by delta (positive = forward, negative = backward). */
  moveFocus: (delta: number, total: number) => void;
  /** Move focus to the first enabled/visible item. */
  focusFirst: (total: number) => void;
  /** Move focus to the last enabled/visible item. */
  focusLast: (total: number) => void;
}

function findNextEnabled(
  currentIndex: number,
  delta: number,
  total: number,
  isDisabled: (i: number) => boolean,
  isHidden: (i: number) => boolean,
): number {
  if (total <= 0) return 0;
  let attempts = 0;
  let idx = currentIndex;
  while (attempts < total) {
    idx = (idx + delta + total) % total;
    if (!isDisabled(idx) && !isHidden(idx)) return idx;
    attempts++;
  }
  return currentIndex;
}

export function useRovingTabIndex({
  orientation = 'horizontal',
  wrap = true,
  skipDisabled = true,
  skipHidden = true,
  onIndexChange,
}: RovingTabIndexOptions = {}): RovingTabIndexResult {
  const [currentIndex, setCurrentIndex] = useState(0);
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;

  const setAndNotify = useCallback((index: number) => {
    setCurrentIndex(index);
    onIndexChangeRef.current?.(index);
  }, []);

  useEffect(() => {
    setCurrentIndex((prev) => prev);
  }, []);

  const getTabIndex = useCallback(
    (index: number, disabled = false, hidden = false): number => {
      if (disabled || hidden) return -1;
      return index === currentIndex ? 0 : -1;
    },
    [currentIndex],
  );

  const moveFocus = useCallback(
    (delta: number, total: number) => {
      if (total <= 0) return;
      if (skipDisabled || skipHidden) {
        const isDisabledFn = skipDisabled ? (i: number) => false : () => false;
        const isHiddenFn = skipHidden ? (i: number) => false : () => false;
        const next = findNextEnabled(currentIndex, delta, total, isDisabledFn, isHiddenFn);
        setAndNotify(next);
      } else {
        const next = wrap
          ? (currentIndex + delta + total) % total
          : Math.max(0, Math.min(currentIndex + delta, total - 1));
        setAndNotify(next);
      }
    },
    [currentIndex, skipDisabled, skipHidden, wrap, setAndNotify],
  );

  const focusFirst = useCallback(
    (total: number) => {
      if (total <= 0) return;
      setAndNotify(0);
    },
    [setAndNotify],
  );

  const focusLast = useCallback(
    (total: number) => {
      if (total <= 0) return;
      setAndNotify(total - 1);
    },
    [setAndNotify],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const total = (e.currentTarget as HTMLElement).children.length;
      switch (e.key) {
        case 'ArrowRight':
          if (orientation === 'horizontal' || orientation === 'both') {
            e.preventDefault();
            moveFocus(1, total);
          }
          break;
        case 'ArrowLeft':
          if (orientation === 'horizontal' || orientation === 'both') {
            e.preventDefault();
            moveFocus(-1, total);
          }
          break;
        case 'ArrowDown':
          if (orientation === 'vertical' || orientation === 'both') {
            e.preventDefault();
            moveFocus(1, total);
          }
          break;
        case 'ArrowUp':
          if (orientation === 'vertical' || orientation === 'both') {
            e.preventDefault();
            moveFocus(-1, total);
          }
          break;
        case 'Home': {
          e.preventDefault();
          focusFirst(total);
          break;
        }
        case 'End': {
          e.preventDefault();
          focusLast(total);
          break;
        }
      }
    },
    [orientation, moveFocus, focusFirst, focusLast],
  );

  return {
    currentIndex,
    setCurrentIndex: setAndNotify,
    getTabIndex,
    handleKeyDown,
    moveFocus,
    focusFirst,
    focusLast,
  };
}
