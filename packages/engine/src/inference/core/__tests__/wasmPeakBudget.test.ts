import { describe, expect, it, vi } from 'vitest';

/**
 * Peak-memory figures were tested against `wasmSafeModelBytes`, a *model-file*
 * budget. Since peak runs several times file size, that rejected models which
 * demonstrably run — SCUNet loads and infers in under a second at a 280MB peak,
 * yet was refused against a 50MB file budget, surfacing as "Model exceeds safe
 * WASM memory limit" and blocking denoise entirely.
 */
vi.mock('@strata/platform', () => ({ isTauriRuntime: () => false }));

describe('WASM safety budgets', () => {
  it('separates the peak-memory budget from the model-file budget', async () => {
    const { getEnvironmentCapabilities } = await import(
      '../../../backgroundRemoval/environmentCapabilities'
    );
    const caps = await getEnvironmentCapabilities();
    expect(caps.wasmSafePeakBytes).toBeGreaterThan(caps.wasmSafeModelBytes);
  });

  it('admits models that run and still refuses the ones that exhaust wasm32', async () => {
    const { isWasmModelSafe } = await import('../../../backgroundRemoval/environmentCapabilities');

    // Verified end-to-end in a browser: session + inference in ~2.7s.
    await expect(isWasmModelSafe('scunet')).resolves.toBe(true);
    await expect(isWasmModelSafe('u2netp')).resolves.toBe(true);
    await expect(isWasmModelSafe('depth-anything-v2-small')).resolves.toBe(true);

    // BiRefNet is the documented case that aborts the webview on bare WASM.
    await expect(isWasmModelSafe('birefnet-general')).resolves.toBe(false);
    await expect(isWasmModelSafe('birefnet-general-lite')).resolves.toBe(false);
  });
});
