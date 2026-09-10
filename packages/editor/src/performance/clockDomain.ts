/**
 * Clock-domain helpers — one place that decides which timestamps may be
 * subtracted from each other.
 *
 * Strata mixes at least four clock domains: the main-thread
 * `performance.now()` monotonic clock, DOM `Event.timeStamp`, the render
 * worker's own `performance.now()` (whose `timeOrigin` is not guaranteed to
 * equal the window's), and native Rust/kernel clocks. Only the first two are
 * safe to subtract without calibration, and only after the guard below.
 * Everything else must go through an explicit offset with recorded
 * uncertainty (see `workerClock.ts`), and native timestamps are never
 * presented on the same axis as JS timestamps.
 */

/** Clock a timestamp was produced by. Recorded alongside calibrated values. */
export type ClockSource =
  | 'main.performance.now'
  | 'dom.event.timeStamp'
  | 'worker.performance.now'
  | 'worker.calibrated'
  | 'native.monotonic'
  | 'unknown';

/**
 * Largest plausible delay between an input event being timestamped by the
 * browser and the handler observing it. Anything beyond this is treated as a
 * different clock domain (e.g. a legacy epoch-based `timeStamp`) rather than a
 * genuinely enormous queue delay, because attributing an epoch timestamp as
 * latency would report ~1.7e12 ms of "input delay".
 */
const MAX_PLAUSIBLE_EVENT_QUEUE_DELAY_MS = 10_000;

/**
 * Queue delay between the browser timestamping an input event and the handler
 * running, in milliseconds — or null when the event's clock domain cannot be
 * trusted.
 *
 * In Chromium, WebKit, and Gecko a `Event.timeStamp` inside a Window context
 * is a `DOMHighResTimeStamp` relative to the same `performance.timeOrigin` as
 * `performance.now()`, so the subtraction is valid. The guard rejects zero
 * (synthesized events), negative results (clock skew or a synthetic event
 * stamped in the future), and implausibly large results (epoch-domain
 * timestamps).
 */
export function eventQueueDelayMs(eventTimeStamp: number, handlerNowMs: number): number | null {
  if (!Number.isFinite(eventTimeStamp) || eventTimeStamp <= 0) return null;
  const delay = handlerNowMs - eventTimeStamp;
  if (delay < 0 || delay > MAX_PLAUSIBLE_EVENT_QUEUE_DELAY_MS) return null;
  return delay;
}

/**
 * A timestamp translated out of a foreign clock domain, carrying the
 * uncertainty of that translation. Consumers must render the uncertainty
 * rather than treating `valueMs` as exact.
 */
export interface CalibratedTimestamp {
  /** Value in the main-thread `performance.now()` domain. */
  valueMs: number;
  /** Half-width of the uncertainty interval, in milliseconds. */
  uncertaintyMs: number;
  /** Which clock originally produced the value. */
  source: ClockSource;
  /** Calibration generation the translation used; changes on worker restart. */
  calibrationGeneration: number;
}

/**
 * True when two calibrated timestamps are ordered beyond their combined
 * uncertainty. Used by tests and diagnostics to avoid claiming a causal
 * ordering the calibration cannot support.
 */
export function isConfidentlyOrdered(
  earlier: CalibratedTimestamp,
  later: CalibratedTimestamp,
): boolean {
  return later.valueMs - earlier.valueMs > earlier.uncertaintyMs + later.uncertaintyMs;
}
