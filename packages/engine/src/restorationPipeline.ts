import { dispatchDenoise } from './denoiseProviders/dispatch';
import { scalePixelArt } from './pixelArtScaling';
import {
  planRestoration,
  type RestorationOperation,
  type RestorationRequest,
  type RestorationStagePlan,
  type RestorationStageState,
  toRestorationError,
} from './restoration';
import { dispatchUpscale } from './upscaleProviders/dispatch';

export type { RestorationStageState } from './restoration';

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

function cropForPreview(source: ImageData, maxDimension: number): ImageData {
  const limit = Math.max(1, Math.round(maxDimension));
  if (source.width <= limit && source.height <= limit) return source;
  const width = Math.max(1, Math.min(source.width, limit));
  const height = Math.max(1, Math.min(source.height, limit));
  const originX = Math.floor((source.width - width) / 2);
  const originY = Math.floor((source.height - height) / 2);
  const result = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((originY + y) * source.width + originX) * 4;
    const sourceEnd = sourceStart + width * 4;
    result.data.set(source.data.subarray(sourceStart, sourceEnd), y * width * 4);
  }
  return result;
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
  const previewScale = request.upscale?.scale ?? 1;
  const previewLimit = (request.previewMaxDimension ?? 512) / Math.max(1, previewScale);
  let currentImage = request.preview ? cropForPreview(source, previewLimit) : source;
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
        // Faithful policy uses lighter denoise to preserve original detail;
        // balanced uses the user-selected or default strength.
        const effectiveStrength =
          request.qualityPolicy === 'faithful' && !request.denoise?.strength
            ? 'light'
            : (request.denoise?.strength ?? 'medium');
        const strengthValue = { light: 0.3, medium: 0.5, strong: 0.8 }[effectiveStrength];
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
      } else if (stage.task === 'deblur' || stage.task === 'compression-restoration') {
        // Use explicit deblur strength when provided; fall back to the
        // denoise-mapped value for backward compatibility with callers
        // that don't yet set deblur.strength.
        const deblurStrength =
          request.deblur?.strength != null
            ? request.deblur.strength
            : request.qualityPolicy === 'faithful' && !request.denoise?.strength
              ? 0.3
              : request.denoise?.strength === 'light'
                ? 0.3
                : request.denoise?.strength === 'strong'
                  ? 0.8
                  : 0.7;
        const { dispatchRestorationTask } = await import('./restorationProviders/dispatch');
        const result = await dispatchRestorationTask(currentImage, stage.task, deblurStrength, {
          modelId: stage.modelId,
          signal: options.signal,
          onProgress: (done, total) => {
            stage.progress = total > 0 ? done / total : 0;
            options.onProgress?.(stage, done, total);
            reportStages(stages, options.onStageChange);
          },
        });
        currentImage = result.imageData;
        provider = provider ?? result.executionProvider;
      } else if (stage.task === 'upscale') {
        const upscale = request.upscale;
        if (!upscale) throw new Error('Upscale settings are required');
        if (upscale.method === 'pixel-art') {
          currentImage = scalePixelArt(currentImage, {
            algorithm: upscale.pixelArtAlgorithm ?? 'nearest',
            scale: upscale.scale,
          });
        } else {
          const beforeUpscaleWidth = currentImage.width;
          const beforeUpscaleHeight = currentImage.height;
          currentImage = await dispatchUpscale(
            currentImage,
            {
              method: upscale.method,
              scale: upscale.scale,
              modelId: stage.modelId,
              preview: request.preview,
              previewMaxDimension: request.previewMaxDimension,
              onProgress: (done, total) => {
                stage.progress = total > 0 ? done / total : 0;
                options.onProgress?.(stage, done, total);
                reportStages(stages, options.onStageChange);
              },
            },
            options.signal,
          );
          // Real-ESRGAN is a fixed 4× model. An arbitrary requested
          // scale (e.g. 2×) is served as: AI 4× → high-quality downsample
          // to the exact target size. This is honest about what the model
          // natively does and avoids claiming variable-scale super-resolution.
          if (
            upscale.method === 'ai' &&
            !request.preview &&
            upscale.scale !== 4 &&
            currentImage.width === beforeUpscaleWidth * 4 &&
            currentImage.height === beforeUpscaleHeight * 4
          ) {
            const { upscaleImageData } = await import('./imageEnhancement');
            const targetWidth = Math.max(1, Math.round(beforeUpscaleWidth * upscale.scale));
            const targetHeight = Math.max(1, Math.round(beforeUpscaleHeight * upscale.scale));
            if (currentImage.width !== targetWidth || currentImage.height !== targetHeight) {
              currentImage = upscaleImageData(currentImage, {
                method: 'lanczos3',
                targetWidth,
                targetHeight,
              });
            }
          }
        }
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
      throw toRestorationError(error);
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
