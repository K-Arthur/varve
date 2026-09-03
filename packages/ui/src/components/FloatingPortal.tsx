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
  type Placement,
  shift,
  size,
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
  /** Optional max height before scroll. The viewport is the default constraint. */
  maxHeight?: number;
  /** Match floating layer width to the anchor element. */
  matchAnchorWidth?: boolean;
  /** Called when user clicks outside the floating layer. */
  onClose?: () => void;
  /** Additional portaled descendants that count as inside for outside-click handling. */
  insideRefs?: readonly RefObject<HTMLElement | null>[];
  /** Optional id for aria-controls wiring. */
  id?: string;
}

export function FloatingPortal({
  anchorRef,
  open,
  children,
  className,
  placement = 'bottom-start',
  maxHeight,
  matchAnchorWidth = false,
  onClose,
  insideRefs,
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
              const constrainedHeight =
                maxHeight === undefined ? availableHeight : Math.min(availableHeight, maxHeight);
              Object.assign(elements.floating.style, {
                ...(matchAnchorWidth ? { width: `${rects.reference.width}px` } : {}),
                maxHeight: `${constrainedHeight}px`,
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
      // Check the floating element AND any focus-trap wrapper or dialog
      // that may sit between the portal root and the actual content.
      if (floatingRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      if (insideRefs?.some((ref) => ref.current?.contains(target))) return;
      onClose();
    };

    // Attach synchronously so there is no timing gap between the portal
    // rendering and the listener being active.  The opening click's
    // pointerdown fires BEFORE this effect runs (it fires during the
    // browser's event dispatch, before React commits), so the listener
    // is never in place to catch it — no skip logic needed.
    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [open, onClose, anchorRef, insideRefs]);

  if (!open) return null;

  // Native <dialog> elements render in the browser's top layer. A portal to
  // document.body is painted below that layer, so selects inside a dialog can
  // appear to open while their listbox is invisible and unclickable. Keep
  // nested overlays inside their owning dialog; menus outside dialogs still
  // use document.body to escape clipping ancestors.
  const portalRoot = anchorRef.current?.closest('dialog') ?? document.body;

  return createPortal(
    <div ref={floatingRef} id={id} className={className} style={posStyle}>
      {children}
    </div>,
    portalRoot,
  );
}
