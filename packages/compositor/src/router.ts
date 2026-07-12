/**
 * Compositor backend router — capability detection + fallback chain.
 */
import { Canvas2DBackend } from './canvas2d/backend';
import type { CompositorBackend, CompositorCapabilities, CompositorOptions } from './types';
import { WebGPUBackend } from './webgpu/backend';
import { detectWebGPU } from './webgpu/detect';

export async function createCompositorBackend(
  canvas: HTMLCanvasElement,
  opts: CompositorOptions = {},
): Promise<{ backend: CompositorBackend; capabilities: CompositorCapabilities }> {
  const capabilities = await detectWebGPU();
  let backend: CompositorBackend;

  if (opts.preferWebGpu && capabilities.webgpu) {
    // No `onDeviceLost` hot-swap here: a `<canvas>` element's context type
    // (`webgpu` vs `2d`) is fixed for its lifetime in every browser, so a
    // Canvas2DBackend can't be initialized on this same `canvas` after
    // `getContext('webgpu')` has already been called on it — recovery
    // requires the caller to remount a fresh canvas element and re-run
    // `createCompositorBackend` on it. `WebGPUBackend.getDiagnostics()`
    // exposes `deviceLost: true` once `GPUDevice.lost` resolves so the UI
    // can prompt for that instead of silently leaving a frozen canvas.
    backend = new WebGPUBackend();
  } else {
    backend = new Canvas2DBackend();
  }

  await backend.init(canvas);
  return { backend, capabilities };
}

export { detectWebGPU };
