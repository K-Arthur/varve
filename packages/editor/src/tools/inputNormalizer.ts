/**
 * Input normalization — converts raw PointerEvent(s) into a canonical,
 * device-independent NormalizedInputEvent that preserves all available
 * stylus/pointer data while providing safe defaults for absent properties.
 *
 * Research basis: W3C Pointer Events L3 (2026 Rec), MDN PointerEvent API,
 *   WebKitGTK limitations, Chromium getCoalescedEvents/getPredictedEvents.
 *
 * Architecture:
 *   Raw PointerEvent(s) → NormalizedInputEvent → StrokePoint
 *   The pipeline is:
 *     1. collectSourceEvents(ev) → PointerEvent[] (coalesced + predicted)
 *     2. normalizeEvent(ev) → NormalizedInputEvent (one canonical record)
 *     3. NormalizedInputEvent → StrokePoint (for brush engine)
 *     4. NormalizedInputEvent → CapturedPoint (for vector freehand)
 */

import { isWebKitGTK } from '@varve/platform';
import type { StrokePoint } from '@varve/scene';
import { filterVelocity, normalizePressure, normalizeTilt, tiltAzimuth } from './pointerDynamics';

/**
 * Canonical normalized input event from a single pointer sample.
 * All fields have safe defaults; unavailable properties are 0 or the
 * specified default.
 */
export interface NormalizedInputEvent {
  /** Position in viewport (clientX/Y) */
  clientX: number;
  clientY: number;
  /** Normalized pressure 0-1. 0 = no pressure, 0.5 = mouse default, 1 = max. */
  pressure: number;
  /** Pointer tilt in degrees from the Z axis (0 = perpendicular). [0, 90] */
  tiltX: number;
  tiltY: number;
  /** Twist/barrel rotation in degrees [0, 359]. -1 when unavailable. */
  twist: number;
  /** Tangential pressure along barrel [-1, 1], 0 when unavailable. */
  tangentialPressure: number;
  /** Width and height of the contact ellipse in CSS pixels. Mouse = 1. */
  width: number;
  height: number;
  /** Pointer type as reported by the browser. */
  pointerType: 'mouse' | 'pen' | 'touch';
  /** Altitude angle in radians from the surface (0 = flat, PI/2 = perpendicular). */
  altitudeAngle: number;
  /** Azimuth angle in radians from the X axis. */
  azimuthAngle: number;
  /** True when this is a predicted event (may be inaccurate or delayed). */
  isPredicted: boolean;
  /** Timestamp in ms (performance.now epoch or PointerEvent.timeStamp). */
  time: number;
  /** True when the pen's eraser end is in use. */
  isEraser: boolean;
  /** True when this is the primary pointer in a multi-pointer session. */
  isPrimary: boolean;
  /** Unique pointer ID for this contact. */
  pointerId: number;
}

export interface PlatformCapabilities {
  /** Browser supports getCoalescedEvents(). */
  hasCoalescedEvents: boolean;
  /** Browser supports getPredictedEvents(). */
  hasPredictedEvents: boolean;
  /** Canvas supports OffscreenCanvas in the current context. */
  hasOffscreenCanvas: boolean;
  /** Current pointer type is pen (stylus). */
  isPen: boolean;
  /** Pressure data is available (not mouse-emulated). */
  hasPressureData: boolean;
  /** Tilt data is available. */
  hasTiltData: boolean;
  /** Twist/rotation data is available. */
  hasTwistData: boolean;
  /** WebKitGTK or other limited environment. */
  isLimited: boolean;
}

/** Detected platform capabilities. Populated once at init. */
let platformCaps: PlatformCapabilities | null = null;

export function detectPlatformCapabilities(): PlatformCapabilities {
  if (platformCaps) return platformCaps;

  const hasCoalesced = typeof PointerEvent.prototype.getCoalescedEvents === 'function';
  const hasPredicted = typeof PointerEvent.prototype.getPredictedEvents === 'function';
  const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

  const isWebKit = isWebKitGTK();

  platformCaps = {
    hasCoalescedEvents: hasCoalesced,
    hasPredictedEvents: hasPredicted,
    hasOffscreenCanvas: hasOffscreen,
    isPen: false,
    hasPressureData: false,
    hasTiltData: false,
    hasTwistData: false,
    isLimited: isWebKit && !hasCoalesced,
  };
  return platformCaps;
}

