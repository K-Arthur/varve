/**
 * Wheel-gesture trajectory classification — the sticky, sequence-aware layer
 * on top of `classifyWheelEvent`.
 *
 * Per-event magnitude heuristics are brittle exactly where they matter most:
 * a fast trackpad flick can emit per-event pixel deltas of 60-120 px
 * (the ambiguous band), which `classifyWheelEvent` resolves to `unknown` and
 * callers treat as a mouse wheel — applying app-side inertia on top of the
 * OS momentum the trackpad already delivered (doubled momentum). Conversely,
 * free-spinning "precision" mouse wheels emit long pixel-mode runs of small
 * deltas that look like trackpads.
 *
 * This classifier uses sequence evidence instead:
 *
 * 1. Line/page mode is always a mouse detent.
 * 2. Pixel mode resolves via burst structure: a *burst* is a run of wheel
 *    events with inter-arrival times below the gesture gap. Trackpad flicks
 *    are bursts of many events with a decaying magnitude envelope; detented
 *    wheels emit sparse, roughly-equal-magnitude events.
 * 3. A resolved gesture sticks with hysteresis: switching requires N
 *    consecutive contrary per-event signals, so one loud event mid-gesture
 *    cannot flip the classification and toggle inertia on/off mid-flick.
 * 4. A gap between events (gesture ended) resets the gesture state.
 *
 * The output drives `applyInertia`: only gestures classified as wheel/mouse
 * receive app-side inertia; trackpad gestures keep the OS momentum alone.
 * When the trajectory is genuinely ambiguous it degrades to the per-event
 * classification, which defaults to `mouse` — the safe choice per the
 * existing wheelClassifier contract.
 */

import { classifyWheelEvent, type WheelSource } from './wheelClassifier';

/** Inter-arrival gap that ends a wheel gesture (ms). */
export const WHEEL_GESTURE_GAP_MS = 250;
/** Max events retained per gesture for trajectory evidence. */
export const WHEEL_GESTURE_MAX_HISTORY = 12;
/** Consecutive contrary signals required to flip a sticky classification. */
export const WHEEL_GESTURE_HYSTERESIS = 3;
/** Minimum burst size before trajectory evidence counts at all. */
export const WHEEL_BURST_MIN_EVENTS = 3;
/** Events that arrive within this window are part of the same burst. */
export const WHEEL_BURST_WINDOW_MS = 120;

export interface WheelGestureSample {
  timeMs: number;
  source: WheelSource;
  mag: number;
}

export interface WheelGestureClassifier {
  /** Classify one wheel event with sequence context; `now` injectable for tests. */
  classify(deltaMode: number, deltaX: number, deltaY: number, now?: number): WheelSource;
  /** True when the retained evidence points at a trackpad gesture. */
  isTrackpad(): boolean;
  reset(): void;
}

/** Resolve the ambiguous pixel-mode band using the burst trajectory. */
function resolveAmbiguous(
  burst: readonly WheelGestureSample[],
  perEvent: WheelSource,
): WheelSource {
  if (perEvent !== 'unknown') return perEvent;
  if (burst.length < WHEEL_BURST_MIN_EVENTS) return perEvent;

  // Trackpad flicks decay: later events are no larger than earlier ones
  // (allowing a small jitter factor). Detents stay flat or grow (mouse
  // acceleration). Require the burst to be dense (arrived within the burst
  // window of the first event) so sparse large deltas are not misread.
  const first = burst[0]!;
  const spanMs = burst[burst.length - 1]!.timeMs - first.timeMs;
  if (spanMs > WHEEL_BURST_WINDOW_MS) return perEvent;

  let decayed = true;
  for (let i = 1; i < burst.length; i++) {
    const prev = burst[i - 1]!;
    const cur = burst[i]!;
    if (cur.mag > prev.mag * 1.3) {
      decayed = false;
      break;
    }
  }
  return decayed ? 'trackpad' : perEvent;
}

export function createWheelGestureClassifier(): WheelGestureClassifier {
  let history: WheelGestureSample[] = [];
  let gesture: WheelSource | null = null;
  let contraryCount = 0;
  let lastTimeMs = Number.NEGATIVE_INFINITY;

  return {
    classify(deltaMode, deltaX, deltaY, now = performance.now()) {
      if (!Number.isFinite(now)) now = performance.now();
      if (now - lastTimeMs > WHEEL_GESTURE_GAP_MS) {
        history = [];
        gesture = null;
        contraryCount = 0;
      }
      lastTimeMs = now;

      const perEvent = classifyWheelEvent({ deltaMode, deltaX, deltaY });
      const mag = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      history.push({ timeMs: now, source: perEvent, mag });
      if (history.length > WHEEL_GESTURE_MAX_HISTORY) history.shift();

      const resolved = resolveAmbiguous(history, perEvent);

      // No sticky gesture yet: adopt the resolved signal (unknown stays
      // unknown → callers degrade to the per-event behavior).
      if (gesture === null) {
        if (resolved !== 'unknown') {
          gesture = resolved;
          contraryCount = 0;
        }
        return resolved;
      }

      // Sticky gesture: count contrary per-event signals (ambiguous signals
      // are not contrary — they are the band we cannot trust either way).
      if (resolved !== gesture && resolved !== 'unknown') {
        contraryCount++;
        if (contraryCount >= WHEEL_GESTURE_HYSTERESIS) {
          gesture = resolved;
          contraryCount = 0;
        }
      } else if (resolved === gesture) {
        contraryCount = 0;
      }
      return gesture;
    },
    isTrackpad() {
      return gesture === 'trackpad';
    },
    reset() {
      history = [];
      gesture = null;
      contraryCount = 0;
      lastTimeMs = Number.NEGATIVE_INFINITY;
    },
  };
}
