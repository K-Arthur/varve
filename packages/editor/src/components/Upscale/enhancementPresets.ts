import type {
  DenoiseStrength,
  PixelArtAlgorithm,
  RestorationOperation,
  UpscaleModeId,
} from '@varve/engine';

export type EnhancementPresetId =
  | 'recommended'
  | 'fast-preview'
  | 'photo-cleanup'
  | 'photo-upscale'
  | 'illustration-upscale'
  | 'pixel-art'
  | 'denoise'
  | 'deblur'
  | 'deblur-upscale'
  | 'custom';

export interface EnhancementPreset {
  id: Exclude<EnhancementPresetId, 'custom'>;
  label: string;
  description: string;
  operation: RestorationOperation | 'auto';
  mode: UpscaleModeId;
  scale: number;
  qualityPolicy: 'faithful' | 'balanced';
  denoiseStrength: DenoiseStrength;
  deblurStrength: number;
  pixelArtAlgorithm: PixelArtAlgorithm;
}

/**
 * Review-first starting points for the complete enhancement surface.
 * Output behavior is deliberately not part of a preset: choosing a preset
 * must not silently change whether the source is replaced or preserved.
 */
export const ENHANCEMENT_PRESETS: readonly EnhancementPreset[] = [
  {
    id: 'recommended',
    label: 'Recommended (Auto)',
    description: 'Analyze the image and choose the smallest justified repair.',
    operation: 'auto',
    mode: 'quality',
    scale: 2,
    qualityPolicy: 'faithful',
    denoiseStrength: 'none',
    deblurStrength: 0.7,
    pixelArtAlgorithm: 'epx',
  },
  {
    id: 'fast-preview',
    label: 'Fast preview',
    description: 'Quick 2x CPU upscale for drafts and limited hardware.',
    operation: 'upscale',
    mode: 'fast',
    scale: 2,
    qualityPolicy: 'faithful',
    denoiseStrength: 'none',
    deblurStrength: 0.7,
    pixelArtAlgorithm: 'epx',
  },
  {
    id: 'photo-cleanup',
    label: 'Photo cleanup + upscale',
    description: 'Medium SCUNet denoise followed by a balanced 2x CPU upscale.',
    operation: 'restore-upscale',
    mode: 'quality',
    scale: 2,
    qualityPolicy: 'balanced',
    denoiseStrength: 'medium',
    deblurStrength: 0.7,
    pixelArtAlgorithm: 'epx',
  },
  {
    id: 'photo-upscale',
    label: 'Photo AI upscale',
    description: 'Bundled Real-ESRGAN general x4 super-resolution.',
    operation: 'upscale',
    mode: 'ai-enhance',
    scale: 4,
    qualityPolicy: 'balanced',
    denoiseStrength: 'none',
    deblurStrength: 0.7,
    pixelArtAlgorithm: 'epx',
  },
  {
    id: 'illustration-upscale',
    label: 'Illustration / anime upscale',
    description: 'Anime-optimized Real-ESRGAN x4 for line art and flat colour.',
    operation: 'upscale',
    mode: 'illustration',
    scale: 4,
    qualityPolicy: 'faithful',
    denoiseStrength: 'none',
    deblurStrength: 0.7,
    pixelArtAlgorithm: 'epx',
  },
  {
    id: 'pixel-art',
    label: 'Pixel art upscale',
    description: 'Integer scaling with crisp pixel-preserving algorithms.',
    operation: 'upscale',
    mode: 'pixel-art',
    scale: 4,
    qualityPolicy: 'faithful',
    denoiseStrength: 'none',
    deblurStrength: 0.7,
    pixelArtAlgorithm: 'epx',
  },
  {
    id: 'denoise',
    label: 'Denoise only',
    description: 'SCUNet cleanup without changing image dimensions.',
    operation: 'denoise',
    mode: 'quality',
    scale: 2,
    qualityPolicy: 'faithful',
    denoiseStrength: 'medium',
    deblurStrength: 0.7,
    pixelArtAlgorithm: 'epx',
  },
  {
    id: 'deblur',
    label: 'Deblur only',
    description: 'Conservative NAFNet deblur without changing image dimensions.',
    operation: 'deblur',
    mode: 'quality',
    scale: 2,
    qualityPolicy: 'faithful',
    denoiseStrength: 'none',
    deblurStrength: 0.5,
    pixelArtAlgorithm: 'epx',
  },
  {
    id: 'deblur-upscale',
    label: 'Deblur + upscale',
    description: 'NAFNet deblur followed by a balanced 2x CPU upscale.',
    operation: 'deblur-upscale',
    mode: 'quality',
    scale: 2,
    qualityPolicy: 'balanced',
    denoiseStrength: 'none',
    deblurStrength: 0.5,
    pixelArtAlgorithm: 'epx',
  },
];

export function getEnhancementPreset(id: EnhancementPresetId): EnhancementPreset | undefined {
  return ENHANCEMENT_PRESETS.find((preset) => preset.id === id);
}
