/**
 * User-facing upscale modes. Maps intent to engine method + defaults.
 *
 * The engine exposes raw algorithm names (bilinear, bicubic, lanczos3, etc.).
 * Users think in terms of outcomes. This layer translates.
 */

import type { UpscaleMethod } from './imageEnhancement';
import type { PixelArtAlgorithm } from './pixelArtScaling';

export type UpscaleModeId =
  | 'pixel-art'
  | 'fast'
  | 'balanced'
  | 'quality'
  | 'ai-enhance'
  | 'illustration';

export interface UpscaleMode {
  id: UpscaleModeId;
  label: string;
  description: string;
  method: UpscaleMethod;
  /** Whether this mode uses AI inference. */
  isAi: boolean;
  /** Whether scale factor is locked (AI is always 4x). */
  lockedScale: boolean;
  /** Default scale factor. */
  defaultScale: number;
  /** Allowed scale factors. */
  scaleOptions: number[];
  /** Whether only integer scales are allowed. */
  integerOnly: boolean;
  /** Available pixel-art algorithms (for pixel-art mode). */
  pixelArtAlgorithms?: PixelArtAlgorithm[];
  /** Default pixel-art algorithm (for pixel-art mode). */
  defaultPixelArtAlgorithm?: PixelArtAlgorithm;
}

export const UPSCALE_MODES: UpscaleMode[] = [
  {
    id: 'pixel-art',
    label: 'Pixel art',
    description: 'Hard edges, no blur. Preserves crisp pixels for pixel art and UI assets.',
    method: 'nearest',
    isAi: false,
    lockedScale: false,
    defaultScale: 4,
    scaleOptions: [2, 3, 4, 8],
    integerOnly: true,
    pixelArtAlgorithms: ['nearest', 'epx', 'scale2x', 'scale3x', 'scale4x', 'hqx', 'xbr'],
    defaultPixelArtAlgorithm: 'epx',
  },
  {
    id: 'fast',
    label: 'Fast',
    description: 'Bilinear resampling. Quick previews and large images on limited hardware.',
    method: 'bilinear',
    isAi: false,
    lockedScale: false,
    defaultScale: 2,
    scaleOptions: [1.5, 2, 3, 4],
    integerOnly: false,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Bicubic (Catmull-Rom). Good quality for general photographs and illustrations.',
    method: 'bicubic',
    isAi: false,
    lockedScale: false,
    defaultScale: 2,
    scaleOptions: [1.5, 2, 3, 4],
    integerOnly: false,
  },
  {
    id: 'quality',
    label: 'Quality',
    description: 'Lanczos-3. Highest quality CPU resampling for final output and print.',
    method: 'lanczos3',
    isAi: false,
    lockedScale: false,
    defaultScale: 2,
    scaleOptions: [1.5, 2, 3, 4],
    integerOnly: false,
  },
  {
    id: 'ai-enhance',
    label: 'AI enhancement',
    description:
      'Real-ESRGAN x4 super-resolution. Restores detail using the bundled offline model. Best for photographs and illustrations.',
    method: 'ai',
    isAi: true,
    lockedScale: true,
    defaultScale: 4,
    scaleOptions: [4],
    integerOnly: true,
  },
  {
    id: 'illustration',
    label: 'Illustration & anime',
    description:
      'Tuned for line art, flat colours, and cel shading. Uses the validated Real-ESRGAN anime x4 checkpoint when it is installed; the general model remains a separate photo-oriented mode.',
    method: 'ai',
    isAi: true,
    lockedScale: true,
    defaultScale: 4,
    scaleOptions: [4],
    integerOnly: true,
  },
];

export function getUpscaleMode(id: UpscaleModeId): UpscaleMode | undefined {
  return UPSCALE_MODES.find((m) => m.id === id);
}

export const DEFAULT_UPSCALE_MODE: UpscaleModeId = 'balanced';
