/**
 * FloatingPortal — portaled overlay anchored to a trigger element.
 *
 * Escapes overflow:hidden ancestors (editor shell, inspector panels) by
 * rendering to document.body with position:fixed via Floating UI.
 *
 * Research basis: Floating UI positioning; APG menu/dialog layering patterns.
 */
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
  type Placement,
} from '@floating-ui/dom';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface FloatingPortalProps {
  /** Element to anchor the floating layer to. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Floating UI placement relative to anchor. */
  placement?: Placement;
  /** Max height before scroll (px). Defaults to 480. */
  maxHeight?: number;
  /** Match floating layer width to the anchor element. */
  matchAnchorWidth?: boolean;
  /** Called when user clicks outside the floating layer. */
  onClose?: () => void;
  /** Optional id for aria-controls wiring. */
  id?: string;
}

export function FloatingPortal({
  anchorRef,
  open,
  children,
  className,
  placement = 'bottom-start',
  maxHeight = 480,
  matchAnchorWidth = false,
  onClose,
  id,
}: FloatingPortalProps) {
  const floatingRef = useRef<HTMLDivElement>(null);
  const [posStyle, setPosStyle] = useState<CSSProperties>({
    position: 'fixed',
    visibility: 'hidden',
    zIndex: 'var(--z-overlay)',
  });

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!open || !anchor || !floating) return;

    // Show immediately at anchor rect; refine when computePosition resolves.
    const anchorRect = anchor.getBoundingClientRect();
    setPosStyle({
      position: 'fixed',
      left: anchorRect.left,
      top: anchorRect.bottom + 4,
      zIndex: 'var(--z-overlay)',
      visibility: 'visible',
    });

    const update = () => {
      computePosition(anchor, floating, {
        placement,
        middleware: [
          offset(4),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableHeight, rects, elements }) {
              Object.assign(elements.floating.style, {
                ...(matchAnchorWidth ? { width: `${rects.reference.width}px` } : {}),
                maxHeight: `${Math.min(availableHeight, maxHeight)}px`,
                overflowY: 'auto',
              });
            },
          }),
        ],
      })
        .then(({ x, y }) => {
          setPosStyle({
            position: 'fixed',
            left: x,
            top: y,
            zIndex: 'var(--z-overlay)',
            visibility: 'visible',
          });
        })
        .catch(() => {
          const rect = anchor.getBoundingClientRect();
          setPosStyle({
            position: 'fixed',
            left: rect.left,
            top: rect.bottom + 4,
            zIndex: 'var(--z-overlay)',
            visibility: 'visible',
          });
        });
    };

    update();
    return autoUpdate(anchor, floating, update);
  }, [open, anchorRef, placement, maxHeight, matchAnchorWidth]);

  useEffect(() => {
    if (!open || !onClose) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (floatingRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };

    // Defer listener so the opening click/pointerdown does not immediately dismiss.
    const frame = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handlePointerDown, true);
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div ref={floatingRef} id={id} className={className} style={posStyle}>
      {children}
    </div>,
    document.body,
  );
}
