/**
 * WebGPU live-effect provider — bridges the engine's dispatch chain
 * (`@varve/engine/liveEffects/dispatch.ts`) to the GPU compute runner.
 *
 * Availability follows the compositor's adapter policy (ADR-0003): software
 * adapters are declined, so headless/webkit environments keep the CPU path
 * and the E2E pixel hashes stay deterministic. Requests that are
 * unsupported on GPU (sequential error diffusion) throw during `apply` and
 * the dispatch chain falls back to the CPU provider.
 */
import type { EffectDispatchRequest, LiveEffectProvider } from '@varve/engine';
import { registerEffectKernels } from './effects/kernels';
import { type GpuEffectRunner, getSharedEffectRunner } from './effects/runner';

async function runnerFor(_options?: {
  requireHardwareAdapter?: boolean;
}): Promise<GpuEffectRunner | null> {
  const runner = await getSharedEffectRunner();
  if (runner && !runner.diagnostics.ready) return null;
  // getSharedEffectRunner inits once with the default policy; a caller that
  // explicitly allows software adapters (harness) builds its own runner.
  return runner;
}

export const gpuEffectProvider: LiveEffectProvider = {
  id: 'gpu-effects',
  label: 'WebGPU (Compute)',
  isAvailable() {
    return runnerFor().then((runner) => runner !== null);
  },
  async apply(request: EffectDispatchRequest, rgba: Uint8ClampedArray) {
    const runner = await runnerFor();
    if (!runner) throw new Error('WebGPU effects unavailable');
    return runner.apply(request, rgba);
  },
};

/** Register kernels on an externally-created runner (harness / tests). */
export function installEffectKernels(runner: GpuEffectRunner): void {
  registerEffectKernels(runner);
}
