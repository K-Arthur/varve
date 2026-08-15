/**
 * Tooltip — APG Tooltip pattern with Floating UI positioning.
 *
 * Research basis: ARIA Authoring Practices Guide — Tooltip pattern
 *   https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
 *
 * Design goals for Varve's dense professional canvas app:
 * - Portaled rendering to document.body to escape overflow:hidden ancestors.
 * - Warm-up timing via TooltipProvider (faster adjacent tooltips in toolbars).
 * - aria-describedby is placed on the actual focusable trigger, not a wrapper.
 * - Pointer-aware delays: first hover waits, subsequent nearby tooltips warm.
 * - Small close delay to prevent flicker when crossing tiny gaps.
 * - Tooltips are hoverable so users can read them without them disappearing.
 * - Pointer-down / drag / touch suppression so tooltips never open mid-gesture.
 * - Truncation-only mode for ellipsised layer/file/font names.
 * - Reduced-motion and forced-colours safe by default.
 */

import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
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
  /** Primary tooltip text. Shown as the trigger's description unless disabledReason is set. */
  label: string;
  /** Preferred placement. Defaults to 'top'. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay in ms before showing on hover. Default 300. Kept as alias for openDelay. */
  delay?: number;
  /** Delay in ms before showing on hover. Overrides `delay` if both are provided. */
  openDelay?: number;
  /** Delay in ms before hiding after pointer/focus leaves. Default 0. */
  closeDelay?: number;
  /** Max width of the tooltip. Default 240px. */
  maxWidth?: number;
  /** Keyboard shortcut label shown in the tooltip (e.g., "V" for Select). */
  shortcut?: string;
  /**
   * Explanation shown when the trigger is disabled. When the child is disabled
   * with the HTML `disabled` attribute, the trigger is wrapped in a focusable
   * span so the reason remains available to keyboard/screen-reader users.
   */
  disabledReason?: string;
  /**
   * When true, the tooltip only fires when the trigger's text is visually
   * truncated (scrollWidth > clientWidth). Useful for long layer/file names.
   */
  truncationOnly?: boolean;
  /** Controlled open state. When set, the component becomes fully controlled. */
  open?: boolean;
  /** Called when the tooltip opens or closes (controlled mode). */
  onOpenChange?: (open: boolean) => void;
  /**
   * Tabindex forwarded to the focusable trigger. Useful inside roving-tabindex
   * toolbars that expect to manage trigger focusability.
   */
  tabIndex?: number;
  /** Explicit id for the tooltip element. A stable id is generated if omitted. */
  id?: string;
}

