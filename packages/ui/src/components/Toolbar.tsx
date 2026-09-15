/**
 * APG toolbar — role="toolbar" with roving tabindex (Strata plan §4.3, §5.3).
 *
 * Arrow keys navigate between tool buttons. The active tool gets tabindex=0.
 *
 * Focus rules:
 * - Focus is moved only when the toolbar itself already contains the current
 *   focus (roving tabindex contract); the toolbar never steals focus on
 *   mount or when the tool set changes.
 * - Disabled buttons are skipped by arrow navigation.
 * - Tabindex is managed imperatively over the rendered buttons, so children
 *   may be arbitrary components (Tooltip wrappers, custom tool buttons) —
 *   there is no prop-coupling to any child API.
 */
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { nextEnabledIndex } from '../utils/focusMovement';

export interface ToolbarProps {
  label: string;
  /**
   * Optional: the floating palette mounts before the workspace config
   * hydrates, so a toolbar can legitimately commit once with no children.
   */
  children?: ReactNode;
  /** Whether arrow navigation wraps from last to first. Defaults to true. */
  wrap?: boolean;
}

const BUTTON_SELECTOR = 'button, a[href]';

export function Toolbar({ label, children, wrap = true }: ToolbarProps) {
  const [focusIdx, setFocusIdx] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const getButtons = useCallback((): HTMLButtonElement[] => {
    const container = toolbarRef.current;
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLButtonElement>(BUTTON_SELECTOR));
  }, []);

  const isDisabledAt = useCallback(
    (i: number) => {
      const el = getButtons()[i];
      return !el || el.hasAttribute('disabled');
    },
    [getButtons],
  );

  // Apply the roving tabindex to the current item and clear it elsewhere.
  //
  // This runs on every render, not only when `focusIdx` changes, because the
  // button set is owned by arbitrary children and can appear or change *after*
  // the first commit (workspace config hydration, conditional rows, mode
  // switches). A focusIdx-only effect silently skipped those commits and left
  // every button at the browser default `tabIndex = 0` — 15 tab stops instead
  // of one. Reading the live DOM keeps the invariant true regardless of when
  // the children arrive.
  //
  // Layout timing (not passive) so the attributes are in place before paint
  // and before any focus can move; the work is a handful of setAttribute
  // calls on the rendered row.
  const applyRovingTabindex = useCallback(() => {
    const buttons = getButtons();
    if (buttons.length === 0) return;
    // Shrunk list: land on the last enabled item rather than a wrapped index.
    // Otherwise keep the current item, or advance past a disabled one so the
    // roving stop is never on a control the user cannot activate.
    let active = Math.min(focusIdx, buttons.length - 1);
    if (isDisabledAt(active)) {
      active = nextEnabledIndex(buttons.length, active, 1, isDisabledAt);
    }
    buttons.forEach((el, i) => {
      if (i === active && !el.hasAttribute('disabled')) {
        el.setAttribute('tabindex', '0');
      } else {
        el.setAttribute('tabindex', '-1');
      }
    });
    if (active !== focusIdx) setFocusIdx(active);
  }, [focusIdx, getButtons, isDisabledAt]);

  useLayoutEffect(() => {
    applyRovingTabindex();
  });

  // Children can also mutate without a Toolbar re-render (a portal, an async
  // icon, a child that owns its own list). Watch the subtree so the one-tab-
  // stop invariant is restored rather than silently broken.
  useEffect(() => {
    const container = toolbarRef.current;
    if (!container || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => applyRovingTabindex());
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [applyRovingTabindex]);

  // Move focus within the toolbar only when focus is already inside it —
  // never steal focus from the document flow on mount.
  useEffect(() => {
    const container = toolbarRef.current;
    if (!container?.contains(document.activeElement)) return;
    const target = getButtons()[focusIdx];
    if (target && !target.hasAttribute('disabled')) {
      target.focus({ preventScroll: true });
    }
  }, [focusIdx, getButtons]);

  const navigate = useCallback(
    (dir: 1 | -1) => {
      const count = getButtons().length;
      if (count <= 0) return;
      setFocusIdx((i) => {
        if (wrap) return nextEnabledIndex(count, i, dir, isDisabledAt);
        for (let step = 1; step < count; step += 1) {
          const k = i + dir * step;
          if (k < 0 || k >= count) return i;
          if (!isDisabledAt(k)) return k;
        }
        return i;
      });
    },
    [wrap, getButtons, isDisabledAt],
  );

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const count = getButtons().length;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          navigate(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          navigate(-1);
          break;
        case 'Home':
          e.preventDefault();
          setFocusIdx((i) => {
            for (let k = 0; k < count; k += 1) {
              if (!isDisabledAt(k)) return k;
            }
            return i;
          });
          break;
        case 'End':
          e.preventDefault();
          setFocusIdx((i) => {
            for (let k = count - 1; k >= 0; k -= 1) {
              if (!isDisabledAt(k)) return k;
            }
            return i;
          });
          break;
      }
    },
    [navigate, getButtons, isDisabledAt],
  );

  // Keep the roving index in sync with the focused button (pointer clicks
  // must not desync the roving tabindex from the real focus position).
  const handleFocusIn = useCallback(() => {
    const active = document.activeElement;
    if (!active || !toolbarRef.current?.contains(active)) return;
    const idx = getButtons().indexOf(active as HTMLButtonElement);
    if (idx >= 0 && idx !== focusIdx) setFocusIdx(idx);
  }, [getButtons, focusIdx]);

  return (
    <div
      ref={toolbarRef}
      className="varve-toolbar"
      role="toolbar"
      aria-label={label}
      onKeyDown={handleKey}
      onFocus={handleFocusIn}
    >
      {children}
    </div>
  );
}
