import type { PerformanceWorkload, PerformanceWorkloadId } from './workloadCorpus';
import { createPerformanceWorkload } from './workloadCorpus';

export interface SoakResourceSnapshot {
  iteration: number;
  workload: PerformanceWorkloadId;
  timestampMs: number;
  retainedMemoryBytes: number;
  cacheBytes: number;
  activeWorkers: number;
  activeObjectUrls: number;
  activeBitmaps: number;
}

export interface SoakPlateau {
  supported: boolean;
  established: boolean;
  previousWindowMedianBytes?: number;
  finalWindowMedianBytes?: number;
  growthBytes?: number;
  reason?: string;
}

export interface SoakResult {
  schemaVersion: 1;
  completedIterations: number;
  cancelled: boolean;
  durationMs: number;
  snapshots: SoakResourceSnapshot[];
  plateau: SoakPlateau;
  errors: string[];
}

export interface SoakHarnessOptions {
  iterations: number;
  sampleEvery: number;
  plateauWindowSamples: number;
  plateauToleranceBytes: number;
  workloadIds: readonly PerformanceWorkloadId[];
  execute: (
    workload: PerformanceWorkload,
    iteration: number,
    signal?: AbortSignal,
  ) => void | Promise<void>;
  sampleResources: (
    workload: PerformanceWorkloadId,
    iteration: number,
  ) => Omit<SoakResourceSnapshot, 'iteration' | 'workload' | 'timestampMs'>;
  now?: () => number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function computePlateau(
  snapshots: SoakResourceSnapshot[],
  windowSamples: number,
  toleranceBytes: number,
): SoakPlateau {
  if (snapshots.length < windowSamples * 2) {
    return {
      supported: false,
      established: false,
      reason: `requires at least ${windowSamples * 2} resource samples`,
    };
  }
  const previous = snapshots.slice(-(windowSamples * 2), -windowSamples);
  const final = snapshots.slice(-windowSamples);
  const previousWindowMedianBytes = median(previous.map((sample) => sample.retainedMemoryBytes));
  const finalWindowMedianBytes = median(final.map((sample) => sample.retainedMemoryBytes));
  const growthBytes = finalWindowMedianBytes - previousWindowMedianBytes;
  const previousMaxResources = {
    workers: Math.max(...previous.map((sample) => sample.activeWorkers)),
    urls: Math.max(...previous.map((sample) => sample.activeObjectUrls)),
    bitmaps: Math.max(...previous.map((sample) => sample.activeBitmaps)),
  };
  const finalMaxResources = {
    workers: Math.max(...final.map((sample) => sample.activeWorkers)),
    urls: Math.max(...final.map((sample) => sample.activeObjectUrls)),
    bitmaps: Math.max(...final.map((sample) => sample.activeBitmaps)),
  };
  const resourcesStable =
    finalMaxResources.workers <= previousMaxResources.workers &&
    finalMaxResources.urls <= previousMaxResources.urls &&
    finalMaxResources.bitmaps <= previousMaxResources.bitmaps;
  return {
    supported: true,
    established: growthBytes <= toleranceBytes && resourcesStable,
    previousWindowMedianBytes,
    finalWindowMedianBytes,
    growthBytes,
    reason: resourcesStable ? undefined : 'resource counts increased in the final window',
  };
}

export async function runDeterministicSoak(
  options: SoakHarnessOptions,
  signal?: AbortSignal,
): Promise<SoakResult> {
  if (options.iterations < 0 || options.sampleEvery <= 0 || options.plateauWindowSamples <= 0) {
    throw new RangeError('soak iteration and sampling options must be positive');
  }
  if (options.workloadIds.length === 0) throw new RangeError('soak requires at least one workload');

  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const snapshots: SoakResourceSnapshot[] = [];
  const errors: string[] = [];
  let completedIterations = 0;

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    if (signal?.aborted) break;
    const workloadId = options.workloadIds[iteration % options.workloadIds.length]!;
    const workload = createPerformanceWorkload(workloadId);
    try {
      await options.execute(workload, iteration, signal);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    completedIterations++;
    if ((iteration + 1) % options.sampleEvery === 0) {
      snapshots.push({
        iteration,
        workload: workloadId,
        timestampMs: now(),
        ...options.sampleResources(workloadId, iteration),
      });
    }
  }

  return {
    schemaVersion: 1,
    completedIterations,
    cancelled: signal?.aborted ?? false,
    durationMs: Math.max(0, now() - startedAt),
    snapshots,
    plateau: computePlateau(snapshots, options.plateauWindowSamples, options.plateauToleranceBytes),
    errors,
  };
}
