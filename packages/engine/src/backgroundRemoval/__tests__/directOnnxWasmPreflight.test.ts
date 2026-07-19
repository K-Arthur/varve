// @vitest-environment jsdom
/**
 * Mirrors workerWasmPreflight.test.ts for the main-thread direct-ONNX
 * provider: BiRefNet must never reach `InferenceSession.create` on bare WASM
 * in an environment with no accelerated backend and no verified-safe margin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate, mockGetModelLoader } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGetModelLoader: vi.fn(),
}));

vi.mock('onnxruntime-web', () => ({
  env: {
    wasm: { wasmPaths: '', numThreads: 1 },
    versions: { common: 'test', web: 'test' },
  },
  InferenceSession: { create: mockCreate },
  Tensor: class MockTensor {
    type: string;
    data: Float32Array;
    dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
    dispose() {}
  },
}));

vi.mock('../modelLoader', () => ({
  getModelLoader: mockGetModelLoader,
}));

function stubCanvas2d(): void {
  const fakeCtx = {
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => new ImageData(8, 8)),
    createImageData: vi.fn((w: number, h: number) => new ImageData(w, h)),
  };
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => fakeCtx,
        toDataURL: () => 'data:image/png;base64,mask',
      } as unknown as HTMLCanvasElement;
    }
    return document.createElement.bind(document)(tag);
  });
}

describe('directOnnxProvider WASM memory preflight', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreate.mockReset();
    mockGetModelLoader.mockReset().mockReturnValue({
      syncFromStorage: vi.fn().mockResolvedValue(undefined),
      getModelPath: vi.fn().mockResolvedValue('blob:model'),
      isModelAvailable: vi.fn().mockResolvedValue(true),
    });
    stubCanvas2d();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses BiRefNet Lite on bare WASM without calling InferenceSession.create', async () => {
    vi.doMock('../environmentCapabilities', () => ({
      getBestOnnxProviders: vi.fn().mockResolvedValue(['wasm']),
      isWasmModelSafe: vi.fn().mockResolvedValue(false),
    }));

    const { directOnnxRemovalProvider } = await import('../providers/directOnnxProvider');
    const img = new ImageData(8, 8);

    await expect(directOnnxRemovalProvider.remove(img, { method: 'ai-quality' })).rejects.toThrow(
      /exceeds the safe WASM memory limit/i,
    );

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('proceeds to InferenceSession.create when an accelerated provider exists', async () => {
    vi.doMock('../environmentCapabilities', () => ({
      getBestOnnxProviders: vi.fn().mockResolvedValue(['webgl', 'wasm']),
      isWasmModelSafe: vi.fn().mockResolvedValue(false),
    }));
    mockCreate.mockResolvedValue({
      inputNames: ['input'],
      outputNames: ['output'],
      release: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({
        output: { data: new Float32Array(1024 * 1024), dims: [1, 1, 1024, 1024] },
      }),
    });

    const { directOnnxRemovalProvider } = await import('../providers/directOnnxProvider');
    const img = new ImageData(8, 8);
    const result = await directOnnxRemovalProvider.remove(img, { method: 'ai-quality' });

    expect(mockCreate).toHaveBeenCalledWith('blob:model', {
      executionProviders: ['webgl'],
    });
    expect(result.executionProvider).toBe('webgl');
  });
});
