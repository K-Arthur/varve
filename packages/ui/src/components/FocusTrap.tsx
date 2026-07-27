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

export function FocusTrap({ children, active = true, initialFocus, onClose }: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const activeRef = useRef(active);
  onCloseRef.current = onClose;
  activeRef.current = active;

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
      if (savedActive && document.contains(savedActive) && !activeRef.current) {
        savedActive.focus({ preventScroll: true });
      }
    };
  }, [active, initialFocus]);

  return (
    <div ref={containerRef} tabIndex={-1} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
