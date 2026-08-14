/**
 * Restoration task dispatch — one entry point for every tiled restoration
 * task. Chooses the validated model + adapter for the task and runs the
 * shared tiled orchestrator with task-appropriate tile policy.
 *
 * Denoise stays on SCUNet; deblur and compression restoration use NAFNet
 * checkpoints, each validated for exactly one task (see
 * packages/engine/src/restoration.ts capability inventory).
 */

import { nafnetAdapter, scunetAdapter } from './adapters';
import type { RestorationAdapter } from './tiledRestoration';
import { runTiledRestoration, type TiledRestorationOptions } from './tiledRestoration';
import type { RestorationTask } from './types';

export const NAFNET_DEBLUR_GOPRO_ID = 'nafnet-deblur-gopro';
export const NAFNET_DENOISE_SIDD_ID = 'nafnet-denoise-sidd';
export const SCUNET_ID = 'scunet';

export interface RestorationTaskOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  /** Overrides for tests/benchmarks (tile policy, providers). */
  tileSize?: number;
  overlap?: number;
  maxDim?: number;
}

export interface RestorationTaskDispatchResult {
  imageData: ImageData;
  processingTimeMs: number;
  executionProvider: string;
  tilesUsed: number;
}

interface TaskSpec {
  modelId: string;
  adapter: RestorationAdapter;
  tileSize: number;
  overlap: number;
}

const TASK_SPECS: Record<RestorationTask, TaskSpec> = {
  denoise: {
    modelId: SCUNET_ID,
    adapter: scunetAdapter,
    // 512/64 matches the shipped SCUNet tile policy.
    tileSize: 512,
    overlap: 64,
  },
  deblur: {
    modelId: NAFNET_DEBLUR_GOPRO_ID,
    adapter: nafnetAdapter,
    // Deblur needs wider context than denoise: the NAFNet receptive field
    // spans the whole downsampled feature map, so tiles keep a larger
    // overlap to hide edge reconstruction error. Benchmark evidence in
    // docs/quality/image-enhancement-benchmark.md (tile seam tests).
    tileSize: 768,
    overlap: 128,
  },
  'compression-restoration': {
    modelId: NAFNET_DEBLUR_GOPRO_ID,
    adapter: nafnetAdapter,
    tileSize: 512,
    overlap: 64,
  },
};

/** Overridable for tests and benchmark runs. */
export function setTaskSpecOverride(task: RestorationTask, spec: Partial<TaskSpec>): void {
  Object.assign(TASK_SPECS[task], spec);
}

export function resetTaskSpecOverrides(): void {
  TASK_SPECS.denoise = { modelId: SCUNET_ID, adapter: scunetAdapter, tileSize: 512, overlap: 64 };
  TASK_SPECS.deblur = {
    modelId: NAFNET_DEBLUR_GOPRO_ID,
    adapter: nafnetAdapter,
    tileSize: 768,
    overlap: 128,
  };
  TASK_SPECS['compression-restoration'] = {
    modelId: NAFNET_DEBLUR_GOPRO_ID,
    adapter: nafnetAdapter,
    tileSize: 512,
    overlap: 64,
  };
}

export async function dispatchRestorationTask(
  source: ImageData,
  task: RestorationTask,
  strength: number,
  options: RestorationTaskOptions = {},
): Promise<RestorationTaskDispatchResult> {
  const spec = TASK_SPECS[task];
  return runTiledRestoration(source, {
    modelId: spec.modelId,
    strength,
    tileSize: options.tileSize ?? spec.tileSize,
    overlap: options.overlap ?? spec.overlap,
    maxDim: options.maxDim,
    signal: options.signal,
    onProgress: options.onProgress,
    adapter: spec.adapter,
  } satisfies TiledRestorationOptions);
}
