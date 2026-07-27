/**
 * useFocusScope — layered focus-trap stack for nested modals and popovers.
 *
 * When multiple modal layers are open (e.g. a dialog that opens a confirmation
 * sub-dialog), only the topmost scope should trap focus. Closing the topmost
 * scope restores focus to the previous scope, not to the original trigger.
 *
 * Each scope registers a unique ID. Only the scope with the highest insertion
 * order (last registered) is active. When it closes, the next-highest becomes
 * active automatically.
 *
 * Research basis: APG Dialog Modal — nested dialogs
 *   https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 */
import { useCallback, useEffect, useId, useRef } from 'react';

interface ScopeEntry {
  id: string;
  container: HTMLElement;
  previousActive: HTMLElement | null;
  onClose?: () => void;
}

const activeScopes: ScopeEntry[] = [];

function getTopScope(): ScopeEntry | undefined {
  return activeScopes[activeScopes.length - 1];
}

function isTopScope(id: string): boolean {
  const top = getTopScope();
  return top?.id === id;
}

export interface UseFocusScopeOptions {
  /** Called when Escape is pressed while this scope is topmost. */
  onClose?: () => void;
  /** If true, this scope is active and registered. */
  active?: boolean;
  initialFocus?: string;
}

export interface UseFocusScopeResult {
  scopeId: string;
  containerRef: React.RefObject<HTMLElement | null>;
  /** Manually push this scope to the top. */
  activate: () => void;
  /** Manually pop this scope from the stack. */
  deactivate: () => void;
  /** True if this scope is currently the topmost. */
  isTop: () => boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

export function useFocusScope({
  onClose,
  active = true,
  initialFocus,
}: UseFocusScopeOptions = {}): UseFocusScopeResult {
  const id = useId();
  const containerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const initialFocusRef = useRef(initialFocus);
  onCloseRef.current = onClose;

  const isTop = useCallback(() => isTopScope(id), [id]);

  const activate = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const existing = activeScopes.find((s) => s.id === id);
    if (existing) return;

    activeScopes.push({
      id,
      container,
      previousActive: document.activeElement as HTMLElement,
      onClose: onCloseRef.current,
    });
  }, [id]);

  const deactivate = useCallback(() => {
    const idx = activeScopes.findIndex((s) => s.id === id);
    if (idx < 0) return;

    const entry = activeScopes[idx];
    activeScopes.splice(idx, 1);

    const prev = entry.previousActive;
    if (prev && document.contains(prev)) {
      requestAnimationFrame(() => {
        prev.focus({ preventScroll: true });
      });
    }
  }, [id]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    activate();

    if (initialFocusRef.current) {
      const target = container.querySelector<HTMLElement>(initialFocusRef.current);
      requestAnimationFrame(() => {
        target?.focus({ preventScroll: true });
      });
    } else {
      const focusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      requestAnimationFrame(() => {
        focusable?.focus({ preventScroll: true });
      });
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTopScope(id)) return;
      if (e.key === 'Escape' && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null);
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
      deactivate();
    };
  }, [active, id, activate, deactivate]);

  return { scopeId: id, containerRef, activate, deactivate, isTop };
}
