/**
 * FocusTrap — wraps children in a focus-trapping container.
 *
 * Uses the editor hook under the hood; re-exported from @strata/ui for
 * widgets that do not have access to the editor package.
 *
 * Supports:
 * - Initial focus via query selector
 * - Escape to close (via onClose)
 * - Active/inactive toggle
 * - Fallback to container when no focusable children
 *
 * Focus restoration contract: the element focused before the trap activated
 * receives focus back when the trap deactivates OR unmounts — provided focus
 * was still inside the trap at that moment (so a newly opened surface never
 * loses focus to the restore).
 *
 * Research basis: APG Dialog Modal pattern
 */
import { type ReactNode, useEffect, useRef } from 'react';

export interface FocusTrapProps {
  children: ReactNode;
  active?: boolean;
  initialFocus?: string;
  onClose?: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden',
  );
}

function isFocusable(el: HTMLElement): boolean {
  return el.matches(FOCUSABLE_SELECTOR) || el.getAttribute('tabindex') !== null;
}

export function FocusTrap({ children, active = true, initialFocus, onClose }: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const savedActive = document.activeElement as HTMLElement | null;

    let initialTarget: HTMLElement | null = null;
    if (initialFocus) {
      initialTarget = container.querySelector<HTMLElement>(initialFocus);
    }
    if (!initialTarget) {
      const focusable = getFocusable(container);
      initialTarget = focusable[0] ?? null;
    }

    const focusTimer = requestAnimationFrame(() => {
      if (initialTarget) {
        initialTarget.focus({ preventScroll: true });
      } else {
        container.setAttribute('tabindex', '-1');
        container.focus({ preventScroll: true });
        container.removeAttribute('tabindex');
      }
    });

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

      if (e.shiftKey && document.activeElement === first && last) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last && first) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(focusTimer);
      container.removeEventListener('keydown', handleKeyDown);

      // Restore focus to the element focused before the trap activated —
      // on deactivate AND on unmount — only while focus is still inside
      // the trap (never steal focus from a surface that took it).
      if (container.contains(document.activeElement) && savedActive) {
        if (savedActive.isConnected && isFocusable(savedActive)) {
          savedActive.focus({ preventScroll: true });
        }
      }
    };
  }, [active, initialFocus]);

  return (
    <div ref={containerRef} tabIndex={-1} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
