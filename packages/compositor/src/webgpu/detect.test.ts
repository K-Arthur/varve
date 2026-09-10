// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { detectWebGPU } from './detect';

function makeMockAdapter(overrides: {
  features?: string[];
  limits?: Record<string, number>;
  vendor?: string;
  architecture?: string;
  description?: string;
  requestDeviceShouldThrow?: boolean;
}): GPUAdapter {
  const features = overrides.features ?? ['float32-filterable'];
  const limits = overrides.limits ?? {
    maxTextureDimension2D: 8192,
    maxStorageBufferBindingSize: 256 * 1024 * 1024,
  };
  const info = {
    vendor: overrides.vendor ?? 'NVIDIA',
    architecture: overrides.architecture ?? 'Turing',
    device: 'Test GPU',
    description: overrides.description ?? '',
  };

  return {
    requestDevice: vi.fn().mockImplementation(() => {
      if (overrides.requestDeviceShouldThrow) {
        return Promise.reject(new Error('device request failed'));
      }
      return Promise.resolve({
        destroy: vi.fn(),
        lost: Promise.resolve({} as GPUDeviceLostInfo),
        features: new Set(features),
        limits,
        createShaderModule: vi.fn(),
        createRenderPipeline: vi.fn(),
        createBindGroupLayout: vi.fn(),
        createPipelineLayout: vi.fn(),
        createBuffer: vi.fn(),
        createBindGroup: vi.fn(),
        createCommandEncoder: vi.fn(),
        queue: { submit: vi.fn(), writeBuffer: vi.fn() },
      } as unknown as GPUDevice);
    }),
    features: new Set(features),
    limits,
    info,
  } as unknown as GPUAdapter;
}

describe('detectWebGPU', () => {
  it('returns false when navigator.gpu is undefined', async () => {
    const gpu = (window.navigator as any).gpu;
    (window.navigator as any).gpu = undefined;
    const result = await detectWebGPU();
    expect(result.webgpu).toBe(false);
    expect(result.webgpuReason).toContain('navigator');
    (window.navigator as any).gpu = gpu;
  });

  it('returns false for software/fallback adapter', async () => {
    (window.navigator as any).gpu = {
      requestAdapter: vi
        .fn()
        .mockResolvedValue(makeMockAdapter({ vendor: 'mesa', architecture: 'llvmpipe' })),
      getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
    };
    const result = await detectWebGPU();
    expect(result.webgpu).toBe(false);
    expect(result.webgpuReason).toContain('software');
  });

  it('returns false when device request fails', async () => {
    (window.navigator as any).gpu = {
      requestAdapter: vi
        .fn()
        .mockResolvedValue(makeMockAdapter({ requestDeviceShouldThrow: true })),
      getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
    };
    const result = await detectWebGPU();
    expect(result.webgpu).toBe(false);
    expect(result.webgpuReason).toContain('device request');
  });

  it('returns true for capable hardware adapter', async () => {
    (window.navigator as any).gpu = {
      requestAdapter: vi.fn().mockResolvedValue(
        makeMockAdapter({
          vendor: 'NVIDIA',
          architecture: 'Turing',
        }),
      ),
      getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
    };
    const result = await detectWebGPU();
    expect(result.webgpu).toBe(true);
    expect(result.webgpuReason).toBeUndefined();
    expect(result.isFallbackAdapter).toBe(false);
  });

  it('declines SwiftShader adapter (software check)', async () => {
    (window.navigator as any).gpu = {
      requestAdapter: vi.fn().mockResolvedValue(
        makeMockAdapter({
          vendor: 'Google',
          description: 'SwiftShader WebGPU',
        }),
      ),
      getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
    };
    const result = await detectWebGPU();
    expect(result.webgpu).toBe(false);
    expect(result.webgpuReason).toContain('software');
    expect(result.isFallbackAdapter).toBe(true);
  });

  it('returns false when no adapter is available', async () => {
    (window.navigator as any).gpu = {
      requestAdapter: vi.fn().mockResolvedValue(null),
      getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
    };
    const result = await detectWebGPU();
    expect(result.webgpu).toBe(false);
    expect(result.webgpuReason).toContain('no adapter');
  });

  it('returns false when requestAdapter throws', async () => {
    (window.navigator as any).gpu = {
      requestAdapter: vi.fn().mockRejectedValue(new Error('adapter request failed')),
      getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
    };
    const result = await detectWebGPU();
    expect(result.webgpu).toBe(false);
    expect(result.webgpuReason).toContain('no adapter');
  });
});
