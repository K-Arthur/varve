/**
 * Wheel-event classification — distinguishes precision trackpad input
 * from traditional detented mouse wheels.
 *
 * Browsers do not expose a universal "trackpad vs mouse" flag. The
 * heuristics here are conservative and based on real-world event
 * patterns documented in the W3C UIEvents spec and Chromium/Firefox
 * implementation notes:
 *
 * - Trackpads emit `deltaMode = 0` (DOM_DELTA_PIXEL) with small,
 *   high-frequency deltas and momentum tails.
 * - Mouse wheels emit `deltaMode = 1` (DOM_DELTA_LINE) with larger,
 *   discrete detents (typically ±100/±120 per notch in pixel terms).
 * - Some precision mice (Logitech MX Master) emit pixel-mode deltas
 *   with larger magnitudes — the magnitude threshold separates these
 *   from trackpad pixel-mode events.
 *
 * The classifier preserves an `unknown` result. Unknown input remains fully
 * usable as direct pan/zoom, but does not receive application-side inertia:
 * adding momentum to an unrecognised precision device is how OS momentum tails
 * become doubled and sticky. A later sequence can still resolve to mouse or
 * trackpad through wheelGesture.ts.
 *
 * Research basis: W3C UIEvents WheelEvent, Chromium wheel event
 * translation, Firefox DOMMouseScroll, MDN WheelEvent.
 */

/**
 * Result of classifying a wheel event.
 */
export type WheelSource = 'trackpad' | 'mouse' | 'unknown';

/** The fields a classifier actually reads from a wheel event. */
export type WheelDeltaInput = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>;

/**
 * Classify a wheel event as trackpad or mouse-wheel.
 *
 * Heuristics (evaluated in order):
 * 1. `deltaMode === 1` (LINE) or `deltaMode === 2` (PAGE) → mouse wheel.
 *    Trackpads never produce line/page mode.
 * 2. `deltaMode === 0` (PIXEL) with `|deltaY|` (or `|deltaX|`) ≥ 120 →
 *    mouse wheel (detented wheels report ~100-120 px per notch in
 *    pixel mode on some platforms).
 * 3. `deltaMode === 0` with small deltas (< 50) → trackpad.
 * 4. Otherwise → unknown (direct manipulation continues without app inertia).
 */
export function classifyWheelEvent(e: WheelDeltaInput): WheelSource {
  // Line-mode or page-mode is always a mouse wheel.
  if (e.deltaMode === 1 || e.deltaMode === 2) return 'mouse';

  // Pixel-mode: distinguish by magnitude.
  if (e.deltaMode === 0) {
    const mag = Math.max(Math.abs(e.deltaX), Math.abs(e.deltaY));
    // Precision trackpads rarely emit single-event deltas above ~50 px.
    // Detented mice in pixel mode typically emit 100-120 px per notch.
    if (mag >= 120) return 'mouse';
    if (mag > 0 && mag < 50) return 'trackpad';
  }

  return 'unknown';
}

/**
 * Normalize a wheel delta to stable internal pixel units.
 *
 * - `deltaMode 0` (PIXEL): pass through (already in CSS pixels).
 * - `deltaMode 1` (LINE): multiply by the app's explicit 16 CSS-pixel policy.
 * - `deltaMode 2` (PAGE): multiply by the element's client height.
 */
/** Explicit application policy for DOM_DELTA_LINE, not a universal font metric. */
export const DEFAULT_WHEEL_LINE_HEIGHT_CSS_PX = 16;

export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  clientHeight: number,
): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * DEFAULT_WHEEL_LINE_HEIGHT_CSS_PX;
  if (deltaMode === 2) {
    const height = Number.isFinite(clientHeight) ? Math.max(0, clientHeight) : 0;
    return delta * height;
  }
  return delta;
}

/**
 * Normalized wheel-action resolution — the single decision point the canvas
 * wheel handler delegates to, so mouse wheels, trackpads, pinch-emitted
 * ctrl+wheel, and horizontal wheels are classified consistently.
 *
 * Returns a semantic action plus the fully-normalized deltas/scale so callers
 * never re-derive deltaMode or classification themselves.
 */
export interface ResolvedWheelAction {
  /** Which gesture the event should drive. */
  kind: 'zoom' | 'pan';
  /** Classified input source (for adaptive momentum / sensitivity). */
  source: WheelSource;
  /**
   * Pan deltas to ADD to the current pan (already sign-corrected so positive
   * scroll-up moves content up, matching the old `-delta` convention).
   * For `shiftHeld`, `deltaX` carries the vertical delta (horizontal pan).
   */
  deltaX: number;
  deltaY: number;
  /** True when the event was a Shift+scroll horizontal pan. */
  shiftHeld: boolean;
  /** For `zoom`: multiplicative scale factor (>1 zooms in). */
  scale: number;
  /**
   * Whether the app should apply its own inertia on top of this event.
   * Precision trackpads deliver their own momentum, so app-side inertia
   * would double it; mouse wheels need it. `unknown` (borderline) stays
   * direct-only until sequence evidence resolves it.
   */
  applyInertia: boolean;
}

const ZOOM_DELTA_CLAMP = 24;
const ZOOM_EXPONENT = 0.01;

export function resolveWheelAction(e: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  clientHeight: number;
  /** Sequence-aware source from wheelGesture.ts; when omitted, per-event. */
  source?: WheelSource;
}): ResolvedWheelAction {
  const source = e.source ?? classifyWheelEvent(e);
  const normX = normalizeWheelDelta(e.deltaX, e.deltaMode, e.clientHeight);
  const normY = normalizeWheelDelta(e.deltaY, e.deltaMode, e.clientHeight);

  // Ctrl/Cmd + wheel is the platform-standard pinch-to-zoom signal (Chromium
  // converts trackpad pinch into ctrlKey+wheel sequences; some mice also bind
  // it as zoom).
  if (e.ctrlKey || e.metaKey) {
    const d = Math.max(-ZOOM_DELTA_CLAMP, Math.min(ZOOM_DELTA_CLAMP, normY));
    return {
      kind: 'zoom',
      source,
      deltaX: -normX,
      deltaY: -normY,
      shiftHeld: false,
      scale: Math.exp(-d * ZOOM_EXPONENT),
      applyInertia: false,
    };
  }

  // Shift + vertical wheel scrolls horizontally (mouse convention). Preserved
  // for trackpads too, where the user may hold Shift deliberately.
  if (e.shiftKey && normX === 0) {
    return {
      kind: 'pan',
      source,
      deltaX: -normY,
      deltaY: 0,
      shiftHeld: true,
      scale: 1,
      applyInertia: false,
    };
  }

  return {
    kind: 'pan',
    source,
    deltaX: -normX,
    deltaY: -normY,
    shiftHeld: false,
    scale: 1,
    applyInertia: source === 'mouse',
  };
}
