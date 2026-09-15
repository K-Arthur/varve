import type { PerformanceEnvironment } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { createPerformanceCollector } from './performanceCollector';

const environment: PerformanceEnvironment = {
  runtime: 'test',
  backend: 'canvas2d',
  os: 'linux',
  devicePixelRatio: 1,
};

describe('performance collector', () => {
  it('records monotonic spans and summarizes matching metrics', () => {
    let now = 10;
    const collector = createPerformanceCollector({
      environment,
      now: () => now,
      traceId: 'trace',
      createdAt: () => '2026-07-22T00:00:00.000Z',
    });
    const end = collector.start('canvas.frame', 'render');
    now = 14;
    end({ nodes: 100 });
    expect(collector.summary('canvas.frame')).toMatchObject({ count: 1, p50: 4 });
    expect(collector.exportTrace().metrics[0]).toMatchObject({
      name: 'canvas.frame',
      durationMs: 4,
      attributes: { nodes: 100 },
    });
  });

  it('bounds retained metrics and can be disabled', () => {
    let now = 0;
    const collector = createPerformanceCollector({ environment, now: () => now, capacity: 2 });
    for (let index = 0; index < 3; index++) {
      now = index;
      collector.record({ name: 'frame', startTimeMs: now, durationMs: 1 });
    }
    expect(collector.exportTrace().metrics.map((sample) => sample.startTimeMs)).toEqual([1, 2]);
    collector.setEnabled(false);
    collector.record({ name: 'frame', startTimeMs: 3, durationMs: 1 });
    expect(collector.exportTrace().metrics).toHaveLength(2);
  });

  it('exports copies that callers cannot mutate internally', () => {
    const collector = createPerformanceCollector({ environment });
    collector.record({ name: 'frame', startTimeMs: 1, durationMs: 2 });
    const exported = collector.exportTrace();
    exported.metrics.length = 0;
    expect(collector.exportTrace().metrics).toHaveLength(1);
  });
});