/**
 * Check whether a given PointerEvent's stylus data is genuine vs
 * browser-emulated (e.g. mouse events on WebKitGTK that lack real
 * pressure/tilt but report pointerType='pen' anyway).
 */
export function hasGenuineStylusData(ev: PointerEvent): boolean {
  if (ev.pointerType !== 'pen') return false;
  return ev.pressure > 0 || ev.tiltX !== 0 || ev.tiltY !== 0 || ev.twist !== 0;
}

/**
 * Normalize a single raw PointerEvent into a NormalizedInputEvent.
 * All properties are safely defaulted.
 */
export function normalizeInputEvent(ev: PointerEvent): NormalizedInputEvent {
  const pointerType = normalizePointerType(ev.pointerType);
  const pressure = normalizePressure(ev.pressure, pointerType);

  const tiltX = clampFinite(ev.tiltX, -90, 90, 0);
  const tiltY = clampFinite(ev.tiltY, -90, 90, 0);
  const twist = ev.twist ?? -1;

  const altitude = Number.isFinite(ev.altitudeAngle)
    ? clampFinite(ev.altitudeAngle, 0, Math.PI / 2, Math.PI / 2)
    : (Math.PI / 2) * (1 - tiltY / 90);
  const azimuth = Number.isFinite(ev.azimuthAngle)
    ? ev.azimuthAngle
    : (tiltAzimuth(tiltX, tiltY) ?? 0);
  const now = performance.now();
  const eventTime = ev.timeStamp;
  // Modern PointerEvent timestamps share performance.timeOrigin. Reject
  // legacy epoch-domain or malformed values before mixing them with RAF time.
  const time =
    Number.isFinite(eventTime) && eventTime >= 0 && Math.abs(eventTime - now) <= 60_000
      ? eventTime
      : now;

  return {
    clientX: ev.clientX,
    clientY: ev.clientY,
    pressure,
    tiltX,
    tiltY,
    twist: twist >= 0 ? twist % 360 : -1,
    tangentialPressure: clampFinite(
      (ev as PointerEvent & { tangentialPressure?: number }).tangentialPressure,
      -1,
      1,
      0,
    ),
    width: clampFinite((ev as PointerEvent & { width?: number }).width, 0, Number.MAX_VALUE, 1),
    height: clampFinite((ev as PointerEvent & { height?: number }).height, 0, Number.MAX_VALUE, 1),
    pointerType,
    altitudeAngle: Math.max(0, Math.min(Math.PI / 2, altitude)),
    azimuthAngle: azimuth,
    isPredicted: false,
    time,
    isEraser:
      (ev as PointerEvent & { eraserButtons?: number }).pointerType === 'pen' && ev.button === 5,
    isPrimary: ev.isPrimary,
    pointerId: ev.pointerId,
  };
}

