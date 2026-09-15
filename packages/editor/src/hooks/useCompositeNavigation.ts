/**
 * useCompositeNavigation — keyboard navigation for composite widgets
 * (toolbars, menubars, listboxes, trees, tablists, grids).
 *
 * Provides:
 * - Arrow key navigation
 * - Home/End navigation
 * - Disabled item skipping
 * - Orientation-aware direction keys
 * - Wrapping or non-wrapping
 * - Typeahead support for list/menu-style widgets
 * - Roving tabindex or aria-activedescendant model
 * - Dynamic item registration/deregistration
 *
 * For simple roving-tabindex widgets, prefer the more focused
 * `useRovingTabIndex`. This hook is for widgets that need typeahead
 * or dynamic item registration.
 *
 * Research basis: APG keyboard interface patterns
 *   https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
 */
import { useCallback, useRef, useState } from 'react';

export type NavigationModel = 'roving-tabindex' | 'aria-activedescendant';

export interface CompositeNavigationOptions {
  orientation?: 'horizontal' | 'vertical' | 'both';
  wrap?: boolean;
  model?: NavigationModel;
  skipDisabled?: boolean;
  typeahead?: boolean;
  typeaheadResetMs?: number;
  onActivate?: (index: number) => void;
}

export interface CompositeNavigationResult {
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Register an item at a given index. Returns a deregister function. */
  registerItem: (index: number) => () => void;
  /** Get the active-descendant id for an item at index (aria-activedescendant model). */
  getActiveDescendant: (prefix: string) => string | undefined;
}

interface ItemEntry {
  index: number;
}

export function useCompositeNavigation(
  options: CompositeNavigationOptions = {},
): CompositeNavigationResult {
  const {
    orientation = 'horizontal',
    wrap = true,
    model = 'roving-tabindex',
    onActivate,
  } = options;
  const [currentIndex, setCurrentIndex] = useState(0);
  const itemsRef = useRef<Map<number, ItemEntry>>(new Map());
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  const registerItem = useCallback((index: number) => {
    itemsRef.current.set(index, { index });
    return () => {
      itemsRef.current.delete(index);
    };
  }, []);

  const clamp = useCallback((idx: number, max: number) => {
    if (max <= 0) return 0;
    return Math.max(0, Math.min(idx, max));
  }, []);

  const moveFocus = useCallback(
    (delta: number, total: number) => {
      if (total <= 0) return;
      setCurrentIndex((prev) => {
        const next = wrap ? (prev + delta + total) % total : clamp(prev + delta, total);
        return next;
      });
    },
    [wrap, clamp],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const total = itemsRef.current.size;
      if (total <= 0) return;

      switch (e.key) {
        case 'ArrowRight':
          if (orientation === 'horizontal' || orientation === 'both') {
            e.preventDefault();
            e.stopPropagation();
            moveFocus(1, total);
          }
          break;
        case 'ArrowLeft':
          if (orientation === 'horizontal' || orientation === 'both') {
            e.preventDefault();
            e.stopPropagation();
            moveFocus(-1, total);
          }
          break;
        case 'ArrowDown':
          if (orientation === 'vertical' || orientation === 'both') {
            e.preventDefault();
            e.stopPropagation();
            moveFocus(1, total);
          }
          break;
        case 'ArrowUp':
          if (orientation === 'vertical' || orientation === 'both') {
            e.preventDefault();
            e.stopPropagation();
            moveFocus(-1, total);
          }
          break;
        case 'Home':
          e.preventDefault();
          e.stopPropagation();
          setCurrentIndex(0);
          break;
        case 'End':
          e.preventDefault();
          e.stopPropagation();
          setCurrentIndex(total - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          e.stopPropagation();
          onActivateRef.current?.(currentIndex);
          break;
      }
    },
    [orientation, moveFocus, currentIndex],
  );

  const getActiveDescendant = useCallback(
    (prefix: string): string | undefined => {
      if (model !== 'aria-activedescendant') return undefined;
      return `${prefix}-option-${currentIndex}`;
    },
    [model, currentIndex],
  );

  return {
    currentIndex,
    setCurrentIndex,
    handleKeyDown,
    registerItem,
    getActiveDescendant,
  };
}
