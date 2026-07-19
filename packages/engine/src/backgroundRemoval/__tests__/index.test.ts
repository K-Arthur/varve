// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHeuristic, mockRunPooledInference, mockGetModelLoader, mockInvoke } = vi.hoisted(
  () => ({
    mockHeuristic: vi.fn(),
    mockRunPooledInference: vi.fn(),
    mockGetModelLoader: vi.fn(),
    mockInvoke: vi.fn(),
  }),
);

vi.mock('../previewDownscale', () => ({
  downscaleImageData: (img: ImageData, maxDim: number) => {
    if (img.width <= maxDim && img.height <= maxDim) return img;
    const scale = maxDim / Math.max(img.width, img.height);
    return new ImageData(
      new Uint8ClampedArray(Math.ceil(img.width * scale) * Math.ceil(img.height * scale) * 4),
      Math.ceil(img.width * scale),
      Math.ceil(img.height * scale),
    );
  },
}));

vi.mock('../heuristic', () => ({
  removeBackgroundHeuristic: mockHeuristic,
}));
vi.mock('../workerPool', () => ({
  runPooledInference: mockRunPooledInference,
  cancelAllWorkerJobs: vi.fn(),
  terminateWorkerPool: vi.fn(),
}));
vi.mock('../modelLoader', () => ({
  getModelLoader: mockGetModelLoader,
  resetModelLoader: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

// Environment capabilities: mock to allow ai-quality tests to reach providers
const mockGetEnvironmentCaps = vi.hoisted(() => vi.fn());
const mockIsWasmModelSafe = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockGetBestOnnxProviders = vi.hoisted(() => vi.fn().mockResolvedValue(['wasm']));
vi.mock('../environmentCapabilities', () => ({
  getEnvironmentCapabilities: mockGetEnvironmentCaps,
  getEnvironmentCapabilitiesSync: vi.fn().mockReturnValue({
    crossOriginIsolated: false,
    isWebKitGTK: false,
    isTauri: false,
    hasWorker: true,
    hasWebGL: false,
    hasWebGPU: false,
    sharedMemoryAvailable: false,
    wasmSafeModelBytes: 400_000_000,
    preferredOnnxProviders: ['wasm'],
    label: 'Test',
  }),
  isWasmModelSafe: mockIsWasmModelSafe,
  getBestOnnxProviders: mockGetBestOnnxProviders,
  resetEnvironmentCapabilities: vi.fn(),
}));

function makeImage(w = 4, h = 4): ImageData {
  return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
}

const HEURISTIC_RESULT = {
  maskDataUrl: 'data:image/png;base64,heuristic',
  confidence: 0.5,
  method: 'quick' as const,
  processingTimeMs: 1,
  width: 4,
  height: 4,
};

describe('removeBackground dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    mockHeuristic.mockReset().mockResolvedValue(HEURISTIC_RESULT);
    mockRunPooledInference.mockReset().mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,worker',
      confidence: 0.9,
      method: 'ai-balanced',
      processingTimeMs: 10,
      width: 4,
      height: 4,
    });
    mockInvoke.mockReset();
    mockGetModelLoader.mockReset().mockReturnValue({
      getState: () => 'unavailable',
      getModelPath: vi.fn().mockResolvedValue('/models/test.onnx'),
      syncFromStorage: vi.fn().mockResolvedValue(undefined),
      isModelAvailable: vi.fn().mockResolvedValue(false),
    });
    mockGetEnvironmentCaps.mockReset().mockResolvedValue({
      crossOriginIsolated: false,
      isWebKitGTK: false,
      isTauri: false,
      hasWorker: true,
      hasWebGL: false,
      hasWebGPU: false,
      sharedMemoryAvailable: false,
      wasmSafeModelBytes: 400_000_000,
      preferredOnnxProviders: ['wasm'],
      label: 'Test',
    });
    mockIsWasmModelSafe.mockReset().mockResolvedValue(true);
    mockGetBestOnnxProviders.mockReset().mockResolvedValue(['wasm']);
    vi.unstubAllGlobals();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('rejects 0-byte images before dispatching anywhere', async () => {
    const { removeBackground } = await import('../index');
    const zeroImage = { width: 0, height: 4, data: new Uint8ClampedArray(0) } as ImageData;
    await expect(removeBackground(zeroImage, { method: 'quick' })).rejects.toThrow(/0-byte image/);
    expect(mockHeuristic).not.toHaveBeenCalled();
  });

  it('method: "quick" always uses the heuristic, never touches AI dispatch', async () => {
    vi.stubGlobal('Worker', class {});
    const { removeBackground } = await import('../index');
    const result = await removeBackground(makeImage(), { method: 'quick' });
    expect(result).toMatchObject(HEURISTIC_RESULT);
    expect(result.sourceWidth).toBe(4);
    expect(result.sourceHeight).toBe(4);
    expect(result.sourceResolutionInfo).toBeDefined();
    expect(mockHeuristic).toHaveBeenCalledTimes(1);
    expect(mockRunPooledInference).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('AI methods try the Web Worker first, even inside the Tauri webview', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.stubGlobal('Worker', class {});
    mockRunPooledInference.mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,worker',
      confidence: 0.9,
      method: 'ai-balanced',
      processingTimeMs: 10,
      width: 4,
      height: 4,
    });

    const { removeBackground } = await import('../index');
    const result = await removeBackground(makeImage(), { method: 'ai-balanced' });

    expect(mockRunPooledInference).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.method).toBe('ai-balanced');
    expect(result.maskDataUrl).toContain('worker');
  });

  it('accepts a matching Tauri AI result when the Worker throws', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.stubGlobal('Worker', class {});
    mockRunPooledInference.mockRejectedValue(new Error('worker unavailable'));
    // native_ai_status=false keeps this on the default worker-first order
    // (ADR-0005) so this test exercises the traditional worker→tauri
    // fallback path, not the native-preferred ai-quality ordering (see
    // 'prefers native Tauri for ai-quality when native ai is ready' below).
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'native_ai_status'
        ? Promise.resolve(false)
        : Promise.resolve({
            maskBase64: 'abc123',
            confidence: 0.6,
            method: 'ai-quality',
            processingTimeMs: 5,
            width: 4,
            height: 4,
          }),
    );

    const fakeCtx = { putImageData: vi.fn(), getImageData: vi.fn() };
    const fakeBlob = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as Blob;
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => fakeCtx,
      toBlob: (cb: (b: Blob) => void) => cb(fakeBlob),
    } as unknown as HTMLCanvasElement);

    const { removeBackground } = await import('../index');
    const result = await removeBackground(makeImage(), { method: 'ai-quality' });

    // One call to check native_ai_status (ai-quality always checks this on
    // Tauri, see getProviderOrder in dispatch.ts) plus one to remove_background.
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenCalledWith('native_ai_status');
    expect(mockInvoke).toHaveBeenCalledWith('remove_background', expect.anything());
    expect(result.maskDataUrl).toBe('data:image/png;base64,abc123');
    expect(result.confidence).toBe(0.6);
    expect(result.processingTimeMs).toBe(5);
    expect(result.method).toBe('ai-quality');

    vi.restoreAllMocks();
  });

  it('prefers native Tauri over the Worker for ai-quality when native ai is ready', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.stubGlobal('Worker', class {});
    // If the Worker were tried, this test would still pass by falling
    // through — so also assert the Worker was never even attempted.
    mockRunPooledInference.mockRejectedValue(new Error('worker should not be tried'));
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'native_ai_status'
        ? Promise.resolve(true)
        : Promise.resolve({
            maskBase64: 'native-result',
            confidence: 0.98,
            method: 'ai-quality',
            processingTimeMs: 15000,
            width: 4,
            height: 4,
          }),
    );

    const fakeCtx = { putImageData: vi.fn(), getImageData: vi.fn() };
    const fakeBlob = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as Blob;
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => fakeCtx,
      toBlob: (cb: (b: Blob) => void) => cb(fakeBlob),
    } as unknown as HTMLCanvasElement);

    const { removeBackground } = await import('../index');
    const result = await removeBackground(makeImage(), { method: 'ai-quality' });

    expect(mockRunPooledInference).not.toHaveBeenCalled();
    expect(result.maskDataUrl).toBe('data:image/png;base64,native-result');
    expect(result.confidence).toBe(0.98);

    vi.restoreAllMocks();
  });

  it('routes "ai-balanced" to the bundled u2netp model in the worker', async () => {
    vi.stubGlobal('Worker', class {});
    mockRunPooledInference.mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,worker',
      confidence: 0.9,
      method: 'ai-balanced',
      processingTimeMs: 10,
      width: 4,
      height: 4,
    });

    const { removeBackground } = await import('../index');
    await removeBackground(makeImage(), { method: 'ai-balanced' });

    expect(mockRunPooledInference).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ previewMaxDimension: 2048, method: 'ai-balanced' }),
      expect.anything(),
      'u2netp',
      undefined,
    );
  });

  it('passes default previewMaxDimension 2048 to worker for AI quality tier', async () => {
    vi.stubGlobal('Worker', class {});
    mockRunPooledInference.mockResolvedValue({
      maskDataUrl: 'data:image/png;base64,worker',
      confidence: 0.9,
      method: 'ai-quality',
      processingTimeMs: 10,
      width: 4,
      height: 4,
    });

    const { removeBackground } = await import('../index');
    await removeBackground(makeImage(), { method: 'ai-quality' });

    expect(mockRunPooledInference).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ previewMaxDimension: 2048, method: 'ai-quality' }),
      expect.anything(),
      'birefnet-general-lite',
      undefined,
    );
  });

  it('does not silently substitute a heuristic when AI providers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const { removeBackground } = await import('../index');
    await expect(removeBackground(makeImage(), { method: 'ai-balanced' })).rejects.toThrow(
      /AI background removal is unavailable/i,
    );
    expect(mockHeuristic).not.toHaveBeenCalled();
  });

  it('reports failure when the direct AI path throws', async () => {
    vi.stubGlobal('Worker', undefined);
    mockGetModelLoader.mockReturnValue({
      getState: () => 'ready',
      getModelPath: vi.fn().mockResolvedValue('/models/birefnet-general-lite.onnx'),
      syncFromStorage: vi.fn().mockResolvedValue(undefined),
      isModelAvailable: vi.fn().mockResolvedValue(true),
    });

    const { removeBackground } = await import('../index');
    await expect(removeBackground(makeImage(), { method: 'ai-balanced' })).rejects.toThrow(
      /AI background removal/i,
    );
    expect(mockHeuristic).not.toHaveBeenCalled();
  });

  it('downscales oversized images at engine entry before dispatch (quick)', async () => {
    vi.stubGlobal('Worker', class {});
    const { removeBackground } = await import('../index');
    const bigImage = new ImageData(new Uint8ClampedArray(4096 * 4096 * 4), 4096, 4096);
    await removeBackground(bigImage, { method: 'quick' });
    expect(mockHeuristic).toHaveBeenCalledTimes(1);
    const arg = mockHeuristic.mock.calls[0]![0] as ImageData;
    expect(arg.width).toBeLessThanOrEqual(2048);
    expect(arg.height).toBeLessThanOrEqual(2048);
  });

  it('downscales oversized images at engine entry before dispatch (ai-balanced)', async () => {
    vi.stubGlobal('Worker', class {});
    const { removeBackground } = await import('../index');
    const bigImage = new ImageData(new Uint8ClampedArray(4096 * 4096 * 4), 4096, 4096);
    await removeBackground(bigImage, { method: 'ai-balanced' });
    expect(mockRunPooledInference).toHaveBeenCalledTimes(1);
    const imageArg = mockRunPooledInference.mock.calls[0]![0] as ImageData;
    expect(imageArg.width).toBeLessThanOrEqual(2048);
    expect(imageArg.height).toBeLessThanOrEqual(2048);
  });

  it('does not attempt direct AI when the specific model is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    mockGetModelLoader.mockReturnValue({
      getState: () => 'ready',
      getModelPath: vi.fn().mockResolvedValue('/models/birefnet-general.onnx'),
      syncFromStorage: vi.fn().mockResolvedValue(undefined),
      isModelAvailable: vi.fn().mockImplementation(async (id: string) => id === 'birefnet-general'),
    });

    const { removeBackground } = await import('../index');
    await expect(removeBackground(makeImage(), { method: 'ai-balanced' })).rejects.toThrow(
      /AI background removal is unavailable/i,
    );
    expect(mockHeuristic).not.toHaveBeenCalled();
  });

  it('rejects a Tauri heuristic result for an AI request', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.stubGlobal('Worker', class {});
    mockRunPooledInference.mockRejectedValue(new Error('worker unavailable'));
    mockInvoke.mockResolvedValue({
      maskBase64: 'fake',
      confidence: 0.99,
      method: 'quick',
      processingTimeMs: 5,
      width: 4,
      height: 4,
    });

    const fakeCtx = { putImageData: vi.fn(), getImageData: vi.fn() };
    const fakeBlob = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as Blob;
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => fakeCtx,
      toBlob: (cb: (b: Blob) => void) => cb(fakeBlob),
    } as unknown as HTMLCanvasElement);

    const { removeBackground } = await import('../index');
    await expect(removeBackground(makeImage(), { method: 'ai-quality' })).rejects.toThrow(
      /AI background removal failed/i,
    );
    vi.restoreAllMocks();
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    const { removeBackground } = await import('../index');
    const controller = new AbortController();
    controller.abort();
    await expect(
      removeBackground(makeImage(), { method: 'ai-balanced' }, controller.signal),
    ).rejects.toThrow('cancelled');
  });

  it('rejects when the caller signal is aborted mid-dispatch', async () => {
    vi.stubGlobal('Worker', class {});
    mockRunPooledInference.mockImplementation(() => new Promise(() => {}));

    const { removeBackground } = await import('../index');
    const controller = new AbortController();
    const promise = removeBackground(makeImage(), { method: 'ai-balanced' }, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('cancelled');
  });

  it('times out a hung provider without claiming heuristic output is AI', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('Worker', undefined);
    mockGetModelLoader.mockReturnValue({
      getState: () => 'ready',
      getModelPath: vi.fn().mockImplementation(() => new Promise(() => {})),
      syncFromStorage: vi.fn().mockImplementation(() => new Promise(() => {})),
      isModelAvailable: vi.fn().mockImplementation(() => new Promise(() => {})),
    });

    const { removeBackground } = await import('../index');
    const promise = removeBackground(makeImage(), { method: 'ai-balanced' });
    const expectation = expect(promise).rejects.toThrow(/AI background removal/i);
    await vi.advanceTimersByTimeAsync(150_000);
    await expectation;
    expect(mockHeuristic).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('AI_PROVIDER_CHAIN strategy', () => {
  it('exports providers in order: worker → tauri → direct-onnx → cloud → heuristic', async () => {
    const { AI_PROVIDER_CHAIN } = await import('../index');
    expect(AI_PROVIDER_CHAIN.map((p) => p.id)).toEqual([
      'worker-onnx',
      'tauri-native',
      'direct-onnx',
      'cloud',
    ]);
  });
});
