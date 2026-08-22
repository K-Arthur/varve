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

/**
 * Deblur tile policy is adaptive, not static: NAFNet's global receptive
 * field (16x downsampling + global channel attention) makes seams far
 * worse than upscale/denoise tiling — measured 34 dB tiled-vs-whole at
 * 768/128 vs 60 dB single-shot on a 1536px image (seam tests, see
 * docs/quality/image-enhancement-benchmark.md). Images up to 1280px run
 * single-shot; larger images use the same 1280px tiles, because a
 * 1536px single-shot already peaks above 7 GB (OOM-measured) while a
 * 1280px tile stays within the ~5 GB budget.
 */
function deblurTilePolicy(width: number, height: number): { tileSize: number; overlap: number } {
  const maxDim = Math.max(width, height);
  if (maxDim <= 1280) {
    return { tileSize: Math.max(768, Math.ceil(maxDim / 16) * 16), overlap: 0 };
  }
  return { tileSize: 1280, overlap: 256 };
}

interface TaskSpec {
  modelId: string;
  adapter: RestorationAdapter;
  tileSize: number;
  overlap: number;
  /** Dynamic tile policy override (called with source dims). */
  tilePolicy?: (width: number, height: number) => { tileSize: number; overlap: number };
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
    tileSize: 1280,
    overlap: 256,
    tilePolicy: deblurTilePolicy,
  },
  'compression-restoration': {
    // No validated checkpoint — SCUNet harms text/thin-lines on the
    // design corpus (-17 dB, docs/quality/image-enhancement-benchmark.md)
    // and the only NAFNet JPEG checkpoint was rejected on provenance.
    // The planner rejects this task before dispatch is reached, but an
    // empty modelId ensures dispatch cannot silently route through an
    // unrelated model if the guard is ever bypassed.
    modelId: '',
    adapter: scunetAdapter,
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
    tileSize: 1280,
    overlap: 256,
    tilePolicy: deblurTilePolicy,
  };
  TASK_SPECS['compression-restoration'] = {
    modelId: '',
    adapter: scunetAdapter,
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
  if (task === 'compression-restoration') {
    throw new Error(
      'Remove compression artifacts is not available for this installation — no checkpoint has passed Varve’s design-content corpus (SCUNet destroys 1px lines; see docs/quality/image-enhancement-benchmark.md).',
    );
  }
  const spec = TASK_SPECS[task];
  const policy = spec.tilePolicy?.(source.width, source.height);
  return runTiledRestoration(source, {
    modelId: spec.modelId,
    strength,
    tileSize: options.tileSize ?? policy?.tileSize ?? spec.tileSize,
    overlap: options.overlap ?? policy?.overlap ?? spec.overlap,
    maxDim: options.maxDim,
    signal: options.signal,
    onProgress: options.onProgress,
    adapter: spec.adapter,
  } satisfies TiledRestorationOptions);
}