interface TooltipContextValue {
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
const POINTER_SUPPRESS_MS = 150;

const supportsPointer = typeof window !== 'undefined' && typeof window.PointerEvent !== 'undefined';

export function TooltipProvider({ children, warmWindow = 2000 }: TooltipProviderProps) {
  const lastShownAtRef = useRef(0);
  const warmWindowRef = useRef(warmWindow);
  warmWindowRef.current = warmWindow;

  const value = useMemo<TooltipContextValue>(
    () => ({
      registerShow: () => {
        lastShownAtRef.current = Date.now();
      },
      getLastShownAt: () => lastShownAtRef.current,
      getWarmWindow: () => warmWindowRef.current,
    }),
    [],
  );

  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>;
}

function useMergedRef<T extends HTMLElement>(
  ownRef: React.MutableRefObject<T | null>,
  incomingRef?: React.Ref<T>,
) {
  return useCallback(
    (node: T | null) => {
      ownRef.current = node;
      if (!incomingRef) return;
      if (typeof incomingRef === 'function') {
        incomingRef(node);
      } else if ('current' in incomingRef) {
        (incomingRef as React.MutableRefObject<T | null>).current = node;
      }
    },
    [incomingRef, ownRef],
  );
}

function composeHandlers<T extends { stopPropagation?: () => void }>(
  own: (e: T) => void,
  incoming?: (e: T) => void,
) {
  return (e: T) => {
    incoming?.(e);
    // If the caller stopped propagation, respect it so ancestor handlers do not run.
    if ('stopPropagation' in e && (e as { stopPropagation?: () => void }).stopPropagation) {
      try {
        if ((e as unknown as { isPropagationStopped?: () => boolean }).isPropagationStopped?.()) {
          return;
        }
      } catch {
        // Fallback: still call our handler unless the event explicitly says not to.
      }
    }
    own(e);
  };
}

export function Tooltip({
  children,
  label,
  placement = 'top',
  delay,
  openDelay,
  closeDelay = 0,
  maxWidth = 240,
  shortcut,
  disabledReason,
  truncationOnly = false,
  open: controlledOpen,
  onOpenChange,
  tabIndex: tabIndexProp,
  id,
}: TooltipProps) {
  const generatedId = useId();
  const tooltipId = id ?? generatedId;

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const visible = isControlled ? controlledOpen : internalOpen;

  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const isTruncatedRef = useRef(false);
  const pointerDownRef = useRef(false);
  const suppressFocusShowUntilRef = useRef(0);
  const [posStyle, setPosStyle] = useState<{ left: number; top: number } | null>(null);

  const warmContext = useContext(TooltipContext);

  const actualOpenDelay = openDelay ?? delay ?? DEFAULT_DELAY;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (isControlled) {
        onOpenChange?.(nextOpen);
      } else {
        setInternalOpen(nextOpen);
      }
    },
    [isControlled, onOpenChange],
  );

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openNow = useCallback(() => {
    if (!mountedRef.current) return;
    setOpen(true);
    warmContext?.registerShow();
  }, [setOpen, warmContext]);

  const scheduleOpen = useCallback(
    (immediate = false) => {
      clearTimers();
      if (truncationOnly && !isTruncatedRef.current) return;

      if (immediate) {
        openNow();
        return;
      }

      let effectiveDelay = actualOpenDelay;
      if (warmContext) {
        const elapsed = Date.now() - warmContext.getLastShownAt();
        if (elapsed < warmContext.getWarmWindow()) {
          effectiveDelay = Math.min(actualOpenDelay, WARM_DELAY);
        }
      }

      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null;
        openNow();
      }, effectiveDelay);
    },
    [actualOpenDelay, clearTimers, openNow, truncationOnly, warmContext],
  );

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current) return;
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (mountedRef.current) {
        setOpen(false);
        setPosStyle(null);
      }
    }, closeDelay);
  }, [closeDelay, setOpen]);

  const handleClose = useCallback(() => {
    clearTimers();
    if (closeDelay <= 0) {
      if (mountedRef.current) {
        setOpen(false);
        setPosStyle(null);
      }
    } else {
      scheduleClose();
    }
  }, [clearTimers, closeDelay, scheduleClose, setOpen]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  useLayoutEffect(() => {
    const triggerEl = triggerRef.current;
    const tipEl = tooltipRef.current;
    if (!visible || !triggerEl || !tipEl) return;

    const updatePosition = () => {
      void computePosition(triggerEl, tipEl, {
        placement,
        strategy: 'fixed',
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 12 })],
      }).then(({ x, y }) => {
        setPosStyle({ left: x, top: y });
      });
    };

    const cleanup = autoUpdate(triggerEl, tipEl, updatePosition);
    updatePosition();

    return () => {
      cleanup();
    };
  }, [visible, placement]);

  useEffect(() => {
    if (!visible) return;
    const onScroll = () => handleClose();
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [visible, handleClose]);

  const checkTruncation = useCallback(() => {
    if (!truncationOnly) return;
    const el = triggerRef.current;
    if (el) {
      isTruncatedRef.current = el.scrollWidth > el.clientWidth;
    }
  }, [truncationOnly]);

  useLayoutEffect(() => {
    if (!truncationOnly) return;
    checkTruncation();
    const el = triggerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(checkTruncation);
    ro.observe(el);
    return () => ro.disconnect();
  }, [truncationOnly, checkTruncation]);

  const onPointerEnter = useCallback(
    (e: { pointerType?: string; buttons?: number }) => {
      // Ignore touch, stylus hover is fine but touch-first interaction should
      // activate the control immediately, not discover a tooltip.
      if (e.pointerType === 'touch') return;
      // Do not show while any pointer button is held (drag, gesture, stroke).
      if ((e.buttons ?? 0) !== 0) return;
      // If we recently had a pointer-down on this trigger, ignore the focus
      // event that often follows a mouse click.
      if (Date.now() < suppressFocusShowUntilRef.current) return;
      scheduleOpen(false);
    },
    [scheduleOpen],
  );

  const onPointerLeave = useCallback(() => {
    handleClose();
  }, [handleClose]);

  const onPointerDown = useCallback(() => {
    pointerDownRef.current = true;
    suppressFocusShowUntilRef.current = Date.now() + POINTER_SUPPRESS_MS;
    clearTimers();
    if (!isControlled && mountedRef.current) {
      setInternalOpen(false);
      setPosStyle(null);
    } else if (isControlled) {
      onOpenChange?.(false);
    }
  }, [clearTimers, isControlled, onOpenChange]);

  const onPointerUp = useCallback(() => {
    pointerDownRef.current = false;
  }, []);

  const onFocus = useCallback(() => {
    if (Date.now() < suppressFocusShowUntilRef.current) return;
    if (pointerDownRef.current) return;
    scheduleOpen(true);
  }, [scheduleOpen]);

  const onBlur = useCallback(() => {
    handleClose();
  }, [handleClose]);

  const onKeyDown = useCallback(
    (e: { key: string; preventDefault?: () => void; stopPropagation?: () => void }) => {
      if (e.key === 'Escape') {
        e.preventDefault?.();
        e.stopPropagation?.();
        clearTimers();
        setOpen(false);
        setPosStyle(null);
      }
    },
    [clearTimers, setOpen],
  );

  const onTooltipPointerEnter = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const onTooltipPointerLeave = useCallback(() => {
    handleClose();
  }, [handleClose]);

  const tooltipContent = disabledReason ?? label;
  const describedBy = visible ? tooltipId : undefined;

  const child = Children.toArray(children)[0];
  const childElement = isValidElement(child)
    ? (child as ReactElement<{ disabled?: boolean }>)
    : null;
  // We only wrap a disabled child when there is a disabledReason to explain.
  const needsDisabledWrapper =
    Boolean(disabledReason) && childElement && childElement.props.disabled === true;

  // Prepare ref merging unconditionally to avoid hook ordering violation
  // React 19 moved `ref` from the ReactElement instance onto props. Reading
  // `childElement.ref` triggers a runtime warning on every tooltip render and
  // will be removed from the element type; use the props location instead.
  const incomingRef = childElement
    ? (childElement.props as { ref?: React.Ref<HTMLElement> }).ref
    : null;
  const mergedRef = useMergedRef(triggerRef, incomingRef);

  const isDev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
  useEffect(() => {
    if (!isDev || !childElement) return;
    const props = childElement.props as Record<string, unknown>;
    const hasAccessibleName =
      Boolean(props['aria-label']) ||
      Boolean(props['aria-labelledby']) ||
      Boolean(props.title) ||
      Boolean(props.label) ||
      typeof props.children === 'string' ||
      typeof props.children === 'number' ||
      (Array.isArray(props.children) &&
        props.children.some((c) => typeof c === 'string' || typeof c === 'number'));
    if (!hasAccessibleName) {
      console.warn(
        `Tooltip trigger is missing an accessible name. Tooltip: "${label}". Add aria-label, aria-labelledby, a visible text child, or a label prop to the trigger.`,
      );
    }
    if (props.title) {
      console.warn(
        `Tooltip trigger has a native title attribute that conflicts with the Tooltip component: "${label}". Remove the title attribute from the trigger.`,
      );
    }
  }, [childElement, isDev, label]);

  const hoverTriggerHandlers = supportsPointer
    ? {
        onPointerEnter,
        onPointerLeave,
        onPointerDown,
        onPointerUp,
      }
    : {
        onMouseEnter: () => scheduleOpen(false),
        onMouseLeave: handleClose,
        onMouseDown: onPointerDown,
        onMouseUp: onPointerUp,
      };

  const baseTriggerProps = {
    'aria-describedby': describedBy,
    onFocus,
    onBlur,
    onKeyDown,
    tabIndex: tabIndexProp,
    ref: undefined as React.Ref<HTMLElement> | undefined,
  };

  const tooltipPortal = visible && (
    <div
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      className="varve-tooltip"
      data-varve-tooltip=""
      style={{
        left: posStyle?.left ?? 0,
        top: posStyle?.top ?? 0,
        maxWidth,
      }}
      onPointerEnter={onTooltipPointerEnter}
      onPointerLeave={onTooltipPointerLeave}
    >
      <span className="varve-tooltip__body">{tooltipContent}</span>
      {shortcut && !disabledReason && (
        <span
          className="varve-tip__shortcut"
          role="status"
          aria-label={`Keyboard shortcut: ${shortcut}`}
        >
          {shortcut}
        </span>
      )}
    </div>
  );

  if (!label && !disabledReason) {
    return <>{children}</>;
  }

  if (needsDisabledWrapper) {
    return (
      <span
        {...hoverTriggerHandlers}
        {...baseTriggerProps}
        ref={triggerRef as React.Ref<HTMLSpanElement>}
        tabIndex={tabIndexProp ?? 0}
        className="varve-tooltip-trigger"
        style={{ display: 'inline-flex' }}
      >
        {children}
        {tooltipPortal && createPortal(tooltipPortal, document.body)}
      </span>
    );
  }

  if (childElement) {
    const triggerProps = {
      ...baseTriggerProps,
      ...hoverTriggerHandlers,
      ref: mergedRef,
    };

    // Compose any handlers the child already provides so we don't clobber them.
    const composedProps: Record<string, unknown> = {};
    for (const key of Object.keys(triggerProps) as Array<keyof typeof triggerProps>) {
      const incoming = (childElement.props as Record<string, unknown>)[key];
      const own = triggerProps[key];
      if (typeof own === 'function' && (key.startsWith('on') || key === 'ref')) {
        if (key === 'ref') {
          composedProps[key] = own;
        } else {
          composedProps[key] = composeHandlers(
            own as (e: never) => void,
            incoming as (e: never) => void,
          );
        }
      } else if (key === 'aria-describedby' && incoming) {
        composedProps[key] = `${incoming} ${describedBy ?? ''}`.trim();
      } else if (key === 'tabIndex' && incoming !== undefined && tabIndexProp === undefined) {
        composedProps[key] = incoming;
      } else {
        composedProps[key] = own ?? incoming;
      }
    }

    return (
      <>
        {cloneElement(childElement as ReactElement, composedProps as Record<string, unknown>)}
        {tooltipPortal && createPortal(tooltipPortal, document.body)}
      </>
    );
  }

  return (
    <span
      {...hoverTriggerHandlers}
      {...baseTriggerProps}
      ref={triggerRef as React.Ref<HTMLSpanElement>}
      className="varve-tooltip-trigger"
      style={{ display: 'inline-flex' }}
    >
      {children}
      {tooltipPortal && createPortal(tooltipPortal, document.body)}
    </span>
  );
}