function clampFinite(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizePointerType(pointerType: string): NormalizedInputEvent['pointerType'] {
  return pointerType === 'pen' || pointerType === 'touch' || pointerType === 'mouse'
    ? pointerType
    : 'mouse';
}

/**
 * Collect all source events from a pointer event: coalesced sub-frame events,
 * then the primary event. When predicted events are available and requested,
 * they are appended at the end.
 */
export function collectSourceEvents(
  ev: PointerEvent,
  includePredicted: boolean = false,
): NormalizedInputEvent[] {
  const events: NormalizedInputEvent[] = [];

  if (typeof ev.getCoalescedEvents === 'function') {
    const coalesced = ev.getCoalescedEvents();
    if (coalesced.length > 0) {
      for (const c of coalesced) {
        events.push(normalizeInputEvent(c));
      }
    }
  }

  const primary = normalizeInputEvent(ev);
  const last = events[events.length - 1];
  if (
    !last ||
    last.clientX !== primary.clientX ||
    last.clientY !== primary.clientY ||
    last.time !== primary.time
  ) {
    events.push(primary);
  }

  if (includePredicted && typeof ev.getPredictedEvents === 'function') {
    const predicted = ev.getPredictedEvents();
    if (predicted.length > 0) {
      for (const p of predicted) {
        const norm = normalizeInputEvent(p);
        norm.isPredicted = true;
        events.push(norm);
      }
    }
  }

  return canonicalizeInputEvents(events);
}

/**
 * Put browser samples into the one order the stroke engine accepts.
 *
 * Browsers normally return a time-ordered coalesced packet, but WebViews and
 * synthetic test input have both produced out-of-order samples. Canonicalising
 * here also prevents the coalesced endpoint and parent pointermove from
 * becoming two paint samples. Confirmed input always wins over an identical
 * prediction; predictions remain a distinct, replaceable tail.
 */
export function canonicalizeInputEvents(
  events: readonly NormalizedInputEvent[],
): NormalizedInputEvent[] {
  const confirmed: Array<{ event: NormalizedInputEvent; index: number }> = [];
  const predicted: Array<{ event: NormalizedInputEvent; index: number }> = [];

  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) continue;
    const target = event.isPredicted ? predicted : confirmed;
    target.push({ event, index });
  }

  const byTimeThenArrival = (
    a: { event: NormalizedInputEvent; index: number },
    b: { event: NormalizedInputEvent; index: number },
  ) => (a.event.time === b.event.time ? a.index - b.index : a.event.time - b.event.time);
  confirmed.sort(byTimeThenArrival);
  predicted.sort(byTimeThenArrival);

  const result: NormalizedInputEvent[] = [];
  const seen = new Set<string>();
  for (const { event } of [...confirmed, ...predicted]) {
    const key = `${event.pointerId}:${event.time}:${event.clientX}:${event.clientY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result;
}

/**
 * Convert a NormalizedInputEvent to a StrokePoint for the brush engine.
 * Requires the previous point for direction/speed calculation.
 */
export function inputToStrokePoint(
  input: NormalizedInputEvent,
  world: { x: number; y: number },
  prevPoint?: { x: number; y: number; time: number; speed?: number; direction?: number },
): StrokePoint {
  let speed = prevPoint?.speed ?? 0;
  let direction = prevPoint?.direction ?? 0;

  if (prevPoint && input.time > prevPoint.time) {
    const dx = world.x - prevPoint.x;
    const dy = world.y - prevPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dt = (input.time - prevPoint.time) / 1000;
    if (dt > 0) speed = filterVelocity(prevPoint.speed ?? 0, dist / dt, dt);
    direction = dist > 0 ? Math.atan2(dy, dx) : (prevPoint.direction ?? 0);
  }

  const tilt = normalizeTilt(input.tiltX, input.tiltY);

  return {
    x: world.x,
    y: world.y,
    pressure: input.pressure,
    tilt,
    direction,
    speed,
    time: input.time,
    tiltAzimuth:
      tilt > 0
        ? Number.isFinite(input.azimuthAngle)
          ? input.azimuthAngle
          : tiltAzimuth(input.tiltX, input.tiltY)
        : null,
    twist: input.twist,
    tangentialPressure: input.tangentialPressure,
  };
}

/**
 * Convert a CSS-pixel distance into the equivalent world-space distance at
 * the current zoom.
 *
 * Only use this when the value is compared against a **world-space** delta.
 * A drag threshold compared against screen-space pointer motion must stay a
 * screen-space constant: dividing it by zoom makes the gesture require
 * `cssPixels / zoom` of hand movement, which is ~50 px at 6% zoom (the object
 * feels stuck) and ~0.2 px at 1600% (sub-pixel jitter starts a drag). See
 * `BaseTool.DRAG_THRESHOLD_CSS_PX`.
 */
export function worldDistanceForCssPixels(cssPixels: number, zoom: number): number {
  if (zoom <= 0) return cssPixels;
  return cssPixels / zoom;
}

/**
 * Evaluate platform support for a given stylus property.
 * Returns a human-readable string describing availability.
 */
export function describeStylusCapability(): string {
  const caps = detectPlatformCapabilities();
  const parts: string[] = [];
  if (caps.isPen) parts.push('pen');
  if (caps.hasPressureData) parts.push('pressure');
  if (caps.hasTiltData) parts.push('tilt');
  if (caps.hasTwistData) parts.push('twist');
  if (caps.hasCoalescedEvents) parts.push('coalesced');
  if (caps.hasPredictedEvents) parts.push('predicted');
  return parts.length > 0 ? parts.join(', ') : 'mouse only';
}
