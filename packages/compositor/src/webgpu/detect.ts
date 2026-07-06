/**
 * WebGPU capability detection with fallback adapter reporting.
 */
import type { CompositorCapabilities } from '../types';

interface GpuNavigator extends Navigator {
  gpu?: {
    requestAdapter(options?: { powerPreference?: string }): Promise<GpuAdapter | null>;
  };
}

interface GpuAdapter {
  requestDevice(): Promise<GpuDevice>;
  info?: { description?: string };
}

interface GpuDevice {
  destroy(): void;
  lost: Promise<{ reason: string; message: string }>;
}

export async function detectWebGPU(): Promise<CompositorCapabilities> {
  if (typeof navigator === 'undefined') {
    return { webgpu: false, webgpuReason: 'navigator.gpu unavailable' };
  }
  const gpu = (navigator as GpuNavigator).gpu;
  if (!gpu) {
    return { webgpu: false, webgpuReason: 'navigator.gpu unavailable' };
  }
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return { webgpu: false, webgpuReason: 'no adapter' };
    }
    const device = await adapter.requestDevice();
    device.destroy();
    return {
      webgpu: true,
      isFallbackAdapter: adapter.info?.description?.includes('fallback') ?? false,
    };
  } catch (err) {
    return {
      webgpu: false,
      webgpuReason: err instanceof Error ? err.message : 'adapter request failed',
    };
  }
}
