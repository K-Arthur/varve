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
 * The classifier is intentionally permissive: when uncertain, it
 * defaults to `mouse` (the safer assumption for zoom behavior).
 *
 * Research basis: W3C UIEvents WheelEvent, Chromium wheel event
 * translation, Firefox DOMMouseScroll, MDN WheelEvent.
 */

/** Result of classifying a wheel event. */
export type WheelSource = 'trackpad' | 'mouse' | 'unknown';

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
 * 4. Otherwise → unknown (treat as mouse for safety).
 */
export function classifyWheelEvent(e: WheelEvent): WheelSource {
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
 * - `deltaMode 1` (LINE): multiply by 16 (standard line height).
 * - `deltaMode 2` (PAGE): multiply by the element's client height.
 */
export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  clientHeight: number,
): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * clientHeight;
  return delta;
}
