// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetModelLoader, mockHeuristic, mockCreate, mockDownscale } = vi.hoisted(() => ({
  mockGetModelLoader: vi.fn(),
  mockHeuristic: vi.fn(),
  mockCreate: vi.fn(),
  mockDownscale: vi.fn((img: ImageData) => img),
}));

vi.mock('../heuristic', () => ({
  maskToDataUrl: vi.fn(() => 'data:image/png;base64,direct'),
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
vi.mock('../previewDownscale', () => ({
  downscaleImageData: mockDownscale,
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

function makeImage(w = 4096, h = 4096): ImageData {
  return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
}

function stubCanvas2d(): void {
  const fakeCtx = {
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn((w: number, h: number) => makeImage(w, h)),
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

describe('direct AI previewMaxDimension parity', () => {
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
    mockDownscale.mockReset().mockImplementation((_img: ImageData) => {
      return new ImageData(new Uint8ClampedArray(2048 * 2048 * 4), 2048, 2048);
    });
    mockCreate.mockReset();
    stubCanvas2d();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downscales source before model input resize on direct ONNX path', async () => {
    const outputData = new Float32Array(1024 * 1024);
    for (let i = 0; i < outputData.length; i++) outputData[i] = 0.9;

    mockCreate.mockResolvedValue({
      inputNames: ['input'],
      outputNames: ['output'],
      run: vi.fn().mockResolvedValue({
        output: { data: outputData, dims: [1, 1, 1024, 1024] },
      }),
    });

    const { removeBackground } = await import('../index');
    await removeBackground(makeImage(4096, 4096), {
      method: 'ai-balanced',
      previewMaxDimension: 2048,
    });

    expect(mockDownscale).toHaveBeenCalledWith(expect.objectContaining({ width: 4096 }), 2048);
  });
});
