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
  const renderer = opts.renderer ?? (opts.preferWebGpu ? 'webgpu' : 'canvas2d');
  if (renderer === 'webgl2') {
    const { WebGL2Backend } = await import('./webgl2/backend');
    const requested = new WebGL2Backend();
    await requested.init(canvas);
    const diagnostics = requested.getDiagnostics();
    if (diagnostics.gpuActive) {
      return { backend: requested, capabilities: { webgpu: false, webgl2: true } };
    }
    requested.destroy();
    const reason = diagnostics.initFailureReason ?? 'WebGL2 initialization failed';
    const fallback = new Canvas2DBackend(reason, 'webgl2');
    await fallback.init(canvas);
    return {
      backend: fallback,
      capabilities: { webgpu: false, webgl2: false, webgl2Reason: reason, rendererReason: reason },
    };
  }
  if (renderer === 'webgpu') {
    // Initialize the backend once. A separate probe would request and destroy
    // a device before this request, adding startup work and allowing the two
    // requests to disagree about availability.
    const requested = new WebGPUBackend();
    await requested.init(canvas);
    const diagnostics = requested.getDiagnostics();
    if (diagnostics.gpuActive) {
      return { backend: requested, capabilities: { webgpu: true } };
    }
    requested.destroy();
    const reason = diagnostics.initFailureReason ?? 'WebGPU initialization failed';
    const fallback = new Canvas2DBackend(reason, 'webgpu');
    await fallback.init(canvas);
    return {
      backend: fallback,
      capabilities: {
        webgpu: false,
        webgpuReason: reason,
        isFallbackAdapter: diagnostics.adapterIsFallback,
      },
    };
  }

  const backend = new Canvas2DBackend();
  await backend.init(canvas);
  return { backend, capabilities: { webgpu: false, webgpuReason: 'not requested' } };
}

export { detectWebGPU };
