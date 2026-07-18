import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchBackgroundRemoval } from '../providers/dispatch';

// Simple test ImageData factory
function makeImageData(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 100;
    data[i * 4 + 1] = 150;
    data[i * 4 + 2] = 200;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: 'srgb' as const };
}

// Create a minimal heuristic mock result
const mockHeuristicResult = {
  maskDataUrl: 'data:image/png;base64,test',
  confidence: 0.5,
  method: 'quick' as const,
  processingTimeMs: 10,
  width: 100,
  height: 100,
};

describe('dispatchBackgroundRemoval', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects zero-size images', async () => {
    await expect(
      dispatchBackgroundRemoval(
        { data: new Uint8ClampedArray(0), width: 0, height: 0, colorSpace: 'srgb' },
        { method: 'quick' },
      ),
    ).rejects.toThrow('empty');
  });

  it('quick method uses heuristic path', async () => {
    // Mock the heuristic module
    vi.doMock('../heuristic', () => ({
      removeBackgroundHeuristic: vi.fn().mockResolvedValue(mockHeuristicResult),
    }));

    const { dispatchBackgroundRemoval: dispatch } = await import('../providers/dispatch');
    const result = await dispatch(makeImageData(100, 100), { method: 'quick' });
    expect(result.method).toBe('quick');
    expect(result.confidence).toBe(0.5);
  });

  it('falls back gracefully when ai-quality fails on WASM-only environments', async () => {
    // Mock environmentCapabilities to simulate a WASM-only environment.
    // The dispatch should try ai-quality, fail because no providers work,
    // then fall back to ai-balanced which also fails (no onnxruntime-web).
    // Result: descriptive error about all modes failing, not a crash or
    // memory-related error.
    const mockCaps = {
      isWasmModelSafe: vi.fn().mockResolvedValue(false),
      getEnvironmentCapabilities: vi.fn().mockResolvedValue({
        crossOriginIsolated: false,
        isWebKitGTK: true,
        isTauri: false,
        hasWorker: true,
        hasWebGL: false,
        hasWebGPU: false,
        sharedMemoryAvailable: false,
        wasmSafeModelBytes: 50_000_000,
        preferredOnnxProviders: ['wasm'],
        label: 'Test (no GPU)',
      }),
    };

    vi.doMock('../environmentCapabilities', () => mockCaps);

    const { dispatchBackgroundRemoval: dispatch } = await import('../providers/dispatch');
    const err = await dispatch(makeImageData(100, 100), { method: 'ai-quality' }).catch((e) => e);
    // Should NOT throw a memory-related error (we try and fall back instead)
    expect(err.message).not.toMatch(/exceeds the safe WASM memory limit/i);
    // Should give a clear message about all modes failing
    expect(err.message).toMatch(/AI background removal/i);
  });

  it('allows ai-balanced (u2netp) in all environments', async () => {
    // Mock environmentCapabilities with minimal environment
    const mockCaps = {
      isWasmModelSafe: vi.fn().mockImplementation((id: string) => Promise.resolve(id === 'u2netp')),
      getEnvironmentCapabilities: vi.fn().mockResolvedValue({
        crossOriginIsolated: false,
        isWebKitGTK: true,
        isTauri: false,
        hasWorker: true,
        hasWebGL: false,
        hasWebGPU: false,
        sharedMemoryAvailable: false,
        wasmSafeModelBytes: 50_000_000,
        preferredOnnxProviders: ['wasm'],
        label: 'Test (minimal)',
      }),
    };

    vi.doMock('../environmentCapabilities', () => mockCaps);

    // We also need to mock the provider chain since it won't actually have
    // models available. The dispatch will throw "AI background removal is
    // unavailable" rather than a memory error.
    const { dispatchBackgroundRemoval: dispatch } = await import('../providers/dispatch');
    const err = await dispatch(makeImageData(100, 100), { method: 'ai-balanced' }).catch((e) => e);
    // Should NOT throw a memory-related error
    expect(err.message).not.toMatch(/exceeds the safe WASM memory limit/i);
    expect(err.message).not.toMatch(/memory/i);
  });

  it('respects abort signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      dispatchBackgroundRemoval(makeImageData(100, 100), { method: 'quick' }, ac.signal),
    ).rejects.toThrow('cancelled');
  });

  it('allows ai-quality on environments with WebGPU or WebGL', async () => {
    // Mock environmentCapabilities to simulate GPU-capable environment
    const mockCaps = {
      isWasmModelSafe: vi.fn().mockResolvedValue(false),
      getEnvironmentCapabilities: vi.fn().mockResolvedValue({
        crossOriginIsolated: false,
        isWebKitGTK: false,
        isTauri: false,
        hasWorker: true,
        hasWebGL: true,
        hasWebGPU: false,
        sharedMemoryAvailable: false,
        wasmSafeModelBytes: 50_000_000,
        preferredOnnxProviders: ['webgl', 'wasm'],
        label: 'Test (WebGL)',
      }),
    };

    vi.doMock('../environmentCapabilities', () => mockCaps);

    const { dispatchBackgroundRemoval: dispatch } = await import('../providers/dispatch');
    // Should fail with "unavailable" not "memory limit" since WebGL is available
    const err = await dispatch(makeImageData(100, 100), { method: 'ai-quality' }).catch((e) => e);
    expect(err.message).not.toMatch(/exceeds the safe WASM memory limit/i);
  });

  it('allows ai-quality on Tauri environments', async () => {
    const mockCaps = {
      isWasmModelSafe: vi.fn().mockResolvedValue(false),
      getEnvironmentCapabilities: vi.fn().mockResolvedValue({
        crossOriginIsolated: false,
        isWebKitGTK: true,
        isTauri: true, // Tauri — can try native backend
        hasWorker: true,
        hasWebGL: false,
        hasWebGPU: false,
        sharedMemoryAvailable: false,
        wasmSafeModelBytes: 50_000_000,
        preferredOnnxProviders: ['wasm'],
        label: 'Test (Tauri)',
      }),
    };

    vi.doMock('../environmentCapabilities', () => mockCaps);

    const { dispatchBackgroundRemoval: dispatch } = await import('../providers/dispatch');
    // Should fail with "unavailable" not "memory limit" since Tauri provides native fallback
    const err = await dispatch(makeImageData(100, 100), { method: 'ai-quality' }).catch((e) => e);
    expect(err.message).not.toMatch(/exceeds the safe WASM memory limit/i);
  });
});
