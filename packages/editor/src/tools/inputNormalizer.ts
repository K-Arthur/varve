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
  /** Pointer type used by the input policy. Unknown/custom values stay unknown. */
  pointerType: 'mouse' | 'pen' | 'touch' | 'unknown';
  /** Original browser-provided pointerType, retained for diagnostics. */
  rawPointerType: string;
  /** Button transition and active button bitfield for this sample. */
  button: number;
  buttons: number;
  /** Altitude angle in radians from the surface (0 = flat, PI/2 = perpendicular). */
  altitudeAngle: number;
  /** Azimuth angle in radians from the X axis. */
  azimuthAngle: number;
  /** True when this is a predicted event (may be inaccurate or delayed). */
  isPredicted: boolean;
  /** Timestamp in ms (performance.now epoch or PointerEvent.timeStamp). */
  time: number;
  /** Whether `time` came from a correlatable DOM timestamp rather than a fallback clock. */
  timestampTrusted?: boolean;
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

export type ObservedCapabilityStatus = 'unknown' | 'observed' | 'unavailable';

/**
 * Device observations are intentionally separate from API availability.
 * `PointerEvent` existing in a runtime does not prove that a connected pen
 * supplies pressure, tilt, twist, or an eraser channel.
 */
export interface ObservedInputCapabilities {
  pointerType: 'unknown' | 'mouse' | 'touch' | 'pen';
  pressure: ObservedCapabilityStatus;
  tilt: ObservedCapabilityStatus;
  twist: ObservedCapabilityStatus;
  eraser: ObservedCapabilityStatus;
}

/** Detected platform capabilities. Populated once at init. */
let platformCaps: PlatformCapabilities | null = null;

