/**
 * `render.worker` span assembly.
 *
 * Turns the worker's own-domain timing into a main-thread-domain span with an
 * explicit uncertainty, and splits worker time into queue wait, surface
 * allocation, replay, bitmap creation and transfer so "the worker was slow" is
 * distinguishable from "the frame spent its time in the message queue".
 *
 * Kept out of `workerHost.ts` so the transport/ownership logic there stays
 * free of diagnostics concerns and this arithmetic is testable on its own.
 */
import type { WorkerClockCalibrator } from '../performance/workerClock';
import type { WorkerRenderTiming } from './workerHost';

export interface WorkerSpanInput {
  timing: WorkerRenderTiming;
  /** main.performance.now() when the host posted the render command. */
  dispatchedAtMs: number;
  /** main.performance.now() when the host received the response. */
  receivedAtMs: number;
}

export interface WorkerSpanResult {
  /** Span start in the main-thread domain. */
  startTimeMs: number;
  /** Total worker-owned duration (receive → post), in milliseconds. */
  durationMs: number;
  attributes: Record<string, string | number | boolean>;
}

/**
 * Build the span. Every cross-domain value carries the calibration
 * uncertainty; when no calibration exists the span still reports worker-owned
 * durations (which are differences *within* the worker domain and therefore
 * valid) but marks its placement on the shared timeline as uncalibrated.
 */
export function buildWorkerRenderSpan(
  calibrator: WorkerClockCalibrator,
  input: WorkerSpanInput,
): WorkerSpanResult {
  const { timing, dispatchedAtMs, receivedAtMs } = input;
  const start = calibrator.toMainDomain(timing.receivedAt);
  const calibrated = Number.isFinite(start.uncertaintyMs);
  // Worker-internal differences are exact regardless of calibration.
  const workerOwnedMs = Math.max(0, timing.postedAt - timing.receivedAt);
  const queueWaitMs = Math.max(0, timing.renderStartedAt - timing.receivedAt - timing.surfaceMs);
  // Round-trip minus worker-owned time is the cost of the two message hops
  // plus main-thread scheduling; it is a main-domain difference and so is
  // valid even uncalibrated.
  const transportMs = Math.max(0, receivedAtMs - dispatchedAtMs - workerOwnedMs);
  return {
    // Placing the span without calibration would assert a cross-domain
    // instant, so fall back to the (exact) main-thread dispatch time and say
    // so in the attributes rather than inventing a translated start.
    startTimeMs: calibrated ? start.valueMs : dispatchedAtMs,
    durationMs: workerOwnedMs,
    attributes: {
      clockSource: start.source,
      calibrationGeneration: start.calibrationGeneration,
      clockUncertaintyMs: calibrated ? start.uncertaintyMs : -1,
      startPlacement: calibrated ? 'calibrated' : 'dispatch-fallback',
      queueWaitMs,
      surfaceMs: timing.surfaceMs,
      replayMs: timing.replayMs,
      bitmapMs: timing.bitmapMs,
      transportMs,
      irCount: timing.irCount,
      imageCount: timing.imageCount,
    },
  };
}
