/**
 * Coordinate and ownership primitives shared by floating UI surfaces.
 *
 * A browser `clientX`/`clientY` pair is a viewport point. Keeping that fact in
 * the value makes it difficult to accidentally feed page or canvas-world
 * coordinates into a `position: fixed` overlay.
 */

import type { Placement, VirtualElement } from '@floating-ui/dom';

export interface ViewportPoint {
  readonly space: 'viewport';
  readonly x: number;
  readonly y: number;
}

/** Page/document coordinates. Convert these before feeding a fixed overlay. */
export interface PagePoint {
  readonly space: 'page';
  readonly x: number;
  readonly y: number;
}

/** OS screen coordinates. These are never valid Floating UI viewport inputs. */
export interface ScreenPoint {
  readonly space: 'screen';
  readonly x: number;
  readonly y: number;
}

/** Canvas-world coordinates. Convert through the active camera first. */
export interface CanvasWorldPoint {
  readonly space: 'canvas-world';
  readonly x: number;
  readonly y: number;
}

export interface ElementAnchor {
  readonly kind: 'element';
  readonly element: HTMLElement;
}

export interface RangeAnchor {
  readonly kind: 'range';
  readonly range: Range;
  readonly contextElement?: HTMLElement | null;
}

export interface PointAnchor {
  readonly kind: 'point';
  readonly point: ViewportPoint;
  readonly ownerDocument: Document;
  /** Real context used for clipping/update ownership; the point stays fixed. */
  readonly contextElement?: HTMLElement | null;
}

export type OverlayAnchor = ElementAnchor | PointAnchor | RangeAnchor;

export function viewportPoint(x: number, y: number): ViewportPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`Viewport coordinates must be finite: (${x}, ${y})`);
  }
  return { space: 'viewport', x, y };
}

export function pagePoint(x: number, y: number): PagePoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`Page coordinates must be finite: (${x}, ${y})`);
  }
  return { space: 'page', x, y };
}

export function screenPoint(x: number, y: number): ScreenPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`Screen coordinates must be finite: (${x}, ${y})`);
  }
  return { space: 'screen', x, y };
}

export function canvasWorldPoint(x: number, y: number): CanvasWorldPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`Canvas-world coordinates must be finite: (${x}, ${y})`);
  }
  return { space: 'canvas-world', x, y };
}

/** Convert document/page coordinates into the viewport space required by fixed UI. */
export function pageToViewport(point: PagePoint, ownerDocument: Document): ViewportPoint {
  const view = ownerDocument.defaultView;
  return viewportPoint(point.x - (view?.scrollX ?? 0), point.y - (view?.scrollY ?? 0));
}

export function elementAnchor(element: HTMLElement): ElementAnchor {
  return { kind: 'element', element };
}

export function pointAnchor(
  point: ViewportPoint,
  ownerDocument: Document,
  contextElement?: HTMLElement | null,
): PointAnchor {
  if (point.space !== 'viewport') {
    throw new TypeError('Point anchors require a viewport point');
  }
  if (contextElement && contextElement.ownerDocument !== ownerDocument) {
    throw new TypeError('The context element must belong to the point anchor document');
  }
  return { kind: 'point', point, ownerDocument, contextElement };
}

export function rangeAnchor(range: Range, contextElement?: HTMLElement | null): RangeAnchor {
  const ownerDocument = range.startContainer.ownerDocument;
  if (!ownerDocument) throw new TypeError('A range anchor must belong to a document');
  if (contextElement && contextElement.ownerDocument !== ownerDocument) {
    throw new TypeError('The range context element must belong to the range document');
  }
  return { kind: 'range', range, contextElement };
}

/**
 * Build the zero-size reference Floating UI expects for a context point.
 * `contextElement` is deliberately retained as metadata by Floating UI so
 * clipping can be resolved against the real surface when one is available.
 */
