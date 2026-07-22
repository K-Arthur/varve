import { describe, expect, it } from 'vitest';
import { runDeterministicSoak } from './soakHarness';

describe('deterministic soak harness', () => {
  it('cycles workloads and accepts a settled memory/resource plateau', async () => {
    let clock = 0;
    const visited: string[] = [];
    const result = await runDeterministicSoak({
      iterations: 8,
      sampleEvery: 1,
      plateauWindowSamples: 3,
      plateauToleranceBytes: 1_024,
      workloadIds: ['small', 'rapid-brush'],
      now: () => clock++,
      execute: (workload) => {
        visited.push(workload.id);
      },
      sampleResources: (_workload, iteration) => ({
        retainedMemoryBytes: 10_000 + Math.min(iteration, 2) * 100,
        cacheBytes: 2_000,
        activeWorkers: 1,
        activeObjectUrls: 0,
        activeBitmaps: 2,
      }),
    });

    expect(visited).toEqual([
      'small',
      'rapid-brush',
      'small',
      'rapid-brush',
      'small',
      'rapid-brush',
      'small',
      'rapid-brush',
    ]);
    expect(result).toMatchObject({
      completedIterations: 8,
      cancelled: false,
      plateau: { supported: true, established: true, growthBytes: 0 },
      errors: [],
    });
  });

  it('reports resource-count growth even when heap estimates are flat', async () => {
    const result = await runDeterministicSoak({
      iterations: 6,
      sampleEvery: 1,
      plateauWindowSamples: 2,
      plateauToleranceBytes: 0,
      workloadIds: ['small'],
      execute: () => undefined,
      sampleResources: (_workload, iteration) => ({
        retainedMemoryBytes: 4_096,
        cacheBytes: 512,
        activeWorkers: iteration < 4 ? 1 : 2,
        activeObjectUrls: 0,
        activeBitmaps: 0,
      }),
    });

    expect(result.plateau).toMatchObject({
      supported: true,
      established: false,
      reason: 'resource counts increased in the final window',
    });
  });

  it('cancels between operations and preserves completed samples', async () => {
    const controller = new AbortController();
    const result = await runDeterministicSoak(
      {
        iterations: 20,
        sampleEvery: 1,
        plateauWindowSamples: 2,
        plateauToleranceBytes: 0,
        workloadIds: ['small'],
        execute: (_workload, iteration) => {
          if (iteration === 2) controller.abort();
        },
        sampleResources: () => ({
          retainedMemoryBytes: 0,
          cacheBytes: 0,
          activeWorkers: 0,
          activeObjectUrls: 0,
          activeBitmaps: 0,
        }),
      },
      controller.signal,
    );

    expect(result.completedIterations).toBe(3);
    expect(result.cancelled).toBe(true);
    expect(result.snapshots).toHaveLength(3);
  });

  it('records operation failures and continues the soak', async () => {
    const result = await runDeterministicSoak({
      iterations: 3,
      sampleEvery: 1,
      plateauWindowSamples: 2,
      plateauToleranceBytes: 0,
      workloadIds: ['small'],
      execute: (_workload, iteration) => {
        if (iteration === 1) throw new Error('worker restarted');
      },
      sampleResources: () => ({
        retainedMemoryBytes: 0,
        cacheBytes: 0,
        activeWorkers: 0,
        activeObjectUrls: 0,
        activeBitmaps: 0,
      }),
    });

    expect(result.completedIterations).toBe(3);
    expect(result.errors).toEqual(['worker restarted']);
  });
});
