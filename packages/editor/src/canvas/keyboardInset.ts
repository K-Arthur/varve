/**
 * Keyboard and visual-viewport inset model.
 *
 * The on-screen keyboard (OSK) changes the *visual* viewport without changing
 * the layout viewport, so a `100dvh` shell cannot see it (research:
 * MDN VisualViewport, Chrome's VirtualKeyboard API guide — see
 * `docs/audits/chromeos-stage4-input-responsive-2026-09-12.md`).
 *
 * Signals, in preferred order:
 *
 * 1. `navigator.virtualKeyboard.boundingRect` when the VirtualKeyboard
 *    API is present and actually reports a keyboard. Chromium exposes the
 *    API; the page does NOT opt into `overlaysContent`, so the browser keeps
 *    its default viewport behavior and this is only used as a measurement.
 * 2. `window.visualViewport` height loss versus the layout viewport height.
 *    This is the default Chromium behavior when the OSK resizes the visual
 *    viewport, and the only signal on engines without the VirtualKeyboard API.
 * 3. Nothing. Callers must treat `keyboardHeight` 0 as "unknown or closed" —
 *    never as "keyboard is closed for sure".
 *
 * User pinch-zoom also shrinks the visual viewport and must not be mistaken
 * for a keyboard: the controller requires `scale` to be ~1 and the layout
 * width to be essentially unchanged before deriving an inset.
 *
 * The module never calls `preventDefault`, never mutates `overlaysContent`,
 * and never disables page zoom.
 */

export const MIN_KEYBOARD_INSET_CSS_PX = 1;
const MAX_PINCH_SCALE_FOR_KEYBOARD = 1.05;
const WIDTH_TOLERANCE = 0.9;

export interface KeyboardInset {
  /** Bottom inset reserved by the virtual keyboard, in CSS pixels. */
  keyboardHeight: number;
  /** Visual viewport height in CSS pixels (layout height when unavailable). */
  visualViewportHeight: number;
  /** Visual viewport top offset in CSS pixels (0 when unavailable). */
  visualViewportOffsetTop: number;
  /** Visual viewport left offset in CSS pixels (0 when unavailable). */
  visualViewportOffsetLeft: number;
  /** Layout viewport height (`window.innerHeight`) in CSS pixels. */
  layoutViewportHeight: number;
  /** Virtual keyboard rectangle in layout-viewport coordinates, when reported. */
  keyboardBounds: KeyboardBounds | null;
  /** True when a reported keyboard is not a bottom-docked, full-width surface. */
  isFloatingKeyboard: boolean;
  /** True when valid keyboard geometry is reported or a bottom inset is inferred. */
  isKeyboardLikelyOpen: boolean;
}

export interface KeyboardBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KeyboardInsetSignals {
  layoutViewportWidth: number | null;
  layoutViewportHeight: number | null;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
  visualViewportOffsetTop: number | null;
  visualViewportOffsetLeft: number | null;
  visualViewportScale: number | null;
  /** `navigator.virtualKeyboard.boundingRect`, in layout-viewport coordinates. */
  keyboardBoundingRect: KeyboardBounds | null;
}

