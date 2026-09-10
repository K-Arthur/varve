import { describe, expect, it } from 'vitest';
import {
  detectPresentationCapabilities,
  EVENT_TIMING_QUANTIZATION_MS,
  estimateCompositeFromRaf,
  observePresentation,
  PRESENTATION_EVIDENCE_BY_RUNTIME,
  presentationFromEventTiming,
  RefreshIntervalEstimator,
} from '../presentationTiming';

describe('presentationFromEventTiming', () => {
  it('splits input delay, handler work and post-handler presentation', () => {
    const sample = presentationFromEventTiming({
      name: 'pointerdown',
      startTime: 1_000,
      duration: 48,
      processingStart: 1_006,
      processingEnd: 1_020,
    });
    expect(sample.name).toBe('present.feedback');
    expect(sample.attributes.inputDelayMs).toBe(6);
    expect(sample.attributes.processingMs).toBe(14);
    expect(sample.attributes.presentationMs).toBe(28);
    expect(sample.attributes.evidence).toBe('event-timing');
  });

  it('reports the 8ms quantization as uncertainty rather than hiding it', () => {
    const sample = presentationFromEventTiming({ name: 'pointerup', startTime: 0, duration: 16 });
    expect(sample.uncertaintyMs).toBe(EVENT_TIMING_QUANTIZATION_MS);
    expect(sample.attributes.quantizationMs).toBe(EVENT_TIMING_QUANTIZATION_MS);
  });

  it('never reports negative phases when optional fields are missing', () => {
    const sample = presentationFromEventTiming({ name: 'click', startTime: 500, duration: 8 });
    expect(sample.attributes.inputDelayMs).toBe(0);
    expect(sample.attributes.processingMs).toBe(0);
    expect(sample.attributes.presentationMs).toBe(8);
  });
});

describe('estimateCompositeFromRaf', () => {
  it('is labelled a lower bound with one refresh interval of uncertainty', () => {
    const sample = estimateCompositeFromRaf(100, 112, 16.7);
    expect(sample.name).toBe('composite.estimated');
    expect(sample.durationMs).toBeCloseTo(12, 5);
    expect(sample.uncertaintyMs).toBeCloseTo(16.7, 5);
    expect(sample.attributes.bound).toBe('lower');
    expect(sample.attributes.evidence).toBe('raf-lower-bound');
  });

  it('clamps a rAF timestamp that precedes the commit', () => {
    expect(estimateCompositeFromRaf(100, 90, 16.7).durationMs).toBe(0);
  });

  it('is never named composite.present, which would assert OS evidence', () => {
    // @ts-expect-error — the union deliberately has no such member.
    expect(estimateCompositeFromRaf(0, 1, 16).name === 'composite.present').toBe(false);
  });
});

describe('RefreshIntervalEstimator', () => {
  it('defaults to the 60Hz interval before any sample', () => {
    expect(new RefreshIntervalEstimator().intervalMs).toBeCloseTo(1000 / 60, 5);
  });

  it('takes the minimum delta, since a delta can only overstate the interval', () => {
    const estimator = new RefreshIntervalEstimator();
    let t = 0;
    for (const delta of [16.7, 33.4, 16.6, 50, 16.8]) {
      t += delta;
      estimator.sample(t);
    }
    expect(estimator.intervalMs).toBeCloseTo(16.6, 5);
  });

  it('rejects implausible deltas from a backgrounded tab', () => {
    const estimator = new RefreshIntervalEstimator();
    estimator.sample(0);
    estimator.sample(5_000);
    expect(estimator.intervalMs).toBeCloseTo(1000 / 60, 5);
  });

  it('forgets history on reset', () => {
    const estimator = new RefreshIntervalEstimator();
    estimator.sample(0);
    estimator.sample(8.3);
    expect(estimator.intervalMs).toBeCloseTo(8.3, 5);
    estimator.reset();
    expect(estimator.intervalMs).toBeCloseTo(1000 / 60, 5);
  });
});

describe('runtime evidence matrix', () => {
  it('claims per-interaction paint evidence only where Event Timing exists', () => {
    expect(PRESENTATION_EVIDENCE_BY_RUNTIME.chromium.span).toBe('present.feedback');
    expect(PRESENTATION_EVIDENCE_BY_RUNTIME.webkitgtk.span).toBe('composite.estimated');
    expect(PRESENTATION_EVIDENCE_BY_RUNTIME.webkitgtk.accuracy).toContain('lower bound');
  });

  it('never requires a profiler for a production build', () => {
    for (const runtime of Object.values(PRESENTATION_EVIDENCE_BY_RUNTIME)) {
      expect(runtime.requiresProfiler).toBe(false);
      expect(runtime.productionSafe).toBe(true);
    }
  });
});

describe('observePresentation', () => {
  it('returns a safe disposer when the runtime exposes no event timing', () => {
    // jsdom has no `event` entry type; the adapter must degrade, not throw.
    expect(detectPresentationCapabilities().eventTiming).toBe(false);
    const dispose = observePresentation();
    expect(() => dispose()).not.toThrow();
  });
});
