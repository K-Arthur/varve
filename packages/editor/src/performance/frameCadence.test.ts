import { describe, expect, it } from 'vitest';
import { FrameCadenceEstimator } from './frameCadence';

function feed(estimator: FrameCadenceEstimator, interval: number, count: number, start = 0) {
  let timestamp = start;
  estimator.observe(timestamp);
  for (let i = 0; i < count; i += 1) {
    timestamp += interval;
    estimator.observe(timestamp);
  }
}

describe('FrameCadenceEstimator', () => {
  it('starts conservatively and measures a stable 120 Hz stream', () => {
    const estimator = new FrameCadenceEstimator({ stableSamples: 4 });
    expect(estimator.current()).toMatchObject({
      intervalMs: 1000 / 60,
      source: 'fallback',
      samples: 0,
    });

    feed(estimator, 1000 / 120, 30);

    expect(estimator.current().source).toBe('measured');
    expect(estimator.current().intervalMs).toBeCloseTo(1000 / 120, 2);
    expect(estimator.current().refreshRate).toBeCloseTo(120, 0);
  });

  it('does not expand the work window when callbacks arrive at 30 Hz', () => {
    const estimator = new FrameCadenceEstimator({ stableSamples: 4 });
    feed(estimator, 1000 / 30, 30);
    expect(estimator.current().intervalMs).toBe(1000 / 60);
    expect(estimator.current().source).toBe('measured');
  });

  it('uses a low quantile so dropped frames do not hide a faster cadence', () => {
    const estimator = new FrameCadenceEstimator({ stableSamples: 4 });
    estimator.observe(0);
    for (let i = 0; i < 40; i += 1) {
      estimator.observe((i + 1) * (1000 / 120));
      if (i % 7 === 0) estimator.observe((i + 2) * (1000 / 120));
    }
    expect(estimator.current().intervalMs).toBeCloseTo(1000 / 120, 2);
  });

  it('resets samples and returns to fallback after a hidden-tab gap', () => {
    const estimator = new FrameCadenceEstimator({ stableSamples: 3 });
    feed(estimator, 1000 / 120, 20);
    expect(estimator.current().source).toBe('measured');
    estimator.observe(10_000);
    expect(estimator.current()).toMatchObject({
      intervalMs: 1000 / 60,
      source: 'fallback',
      samples: 0,
    });
  });

  it('ignores invalid timestamps and sub-minimum jitter', () => {
    const estimator = new FrameCadenceEstimator({ stableSamples: 3 });
    estimator.observe(Number.NaN);
    estimator.observe(0);
    estimator.observe(1);
    estimator.observe(2);
    expect(estimator.current().source).toBe('fallback');
    expect(estimator.current().samples).toBe(0);
  });
});
