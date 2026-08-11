/**
 * NestedOverlayContext — allows parent dialogs to detect when a nested
 * overlay (Select, Popover, etc.) is open and defer Escape-to-close.
 *
 * Without this, pressing Escape while a Select is open first closes the
 * Select (via stopPropagation), then the Dialog sees the Escape and closes
 * itself — the user only wanted to dismiss the dropdown, not the dialog.
 */
import { createContext, type ReactNode, useCallback, useContext, useRef } from 'react';

interface NestedOverlayContextValue {
  /** Register an overlay as open. Returns an unregister function. */
  register: () => () => void;
  /** True when at least one nested overlay is currently open. */
  hasOpenOverlay: boolean;
}

const Ctx = createContext<NestedOverlayContextValue | null>(null);

/**
 * Provider that tracks nested overlay count. Intended to wrap a Dialog.
 */
export function NestedOverlayProvider({ children }: { children: ReactNode }) {
  const countRef = useRef(0);
  // Mutable ref (not state) — we never want re-renders from overlay count changes.
  const hasOpen = useRef(false);

  const register = useCallback(() => {
    countRef.current += 1;
    hasOpen.current = true;

    return () => {
      countRef.current = Math.max(0, countRef.current - 1);
      if (countRef.current === 0) {
        hasOpen.current = false;
      }
    };
  }, []);

  const value: NestedOverlayContextValue = {
    register,
    hasOpenOverlay: hasOpen.current,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Hook for overlay components (Select, Popover, etc.) to register their
 * open state with the nearest NestedOverlayProvider (Dialog).
 *
 * Usage:
 *   const unregister = useNestedOverlayRegistration();
 *   useEffect(() => {
 *     if (open) {
 *       const unreg = unregister();
 *       return unreg;
 *     }
 *   }, [open, unregister]);
 */
export function useNestedOverlayRegistration(): () => () => void {
  const ctx = useContext(Ctx);
  // Return a no-op if there's no provider (standalone Select, etc.)
  if (!ctx) return () => () => {};
  return ctx.register;
}

/**
 * Hook for parent components (Dialog) to check if any nested overlay is open.
 * Returns a ref whose `.current` is always up-to-date (no re-renders).
 */
export function useNestedOverlayRef(): React.RefObject<boolean> {
  const ctx = useContext(Ctx);
  if (!ctx) return { current: false };
  return { current: ctx.hasOpenOverlay };
}
