/**
 * GPU kernel registry — registers every live-effect compute kernel into the
 * runner. Kernels not yet present (sequential-dither is intentionally absent:
 * error diffusion is CPU-only) simply fall back to the CPU provider via the
 * dispatch chain.
 */
import type { GpuEffectRunner } from '../runner';
import { CRT_KERNEL } from './crt';
import { LIGHT_LEAK_KERNEL } from './lightLeak';
import { RGB_SPLIT_KERNEL } from './rgbSplit';

export const EFFECT_KERNELS = [RGB_SPLIT_KERNEL, CRT_KERNEL, LIGHT_LEAK_KERNEL];

export function registerEffectKernels(runner: GpuEffectRunner): void {
  for (const kernel of EFFECT_KERNELS) runner.register(kernel);
}
