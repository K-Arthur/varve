export { Canvas2DBackend } from './canvas2d/backend';
export { SubtreeReplayCache, TileCache } from './canvas2d/tileCache';
export { createCompositorBackend, detectWebGPU } from './router';
export type {
  CompositorBackend,
  CompositorBackendId,
  CompositorCapabilities,
  CompositorDiagnostics,
  CompositorFrame,
  CompositorOptions,
} from './types';
export { WebGPUBackend } from './webgpu/backend';
export type { EffectDispatchRequest as GpuEffectDispatchRequest } from './webgpu/effects/runner';
export { type EffectPass, GpuEffectRunner, type GpuKernelSpec } from './webgpu/effects/runner';
export { gpuEffectProvider, installEffectKernels } from './webgpu/gpuEffectProvider';
