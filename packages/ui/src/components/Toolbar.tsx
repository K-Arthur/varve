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
  useRef,
  useState,
} from 'react';
import { nextEnabledIndex } from '../utils/focusMovement';

export interface ToolbarProps {
  label: string;
  children: ReactNode;
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
  // Runs on focusIdx changes; getButtons reads the live DOM so child-set
  // changes are picked up without a children dependency.
  useEffect(() => {
    getButtons().forEach((el, i) => {
      if (i === focusIdx && !el.hasAttribute('disabled')) {
        el.setAttribute('tabindex', '0');
      } else {
        el.setAttribute('tabindex', '-1');
      }
    });
  }, [focusIdx, getButtons]);

  // Clamp the index when the tool set shrinks.
  useEffect(() => {
    const count = getButtons().length;
    if (count > 0 && focusIdx >= count) setFocusIdx(count - 1);
  }, [focusIdx, getButtons]);

  // Move focus within the toolbar only when focus is already inside it —
  // never steal focus from the document flow on mount. If the current item
  // became disabled, jump to the next enabled one instead.
  useEffect(() => {
    const buttons = getButtons();
    if (buttons[focusIdx]?.hasAttribute('disabled')) {
      const next = nextEnabledIndex(buttons.length, focusIdx, 1, isDisabledAt);
      if (next !== focusIdx) {
        setFocusIdx(next);
        return;
      }
    }
    const container = toolbarRef.current;
    if (!container?.contains(document.activeElement)) return;
    const target = buttons[focusIdx];
    if (target && !target.hasAttribute('disabled')) {
      target.focus({ preventScroll: true });
    }
  }, [focusIdx, getButtons, isDisabledAt]);

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
