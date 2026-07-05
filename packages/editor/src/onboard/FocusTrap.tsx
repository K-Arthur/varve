import { type ReactNode, useEffect, useRef } from 'react';

interface FocusTrapProps {
  children: ReactNode;
  active?: boolean;
  onClose?: () => void;
  initialFocus?: string;
}

export function FocusTrap({ children, active = true, onClose, initialFocus }: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = container.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    const target = initialFocus ? container.querySelector<HTMLElement>(initialFocus) : null;
    (target ?? container.querySelector<HTMLElement>(focusableSelector))?.focus();

    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [active, onClose, initialFocus]);

  return <div ref={containerRef}>{children}</div>;
}
