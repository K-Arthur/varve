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
    const wgpu = new WebGPUBackend();
    wgpu.onDeviceLost = async () => {
      const c2d = new Canvas2DBackend();
      await c2d.init(canvas);
      backend = c2d;
    };
    backend = wgpu;
  } else {
    backend = new Canvas2DBackend();
  }

  await backend.init(canvas);
  return { backend, capabilities };
}

export { detectWebGPU };
