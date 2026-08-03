/**
 * Main-thread <-> worker clock calibration.
 *
 * `performance.now()` in a worker is relative to that worker's own
 * `timeOrigin`, which the spec does not require to equal the window's. On some
 * engines they happen to match; relying on that produces timelines that are
 * silently wrong on the engines where they do not. This module estimates the
 * offset explicitly with NTP-style ping-pong exchanges and reports the
 * uncertainty of that estimate, so nothing downstream can claim sub-millisecond
 * cross-thread precision the calibration cannot support.
 *
 * Model: `workerNow = mainNow + offsetMs`, so a worker timestamp is translated
 * back with `mainNow = workerNow - offsetMs`.
 */
import type { CalibratedTimestamp } from './clockDomain';

/** One completed ping-pong exchange. */
export interface ClockExchange {
  /** main.performance.now() immediately before postMessage. */
  t0: number;
  /** worker.performance.now() on receipt. */
  t1: number;
  /** worker.performance.now() immediately before replying. */
  t2: number;
  /** main.performance.now() on receipt of the reply. */
  t3: number;
}

export interface ClockCalibration {
  /** workerNow - mainNow, in milliseconds. */
  offsetMs: number;
  /** Round-trip time of the sample the offset was derived from. */
  rttMs: number;
  /** Half-width of the uncertainty interval (half the best round trip). */
  uncertaintyMs: number;
  /** Increments on every worker replacement or detected discontinuity. */
  generation: number;
  /** Exchanges folded into this calibration. */
  sampleCount: number;
  /** main.performance.now() when the winning sample was taken. */
  calibratedAtMs: number;
}

/**
 * Offset and uncertainty for a single exchange. The offset is the mean of the
 * outbound and inbound skew; the uncertainty is half the round trip, which is
 * the tightest bound available without assuming symmetric latency.
 */
export function estimateFromExchange(exchange: ClockExchange): {
  offsetMs: number;
  rttMs: number;
  uncertaintyMs: number;
} {
  const { t0, t1, t2, t3 } = exchange;
  const rttMs = Math.max(0, t3 - t0 - (t2 - t1));
  return {
    offsetMs: (t1 - t0 + (t2 - t3)) / 2,
    rttMs,
    uncertaintyMs: rttMs / 2,
  };
}

/**
 * A round trip this far above the best observed one is treated as a scheduling
 * outlier (the worker was busy replaying a frame) rather than clock evidence.
 * Minimum-RTT selection already prefers the quiet sample; this only bounds how
 * long a stale best sample is trusted after a long pause.
 */
const RECALIBRATION_INTERVAL_MS = 30_000;

/**
 * A jump larger than this between the current best offset and a fresh sample
 * is a discontinuity (system sleep, worker restart, process migration) rather
 * than drift, and invalidates the previous calibration instead of being
 * averaged into it.
 */
const DISCONTINUITY_THRESHOLD_MS = 250;

export class WorkerClockCalibrator {
  private best: ClockCalibration | null = null;
  private generation = 0;
  private samples = 0;

  /** Current calibration, or null before the first exchange completes. */
  get calibration(): ClockCalibration | null {
    return this.best;
  }

  /** Bump the generation and drop the offset — call on worker replacement. */
  reset(): void {
    this.generation += 1;
    this.best = null;
    this.samples = 0;
  }

  /**
   * Fold an exchange in. Minimum round-trip wins because the offset error is
   * bounded by rtt/2, so the quietest exchange is the most informative one; a
   * discontinuity replaces the estimate outright rather than being averaged.
   */
  addExchange(exchange: ClockExchange): ClockCalibration {
    const { offsetMs, rttMs, uncertaintyMs } = estimateFromExchange(exchange);
    this.samples += 1;
    const discontinuous =
      this.best !== null && Math.abs(offsetMs - this.best.offsetMs) > DISCONTINUITY_THRESHOLD_MS;
    if (discontinuous) {
      this.generation += 1;
      this.samples = 1;
    }
    const stale =
      this.best !== null && exchange.t3 - this.best.calibratedAtMs > RECALIBRATION_INTERVAL_MS;
    if (this.best === null || discontinuous || stale || rttMs < this.best.rttMs) {
      this.best = {
        offsetMs,
        rttMs,
        uncertaintyMs,
        generation: this.generation,
        sampleCount: this.samples,
        calibratedAtMs: exchange.t3,
      };
    } else {
      this.best = { ...this.best, sampleCount: this.samples };
    }
    return this.best;
  }

  /** True when the best sample is old enough to warrant another exchange. */
  needsRecalibration(nowMs: number): boolean {
    if (this.best === null) return true;
    return nowMs - this.best.calibratedAtMs > RECALIBRATION_INTERVAL_MS;
  }

  /**
   * Translate a worker timestamp into the main-thread domain. Returns an
   * `unknown`-source value with infinite uncertainty when no calibration
   * exists, so callers cannot mistake an uncalibrated value for a measured one.
   */
  toMainDomain(workerNowMs: number): CalibratedTimestamp {
    if (this.best === null) {
      return {
        valueMs: workerNowMs,
        uncertaintyMs: Number.POSITIVE_INFINITY,
        source: 'worker.performance.now',
        calibrationGeneration: this.generation,
      };
    }
    return {
      valueMs: workerNowMs - this.best.offsetMs,
      uncertaintyMs: this.best.uncertaintyMs,
      source: 'worker.calibrated',
      calibrationGeneration: this.best.generation,
    };
  }
}

export { DISCONTINUITY_THRESHOLD_MS, RECALIBRATION_INTERVAL_MS };
