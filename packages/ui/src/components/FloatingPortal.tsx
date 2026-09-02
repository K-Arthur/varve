/**
 * FloatingPortal — the shared geometry/ownership layer for floating UI.
 *
 * Semantic primitives (menus, listboxes, popovers, and dialogs) keep their
 * own keyboard and focus contracts. This component only owns the things they
 * can safely share: an explicit anchor, an owner document, a portal host,
 * measured placement, collision handling, overlay ancestry, and cleanup.
 */
import {
  autoUpdate,
  computePosition,
  flip,
  hide,
  offset,
  type Placement,
  shift,
  size,
  type VirtualElement,
} from '@floating-ui/dom';
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type OverlayCloseReason,
  type OverlayKind,
  registerOverlay,
  traceOverlayEvent,
} from './OverlayRegistry';
import {
  directionForAnchor,
  type OverlayAnchor,
  ownerDocumentForAnchor,
  portalRootForAnchor,
  resolvePlacementForDirection,
  safeViewportRect,
  virtualPointReference,
  virtualRangeReference,
} from './overlayGeometry';

const SAFE_VIEWPORT_PADDING = 8;

/** React context carried through portals so a portaled descendant has a real parent overlay. */
export const OverlayParentContext = createContext<string | null>(null);

export interface FloatingPositionResult {
  x: number;
  y: number;
  placement: Placement;
  middlewareData: Record<string, unknown>;
}

export interface FloatingPortalProps {
  /** Element ref used by existing element-anchored call sites. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Explicit element or viewport-point anchor for new call sites. */
  anchor?: OverlayAnchor | null;
  /** Explicit owner document for point anchors and detached-window hosts. */
  ownerDocument?: Document;
  /** Optional window-local host. Defaults to a containing dialog or owner body. */
  portalRoot?: HTMLElement | null;
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Centralized z-layer token; tooltips intentionally sit below menus. */
  zIndex?: CSSProperties['zIndex'];
  /** Floating UI placement relative to the anchor. */
  placement?: Placement;
  /** Treat horizontal placement as logical inline-start/end in RTL. */
  logicalPlacement?: boolean;
  /** Placements to try after the preferred placement overflows. */
  fallbackPlacements?: Placement[];
  /** Distance between the reference and floating surface. */
  offsetDistance?: number;
  /** Optional max height before scroll. The viewport is the default constraint. */
  maxHeight?: number;
  /** Match floating layer width to the anchor element. */
  matchAnchorWidth?: boolean;
  /** Called when the shared registry classifies a dismissal or stale anchor. */
  onClose?: (reason: OverlayCloseReason) => void;
  /** Semantic/diagnostic overlay kind. */
  kind?: OverlayKind;
  /** Stable ID for the registry; generated from React's stable ID otherwise. */
  overlayId?: string;
  /** Optional DOM id for aria-controls wiring. */
  id?: string;
  /** Override the inherited parent overlay ID when integrating a non-React child. */
  parentId?: string | null;
  /** Enable registry pointer dismissal for this surface. */
  dismissOnPointerDown?: boolean;
  /** Enable registry Escape dismissal for primitives without a local key handler. */
  dismissOnEscape?: boolean;
  /** Close transient surfaces when their owner window loses activation. */
  dismissOnWindowBlur?: boolean;
  /** Development/test geometry trace hook. */
  onPositionChange?: (result: FloatingPositionResult) => void;
}

function resolveAnchor(
  anchor: OverlayAnchor | null | undefined,
  anchorRef: RefObject<HTMLElement | null> | undefined,
): OverlayAnchor | null {
  if (anchor) return anchor;
  const element = anchorRef?.current;
  return element ? { kind: 'element', element } : null;
}

