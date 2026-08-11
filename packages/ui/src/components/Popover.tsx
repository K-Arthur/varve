import { arrow, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import {
  cloneElement,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FocusTrap } from './FocusTrap';

export interface PopoverProps {
  children: ReactNode;
  popover: ReactNode;
  placement?: 'bottom' | 'top' | 'left' | 'right';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name for the popover panel; also enables role="dialog". */
  label?: string;
}

/** True if the browser implements the native Popover API. */
const HAS_POPOVER_API =
  typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

export function Popover({
  children,
  popover,
  placement = 'bottom',
  open: controlledOpen,
  onOpenChange,
  label,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const prevOpenRef = useRef(isOpen);
  const skipToggleRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  const [posStyle, setPosStyle] = useState<{ left: number; top: number } | null>(null);
  const [arrowStyle, setArrowStyle] = useState<{ left: number; top: number } | null>(null);
  const popoverId = useId();

  // ── Native Popover API (with fallback) ──────────────────────────────────

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    if (!HAS_POPOVER_API) return; // fallback uses CSS class below
    skipToggleRef.current = true;
    try {
      if (isOpen) {
        el.showPopover();
      } else {
        el.hidePopover();
      }
    } catch {
      // already in the desired state
    }
    skipToggleRef.current = false;
  }, [isOpen]);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    if (!HAS_POPOVER_API) return;
    const handleToggle = () => {
      if (skipToggleRef.current) return;
      const nowOpen = !isOpenRef.current;
      if (!isControlled) {
        setInternalOpen(nowOpen);
      }
      onOpenChange?.(nowOpen);
    };
    el.addEventListener('toggle', handleToggle);
    return () => el.removeEventListener('toggle', handleToggle);
  }, [onOpenChange, isControlled]);

  // ── Fallback visibility for browsers without popover API ─────────────────

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    if (HAS_POPOVER_API) return;
    if (isOpen) {
      el.style.display = '';
      el.setAttribute('data-popover-open', 'true');
    } else {
      el.style.display = 'none';
      el.removeAttribute('data-popover-open');
    }
  }, [isOpen]);

  // Fallback dismissal for browsers without the native popover API:
  // native `popover="auto"` handles Escape and outside-click, the fallback
  // must replicate both.
  useEffect(() => {
    if (HAS_POPOVER_API || !isOpen) return;

    const close = () => {
      if (isControlled) {
        onOpenChange?.(false);
      } else {
        setInternalOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const handlePointerDown = (e: PointerEvent) => {
      const popoverEl = popoverRef.current;
      if (!popoverEl || popoverEl.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      close();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen, isControlled, onOpenChange]);

  // ── Positioning ──────────────────────────────────────────────────────────

  useEffect(() => {
    const triggerEl = triggerRef.current;
    const popoverEl = popoverRef.current;
    const arrowEl = arrowRef.current;
    if (!isOpen || !triggerEl || !popoverEl || !arrowEl) return;

    const updatePosition = () => {
      computePosition(triggerEl, popoverEl, {
        placement,
        middleware: [offset(8), flip(), shift({ padding: 8 }), arrow({ element: arrowEl })],
      }).then(({ x, y, middlewareData }) => {
        setPosStyle({ left: x, top: y });
        if (middlewareData.arrow) {
          setArrowStyle({
            left: middlewareData.arrow.x ?? 0,
            top: middlewareData.arrow.y ?? 0,
          });
        }
      });
    };

    const cleanup = autoUpdate(triggerEl, popoverEl, updatePosition);
    updatePosition();
    return () => {
      cleanup();
      setPosStyle(null);
      setArrowStyle(null);
    };
  }, [isOpen, placement]);

  // ── Focus management ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const popoverEl = popoverRef.current;
    if (!popoverEl) return;
    const firstFocusable = popoverEl.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    requestAnimationFrame(() => {
      (firstFocusable ?? popoverEl).focus();
    });
  }, [isOpen]);

  useEffect(() => {
    if (prevOpenRef.current && !isOpen) {
      const trigger = triggerRef.current;
      if (trigger) {
        // Restore focus to the actual trigger control: the first focusable
        // descendant (button/input/select/[tabindex]) or the span itself.
        const focusable = trigger.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable) {
          focusable.focus();
        } else {
          trigger.setAttribute('tabindex', '-1');
          trigger.focus();
          trigger.removeAttribute('tabindex');
        }
      }
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  // ── Inert siblings ───────────────────────────────────────────────────────

  const siblingsRef = useRef<Set<HTMLElement>>(new Set());

  useEffect(() => {
    const popoverEl = popoverRef.current;
    if (!popoverEl) return;
    const parent = popoverEl.parentElement;
    if (!parent) return;

    // Capture siblings once
    if (siblingsRef.current.size === 0) {
      const siblings = Array.from(parent.children).filter(
        (child) => child !== popoverEl && child !== triggerRef.current,
      );
      siblingsRef.current = new Set(siblings as HTMLElement[]);
    }

    siblingsRef.current.forEach((s) => {
      s.inert = isOpen;
    });
    return () => {
      siblingsRef.current.forEach((s) => {
        s.inert = false;
      });
    };
  }, [isOpen]);

  const handleTriggerClick = useCallback(() => {
    if (isControlled) {
      onOpenChange?.(!isOpen);
    } else {
      setInternalOpen((v) => !v);
    }
  }, [isControlled, isOpen, onOpenChange]);

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTriggerClick();
      }
    },
    [handleTriggerClick],
  );

  const triggerEl = isValidElement<{
    onClick?: React.MouseEventHandler;
    onKeyDown?: React.KeyboardEventHandler;
    'aria-haspopup'?: string;
    'aria-expanded'?: boolean;
  }>(children)
    ? children
    : null;

  const popoverStyle = useMemo((): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      left: posStyle?.left ?? 0,
      top: posStyle?.top ?? 0,
      margin: 0,
      zIndex: 'var(--z-overlay)' as unknown as number,
    };
    // For browsers without the popover API, hide via display:none
    // when closed (the effect above also toggles this reactively).
    if (!HAS_POPOVER_API && !isOpen) {
      base.display = 'none';
    }
    return base;
  }, [posStyle, isOpen]);

  return (
    <>
      <span ref={triggerRef}>
        {triggerEl ? (
          cloneElement(triggerEl, {
            onClick: (e: React.MouseEvent) => {
              triggerEl.props.onClick?.(e);
              if (!e.defaultPrevented) handleTriggerClick();
            },
            onKeyDown: (e: React.KeyboardEvent) => {
              triggerEl.props.onKeyDown?.(e);
              if (!e.defaultPrevented) handleTriggerKeyDown(e);
            },
            'aria-haspopup': 'dialog' as const,
            'aria-expanded': isOpen,
          })
        ) : (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            onClick={handleTriggerClick}
            onKeyDown={handleTriggerKeyDown}
            style={{
              display: 'inline-flex',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              font: 'inherit',
              color: 'inherit',
            }}
          >
            {children}
          </button>
        )}
      </span>
      <div
        ref={popoverRef}
        id={popoverId}
        {...(HAS_POPOVER_API ? { popover: 'auto' } : {})}
        className="varve-popover"
        style={popoverStyle}
        {...(label ? { role: 'dialog' as const, 'aria-label': label } : {})}
      >
        {/* U15 (2026-08-10): trap Tab inside the open popover (APG dialog
         * pattern). The trap also restores focus to the trigger on close,
         * which composes with Popover's own restore below. */}
        <FocusTrap
          active={isOpen}
          onClose={() => {
            if (isControlled) {
              onOpenChange?.(false);
            } else {
              setInternalOpen(false);
            }
          }}
        >
          {popover}
        </FocusTrap>
        <div
          ref={arrowRef}
          className="varve-popover__arrow"
          style={{
            position: 'absolute',
            ...(arrowStyle ? { left: arrowStyle.left, top: arrowStyle.top } : {}),
          }}
        />
      </div>
    </>
  );
}
