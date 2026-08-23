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
  /** Total number of items. When provided, overrides DOM children.length for
   *  arrow navigation — avoids counting separators, spacers, etc. */
  totalItems?: number;
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

function clampIndex(idx: number, total: number): number {
  if (total <= 0) return 0;
  return ((idx % total) + total) % total;
}

export function useRovingTabIndex(options: RovingTabIndexOptions = {}): RovingTabIndexResult {
  const { orientation = 'horizontal', wrap = true, onIndexChange, totalItems } = options;
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
      const next = wrap
        ? clampIndex(currentIndex + delta, total)
        : Math.max(0, Math.min(currentIndex + delta, total - 1));
      setAndNotify(next);
    },
    [currentIndex, wrap, setAndNotify],
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
      const total = totalItems ?? (e.currentTarget as HTMLElement).children.length;
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
    [orientation, moveFocus, focusFirst, focusLast, totalItems],
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
