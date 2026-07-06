// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetModelLoader, mockHeuristic, mockCreate } = vi.hoisted(() => ({
  mockGetModelLoader: vi.fn(),
  mockHeuristic: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('../heuristic', () => ({
  removeBackgroundHeuristic: mockHeuristic,
}));
vi.mock('../workerPool', () => ({
  runPooledInference: vi.fn(),
  cancelAllWorkerJobs: vi.fn(),
  terminateWorkerPool: vi.fn(),
}));
vi.mock('../modelLoader', () => ({
  getModelLoader: mockGetModelLoader,
  resetModelLoader: vi.fn(),
}));
vi.mock('onnxruntime-web', () => ({
  InferenceSession: {
    create: mockCreate,
  },
  Tensor: class MockTensor {
    type: string;
    data: Float32Array;
    dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  },
}));

function makeImage(w = 8, h = 8): ImageData {
  return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
}

function stubCanvas2d(): void {
  const fakeCtx = {
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => makeImage(8, 8)),
    createImageData: vi.fn((w: number, h: number) => makeImage(w, h)),
  };
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => fakeCtx,
        toDataURL: () => 'data:image/png;base64,direct',
      } as unknown as HTMLCanvasElement;
    }
    return document.createElement.bind(document)(tag);
  });
}

describe('direct AI telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal('Worker', undefined);
    mockHeuristic.mockReset();
    mockGetModelLoader.mockReset().mockReturnValue({
      getState: () => 'ready',
      getModelPath: vi.fn().mockResolvedValue('blob:model'),
      syncFromStorage: vi.fn().mockResolvedValue(undefined),
      isModelAvailable: vi.fn().mockResolvedValue(true),
    });
    mockCreate.mockReset();
    stubCanvas2d();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('falls back to wasm execution provider when webgl session creation fails', async () => {
    const outputData = new Float32Array(1024 * 1024);
    for (let i = 0; i < outputData.length; i++) outputData[i] = i % 2 === 0 ? 0.95 : 0.05;

    mockCreate.mockRejectedValueOnce(new Error('WebGL unavailable')).mockResolvedValueOnce({
      inputNames: ['input'],
      outputNames: ['output'],
      run: vi.fn().mockResolvedValue({
        output: { data: outputData, dims: [1, 1, 1024, 1024] },
      }),
    });

    const { removeBackground } = await import('../index');
    const result = await removeBackground(makeImage(), { method: 'ai-balanced' });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0]?.[1]).toEqual({ executionProviders: ['webgl', 'wasm'] });
    expect(mockCreate.mock.calls[1]?.[1]).toEqual({ executionProviders: ['wasm'] });
    expect(result.executionProvider).toBe('wasm');
    expect(result.processingTimeMs).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
