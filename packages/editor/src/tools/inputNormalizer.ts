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
  const isPen = ev.pointerType === 'pen';
  const pressure = isPen
    ? Math.max(0, Math.min(1, ev.pressure))
    : ev.pointerType === 'touch'
      ? Math.max(0, Math.min(1, ev.pressure))
      : 0.5;

  const tiltX = ev.tiltX ?? 0;
  const tiltY = ev.tiltY ?? 0;
  const twist = ev.twist ?? -1;

  const altitude = ev.altitudeAngle ?? (Math.PI / 2) * (1 - tiltY / 90);
  const azimuth = ev.azimuthAngle ?? Math.atan2(tiltX, tiltY);
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
    tiltX: Math.max(-90, Math.min(90, tiltX)),
    tiltY: Math.max(-90, Math.min(90, tiltY)),
    twist: twist >= 0 ? twist % 360 : -1,
    tangentialPressure: Math.max(
      -1,
      Math.min(1, (ev as PointerEvent & { tangentialPressure?: number }).tangentialPressure ?? 0),
    ),
    width: Math.max(0, (ev as PointerEvent & { width?: number }).width ?? 1),
    height: Math.max(0, (ev as PointerEvent & { height?: number }).height ?? 1),
    pointerType: (ev.pointerType as 'mouse' | 'pen' | 'touch') || 'mouse',
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

  if (events.length === 0) {
    events.push(normalizeInputEvent(ev));
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

  return events;
}

/**
 * Convert a NormalizedInputEvent to a StrokePoint for the brush engine.
 * Requires the previous point for direction/speed calculation.
 */
export function inputToStrokePoint(
  input: NormalizedInputEvent,
  world: { x: number; y: number },
  prevPoint?: { x: number; y: number; time: number },
): StrokePoint {
  let speed = 0;
  let direction = 0;

  if (prevPoint && input.time > prevPoint.time) {
    const dx = world.x - prevPoint.x;
    const dy = world.y - prevPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dt = (input.time - prevPoint.time) / 1000;
    if (dt > 0) {
      speed = dist / dt;
    }
    direction = Math.atan2(dy, dx);
  }

  const avgTiltDeg = (input.tiltX + input.tiltY) / 2;

  return {
    x: world.x,
    y: world.y,
    pressure: input.pressure,
    tilt: avgTiltDeg,
    direction,
    speed,
    time: input.time,
  };
}

/**
 * Compute a zoom-aware drag threshold. At high zoom, small CSS-pixel
 * movements represent tiny world-space movements. This ensures consistent
 * drag thresholds in world space across zoom levels.
 */
export function zoomAwareDragThreshold(cssPixels: number, zoom: number): number {
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
