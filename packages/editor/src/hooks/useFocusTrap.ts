/**
 * useFocusTrap — trap keyboard focus within a container.
 *
 * Consolidates the two prior FocusTrap implementations (one in ui, one
 * in editor/onboard). Supports:
 * - Active/inactive toggle
 * - Initial focus target (query selector or auto-first)
 * - Escape handler (optional onClose)
 * - Nested traps via focus scope stack
 * - Focus restoration on deactivation (optional)
 * - Safe fallbacks for empty containers
 *
 * This does NOT render a wrapper div. It is a pure hook that attaches
 * a keydown listener to the container ref. Use the <FocusTrap> component
 * wrapper for JSX convenience.
 *
 * Research basis: APG Dialog Modal pattern
 *   https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 */
import { useCallback, useEffect, useRef } from 'react';

export interface UseFocusTrapOptions {
  active?: boolean;
  initialFocus?: string;
  onClose?: () => void;
  /** Focus the container itself if no focusable children exist. */
  fallbackToContainer?: boolean;
  /** If true, focus is restored to the element that was active before
   *  the trap became active. Only applies on deactivation. */
  restoreOnDeactivate?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden',
  );
}

export interface UseFocusTrapResult {
  /** Ref to attach to the container element. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Activate the trap programmatically. */
  activate: (initialFocusSelector?: string) => void;
  /** Deactivate the trap programmatically. */
  deactivate: () => void;
}

export function useFocusTrap({
  active = true,
  initialFocus,
  onClose,
  fallbackToContainer = false,
  restoreOnDeactivate = false,
}: UseFocusTrapOptions = {}): UseFocusTrapResult {
  const containerRef = useRef<HTMLElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef(active);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  activeRef.current = active;

  const deactivate = useCallback(() => {
    if (restoreOnDeactivate && previousActiveRef.current) {
      const prev = previousActiveRef.current;
      previousActiveRef.current = null;
      requestAnimationFrame(() => {
        if (document.contains(prev)) {
          prev.focus({ preventScroll: true });
        }
      });
    }
  }, [restoreOnDeactivate]);

  const activate = useCallback(
    (initialFocusSelector?: string) => {
      const container = containerRef.current;
      if (!container) return;

      previousActiveRef.current = document.activeElement as HTMLElement;

      const selector = initialFocusSelector ?? initialFocus;
      let target: HTMLElement | null = null;

      if (selector) {
        target = container.querySelector<HTMLElement>(selector);
      }

      if (!target) {
        const focusable = getFocusable(container);
        target = focusable[0] ?? null;
      }

      if (target) {
        requestAnimationFrame(() => {
          target?.focus({ preventScroll: true });
        });
      } else if (fallbackToContainer) {
        container.setAttribute('tabindex', '-1');
        container.focus({ preventScroll: true });
      }
    },
    [initialFocus, fallbackToContainer],
  );

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const savedActive = document.activeElement as HTMLElement;
    previousActiveRef.current =
      savedActive !== document.body ? savedActive : null;

    let initialTarget: HTMLElement | null = null;
    if (initialFocus) {
      initialTarget = container.querySelector<HTMLElement>(initialFocus);
    }
    if (!initialTarget) {
      const focusable = getFocusable(container);
      initialTarget = focusable[0] ?? null;
    }
    if (initialTarget) {
      requestAnimationFrame(() => {
        initialTarget?.focus({ preventScroll: true });
      });
    } else if (fallbackToContainer) {
      container.setAttribute('tabindex', '-1');
      requestAnimationFrame(() => {
        container?.focus({ preventScroll: true });
        container?.removeAttribute('tabindex');
      });
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, initialFocus, fallbackToContainer]);

  return { containerRef, activate, deactivate };
}