function hiddenStyle(
  maxHeight?: number,
  zIndex: CSSProperties['zIndex'] = 'var(--z-overlay)',
): CSSProperties {
  return {
    position: 'fixed',
    left: 0,
    top: 0,
    width: 'max-content',
    maxHeight: maxHeight === undefined ? undefined : Math.max(0, maxHeight),
    boxSizing: 'border-box',
    visibility: 'hidden',
    pointerEvents: 'none',
    zIndex,
  };
}

function rectDetails(rect: DOMRect | undefined): Record<string, number> | undefined {
  if (!rect) return undefined;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function fallbackPosition(
  reference: Element | VirtualElement,
  floating: HTMLElement,
  placement: Placement,
  gap: number,
  ownerDocument: Document,
): { x: number; y: number } {
  const referenceRect = reference.getBoundingClientRect();
  const floatingRect = floating.getBoundingClientRect();
  const isTop = placement.startsWith('top');
  const isRight = placement.startsWith('right');
  const isLeft = placement.startsWith('left');
  const isEnd = placement.endsWith('-end');
  let x = isRight
    ? referenceRect.right + gap
    : isLeft
      ? referenceRect.left - floatingRect.width - gap
      : isEnd
        ? referenceRect.right - floatingRect.width
        : referenceRect.left;
  let y = isTop
    ? referenceRect.top - floatingRect.height - gap
    : placement.startsWith('bottom')
      ? referenceRect.bottom + gap
      : isEnd
        ? referenceRect.bottom - floatingRect.height
        : referenceRect.top;
  const safe = safeViewportRect(ownerDocument, SAFE_VIEWPORT_PADDING);
  x = Math.min(Math.max(safe.left, x), Math.max(safe.left, safe.right - floatingRect.width));
  y = Math.min(Math.max(safe.top, y), Math.max(safe.top, safe.bottom - floatingRect.height));
  return { x, y };
}

export function FloatingPortal({
  anchorRef,
  anchor: explicitAnchor,
  ownerDocument: explicitOwnerDocument,
  portalRoot: explicitPortalRoot,
  open,
  children,
  className,
  zIndex = 'var(--z-overlay)',
  placement = 'bottom-start',
  logicalPlacement = false,
  fallbackPlacements,
  offsetDistance = 4,
  maxHeight,
  matchAnchorWidth = false,
  onClose,
  kind = 'popover',
  overlayId: explicitOverlayId,
  id,
  parentId: explicitParentId,
  dismissOnPointerDown,
  dismissOnEscape = false,
  dismissOnWindowBlur,
  onPositionChange,
}: FloatingPortalProps) {
  const generatedId = useId();
  const inheritedParentId = useContext(OverlayParentContext);
  const floatingRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const positionRef = useRef(onPositionChange);
  const generationRef = useRef(0);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [posStyle, setPosStyle] = useState<CSSProperties>(() => hiddenStyle(maxHeight, zIndex));

  closeRef.current = onClose;
  positionRef.current = onPositionChange;
  const shouldDismissOnPointerDown = dismissOnPointerDown ?? Boolean(onClose);
  const shouldDismissOnWindowBlur = dismissOnWindowBlur ?? Boolean(onClose);

  const overlayId = explicitOverlayId ?? `varve-overlay-${generatedId.replace(/[:]/g, '')}`;
  const parentId = explicitParentId ?? inheritedParentId;
  const renderAnchor = resolveAnchor(explicitAnchor, anchorRef);
  const [resolvedOwnerDocument, setResolvedOwnerDocument] = useState<Document | null>(() =>
    ownerDocumentForAnchor(renderAnchor, explicitOwnerDocument),
  );
  const ownerDocument =
    resolvedOwnerDocument ?? ownerDocumentForAnchor(renderAnchor, explicitOwnerDocument);

  // Resolve the root after refs have been committed. This avoids the first
  // render accidentally choosing the main window body when an anchor belongs
  // to a detached window or a native dialog.
  useLayoutEffect(() => {
    const currentAnchor = resolveAnchor(explicitAnchor, anchorRef);
    if (!open || !currentAnchor) {
      setPortalRoot(null);
      return;
    }
    const measuredOwnerDocument = ownerDocumentForAnchor(currentAnchor, explicitOwnerDocument);
    if (!measuredOwnerDocument) {
      setPortalRoot(null);
      return;
    }
    if (!ownerDocument || measuredOwnerDocument !== ownerDocument) {
      // Refs are assigned during commit, after the first render. Resolve a
      // ref-only anchor here before creating a portal so a detached-window
      // surface can never briefly mount in the primary document.
      setResolvedOwnerDocument(measuredOwnerDocument);
      setPortalRoot(null);
      return;
    }
    const requestedRoot =
      explicitPortalRoot && explicitPortalRoot.ownerDocument === ownerDocument
        ? explicitPortalRoot
        : portalRootForAnchor(ownerDocument, currentAnchor);
    setPortalRoot((current) => (current === requestedRoot ? current : requestedRoot));
  }, [open, ownerDocument, explicitOwnerDocument, explicitAnchor, explicitPortalRoot, anchorRef]);

  // Register once per mounted surface. The registry owns one pointer and one
  // optional Escape listener per owner document, including across React roots.
  useLayoutEffect(() => {
    if (!open || !portalRoot || !ownerDocument || !floatingRef.current) return;
    const currentAnchor = resolveAnchor(explicitAnchor, anchorRef);
    const anchorElement =
      currentAnchor?.kind === 'element' ? currentAnchor.element : currentAnchor?.contextElement;
    return registerOverlay({
      id: overlayId,
      kind,
      parentId,
      ownerDocument,
      portalRoot,
      node: floatingRef.current,
      anchorElement,
      onClose: (reason) => closeRef.current?.(reason),
      dismissOnPointerDown: shouldDismissOnPointerDown,
      dismissOnEscape,
      dismissOnWindowBlur: shouldDismissOnWindowBlur,
    });
  }, [
    open,
    portalRoot,
    ownerDocument,
    explicitAnchor,
    anchorRef,
    overlayId,
    kind,
    parentId,
    shouldDismissOnPointerDown,
    dismissOnEscape,
    shouldDismissOnWindowBlur,
  ]);

  useLayoutEffect(() => {
    const floating = floatingRef.current;
    if (!open || !portalRoot || !ownerDocument || !floating) return;

    const currentAnchor = resolveAnchor(explicitAnchor, anchorRef);
    if (
      !currentAnchor ||
      (currentAnchor.kind === 'element' &&
        (!currentAnchor.element.isConnected ||
          currentAnchor.element.ownerDocument !== ownerDocument)) ||
      (currentAnchor.kind === 'range' &&
        (!currentAnchor.range.startContainer.isConnected ||
          currentAnchor.range.startContainer.ownerDocument !== ownerDocument))
    ) {
      traceOverlayEvent(ownerDocument, {
        event: 'anchor-detached',
        id: overlayId,
        kind,
        parentId,
        decision: 'close',
        reason: 'anchor-detached',
      });
      closeRef.current?.('anchor-detached');
      return;
    }

    const generation = ++generationRef.current;
    let cancelled = false;
    setPosStyle(hiddenStyle(maxHeight, zIndex));
    traceOverlayEvent(ownerDocument, {
      event: 'anchor-measured',
      id: overlayId,
      kind,
      parentId,
      decision: 'measure-hidden',
      details: {
        anchorKind: currentAnchor.kind,
        point:
          currentAnchor.kind === 'point'
            ? {
                x: currentAnchor.point.x,
                y: currentAnchor.point.y,
                space: currentAnchor.point.space,
              }
            : undefined,
        range:
          currentAnchor.kind === 'range'
            ? rectDetails(currentAnchor.range.getBoundingClientRect())
            : undefined,
        anchorRect:
          currentAnchor.kind === 'element'
            ? rectDetails(currentAnchor.element.getBoundingClientRect())
            : currentAnchor.kind === 'range'
              ? rectDetails(currentAnchor.range.getBoundingClientRect())
              : rectDetails(currentAnchor.contextElement?.getBoundingClientRect()),
      },
    });

    const reference: Element | VirtualElement =
      currentAnchor.kind === 'point'
        ? virtualPointReference(currentAnchor)
        : currentAnchor.kind === 'range'
          ? virtualRangeReference(currentAnchor)
          : currentAnchor.element;
    const direction = directionForAnchor(currentAnchor, ownerDocument);
    const resolvedPlacement = resolvePlacementForDirection(placement, direction, logicalPlacement);
    const resolvedFallbackPlacements = fallbackPlacements?.map((fallback) =>
      resolvePlacementForDirection(fallback, direction, logicalPlacement),
    );
    const update = () => {
      if (cancelled || generation !== generationRef.current || !floating.isConnected) return;
      computePosition(reference, floating, {
        strategy: 'fixed',
        placement: resolvedPlacement,
        middleware: [
          offset(offsetDistance),
          flip({
            padding: SAFE_VIEWPORT_PADDING,
            fallbackPlacements: resolvedFallbackPlacements,
          }),
          shift({ padding: SAFE_VIEWPORT_PADDING }),
          size({
            padding: SAFE_VIEWPORT_PADDING,
            apply({ availableWidth, availableHeight, rects, elements }) {
              const constrainedHeight = Math.max(
                0,
                maxHeight === undefined ? availableHeight : Math.min(availableHeight, maxHeight),
              );
              const sizeStyle: Record<string, string> = {
                boxSizing: 'border-box',
                overflowY: 'auto',
              };
              // jsdom and a hidden owner window can report zero available
              // space while the reference is still a valid test/transition
              // anchor. Do not collapse an otherwise measurable surface to
              // 0px; real viewport constraints are positive and are applied.
              if (availableWidth > 0) {
                sizeStyle.maxWidth = `${availableWidth}px`;
                if (matchAnchorWidth) {
                  sizeStyle.width = `${Math.min(rects.reference.width, availableWidth)}px`;
                }
              }
              if (constrainedHeight > 0) sizeStyle.maxHeight = `${constrainedHeight}px`;
              Object.assign(elements.floating.style, sizeStyle);
            },
          }),
          hide({ padding: SAFE_VIEWPORT_PADDING }),
        ],
      })
        .then((result) => {
          if (cancelled || generation !== generationRef.current || !open || !floating.isConnected) {
            return;
          }
          if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) {
            throw new Error('Floating UI returned non-finite coordinates');
          }
          const referenceRect = reference.getBoundingClientRect();
          const referenceHasArea = referenceRect.width > 0 || referenceRect.height > 0;
          const hiddenByReference =
            referenceHasArea &&
            Boolean(
              (result.middlewareData.hide as { referenceHidden?: boolean } | undefined)
                ?.referenceHidden,
            );
          const nextStyle: CSSProperties = {
            position: 'fixed',
            left: result.x,
            top: result.y,
            boxSizing: 'border-box',
            // The size middleware writes collision constraints directly to
            // the floating node before this position update resolves. Keep
            // those values in React's controlled style object as well;
            // otherwise React removes max-height/overflow on the next render
            // and tall context menus can extend below the viewport.
            maxWidth: floating.style.maxWidth || undefined,
            maxHeight: floating.style.maxHeight || undefined,
            overflowY: floating.style.overflowY || undefined,
            visibility: hiddenByReference ? 'hidden' : 'visible',
            pointerEvents: hiddenByReference ? 'none' : 'auto',
            zIndex,
          };
          setPosStyle(nextStyle);
          positionRef.current?.({
            x: result.x,
            y: result.y,
            placement: result.placement,
            middlewareData: result.middlewareData as Record<string, unknown>,
          });
          traceOverlayEvent(ownerDocument, {
            event: 'placement-computed',
            id: overlayId,
            kind,
            parentId,
            placement: result.placement,
            x: result.x,
            y: result.y,
            decision: hiddenByReference ? 'hidden-reference' : 'visible',
            details: {
              middlewareData: result.middlewareData,
              preferredPlacement: placement,
              direction,
              safeViewport: safeViewportRect(ownerDocument, SAFE_VIEWPORT_PADDING),
            },
          });
        })
        .catch(() => {
          if (cancelled || generation !== generationRef.current || !open || !floating.isConnected) {
            return;
          }
          const fallback = fallbackPosition(
            reference,
            floating,
            resolvedPlacement,
            offsetDistance,
            ownerDocument,
          );
          setPosStyle({
            position: 'fixed',
            left: fallback.x,
            top: fallback.y,
            boxSizing: 'border-box',
            visibility: 'visible',
            pointerEvents: 'auto',
            zIndex,
          });
          traceOverlayEvent(ownerDocument, {
            event: 'placement-fallback',
            id: overlayId,
            kind,
            parentId,
            x: fallback.x,
            y: fallback.y,
            decision: 'visible-fallback',
          });
        });
    };

    update();
    const cleanupAutoUpdate =
      currentAnchor.kind === 'element'
        ? autoUpdate(currentAnchor.element, floating, update)
        : currentAnchor.kind === 'range' && currentAnchor.contextElement
          ? autoUpdate(currentAnchor.contextElement, floating, update)
          : undefined;
    const OwnerMutationObserver = ownerDocument.defaultView?.MutationObserver;
    const ownerMutationObserver =
      (currentAnchor.kind === 'element' || currentAnchor.kind === 'range') && OwnerMutationObserver
        ? new OwnerMutationObserver(() => {
            if (
              (currentAnchor.kind === 'element' &&
                (!currentAnchor.element.isConnected ||
                  currentAnchor.element.ownerDocument !== ownerDocument)) ||
              (currentAnchor.kind === 'range' &&
                (!currentAnchor.range.startContainer.isConnected ||
                  currentAnchor.range.startContainer.ownerDocument !== ownerDocument))
            ) {
              traceOverlayEvent(ownerDocument, {
                event: 'anchor-detached',
                id: overlayId,
                kind,
                parentId,
                decision: 'close',
                reason: 'anchor-detached',
              });
              closeRef.current?.('anchor-detached');
            }
          })
        : undefined;
    if (ownerMutationObserver) {
      ownerMutationObserver.observe(ownerDocument, { childList: true, subtree: true });
    }

    return () => {
      cancelled = true;
      generationRef.current += 1;
      cleanupAutoUpdate?.();
      ownerMutationObserver?.disconnect();
      traceOverlayEvent(ownerDocument, {
        event: 'placement-cleanup',
        id: overlayId,
        kind,
        parentId,
        decision: 'cancelled',
      });
    };
  }, [
    open,
    portalRoot,
    ownerDocument,
    explicitAnchor,
    anchorRef,
    placement,
    fallbackPlacements,
    offsetDistance,
    maxHeight,
    zIndex,
    matchAnchorWidth,
    logicalPlacement,
    overlayId,
    kind,
    parentId,
  ]);

  // Keep the generated overlay mounted only while open. The placement effect
  // resets visibility before the browser can paint a stale position.
  const renderPortalRoot =
    portalRoot && ownerDocument && portalRoot.ownerDocument === ownerDocument ? portalRoot : null;
  if (!open || !renderPortalRoot) return null;

  return createPortal(
    <OverlayParentContext.Provider value={overlayId}>
      <div
        ref={floatingRef}
        id={id}
        className={className}
        style={posStyle}
        data-varve-overlay="true"
        data-overlay-id={overlayId}
        data-overlay-kind={kind}
        data-overlay-state={posStyle.visibility === 'visible' ? 'visible' : 'measuring'}
      >
        {children}
      </div>
    </OverlayParentContext.Provider>,
    renderPortalRoot,
  );
}
