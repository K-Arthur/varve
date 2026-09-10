import { dispatchDenoise } from '../denoiseProviders/dispatch';
import type { DenoiseStrength, UpscaleMethod } from '../imageEnhancement';
import { type PixelArtAlgorithm, scalePixelArt } from '../pixelArtScaling';

export interface EnhancementStage {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
}

export interface EnhancementPipelineOptions {
  source: ImageData;
  denoiseStrength?: DenoiseStrength;
  upscaleMethod?: UpscaleMethod | 'pixel-art';
  upscaleScale?: number;
  upscaleModelId?: string;
  pixelArtAlgorithm?: PixelArtAlgorithm;
  signal?: AbortSignal;
  onStageChange?: (stages: EnhancementStage[]) => void;
  onProgress?: (done: number, total: number) => void;
  preview?: boolean;
  previewMaxDimension?: number;
}

export interface EnhancementPipelineResult {
  imageData: ImageData;
  stages: EnhancementStage[];
  totalTimeMs: number;
}

const DENOISE_STRENGTH_MAP: Record<DenoiseStrength, number> = {
  none: 0,
  light: 0.3,
  medium: 0.5,
  strong: 0.8,
};

export async function runEnhancementPipeline(
  options: EnhancementPipelineOptions,
): Promise<EnhancementPipelineResult> {
  const {
    source,
    denoiseStrength = 'none',
    upscaleMethod = 'bicubic',
    upscaleScale = 2,
    upscaleModelId,
    pixelArtAlgorithm,
    signal,
    onStageChange,
    onProgress,
    preview = false,
    previewMaxDimension = 512,
  } = options;

  const start = performance.now();
  const stages: EnhancementStage[] = [
    { name: 'Denoise', status: denoiseStrength !== 'none' ? 'pending' : 'completed' },
    { name: 'Upscale', status: 'pending' },
  ];
  const denoiseStage = stages[0]!;
  const upscaleStage = stages[1]!;
  onStageChange?.(stages);
  if (signal?.aborted) throw new Error('cancelled');

  let currentImage = source;

  if (denoiseStrength !== 'none' && denoiseStrength !== undefined) {
    denoiseStage.status = 'running';
    onStageChange?.([...stages]);
    const strength = DENOISE_STRENGTH_MAP[denoiseStrength];
    const denoiseResult = await dispatchDenoise(currentImage, {
      strength,
      signal,
      onProgress: (done, total) => {
        denoiseStage.status = 'running';
        denoiseStage.progress = done / total;
        onStageChange?.([...stages]);
        onProgress?.(done, total);
      },
    });
    currentImage = denoiseResult.denoised;
    denoiseStage.status = 'completed';
    onStageChange?.([...stages]);
    if (signal?.aborted) throw new Error('cancelled');
  }

  upscaleStage.status = 'running';
  onStageChange?.([...stages]);

  if (upscaleMethod === 'pixel-art') {
    const algorithm = pixelArtAlgorithm ?? 'epx';
    currentImage = scalePixelArt(currentImage, { algorithm, scale: upscaleScale });
  } else if (
    upscaleMethod === 'nearest' ||
    upscaleMethod === 'bilinear' ||
    upscaleMethod === 'bicubic' ||
    upscaleMethod === 'lanczos3'
  ) {
    if (preview) {
      const { computeUpscalePreview } = await import('../imageEnhancement');
      currentImage = computeUpscalePreview(currentImage, {
        method: upscaleMethod,
        scale: upscaleScale,
        previewMaxDimension,
      });
    } else {
      const { upscaleImageData } = await import('../imageEnhancement');
      currentImage = upscaleImageData(currentImage, {
        method: upscaleMethod,
        scale: upscaleScale,
      });
    }
  } else if (upscaleMethod === 'ai') {
    const { dispatchUpscale: dispatchAi } = await import('./dispatch');
    const beforeWidth = currentImage.width;
    const beforeHeight = currentImage.height;
    currentImage = await dispatchAi(
      currentImage,
      {
        method: 'ai',
        scale: upscaleScale,
        modelId: upscaleModelId,
        preview,
        previewMaxDimension,
      },
      signal,
    );
    if (
      !preview &&
      upscaleScale !== 4 &&
      currentImage.width === beforeWidth * 4 &&
      currentImage.height === beforeHeight * 4
    ) {
      const { upscaleImageData } = await import('../imageEnhancement');
      const targetWidth = Math.max(1, Math.round(beforeWidth * upscaleScale));
      const targetHeight = Math.max(1, Math.round(beforeHeight * upscaleScale));
      if (currentImage.width !== targetWidth || currentImage.height !== targetHeight) {
        currentImage = upscaleImageData(currentImage, {
          method: 'lanczos3',
          targetWidth,
          targetHeight,
        });
      }
    }
  }

  upscaleStage.status = 'completed';
  onStageChange?.([...stages]);
  onProgress?.(1, 1);
  const totalTimeMs = performance.now() - start;

  return { imageData: currentImage, stages, totalTimeMs };
}
