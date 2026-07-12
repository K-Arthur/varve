/// <reference types="@webgpu/types" />

/**
 * WebGPU capability detection with fallback adapter reporting.
 */
import type { CompositorCapabilities } from '../types';

export async function detectWebGPU(
  powerPreference?: GPUPowerPreference,
): Promise<CompositorCapabilities> {
  if (typeof navigator === 'undefined') {
    return { webgpu: false, webgpuReason: 'navigator.gpu unavailable' };
  }
  const gpu = navigator.gpu;
  if (!gpu) {
    return { webgpu: false, webgpuReason: 'navigator.gpu unavailable' };
  }
  // Try the requested preference first, fall back to the other if unavailable.
  const preferences: GPUPowerPreference[] = powerPreference
    ? [powerPreference, powerPreference === 'high-performance' ? 'low-power' : 'high-performance']
    : ['high-performance', 'low-power'];
  for (const pref of preferences) {
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: pref });
      if (!adapter) continue;
      const device = await adapter.requestDevice();
      device.destroy();
      return {
        webgpu: true,
        isFallbackAdapter: adapter.info?.description?.includes('fallback') ?? false,
      };
    } catch {
      // Fall through to next preference.
    }
  }
  return { webgpu: false, webgpuReason: 'no adapter available' };
}
