import { useEffect, useRef } from 'react';

export interface FocusTrapProps {
  children: React.ReactNode;
  active?: boolean;
  initialFocus?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';

export function FocusTrap({ children, active = true, initialFocus }: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    function getFocusable(): HTMLElement[] {
      return Array.from(container!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
      );
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active]);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    const timeoutId = setTimeout(() => {
      if (initialFocus) {
        const target = container.querySelector<HTMLElement>(initialFocus);
        target?.focus();
      } else {
        const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        const firstFocusable = Array.from(focusable).find(
          (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
        );
        firstFocusable?.focus();
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [active, initialFocus]);

  return (
    <div ref={containerRef} tabIndex={-1}>
      {children}
    </div>
  );
}
