import { dispatchDenoise } from './denoiseProviders/dispatch';
import { dispatchUpscale } from './upscaleProviders/dispatch';
import {
  planRestoration,
  type RestorationOperation,
  type RestorationRequest,
  type RestorationStagePlan,
} from './restoration';

export interface RestorationStageState extends RestorationStagePlan {
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  progress: number;
  processingTimeMs?: number;
}

export interface RestorationExecutionOptions {
  signal?: AbortSignal;
  onStageChange?: (stages: RestorationStageState[]) => void;
  onProgress?: (stage: RestorationStageState, done: number, total: number) => void;
}

export interface RestorationResult {
  imageData: ImageData;
  operation: RestorationOperation;
  stages: RestorationStageState[];
  warnings: string[];
  modelIds: string[];
  provider?: string;
  totalTimeMs: number;
}

function cancelled(): Error {
  return new Error('cancelled');
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

function reportStages(
  stages: RestorationStageState[],
  callback?: (stages: RestorationStageState[]) => void,
): void {
  callback?.(stages.map((stage) => ({ ...stage })));
}

function initialStage(plan: RestorationStagePlan): RestorationStageState {
  return { ...plan, status: 'pending', progress: 0 };
}

/**
 * Execute a planned restoration request through the existing provider chains.
 * Model sessions remain lazy: planning only checks metadata, while dispatch is
 * reached after the user commits the operation.
 */
export async function runRestoration(
  source: ImageData,
  request: RestorationRequest,
  options: RestorationExecutionOptions = {},
): Promise<RestorationResult> {
  const plan = planRestoration(request);
  const stages = plan.stages.map(initialStage);
  const start = performance.now();
  const modelIds = stages.flatMap((stage) => (stage.modelId ? [stage.modelId] : []));
  let currentImage = source;
  let provider: string | undefined;

  reportStages(stages, options.onStageChange);
  assertNotCancelled(options.signal);

  for (const stage of stages) {
    assertNotCancelled(options.signal);
    stage.status = 'running';
    reportStages(stages, options.onStageChange);
    const stageStart = performance.now();

    try {
      if (stage.task === 'denoise') {
        const strength = request.denoise?.strength ?? 'medium';
        const strengthValue = { light: 0.3, medium: 0.5, strong: 0.8 }[strength];
        const result = await dispatchDenoise(currentImage, {
          strength: strengthValue,
          modelId: stage.modelId,
          signal: options.signal,
          onProgress: (done, total) => {
            stage.progress = total > 0 ? done / total : 0;
            options.onProgress?.(stage, done, total);
            reportStages(stages, options.onStageChange);
          },
        });
        currentImage = result.denoised;
        provider = result.executionProvider;
      } else if (stage.task === 'upscale') {
        const upscale = request.upscale;
        if (!upscale) throw new Error('Upscale settings are required');
        currentImage = await dispatchUpscale(
          currentImage,
          {
            method: upscale.method === 'pixel-art' ? 'nearest' : upscale.method,
            scale: upscale.scale,
            modelId: stage.modelId,
            preview: request.preview,
            previewMaxDimension: request.previewMaxDimension,
            pixelArtAlgorithm: undefined,
          },
          options.signal,
        );
        provider = provider ?? (upscale.method === 'ai' ? 'ai' : 'cpu');
        stage.progress = 1;
        options.onProgress?.(stage, 1, 1);
      } else {
        // The planner currently rejects these operations before execution.
        throw new Error(`${stage.task} has no validated execution provider`);
      }

      assertNotCancelled(options.signal);
      stage.progress = 1;
      stage.status = 'completed';
      stage.processingTimeMs = performance.now() - stageStart;
      reportStages(stages, options.onStageChange);
    } catch (error) {
      stage.processingTimeMs = performance.now() - stageStart;
      stage.status = options.signal?.aborted ? 'cancelled' : 'failed';
      reportStages(stages, options.onStageChange);
      throw error;
    }
  }

  return {
    imageData: currentImage,
    operation: request.operation,
    stages,
    warnings: plan.warnings,
    modelIds,
    provider,
    totalTimeMs: performance.now() - start,
  };
}
