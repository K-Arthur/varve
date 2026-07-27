/**
 * useFocusRestore — save the current active element and restore focus to it later.
 *
 * Handles:
 * - Trigger unmounted before restore (safe fallback)
 * - Focus stolen by another dialog/panel during the gap
 * - Stale element references
 * - Multiple saves (only the last one is restored)
 *
 * Research basis: APG Dialog pattern — focus restoration
 */
import { useCallback, useRef } from 'react';

export interface FocusRestoreResult {
  /** Save the current active element for later restoration. */
  save: () => void;
  /**
   * Restore focus to the saved element (or fallback. Returns true if focus
   * was restored, false if the element is no longer in the DOM.
   */
  restore: (fallback?: HTMLElement | (() => HTMLElement | null)) => boolean;
  /** The saved element, if any. */
  savedElement: HTMLElement | null;
}

export function useFocusRestore(): FocusRestoreResult {
  const savedRef = useRef<HTMLElement | null>(null);

  const save = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) {
      savedRef.current = active;
    }
  }, []);

  const restore = useCallback(
    (fallback?: HTMLElement | (() => HTMLElement | null)): boolean => {
      const target = savedRef.current;
      savedRef.current = null;

      if (target && document.contains(target)) {
        target.focus({ preventScroll: true });
        return true;
      }

      if (fallback) {
        const fb = typeof fallback === 'function' ? fallback() : fallback;
        if (fb && document.contains(fb)) {
          fb.focus({ preventScroll: true });
          return true;
        }
      }

      return false;
    },
    [],
  );

  return {
    save,
    restore,
    get savedElement() {
      return savedRef.current;
    },
  };
}
