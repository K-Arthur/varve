/// <reference types="@webgpu/types" />

/**
 * WebGPU capability detection with fallback adapter reporting.
 */
import { selectWebGpuAdapter } from '@strata/engine';
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
  // Same adapter-selection policy as WebGPUBackend.init (ADR-0003 Minimum
  // Supported Baseline): decline software adapters rather than reporting
  // them as usable, so this capability probe and the real backend init
  // agree on whether a given machine gets GPU or Canvas2D.
  const result = await selectWebGpuAdapter(gpu, { powerPreference, requireHardwareAdapter: true });
  if (result.kind === 'unavailable') {
    return { webgpu: false, webgpuReason: 'no adapter available' };
  }
  if (result.kind === 'declined-software') {
    return { webgpu: false, webgpuReason: 'software adapter declined', isFallbackAdapter: true };
  }
  try {
    const device = await result.adapter.requestDevice();
    device.destroy();
  } catch {
    return { webgpu: false, webgpuReason: 'device request failed' };
  }
  return { webgpu: true, isFallbackAdapter: result.isFallbackAdapter };
}
