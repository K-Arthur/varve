import {
  arrow,
  autoUpdate,
  computePosition,
  flip,
  hide,
  offset,
  shift,
  size,
} from '@floating-ui/dom';
import {
  cloneElement,
  createElement,
  isValidElement,
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
import { OverlayParentContext } from './FloatingPortal';
import { FocusTrap } from './FocusTrap';
import { type OverlayCloseReason, registerOverlay, traceOverlayEvent } from './OverlayRegistry';
import { elementAnchor, portalRootForAnchor, safeViewportRect } from './overlayGeometry';

export interface PopoverProps {
  children: ReactNode;
  popover: ReactNode;
  placement?: 'bottom' | 'top' | 'left' | 'right';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name for the popover panel; also enables role="dialog". */
  label?: string;
  /** Modal popovers may opt into inert siblings and focus trapping. */
  modal?: boolean;
  /** Override the modal focus policy for a rich but nonmodal surface. */
  focusTrap?: boolean;
}

/** True if the browser implements the native Popover API. */
const HAS_POPOVER_API =
  typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

const SAFE_PADDING = 8;

function focusableIn(trigger: HTMLElement): HTMLElement | null {
  return trigger.querySelector<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
}

export function Popover({
  children,
  popover,
  placement = 'bottom',
  open: controlledOpen,
  onOpenChange,
  label,
  modal = false,
  focusTrap,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const shouldTrapFocus = focusTrap ?? modal;

  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const prevOpenRef = useRef(isOpen);
  const skipToggleRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const generationRef = useRef(0);
  const closeRef = useRef<((reason?: OverlayCloseReason) => void) | undefined>(undefined);
  isOpenRef.current = isOpen;

  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [posStyle, setPosStyle] = useState<{ left: number; top: number } | null>(null);
  const [arrowStyle, setArrowStyle] = useState<{ left: number; top: number } | null>(null);
  const popoverId = useId();
  const overlayId = `varve-popover-${popoverId.replace(/[:]/g, '')}`;
  const inheritedParentId = useContext(OverlayParentContext);
  const ownerDocument = triggerRef.current?.ownerDocument ?? document;

  const setOpen = useCallback(
    (nextOpen: boolean, _reason?: OverlayCloseReason) => {
      if (isControlled) {
        onOpenChange?.(nextOpen);
      } else {
        setInternalOpen(nextOpen);
      }
    },
    [isControlled, onOpenChange],
  );
  closeRef.current = (reason) => setOpen(false, reason);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const doc = trigger?.ownerDocument ?? ownerDocument;
    const nextRoot = portalRootForAnchor(doc, trigger ? elementAnchor(trigger) : null);
    setPortalRoot((current) => (current === nextRoot ? current : nextRoot));
  }, [ownerDocument]);

  // ── Native Popover API ───────────────────────────────────────────────────

  useEffect(() => {
    const el = popoverRef.current;
    if (!el || !HAS_POPOVER_API) return;
    skipToggleRef.current = true;
    try {
      if (isOpen) el.showPopover();
      else el.hidePopover();
    } catch {
      // The desired state may already have been applied by the browser.
    }
    skipToggleRef.current = false;
  }, [isOpen]);

  // The portal container is part of this dependency list even though the
  // callback only reads the ref: moving into a dialog/detached body mounts a
  // new DOM node and the native toggle listener must follow that node.
  // biome-ignore lint/correctness/useExhaustiveDependencies: portalRoot tracks the ref-owning portal mount
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el || !HAS_POPOVER_API) return;
    const handleToggle = (event: Event) => {
      if (skipToggleRef.current) return;
      const nativeState = (event as Event & { newState?: string }).newState;
      const nowOpen =
        nativeState === 'open' ? true : nativeState === 'closed' ? false : !isOpenRef.current;
      if (nowOpen === isOpenRef.current) return;
      if (!isControlled) setInternalOpen(nowOpen);
      onOpenChange?.(nowOpen);
    };
    el.addEventListener('toggle', handleToggle);
    return () => el.removeEventListener('toggle', handleToggle);
  }, [isControlled, onOpenChange, portalRoot]);

  // ── Shared ancestry and fallback dismissal ──────────────────────────────

  useLayoutEffect(() => {
    const element = popoverRef.current;
    if (!isOpen || !element || !portalRoot) return;
    const trigger = triggerRef.current;
    return registerOverlay({
      id: overlayId,
      kind: 'popover',
      parentId: inheritedParentId,
      ownerDocument,
      portalRoot,
      node: element,
      anchorElement: trigger,
      onClose: (reason) => closeRef.current?.(reason),
      // Native popovers already implement light-dismiss. The registry still
      // records them for ancestry, but must not close them a second time.
      dismissOnPointerDown: !HAS_POPOVER_API,
      dismissOnEscape: !HAS_POPOVER_API,
      dismissOnWindowBlur: true,
    });
  }, [isOpen, portalRoot, ownerDocument, overlayId, inheritedParentId]);

  // ── Positioning ──────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const element = popoverRef.current;
    const arrowElement = arrowRef.current;
    if (!isOpen || !portalRoot || !trigger || !element || !arrowElement) return;

    const generation = ++generationRef.current;
    let cancelled = false;
    setPosStyle(null);
    setArrowStyle(null);
    traceOverlayEvent(ownerDocument, {
      event: 'anchor-measured',
      id: overlayId,
      kind: 'popover',
      decision: 'measure-hidden',
      details: { anchorRect: trigger.getBoundingClientRect() },
    });

    const updatePosition = () => {
      if (cancelled || generation !== generationRef.current || !element.isConnected) return;
      computePosition(trigger, element, {
        strategy: 'fixed',
        placement,
        middleware: [
          offset(8),
          flip({ padding: SAFE_PADDING }),
          shift({ padding: SAFE_PADDING }),
          size({
            padding: SAFE_PADDING,
            apply({ availableWidth, availableHeight, elements }) {
              Object.assign(elements.floating.style, {
                boxSizing: 'border-box',
                maxWidth: `${Math.max(0, availableWidth)}px`,
                maxHeight: `${Math.max(0, availableHeight)}px`,
                overflowY: 'auto',
              });
            },
          }),
          hide({ padding: SAFE_PADDING }),
          arrow({ element: arrowElement }),
        ],
      }).then(({ x, y, middlewareData }) => {
        if (cancelled || generation !== generationRef.current || !isOpen || !element.isConnected) {
          return;
        }
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          traceOverlayEvent(ownerDocument, {
            event: 'placement-invalid',
            id: overlayId,
            kind: 'popover',
            decision: 'remain-hidden',
            details: { safeViewport: safeViewportRect(ownerDocument, SAFE_PADDING) },
          });
          setPosStyle(null);
          setArrowStyle(null);
          return;
        }
        const referenceRect = trigger.getBoundingClientRect();
        const referenceHasArea = referenceRect.width > 0 || referenceRect.height > 0;
        const referenceHidden =
          referenceHasArea &&
          Boolean(
            (middlewareData.hide as { referenceHidden?: boolean } | undefined)?.referenceHidden,
          );
        setPosStyle(referenceHidden ? null : { left: x, top: y });
        if (!referenceHidden && middlewareData.arrow) {
          setArrowStyle({
            left: middlewareData.arrow.x ?? 0,
            top: middlewareData.arrow.y ?? 0,
          });
        }
        traceOverlayEvent(ownerDocument, {
          event: 'placement-computed',
          id: overlayId,
          kind: 'popover',
          placement,
          x,
          y,
          decision: referenceHidden ? 'hidden-reference' : 'visible',
          details: {
            middlewareData,
            safeViewport: safeViewportRect(ownerDocument, SAFE_PADDING),
          },
        });
      });
    };

    updatePosition();
    const cleanup = autoUpdate(trigger, element, updatePosition);
    const ownerWindow = ownerDocument.defaultView;
    const OwnerMutationObserver = ownerWindow?.MutationObserver;
    const observer = OwnerMutationObserver
      ? new OwnerMutationObserver(() => {
          if (!trigger.isConnected || trigger.ownerDocument !== ownerDocument) {
            traceOverlayEvent(ownerDocument, {
              event: 'anchor-detached',
              id: overlayId,
              kind: 'popover',
              decision: 'close',
              reason: 'anchor-detached',
            });
            closeRef.current?.('anchor-detached');
          }
        })
      : null;
    observer?.observe(ownerDocument, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      generationRef.current += 1;
      cleanup();
      observer?.disconnect();
      setPosStyle(null);
      setArrowStyle(null);
      traceOverlayEvent(ownerDocument, {
        event: 'placement-cleanup',
        id: overlayId,
        kind: 'popover',
        decision: 'cancelled',
      });
    };
  }, [isOpen, portalRoot, ownerDocument, overlayId, placement]);

  // ── Focus management ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !shouldTrapFocus) return;
    const element = popoverRef.current;
    if (!element) return;
    const first = focusableIn(element);
    const view = element.ownerDocument.defaultView;
    const frame = view?.requestAnimationFrame(() => (first ?? element).focus()) ?? 0;
    return () => view?.cancelAnimationFrame(frame);
  }, [isOpen, shouldTrapFocus]);

  useEffect(() => {
    if (prevOpenRef.current && !isOpen) {
      const trigger = triggerRef.current;
      const active = trigger?.ownerDocument.activeElement;
      if (
        trigger &&
        (!active || active === trigger.ownerDocument.body || trigger.contains(active))
      ) {
        (focusableIn(trigger) ?? trigger).focus();
      }
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  // Nonmodal supplemental popovers must not make the rest of the application
  // inert. Modal callers opt in explicitly and own the stronger focus policy.
  const siblingsRef = useRef<Set<HTMLElement>>(new Set());
  useEffect(() => {
    const element = popoverRef.current;
    if (!modal || !element || !isOpen) return;
    const parent = element.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children).filter(
      (child) => child !== element && child !== triggerRef.current,
    ) as HTMLElement[];
    siblingsRef.current = new Set(siblings);
    siblings.forEach((sibling) => {
      sibling.inert = true;
    });
    return () => {
      siblings.forEach((sibling) => {
        sibling.inert = false;
      });
      siblingsRef.current.clear();
    };
  }, [isOpen, modal]);

  const handleTriggerClick = useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);

  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleTriggerClick();
      }
    },
    [handleTriggerClick],
  );

  const triggerElement = isValidElement<{
    onClick?: React.MouseEventHandler;
    onKeyDown?: React.KeyboardEventHandler;
    'aria-haspopup'?: string;
    'aria-expanded'?: boolean;
  }>(children)
    ? children
    : null;

  const popoverStyle = useMemo((): React.CSSProperties => {
    const style: React.CSSProperties = {
      position: 'fixed',
      left: posStyle?.left ?? 0,
      top: posStyle?.top ?? 0,
      margin: 0,
      zIndex: 'var(--z-overlay)' as unknown as number,
      visibility: isOpen && posStyle ? 'visible' : 'hidden',
      pointerEvents: isOpen && posStyle ? 'auto' : 'none',
    };
    if (!HAS_POPOVER_API && !isOpen) style.display = 'none';
    return style;
  }, [isOpen, posStyle]);

  const content = (
    <OverlayParentContext.Provider value={overlayId}>
      <div
        ref={popoverRef}
        id={popoverId}
        {...(HAS_POPOVER_API ? { popover: 'auto' } : {})}
        className="varve-popover"
        style={popoverStyle}
        {...(label ? { role: 'dialog' as const, 'aria-label': label } : {})}
        data-varve-overlay="true"
        data-overlay-id={overlayId}
        data-overlay-kind="popover"
      >
        {shouldTrapFocus ? (
          <FocusTrap active={isOpen} onClose={() => setOpen(false, 'escape')}>
            {popover}
          </FocusTrap>
        ) : (
          popover
        )}
        <div
          ref={arrowRef}
          className="varve-popover__arrow"
          style={{
            position: 'absolute',
            ...(arrowStyle ? { left: arrowStyle.left, top: arrowStyle.top } : {}),
          }}
        />
      </div>
    </OverlayParentContext.Provider>
  );

  return (
    <>
      <span ref={triggerRef}>
        {triggerElement
          ? cloneElement(triggerElement, {
              onClick: (event: React.MouseEvent) => {
                triggerElement.props.onClick?.(event);
                if (!event.defaultPrevented) handleTriggerClick();
              },
              onKeyDown: (event: React.KeyboardEvent) => {
                triggerElement.props.onKeyDown?.(event);
                if (!event.defaultPrevented) handleTriggerKeyDown(event);
              },
              'aria-haspopup': 'dialog' as const,
              'aria-expanded': isOpen,
            })
          : createElement(
              'button',
              {
                type: 'button',
                'aria-haspopup': 'dialog',
                'aria-expanded': isOpen,
                onClick: handleTriggerClick,
                onKeyDown: handleTriggerKeyDown,
                style: {
                  display: 'inline-flex',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  font: 'inherit',
                  color: 'inherit',
                },
              },
              children,
            )}
      </span>
      {portalRoot ? createPortal(content, portalRoot) : null}
    </>
  );
}
