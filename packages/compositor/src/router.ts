/**
 * Compositor backend router — capability detection + fallback chain.
 *
 * WebGPUBackend keeps the present canvas on Canvas2D and renders GPU work to
 * an offscreen canvas (see webgpu/backend.ts). Device loss therefore falls
 * back in-place without remounting the content canvas.
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
    backend = new WebGPUBackend();
  } else {
    backend = new Canvas2DBackend();
  }

  await backend.init(canvas);
  return { backend, capabilities };
}

export { detectWebGPU };
