import { describe, expect, it, vi } from 'vitest';
import { createOrtRuntimeLoader } from '../ortRuntime';

describe('ONNX Runtime entrypoint loading', () => {
  it('uses the WebGPU entrypoint once when the runtime provider set includes WebGPU', async () => {
    const wasm = vi.fn(async () => 'wasm-runtime');
    const webgpu = vi.fn(async () => 'webgpu-runtime');
    const configure = vi.fn();
    const loader = createOrtRuntimeLoader({
      loadWasm: wasm,
      loadWebGpu: webgpu,
      configure,
    });

    const [first, second] = await Promise.all([
      loader.load(['webgpu', 'wasm']),
      loader.load(['webgpu', 'wasm']),
    ]);

    expect(first).toMatchObject({ runtime: 'webgpu-runtime', entrypoint: 'webgpu' });
    expect(second).toBe(first);
    expect(webgpu).toHaveBeenCalledTimes(1);
    expect(wasm).not.toHaveBeenCalled();
    expect(configure).toHaveBeenCalledTimes(1);
  });

  it('falls back to the WASM entrypoint if the WebGPU module cannot load', async () => {
    const wasm = vi.fn(async () => 'wasm-runtime');
    const webgpu = vi.fn(async () => {
      throw new Error('WebGPU entrypoint unavailable');
    });
    const loader = createOrtRuntimeLoader({
      loadWasm: wasm,
      loadWebGpu: webgpu,
      configure: vi.fn(),
    });

    await expect(loader.load(['webgpu', 'wasm'])).resolves.toMatchObject({
      runtime: 'wasm-runtime',
      entrypoint: 'wasm',
      providers: ['wasm'],
    });
    expect(webgpu).toHaveBeenCalledTimes(1);
    expect(wasm).toHaveBeenCalledTimes(1);
  });

  it('resets a rejected initialization so the next caller can recover', async () => {
    const wasm = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary load error'))
      .mockResolvedValueOnce('recovered');
    const loader = createOrtRuntimeLoader({
      loadWasm: wasm,
      loadWebGpu: vi.fn(async () => 'unused'),
      configure: vi.fn(),
    });

    await expect(loader.load(['wasm'])).rejects.toThrow('temporary load error');
    await expect(loader.load(['wasm'])).resolves.toMatchObject({
      runtime: 'recovered',
      entrypoint: 'wasm',
    });
    expect(wasm).toHaveBeenCalledTimes(2);
  });

  it('refuses to silently switch entrypoints after worker initialization', async () => {
    const loader = createOrtRuntimeLoader({
      loadWasm: vi.fn(async () => 'wasm-runtime'),
      loadWebGpu: vi.fn(async () => 'webgpu-runtime'),
      configure: vi.fn(),
    });

    await loader.load(['wasm']);
    await expect(loader.load(['webgpu', 'wasm'])).rejects.toThrow(
      /already initialized in this worker/,
    );
  });
});
