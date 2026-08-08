/**
 * GPU kernel registry — registers every live-effect compute kernel into the
 * runner. Kernels not yet present (sequential-dither is intentionally absent:
 * error diffusion is CPU-only) simply fall back to the CPU provider via the
 * dispatch chain.
 */
import type { GpuEffectRunner } from '../runner';
import { BLOOM_KERNEL } from './bloom';
import { CAUSTICS_KERNEL } from './caustics';
import { CRT_KERNEL } from './crt';
import { LENS_FLARE_KERNEL } from './lensFlare';
import { LIGHT_LEAK_KERNEL } from './lightLeak';
import { LIGHT_SHAFTS_KERNEL } from './lightShafts';
import { PALETTE_SNAP_KERNEL } from './paletteSnap';
import { RGB_SPLIT_KERNEL } from './rgbSplit';
import { VHS_KERNEL } from './vhs';

export const EFFECT_KERNELS = [
  RGB_SPLIT_KERNEL,
  CRT_KERNEL,
  LIGHT_LEAK_KERNEL,
  PALETTE_SNAP_KERNEL,
  VHS_KERNEL,
  LIGHT_SHAFTS_KERNEL,
  CAUSTICS_KERNEL,
  LENS_FLARE_KERNEL,
  BLOOM_KERNEL,
];

export function registerEffectKernels(runner: GpuEffectRunner): void {
  for (const kernel of EFFECT_KERNELS) runner.register(kernel);
}