export function detectPlatformCapabilities(): PlatformCapabilities {
  if (platformCaps) return platformCaps;

  const pointerEventPrototype =
    typeof PointerEvent === 'function' ? PointerEvent.prototype : undefined;
  const hasCoalesced = typeof pointerEventPrototype?.getCoalescedEvents === 'function';
  const hasPredicted = typeof pointerEventPrototype?.getPredictedEvents === 'function';
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

let observedCapabilities: ObservedInputCapabilities = createUnknownCapabilities();
let observedPressureValues = new Set<number>();

function createUnknownCapabilities(): ObservedInputCapabilities {
  return {
    pointerType: 'unknown',
    pressure: 'unknown',
    tilt: 'unknown',
    twist: 'unknown',
    eraser: 'unknown',
  };
}

/** Record conservative, non-identifying capabilities from an actual sample. */
export function observeInputCapabilities(ev: PointerEvent): ObservedInputCapabilities {
  const pointerType = normalizePointerType(safeString(ev, 'pointerType', ''));
  observedCapabilities.pointerType = pointerType === 'unknown' ? 'unknown' : pointerType;
  if (pointerType !== 'pen') return { ...observedCapabilities };

  const pressure = safeNumber(ev, 'pressure', Number.NaN);
  if (Number.isFinite(pressure) && pressure >= 0 && pressure <= 1) {
    observedPressureValues.add(pressure);
    // A single default value is not evidence either way. Two distinct values
    // are the smallest useful observation that this channel is dynamic.
    if (observedPressureValues.size > 1) observedCapabilities.pressure = 'observed';
  } else {
    observedCapabilities.pressure = 'unavailable';
  }

  const tiltX = safeNumber(ev, 'tiltX', 0);
  const tiltY = safeNumber(ev, 'tiltY', 0);
  if (tiltX !== 0 || tiltY !== 0) observedCapabilities.tilt = 'observed';
  const twist = safeNumber(ev, 'twist', 0);
  if (twist !== 0 && twist >= 0) observedCapabilities.twist = 'observed';
  if (normalizeInputEvent(ev).isEraser) observedCapabilities.eraser = 'observed';
  return { ...observedCapabilities };
}

export function getObservedInputCapabilities(): ObservedInputCapabilities {
  return { ...observedCapabilities };
}

/** Test/diagnostics reset; it does not affect persisted settings. */
export function resetObservedInputCapabilities(): void {
  observedCapabilities = createUnknownCapabilities();
  observedPressureValues = new Set<number>();
}

/**
 * Check whether a given PointerEvent's stylus data is genuine vs
 * browser-emulated (e.g. mouse events on WebKitGTK that lack real
 * pressure/tilt but report pointerType='pen' anyway).
 */
export function hasGenuineStylusData(ev: PointerEvent): boolean {
  if (safeString(ev, 'pointerType', '') !== 'pen') return false;
  const pressure = safeNumber(ev, 'pressure', Number.NaN);
  return (
    (Number.isFinite(pressure) && pressure > 0 && Math.abs(pressure - 0.5) > 0.001) ||
    safeNumber(ev, 'tiltX', 0) !== 0 ||
    safeNumber(ev, 'tiltY', 0) !== 0 ||
    (safeNumber(ev, 'twist', 0) !== 0 && safeNumber(ev, 'twist', 0) >= 0)
  );
}

/**
 * Normalize a single raw PointerEvent into a NormalizedInputEvent.
 * All properties are safely defaulted.
 */
export function normalizeInputEvent(ev: PointerEvent): NormalizedInputEvent {
  const rawPointerType = safeString(ev, 'pointerType', '');
  const pointerType = normalizePointerType(rawPointerType);
  const pressure = normalizePressure(safeNumber(ev, 'pressure', Number.NaN), pointerType);

  const tiltX = clampFinite(safeNumber(ev, 'tiltX', Number.NaN), -90, 90, 0);
  const tiltY = clampFinite(safeNumber(ev, 'tiltY', Number.NaN), -90, 90, 0);
  const twist = safeNumber(ev, 'twist', -1);
  const tiltMagnitude = normalizeTilt(tiltX, tiltY);

  const altitudeValue = safeNumber(ev, 'altitudeAngle', Number.NaN);
  const altitude = Number.isFinite(altitudeValue)
    ? clampFinite(altitudeValue, 0, Math.PI / 2, Math.PI / 2)
    : Math.PI / 2 - (tiltMagnitude * Math.PI) / 180;
  const azimuthValue = safeNumber(ev, 'azimuthAngle', Number.NaN);
  const azimuth = Number.isFinite(azimuthValue) ? azimuthValue : (tiltAzimuth(tiltX, tiltY) ?? 0);
  const now = safeNow();
  const eventTime = safeNumber(ev, 'timeStamp', Number.NaN);
  // Modern PointerEvent timestamps share performance.timeOrigin. Reject
  // legacy epoch-domain or malformed values before mixing them with RAF time.
  const time =
    Number.isFinite(eventTime) && eventTime >= 0 && Math.abs(eventTime - now) <= 60_000
      ? eventTime
      : now;

  return {
    clientX: clampFinite(
      safeNumber(ev, 'clientX', Number.NaN),
      -Number.MAX_VALUE,
      Number.MAX_VALUE,
      0,
    ),
    clientY: clampFinite(
      safeNumber(ev, 'clientY', Number.NaN),
      -Number.MAX_VALUE,
      Number.MAX_VALUE,
      0,
    ),
    pressure,
    tiltX,
    tiltY,
    twist: Number.isFinite(twist) && twist >= 0 ? twist % 360 : -1,
    tangentialPressure: clampFinite(safeNumber(ev, 'tangentialPressure', Number.NaN), -1, 1, 0),
    width: clampFinite(safeNumber(ev, 'width', Number.NaN), 0, Number.MAX_VALUE, 1),
    height: clampFinite(safeNumber(ev, 'height', Number.NaN), 0, Number.MAX_VALUE, 1),
    pointerType,
    rawPointerType,
    button: clampFinite(safeNumber(ev, 'button', Number.NaN), -1, Number.MAX_VALUE, 0),
    buttons: clampFinite(safeNumber(ev, 'buttons', Number.NaN), 0, Number.MAX_SAFE_INTEGER, 0),
    altitudeAngle: Math.max(0, Math.min(Math.PI / 2, altitude)),
    azimuthAngle: azimuth,
    isPredicted: false,
    time,
    timestampTrusted:
      Number.isFinite(eventTime) && eventTime >= 0 && Math.abs(eventTime - now) <= 60_000,
    isEraser: isEraserEvent(ev, pointerType),
    isPrimary: safeBoolean(ev, 'isPrimary', false),
    pointerId: clampFinite(
      safeNumber(ev, 'pointerId', Number.NaN),
      -1,
      Number.MAX_SAFE_INTEGER,
      -1,
    ),
  };
}

function safeNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function safeNumber(source: object | null | undefined, key: string, fallback: number): number {
  try {
    const value = (source as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'number' ? value : fallback;
  } catch {
    return fallback;
  }
}

function safeString(source: object | null | undefined, key: string, fallback: string): string {
  try {
    const value = (source as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'string' ? value : fallback;
  } catch {
    return fallback;
  }
}

function safeBoolean(source: object | null | undefined, key: string, fallback: boolean): boolean {
  try {
    const value = (source as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'boolean' ? value : fallback;
  } catch {
    return fallback;
  }
}

function isEraserEvent(
  ev: PointerEvent,
  pointerType: NormalizedInputEvent['pointerType'],
): boolean {
  if (pointerType !== 'pen') return false;
  const button = safeNumber(ev, 'button', -1);
  const buttons = safeNumber(ev, 'buttons', 0);
  const eraserButtons = safeNumber(ev, 'eraserButtons', 0);
  return button === 5 || (buttons & 32) !== 0 || eraserButtons > 0;
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
    : 'unknown';
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

  const coalesced = safeSampleList(ev, 'getCoalescedEvents');
  if (coalesced.length > 0) {
    for (const c of coalesced) {
      events.push(normalizeInputEvent(c));
    }
  }

  const primary = normalizeInputEvent(ev);
  const last = events[events.length - 1];
  if (!last || !sameInputSample(last, primary)) {
    events.push(primary);
  }

  if (includePredicted) {
    const predicted = safeSampleList(ev, 'getPredictedEvents');
    for (const p of predicted) {
      const norm = normalizeInputEvent(p);
      norm.isPredicted = true;
      events.push(norm);
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
  const appendUnique = (entries: Array<{ event: NormalizedInputEvent }>) => {
    for (const { event } of entries) {
      const key = inputSampleKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(event);
    }
  };
  // Keep the confirmed and predicted arrays separate so a temporary combined
  // array is not allocated for every pointermove packet.
  appendUnique(confirmed);
  appendUnique(predicted);
  return result;
}

function safeSampleList(
  ev: PointerEvent,
  methodName: 'getCoalescedEvents' | 'getPredictedEvents',
): PointerEvent[] {
  try {
    const method = (ev as unknown as Record<string, unknown>)[methodName];
    if (typeof method !== 'function') return [];
    const result = (method as () => unknown).call(ev);
    return Array.isArray(result)
      ? result.filter((sample): sample is PointerEvent =>
          Boolean(sample && typeof sample === 'object'),
        )
      : [];
  } catch {
    return [];
  }
}

function sameInputSample(a: NormalizedInputEvent, b: NormalizedInputEvent): boolean {
  return (
    a.pointerId === b.pointerId &&
    a.pointerType === b.pointerType &&
    a.rawPointerType === b.rawPointerType &&
    a.clientX === b.clientX &&
    a.clientY === b.clientY &&
    a.time === b.time &&
    a.pressure === b.pressure &&
    a.tiltX === b.tiltX &&
    a.tiltY === b.tiltY &&
    a.twist === b.twist &&
    a.tangentialPressure === b.tangentialPressure &&
    a.width === b.width &&
    a.height === b.height &&
    a.button === b.button &&
    a.buttons === b.buttons &&
    a.isEraser === b.isEraser &&
    a.isPrimary === b.isPrimary
  );
}

function inputSampleKey(event: NormalizedInputEvent): string {
  return `${event.pointerId}:${event.pointerType}:${event.rawPointerType}:${event.time}:${event.clientX}:${event.clientY}:${event.pressure}:${event.tiltX}:${event.tiltY}:${event.twist}:${event.tangentialPressure}:${event.width}:${event.height}:${event.button}:${event.buttons}:${event.isEraser}:${event.isPrimary}`;
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
