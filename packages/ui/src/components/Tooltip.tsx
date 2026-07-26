/**
 * Tooltip — APG Tooltip pattern with Floating UI positioning.
 *
 * Research basis: ARIA Authoring Practices Guide — Tooltip pattern
 *   https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
 *
 * Improvements over the previous implementation:
 * - Portaled rendering to document.body to escape overflow:hidden ancestors
 * - Warm-up timing via TooltipProvider (faster adjacent tooltips)
 * - Disabled-reason support for inaccessible disabled controls
 * - Truncation-only mode for text overflow detection
 */

import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface TooltipProps {
  children: ReactNode;
  label: string;
  /** Preferred placement. Defaults to 'top'. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay in ms before showing on hover. Default 300. */
  delay?: number;
  /** Max width of the tooltip. Default 240px. */
  maxWidth?: number;
  /** Keyboard shortcut label shown in the tooltip (e.g., "V" for Select). */
  shortcut?: string;
  /**
   * Explanation shown when the trigger is disabled. When set, the trigger
   * wrapper keeps focusable access and associates the reason via aria-describedby.
   */
  disabledReason?: string;
  /**
   * When true, the tooltip only fires when the trigger's text is visually
   * truncated (scrollWidth > clientWidth). Useful for long layer/file names.
   */
  truncationOnly?: boolean;
}

interface TooltipContextValue {
  /** Timestamp (ms) when the last tooltip in this group was shown, or 0. */
  lastShownAt: number;
  /** Register a show event with the provider. */
  registerShow: () => void;
  /** Read the latest lastShownAt without triggering re-render. */
  getLastShownAt: () => number;
  /** Read the configured warm window (ms) without triggering re-render. */
  getWarmWindow: () => number;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

export interface TooltipProviderProps {
  children: ReactNode;
  /**
   * Duration (ms) after the last tooltip opened during which subsequent
   * tooltips use the warm delay. Default 2000.
   */
  warmWindow?: number;
}

const WARM_DELAY = 100;
const DEFAULT_DELAY = 300;

export function TooltipProvider({ children, warmWindow = 2000 }: TooltipProviderProps) {
  const lastShownAtRef = useRef(0);
  const warmWindowRef = useRef(warmWindow);
  warmWindowRef.current = warmWindow;
  const [lastShownAt, setLastShownAt] = useState(0);
  const registerShow = useCallback(() => {
    const now = Date.now();
    lastShownAtRef.current = now;
    setLastShownAt(now);
  }, []);

  const value = useMemo<TooltipContextValue>(
    () => ({
      lastShownAt,
      registerShow,
      getLastShownAt: () => lastShownAtRef.current,
      getWarmWindow: () => warmWindowRef.current,
    }),
    [lastShownAt, registerShow],
  );

  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>;
}

export function Tooltip({
  children,
  label,
  placement = 'top',
  delay = DEFAULT_DELAY,
  maxWidth = 240,
  shortcut,
  disabledReason,
  truncationOnly = false,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const mountedRef = useRef(true);
  const isTruncatedRef = useRef(false);
  const [posStyle, setPosStyle] = useState<{ left: number; top: number } | null>(null);

  const warmContext = useContext(TooltipContext);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const show = useCallback(
    (immediate = false) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (truncationOnly && !isTruncatedRef.current) return;

      let effectiveDelay = delay;
      if (!immediate && warmContext) {
        const elapsed = Date.now() - warmContext.getLastShownAt();
        if (elapsed < warmContext.getWarmWindow()) {
          effectiveDelay = Math.min(delay, WARM_DELAY);
        }
      }

      if (immediate) {
        if (mountedRef.current) {
          setVisible(true);
          warmContext?.registerShow();
        }
      } else {
        timerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            setVisible(true);
            warmContext?.registerShow();
          }
        }, effectiveDelay);
      }
    },
    [delay, truncationOnly, warmContext],
  );

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (visible && mountedRef.current) {
      setVisible(false);
      setPosStyle(null);
    }
  }, [visible]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const triggerEl = triggerRef.current;
    const tipEl = tooltipRef.current;
    if (!visible || !triggerEl || !tipEl) return;

    const updatePosition = () => {
      computePosition(triggerEl, tipEl, {
        placement,
        middleware: [offset(6), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        setPosStyle({ left: x, top: y });
      });
    };

    const cleanup = autoUpdate(triggerEl, tipEl, updatePosition);
    updatePosition();

    return () => cleanup();
  }, [visible, placement]);

  useEffect(() => {
    if (!visible) return;
    const handler = () => hide();
    document.addEventListener('scroll', handler, true);
    return () => document.removeEventListener('scroll', handler, true);
  }, [visible, hide]);

  const checkTruncation = useCallback(() => {
    if (!truncationOnly) return;
    const el = triggerRef.current;
    if (el) {
      isTruncatedRef.current = el.scrollWidth > el.clientWidth;
    }
  }, [truncationOnly]);

  useEffect(() => {
    if (!truncationOnly) return;
    checkTruncation();
    const el = triggerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(checkTruncation);
    ro.observe(el);
    return () => ro.disconnect();
  }, [truncationOnly, checkTruncation]);

  if (!label) {
    return <>{children}</>;
  }

  const tooltipContent = disabledReason ?? label;
  const describedBy = visible ? tooltipId : undefined;
  const wrapperTabIndex = disabledReason ? 0 : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: tooltip trigger wraps interactive children; hover/focus handlers are for tooltip display only
    <span
      ref={triggerRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      tabIndex={wrapperTabIndex}
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          hide();
        }
      }}
      aria-describedby={describedBy}
    >
      {children}
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className="strata-tooltip"
            style={{
              position: 'fixed',
              left: posStyle?.left ?? 0,
              top: posStyle?.top ?? 0,
              zIndex: 'var(--z-tooltip)' as unknown as number,
              pointerEvents: 'none',
              maxWidth,
            }}
          >
            {tooltipContent}
            {shortcut && !disabledReason && (
              <span className="strata-tip__shortcut">{shortcut}</span>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
