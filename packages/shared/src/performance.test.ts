import { describe, expect, it } from 'vitest';
import type { MetricSample } from './performance';
import {
  appendBoundedMetric,
  createPerformanceTrace,
  nextRenderRevision,
  percentile,
  summarizeDurations,
  validatePerformanceTrace,
} from './performance';

describe('performance contracts', () => {
  it('computes stable percentiles without mutating samples', () => {
    const samples = [9, 1, 5, 3, 7];
    expect(percentile(samples, 0.5)).toBe(5);
    expect(percentile(samples, 0.95)).toBe(9);
    expect(samples).toEqual([9, 1, 5, 3, 7]);
  });

  it('summarizes p50, p95, and p99', () => {
    const summary = summarizeDurations([1, 2, 3, 4, 5]);
    expect(summary).toEqual({ count: 5, min: 1, max: 5, p50: 3, p95: 5, p99: 5 });
  });

  it('keeps a bounded metric ring in monotonic order', () => {
    const samples: MetricSample[] = [];
    appendBoundedMetric(samples, { name: 'frame', startTimeMs: 1, durationMs: 1 }, 2);
    appendBoundedMetric(samples, { name: 'frame', startTimeMs: 2, durationMs: 1 }, 2);
    appendBoundedMetric(samples, { name: 'frame', startTimeMs: 3, durationMs: 1 }, 2);
    expect(samples.map((sample) => sample.startTimeMs)).toEqual([2, 3]);
  });

  it('rejects non-monotonic or invalid traces', () => {
    const trace = createPerformanceTrace({
      traceId: 'trace-1',
      createdAt: '2026-07-22T00:00:00.000Z',
      environment: {
        runtime: 'browser',
        backend: 'canvas2d',
        os: 'linux',
        devicePixelRatio: 1,
      },
    });
    trace.metrics.push(
      { name: 'a', startTimeMs: 2, durationMs: 1 },
      { name: 'b', startTimeMs: 1, durationMs: 1 },
    );
    expect(validatePerformanceTrace(trace)).toContain('metrics must be monotonic by startTimeMs');
  });

  it('increments render revisions monotonically', () => {
    expect(nextRenderRevision(0)).toBe(1);
    expect(nextRenderRevision(Number.MAX_SAFE_INTEGER)).toBe(1);
  });
});
