import { describe, expect, it } from 'vitest';
import {
  DISCONTINUITY_THRESHOLD_MS,
  estimateFromExchange,
  RECALIBRATION_INTERVAL_MS,
  WorkerClockCalibrator,
} from '../workerClock';

/**
 * Build an exchange for a worker whose clock leads the main thread by
 * `offsetMs`, with `oneWayMs` of latency in each direction.
 */
function exchange(t0: number, offsetMs: number, oneWayMs: number, workerBusyMs = 0) {
  const t1 = t0 + oneWayMs + offsetMs;
  const t2 = t1 + workerBusyMs;
  return { t0, t1, t2, t3: t2 - offsetMs + oneWayMs };
}

describe('estimateFromExchange', () => {
  it('recovers a symmetric offset exactly', () => {
    const result = estimateFromExchange(exchange(1_000, 500, 2));
    expect(result.offsetMs).toBeCloseTo(500, 6);
    expect(result.rttMs).toBeCloseTo(4, 6);
    expect(result.uncertaintyMs).toBeCloseTo(2, 6);
  });

  it('excludes worker-side processing time from the round trip', () => {
    const result = estimateFromExchange(exchange(1_000, 0, 3, 50));
    expect(result.rttMs).toBeCloseTo(6, 6);
    expect(result.offsetMs).toBeCloseTo(0, 6);
  });

  it('never reports a negative round trip', () => {
    expect(estimateFromExchange({ t0: 10, t1: 0, t2: 100, t3: 11 }).rttMs).toBe(0);
  });
});

describe('WorkerClockCalibrator', () => {
  it('has no calibration and infinite uncertainty before the first exchange', () => {
    const calibrator = new WorkerClockCalibrator();
    expect(calibrator.calibration).toBeNull();
    expect(calibrator.needsRecalibration(0)).toBe(true);
    const translated = calibrator.toMainDomain(1_234);
    expect(translated.valueMs).toBe(1_234);
    expect(translated.uncertaintyMs).toBe(Number.POSITIVE_INFINITY);
    expect(translated.source).toBe('worker.performance.now');
  });

  it('keeps the minimum-round-trip sample as the best estimate', () => {
    const calibrator = new WorkerClockCalibrator();
    calibrator.addExchange(exchange(1_000, 500, 20));
    expect(calibrator.calibration?.rttMs).toBeCloseTo(40, 6);
    calibrator.addExchange(exchange(1_100, 500, 1));
    expect(calibrator.calibration?.rttMs).toBeCloseTo(2, 6);
    calibrator.addExchange(exchange(1_200, 500, 30));
    // The noisy third sample must not displace the quiet second one.
    expect(calibrator.calibration?.rttMs).toBeCloseTo(2, 6);
    expect(calibrator.calibration?.sampleCount).toBe(3);
    expect(calibrator.calibration?.uncertaintyMs).toBeCloseTo(1, 6);
  });

  it('translates a worker timestamp into the main-thread domain', () => {
    const calibrator = new WorkerClockCalibrator();
    calibrator.addExchange(exchange(1_000, 500, 1));
    const translated = calibrator.toMainDomain(2_500);
    expect(translated.valueMs).toBeCloseTo(2_000, 5);
    expect(translated.source).toBe('worker.calibrated');
    expect(translated.uncertaintyMs).toBeCloseTo(1, 6);
  });

  it('bumps the generation on reset and forgets the offset', () => {
    const calibrator = new WorkerClockCalibrator();
    calibrator.addExchange(exchange(1_000, 500, 1));
    const before = calibrator.calibration?.generation ?? 0;
    calibrator.reset();
    expect(calibrator.calibration).toBeNull();
    calibrator.addExchange(exchange(2_000, 900, 1));
    expect(calibrator.calibration?.generation).toBe(before + 1);
    expect(calibrator.calibration?.offsetMs).toBeCloseTo(900, 5);
  });

  it('treats a large offset jump as a discontinuity, not drift', () => {
    const calibrator = new WorkerClockCalibrator();
    calibrator.addExchange(exchange(1_000, 500, 1));
    const before = calibrator.calibration?.generation ?? 0;
    // A jump beyond the threshold — e.g. after system sleep — must replace the
    // estimate rather than being averaged into it or rejected as noisy.
    calibrator.addExchange(exchange(1_100, 500 + DISCONTINUITY_THRESHOLD_MS + 100, 40));
    expect(calibrator.calibration?.generation).toBe(before + 1);
    expect(calibrator.calibration?.offsetMs).toBeCloseTo(500 + DISCONTINUITY_THRESHOLD_MS + 100, 4);
    expect(calibrator.calibration?.sampleCount).toBe(1);
  });

  it('accepts a fresh sample once the estimate is stale', () => {
    const calibrator = new WorkerClockCalibrator();
    calibrator.addExchange(exchange(1_000, 500, 1));
    const staleAt = 1_000 + RECALIBRATION_INTERVAL_MS + 1_000;
    expect(calibrator.needsRecalibration(staleAt)).toBe(true);
    // Noisier than the retained sample, but the retained one is now too old.
    calibrator.addExchange(exchange(staleAt, 500, 15));
    expect(calibrator.calibration?.rttMs).toBeCloseTo(30, 5);
  });

  it('does not recalibrate while the estimate is fresh', () => {
    const calibrator = new WorkerClockCalibrator();
    calibrator.addExchange(exchange(1_000, 500, 1));
    expect(calibrator.needsRecalibration(1_500)).toBe(false);
  });
});
