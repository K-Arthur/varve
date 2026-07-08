import { arrow, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

export interface PopoverProps {
  children: ReactElement;
  popover: ReactNode;
  placement?: 'bottom' | 'top' | 'left' | 'right';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({
  children,
  popover,
  placement = 'bottom',
  open: controlledOpen,
  onOpenChange,
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

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
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
        trigger.focus();
      }
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    const popoverEl = popoverRef.current;
    const triggerEl = triggerRef.current;
    if (!popoverEl) return;
    const parent = popoverEl.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children).filter(
      (child) => child !== popoverEl && child !== triggerEl,
    );
    siblings.forEach((s) => {
      (s as HTMLElement).inert = isOpen;
    });
    return () => {
      siblings.forEach((s) => {
        (s as HTMLElement).inert = false;
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

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: trigger wrapper; interactive children inside */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: span is a non-semantic wrapper for the interactive trigger */}
      <span
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        style={{ display: 'inline-flex' }}
      >
        {children}
      </span>
      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        className="strata-popover"
        style={{
          position: 'fixed',
          left: posStyle?.left ?? 0,
          top: posStyle?.top ?? 0,
          margin: 0,
          zIndex: 'var(--z-overlay)' as unknown as number,
        }}
      >
        {popover}
        <div
          ref={arrowRef}
          className="strata-popover__arrow"
          style={{
            position: 'absolute',
            ...(arrowStyle ? { left: arrowStyle.left, top: arrowStyle.top } : {}),
          }}
        />
      </div>
    </>
  );
}
