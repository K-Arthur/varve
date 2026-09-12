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
 * 1. `navigator.virtualKeyboard.boundingRect.height` when the VirtualKeyboard
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
  /** Layout viewport height (`window.innerHeight`) in CSS pixels. */
  layoutViewportHeight: number;
  /** True when the measured inset is large enough to be a keyboard. */
  isKeyboardLikelyOpen: boolean;
}

export interface KeyboardInsetSignals {
  layoutViewportWidth: number | null;
  layoutViewportHeight: number | null;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
  visualViewportOffsetTop: number | null;
  visualViewportScale: number | null;
  /** `navigator.virtualKeyboard.boundingRect.height`, when available. */
  keyboardBoundingRectHeight: number | null;
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

  let keyboardHeight = 0;

  const reported = signals.keyboardBoundingRectHeight;
  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) {
    keyboardHeight = reported;
  } else if (layoutHeight > 0) {
    const scale = signals.visualViewportScale;
    const scaleLooksUnzoomed =
      typeof scale !== 'number' || !Number.isFinite(scale) || scale <= MAX_PINCH_SCALE_FOR_KEYBOARD;
    const visualWidth = signals.visualViewportWidth;
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
    layoutViewportHeight: layoutHeight,
    isKeyboardLikelyOpen: keyboardHeight > 0,
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
    visualViewportScale: visual?.scale ?? null,
    keyboardBoundingRectHeight:
      boundingRect && Number.isFinite(boundingRect.height) ? boundingRect.height : null,
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

  const emit = (): void => {
    scheduled = false;
    const next = readKeyboardInset(ownerWindow);
    if (
      next.keyboardHeight === lastKeyboardHeight &&
      next.visualViewportHeight === lastVisualHeight &&
      next.visualViewportOffsetTop === lastOffsetTop
    ) {
      return;
    }
    lastKeyboardHeight = next.keyboardHeight;
    lastVisualHeight = next.visualViewportHeight;
    lastOffsetTop = next.visualViewportOffsetTop;
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
}

/**
 * Install the document-level publisher. Returns a disposer that removes the
 * listeners and the three custom properties it owns.
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
  };
}