function finiteNonNegative(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Pure derivation of the effective bottom inset from raw signals. Unit-tested
 * with the exact shapes a Chromium browser and the Playwright emulation layer
 * produce.
 */
export function computeKeyboardInset(signals: KeyboardInsetSignals): KeyboardInset {
  const layoutHeight = finiteNonNegative(signals.layoutViewportHeight, 0);
  const layoutWidth = finiteNonNegative(signals.layoutViewportWidth, 0);
  const visualHeight =
    signals.visualViewportHeight !== null && Number.isFinite(signals.visualViewportHeight)
      ? Math.max(0, signals.visualViewportHeight)
      : layoutHeight;
  const visualOffsetTop =
    signals.visualViewportOffsetTop !== null && Number.isFinite(signals.visualViewportOffsetTop)
      ? Math.max(0, signals.visualViewportOffsetTop)
      : 0;
  const visualOffsetLeft =
    signals.visualViewportOffsetLeft !== null && Number.isFinite(signals.visualViewportOffsetLeft)
      ? Math.max(0, signals.visualViewportOffsetLeft)
      : 0;
  const visualWidth = finiteNonNegative(signals.visualViewportWidth, layoutWidth);
  const visualBottom = Math.min(layoutHeight, visualOffsetTop + visualHeight);
  const visualRight = Math.min(layoutWidth, visualOffsetLeft + visualWidth);

  let keyboardHeight = 0;
  let keyboardBounds: KeyboardBounds | null = null;
  let isFloatingKeyboard = false;
  const reported = signals.keyboardBoundingRect;
  if (
    reported &&
    [reported.x, reported.y, reported.width, reported.height].every(Number.isFinite)
  ) {
    const x = Math.max(0, reported.x);
    const y = Math.max(0, reported.y);
    const right = Math.min(layoutWidth, reported.x + reported.width);
    const bottom = Math.min(layoutHeight, reported.y + reported.height);
    const width = Math.max(0, right - x);
    const height = Math.max(0, bottom - y);
    if (width >= MIN_KEYBOARD_INSET_CSS_PX && height >= MIN_KEYBOARD_INSET_CSS_PX) {
      keyboardBounds = { x, y, width, height };
      const touchesLayoutBottom = reported.y + reported.height >= layoutHeight - 1;
      const spansLayoutWidth = layoutWidth <= 0 || width >= layoutWidth * 0.8;
      isFloatingKeyboard = !(touchesLayoutBottom && spansLayoutWidth);
      if (!isFloatingKeyboard && visualRight > x && visualOffsetLeft < right) {
        // Reserve only the keyboard area that still intersects the visible
        // viewport. If the viewport already ends at the keyboard top this is
        // zero, avoiding a second subtraction for the same obstruction.
        keyboardHeight = Math.max(0, Math.min(visualBottom, bottom) - Math.max(visualOffsetTop, y));
      }
    }
  } else if (layoutHeight > 0) {
    const scale = signals.visualViewportScale;
    const scaleLooksUnzoomed =
      typeof scale !== 'number' || !Number.isFinite(scale) || scale <= MAX_PINCH_SCALE_FOR_KEYBOARD;
    const widthLooksUnchanged =
      layoutWidth <= 0 ||
      typeof visualWidth !== 'number' ||
      !Number.isFinite(visualWidth) ||
      visualWidth >= layoutWidth * WIDTH_TOLERANCE;
    if (scaleLooksUnzoomed && widthLooksUnchanged) {
      keyboardHeight = Math.max(0, layoutHeight - visualOffsetTop - visualHeight);
    }
  }

  if (layoutHeight > 0) keyboardHeight = Math.min(keyboardHeight, layoutHeight);
  if (keyboardHeight < MIN_KEYBOARD_INSET_CSS_PX) keyboardHeight = 0;

  return {
    keyboardHeight,
    visualViewportHeight: visualHeight,
    visualViewportOffsetTop: visualOffsetTop,
    visualViewportOffsetLeft: visualOffsetLeft,
    layoutViewportHeight: layoutHeight,
    keyboardBounds,
    isFloatingKeyboard,
    isKeyboardLikelyOpen: keyboardHeight > 0 || keyboardBounds !== null,
  };
}

/** Read the current signals from a window. Pure read; no listeners. */
export function readKeyboardInsetSignals(ownerWindow: Window): KeyboardInsetSignals {
  const visual = ownerWindow.visualViewport;
  const virtualKeyboard = (
    ownerWindow.navigator as Navigator & {
      virtualKeyboard?: { boundingRect?: DOMRect };
    }
  ).virtualKeyboard;
  const boundingRect = virtualKeyboard?.boundingRect;
  return {
    layoutViewportWidth: ownerWindow.innerWidth,
    layoutViewportHeight: ownerWindow.innerHeight,
    visualViewportWidth: visual?.width ?? null,
    visualViewportHeight: visual?.height ?? null,
    visualViewportOffsetTop: visual?.offsetTop ?? null,
    visualViewportOffsetLeft: visual?.offsetLeft ?? null,
    visualViewportScale: visual?.scale ?? null,
    keyboardBoundingRect:
      boundingRect &&
      [boundingRect.x, boundingRect.y, boundingRect.width, boundingRect.height].every(
        Number.isFinite,
      )
        ? {
            x: boundingRect.x,
            y: boundingRect.y,
            width: boundingRect.width,
            height: boundingRect.height,
          }
        : null,
  };
}

export function readKeyboardInset(ownerWindow: Window): KeyboardInset {
  return computeKeyboardInset(readKeyboardInsetSignals(ownerWindow));
}

/**
 * Subscribe to every signal that can change the effective inset.
 *
 * Returns an unsubscribe function. The callback is invoked once synchronously
 * with the current value so callers never wait a frame for first paint.
 */
export function subscribeToKeyboardInset(
  ownerWindow: Window,
  onChange: (inset: KeyboardInset) => void,
): () => void {
  let scheduled = false;
  let lastKeyboardHeight = -1;
  let lastVisualHeight = -1;
  let lastOffsetTop = -1;
  let lastOffsetLeft = -1;
  let lastKeyboardBounds = '';
  let lastFloating = false;

  const emit = (): void => {
    scheduled = false;
    const next = readKeyboardInset(ownerWindow);
    if (
      next.keyboardHeight === lastKeyboardHeight &&
      next.visualViewportHeight === lastVisualHeight &&
      next.visualViewportOffsetTop === lastOffsetTop &&
      next.visualViewportOffsetLeft === lastOffsetLeft &&
      JSON.stringify(next.keyboardBounds) === lastKeyboardBounds &&
      next.isFloatingKeyboard === lastFloating
    ) {
      return;
    }
    lastKeyboardHeight = next.keyboardHeight;
    lastVisualHeight = next.visualViewportHeight;
    lastOffsetTop = next.visualViewportOffsetTop;
    lastOffsetLeft = next.visualViewportOffsetLeft;
    lastKeyboardBounds = JSON.stringify(next.keyboardBounds);
    lastFloating = next.isFloatingKeyboard;
    onChange(next);
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    if (typeof ownerWindow.requestAnimationFrame === 'function') {
      ownerWindow.requestAnimationFrame(emit);
    } else {
      ownerWindow.setTimeout(emit, 0);
    }
  };

  const visual = ownerWindow.visualViewport;
  visual?.addEventListener('resize', schedule);
  visual?.addEventListener('scroll', schedule);
  ownerWindow.addEventListener('resize', schedule);
  ownerWindow.addEventListener('orientationchange', schedule);
  const virtualKeyboard = (
    ownerWindow.navigator as Navigator & {
      virtualKeyboard?: EventTarget;
    }
  ).virtualKeyboard;
  virtualKeyboard?.addEventListener('geometrychange', schedule);
  ownerWindow.document.addEventListener('visibilitychange', schedule);

  emit();

  return () => {
    visual?.removeEventListener('resize', schedule);
    visual?.removeEventListener('scroll', schedule);
    ownerWindow.removeEventListener('resize', schedule);
    ownerWindow.removeEventListener('orientationchange', schedule);
    virtualKeyboard?.removeEventListener('geometrychange', schedule);
    ownerWindow.document.removeEventListener('visibilitychange', schedule);
  };
}

export const KEYBOARD_INSET_PROPERTY = '--keyboard-inset-bottom';
export const VISUAL_VIEWPORT_HEIGHT_PROPERTY = '--visual-viewport-height';
export const VISUAL_VIEWPORT_OFFSET_TOP_PROPERTY = '--visual-viewport-offset-top';
export const VISUAL_VIEWPORT_OFFSET_LEFT_PROPERTY = '--visual-viewport-offset-left';
export const VIRTUAL_KEYBOARD_X_PROPERTY = '--virtual-keyboard-x';
export const VIRTUAL_KEYBOARD_Y_PROPERTY = '--virtual-keyboard-y';
export const VIRTUAL_KEYBOARD_WIDTH_PROPERTY = '--virtual-keyboard-width';
export const VIRTUAL_KEYBOARD_HEIGHT_PROPERTY = '--virtual-keyboard-height';

/**
 * Publish the inset as CSS custom properties on the document element.
 *
 * Falls back to no-ops when the document or its defaultView is unavailable
 * (jsdom without a window, detached documents) so unit mounts never throw.
 */
export function applyKeyboardInsetToDocument(ownerDocument: Document, inset: KeyboardInset): void {
  const root = ownerDocument?.documentElement;
  if (!root?.style?.setProperty) return;
  root.style.setProperty(KEYBOARD_INSET_PROPERTY, `${inset.keyboardHeight}px`);
  root.style.setProperty(VISUAL_VIEWPORT_HEIGHT_PROPERTY, `${inset.visualViewportHeight}px`);
  root.style.setProperty(VISUAL_VIEWPORT_OFFSET_TOP_PROPERTY, `${inset.visualViewportOffsetTop}px`);
  root.style.setProperty(
    VISUAL_VIEWPORT_OFFSET_LEFT_PROPERTY,
    `${inset.visualViewportOffsetLeft}px`,
  );
  const bounds = inset.keyboardBounds;
  root.style.setProperty(VIRTUAL_KEYBOARD_X_PROPERTY, `${bounds?.x ?? 0}px`);
  root.style.setProperty(VIRTUAL_KEYBOARD_Y_PROPERTY, `${bounds?.y ?? 0}px`);
  root.style.setProperty(VIRTUAL_KEYBOARD_WIDTH_PROPERTY, `${bounds?.width ?? 0}px`);
  root.style.setProperty(VIRTUAL_KEYBOARD_HEIGHT_PROPERTY, `${bounds?.height ?? 0}px`);
  root.dataset.virtualKeyboardOpen = String(inset.isKeyboardLikelyOpen);
  root.dataset.virtualKeyboardFloating = String(inset.isFloatingKeyboard);
}

/**
 * Install the document-level publisher. Returns a disposer that removes the
 * listeners and the geometry properties/data attributes it owns.
 */
export function installKeyboardInsetPublisher(ownerDocument: Document): () => void {
  const ownerWindow = ownerDocument?.defaultView;
  if (!ownerWindow) return () => undefined;
  const unsubscribe = subscribeToKeyboardInset(ownerWindow, (inset) => {
    applyKeyboardInsetToDocument(ownerDocument, inset);
  });
  return () => {
    unsubscribe();
    const root = ownerDocument.documentElement;
    root.style.removeProperty(KEYBOARD_INSET_PROPERTY);
    root.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_PROPERTY);
    root.style.removeProperty(VISUAL_VIEWPORT_OFFSET_TOP_PROPERTY);
    root.style.removeProperty(VISUAL_VIEWPORT_OFFSET_LEFT_PROPERTY);
    root.style.removeProperty(VIRTUAL_KEYBOARD_X_PROPERTY);
    root.style.removeProperty(VIRTUAL_KEYBOARD_Y_PROPERTY);
    root.style.removeProperty(VIRTUAL_KEYBOARD_WIDTH_PROPERTY);
    root.style.removeProperty(VIRTUAL_KEYBOARD_HEIGHT_PROPERTY);
    delete root.dataset.virtualKeyboardOpen;
    delete root.dataset.virtualKeyboardFloating;
  };
}
