import { describe, expect, it } from 'vitest';
import { PaintProfiler, shouldUseWorker } from '../paintProfiler';

describe('paint profiler', () => {
  it('records nothing at all when off', () => {
    const p = new PaintProfiler();
    p.strokeStarted();
    p.batchProduced({ dabs: 50, source: 'worker', computeMs: 5 });
    p.compositeTook(3);
    const report = p.report();
    expect(p.enabled).toBe(false);
    expect(report.counters.strokes).toBe(0);
    expect(report.counters.dabs).toBe(0);
    expect(report.compute.count).toBe(0);
  });

  it('keeps tallies but no samples in counters mode', () => {
    const p = new PaintProfiler();
    p.setMode('counters');
    p.strokeStarted();
    p.batchProduced({ dabs: 10, source: 'worker', computeMs: 4, queueDelayMs: 9 });
    const report = p.report();
    expect(report.counters.strokes).toBe(1);
    expect(report.counters.dabs).toBe(10);
    // Sample buffers are the only meaningful memory cost, so they stay off.
    expect(report.compute.count).toBe(0);
    expect(report.queueDelay.count).toBe(0);
  });

  it('records distributions in detailed mode', () => {
    const p = new PaintProfiler();
    p.setMode('detailed');
    for (let i = 1; i <= 100; i++) {
      p.batchProduced({ dabs: 1, source: 'sync', computeMs: i, queueDelayMs: i * 2 });
    }
    const report = p.report();
    expect(report.compute.count).toBe(100);
    expect(report.compute.p50).toBeGreaterThan(40);
    expect(report.compute.p95).toBeGreaterThan(report.compute.p50);
    expect(report.compute.p99).toBeGreaterThanOrEqual(report.compute.p95);
    expect(report.compute.max).toBe(100);
  });

  it('separates worker and sync batches', () => {
    const p = new PaintProfiler();
    p.setMode('counters');
    p.batchProduced({ dabs: 1, source: 'worker' });
    p.batchProduced({ dabs: 1, source: 'sync' });
    p.batchProduced({ dabs: 1, source: 'sync' });
    const report = p.report();
    expect(report.counters.workerBatches).toBe(1);
    expect(report.counters.syncBatches).toBe(2);
  });

  it('bounds memory over a long session', () => {
    const p = new PaintProfiler();
    p.setMode('detailed');
    for (let i = 0; i < 50_000; i++) p.batchProduced({ dabs: 1, source: 'sync', computeMs: i });
    // The ring caps retained samples regardless of session length.
    expect(p.report().compute.count).toBeLessThanOrEqual(2048);
  });

  it('drops sample buffers when detailed mode is turned off', () => {
    const p = new PaintProfiler();
    p.setMode('detailed');
    p.batchProduced({ dabs: 1, source: 'sync', computeMs: 5 });
    p.setMode('counters');
    expect(p.report().compute.count).toBe(0);
  });

  it('counts cancellations and stale results', () => {
    const p = new PaintProfiler();
    p.setMode('counters');
    p.strokeCancelled();
    p.staleDropped(3);
    const report = p.report();
    expect(report.counters.cancellations).toBe(1);
    expect(report.counters.staleDropped).toBe(3);
  });

  it('clears everything on reset', () => {
    const p = new PaintProfiler();
    p.setMode('detailed');
    p.strokeStarted();
    p.batchProduced({ dabs: 5, source: 'worker', computeMs: 1 });
    p.reset();
    const report = p.report();
    expect(report.counters.strokes).toBe(0);
    expect(report.compute.count).toBe(0);
  });
});

describe('worker routing decision', () => {
  const base = { radius: 5, grainEnabled: false, symmetryBranches: 1, spacing: 0.25 };

  it('keeps a small hard round on the main thread', () => {
    // Round-tripping a cheap brush costs more in latency than it saves.
    expect(shouldUseWorker(base)).toBe(false);
  });

  it('moves a large brush to the worker', () => {
    expect(shouldUseWorker({ ...base, radius: 120 })).toBe(true);
  });

  it('accounts for grain, which dominates per-pixel cost', () => {
    expect(shouldUseWorker({ ...base, radius: 30, grainEnabled: false })).toBe(false);
    expect(shouldUseWorker({ ...base, radius: 30, grainEnabled: true })).toBe(true);
  });

  it('accounts for symmetry multiplying the work', () => {
    expect(shouldUseWorker({ ...base, radius: 30, symmetryBranches: 1 })).toBe(false);
    expect(shouldUseWorker({ ...base, radius: 30, symmetryBranches: 8 })).toBe(true);
  });

  it('accounts for dab density', () => {
    expect(shouldUseWorker({ ...base, radius: 40, spacing: 1 })).toBe(false);
    expect(shouldUseWorker({ ...base, radius: 40, spacing: 0.02 })).toBe(true);
  });
});
