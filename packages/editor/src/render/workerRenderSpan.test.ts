import { describe, expect, it } from 'vitest';
import { WorkerClockCalibrator } from '../performance/workerClock';
import type { WorkerRenderTiming } from './workerHost';
import { buildWorkerRenderSpan } from './workerRenderSpan';

/** Worker clock leading the main thread by 1000ms, 1ms each way. */
function calibrated(): WorkerClockCalibrator {
  const calibrator = new WorkerClockCalibrator();
  calibrator.addExchange({ t0: 0, t1: 1_001, t2: 1_001, t3: 2 });
  return calibrator;
}

const timing: WorkerRenderTiming = {
  receivedAt: 1_100,
  renderStartedAt: 1_105,
  renderEndedAt: 1_125,
  postedAt: 1_128,
  surfaceMs: 2,
  replayMs: 20,
  bitmapMs: 3,
  irCount: 480,
  imageCount: 2,
};

describe('buildWorkerRenderSpan', () => {
  it('places the span in the main-thread domain using the calibrated offset', () => {
    const span = buildWorkerRenderSpan(calibrated(), {
      timing,
      dispatchedAtMs: 98,
      receivedAtMs: 132,
    });
    // receivedAt 1100 in worker domain - 1000ms offset = 100 main domain.
    expect(span.startTimeMs).toBeCloseTo(100, 5);
    expect(span.durationMs).toBeCloseTo(28, 5);
    expect(span.attributes.startPlacement).toBe('calibrated');
    expect(span.attributes.clockSource).toBe('worker.calibrated');
    expect(span.attributes.clockUncertaintyMs).toBeCloseTo(1, 5);
  });

  it('splits worker time into queue wait, surface, replay and bitmap phases', () => {
    const span = buildWorkerRenderSpan(calibrated(), {
      timing,
      dispatchedAtMs: 98,
      receivedAtMs: 132,
    });
    // 1105 - 1100 = 5ms before replay, of which 2ms was surface allocation.
    expect(span.attributes.queueWaitMs).toBeCloseTo(3, 5);
    expect(span.attributes.surfaceMs).toBe(2);
    expect(span.attributes.replayMs).toBe(20);
    expect(span.attributes.bitmapMs).toBe(3);
    // 34ms round trip - 28ms worker-owned = 6ms of message transport.
    expect(span.attributes.transportMs).toBeCloseTo(6, 5);
  });

  it('reports worker-owned durations but flags placement when uncalibrated', () => {
    const span = buildWorkerRenderSpan(new WorkerClockCalibrator(), {
      timing,
      dispatchedAtMs: 98,
      receivedAtMs: 132,
    });
    // Worker-internal differences stay valid without calibration...
    expect(span.durationMs).toBeCloseTo(28, 5);
    expect(span.attributes.replayMs).toBe(20);
    // ...but the span must not assert a translated cross-domain start.
    expect(span.startTimeMs).toBe(98);
    expect(span.attributes.startPlacement).toBe('dispatch-fallback');
    expect(span.attributes.clockSource).toBe('worker.performance.now');
    expect(span.attributes.clockUncertaintyMs).toBe(-1);
  });

  it('clamps transport when the round trip is shorter than worker-owned time', () => {
    // Only possible with clock jitter between the two domains; reporting a
    // negative transport would be worse than reporting none.
    const span = buildWorkerRenderSpan(calibrated(), {
      timing,
      dispatchedAtMs: 130,
      receivedAtMs: 131,
    });
    expect(span.durationMs).toBeCloseTo(28, 5);
    expect(span.attributes.transportMs).toBe(0);
  });

  it('clamps worker-owned and queue-wait time rather than reporting negatives', () => {
    const span = buildWorkerRenderSpan(calibrated(), {
      timing: { ...timing, renderStartedAt: 1_099, postedAt: 1_099 },
      dispatchedAtMs: 98,
      receivedAtMs: 132,
    });
    expect(span.durationMs).toBe(0);
    expect(span.attributes.queueWaitMs).toBe(0);
  });

  it('carries the calibration generation so worker restarts are visible', () => {
    const calibrator = calibrated();
    calibrator.reset();
    calibrator.addExchange({ t0: 100, t1: 1_101, t2: 1_101, t3: 102 });
    const span = buildWorkerRenderSpan(calibrator, {
      timing,
      dispatchedAtMs: 98,
      receivedAtMs: 132,
    });
    expect(span.attributes.calibrationGeneration).toBe(1);
  });
});