export function virtualPointReference(anchor: PointAnchor): VirtualElement {
  const { x, y } = anchor.point;
  const rect = {
    x,
    y,
    left: x,
    top: y,
    right: x,
    bottom: y,
    width: 0,
    height: 0,
    toJSON: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 }),
  } as DOMRect;

  return {
    getBoundingClientRect: () => rect,
    contextElement: anchor.contextElement ?? undefined,
  };
}

/** Adapt a DOM Range to Floating UI without losing its owner/context metadata. */
export function virtualRangeReference(anchor: RangeAnchor): VirtualElement {
  return {
    getBoundingClientRect: () => anchor.range.getBoundingClientRect(),
    contextElement: anchor.contextElement ?? undefined,
  };
}

export function ownerDocumentForAnchor(
  anchor: OverlayAnchor | null | undefined,
  fallback?: Document,
): Document | null {
  if (anchor?.kind === 'element') return anchor.element.ownerDocument;
  if (anchor?.kind === 'point') return anchor.ownerDocument;
  if (anchor?.kind === 'range')
    return anchor.range.startContainer.ownerDocument ?? fallback ?? null;
  return fallback ?? (typeof document !== 'undefined' ? document : null);
}

export function portalRootForAnchor(
  ownerDocument: Document,
  anchor: OverlayAnchor | null | undefined,
): HTMLElement | null {
  const element =
    anchor?.kind === 'element'
      ? anchor.element
      : anchor?.kind === 'point' || anchor?.kind === 'range'
        ? anchor.contextElement
        : undefined;
  // A native dialog is in the browser top layer. Keeping its descendants in
  // the dialog preserves that stacking context in Chromium, WebKit, and the
  // WebView implementations used by Tauri.
  const dialog = element?.closest('dialog');
  if (dialog?.ownerDocument === ownerDocument) return dialog;
  return ownerDocument.body ?? ownerDocument.documentElement;
}

export interface SafeViewportRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
  readonly padding: number;
}

export function safeViewportRect(ownerDocument: Document, padding = 8): SafeViewportRect {
  const view = ownerDocument.defaultView;
  const rawWidth = view?.innerWidth ?? ownerDocument.documentElement.clientWidth;
  const rawHeight = view?.innerHeight ?? ownerDocument.documentElement.clientHeight;
  const width = Number.isFinite(rawWidth) ? Math.max(0, rawWidth) : 0;
  const height = Number.isFinite(rawHeight) ? Math.max(0, rawHeight) : 0;
  const inset = Math.max(0, padding);
  const left = Math.min(inset, width);
  const top = Math.min(inset, height);
  const right = Math.max(left, width - inset);
  const bottom = Math.max(top, height - inset);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    padding: inset,
  };
}

export type OverlayDirection = 'ltr' | 'rtl';

/** Read writing direction from the anchor's owner document, never the main window. */
export function directionForAnchor(
  anchor: OverlayAnchor | null | undefined,
  ownerDocument: Document,
): OverlayDirection {
  const element =
    anchor?.kind === 'element'
      ? anchor.element
      : anchor?.kind === 'point' || anchor?.kind === 'range'
        ? anchor.contextElement
        : undefined;
  const view = ownerDocument.defaultView;
  if (!element || !view) return 'ltr';
  try {
    return view.getComputedStyle(element).direction === 'rtl' ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}

/**
 * Convert a physical side used by the legacy call sites into logical
 * inline-end/inline-start placement for RTL menus. Vertical start/end remains
 * Floating UI's logical alignment, which its owner-document platform resolves.
 */
export function resolvePlacementForDirection(
  placement: Placement,
  direction: OverlayDirection,
  logical = false,
): Placement {
  if (!logical || direction !== 'rtl') return placement;
  const [side, alignment] = placement.split('-') as [string, string | undefined];
  const resolvedSide = side === 'right' ? 'left' : side === 'left' ? 'right' : side;
  return (alignment ? `${resolvedSide}-${alignment}` : resolvedSide) as Placement;
}
