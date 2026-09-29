/** Output-only unsharp mask, once after final resize; radius in output pixels. */
import type { SharpenMode } from '@varve/shared';
import { applyUnsharpMask } from '../unsharpMask';

export interface SharpenImageOptions {
  mode?: SharpenMode;
  /** Amount as a ratio (0.5 = 50%). */
  amount?: number;
  /** Three-sigma Gaussian support radius in output pixels. */
  radius?: number;
  /** 0..1 delta in the declared domain; max-component gate in RGB mode. */
  threshold?: number;
  /** Equal luma deltas; clipping may change hue/chroma. */
  luminanceOnly?: boolean;
  /** Scale correction by source alpha, in addition to alpha-weighted blur. */
  protectAlpha?: boolean;
  workingSpace?: 'srgb' | 'linear-srgb';
}

export interface SharpenResult {
  imageData: ImageData;
  applied: boolean;
}

export function sharpenImageData(
  source: ImageData,
  options: SharpenImageOptions = {},
): SharpenResult {
  const amount = options.amount ?? 0.5;
  const radius = options.radius ?? 1;
  const applied =
    options.mode !== undefined &&
    options.mode !== 'none' &&
    Number.isFinite(amount) &&
    amount > 0 &&
    Number.isFinite(radius) &&
    radius > 0;
  return {
    imageData: applyUnsharpMask(source, {
      amount: applied ? amount : 0,
      radius,
      threshold: options.threshold ?? 0.02,
      luminanceOnly: options.luminanceOnly ?? true,
      protectAlpha: options.protectAlpha ?? true,
      workingSpace: options.workingSpace ?? 'srgb',
    }),
    applied,
  };
}
