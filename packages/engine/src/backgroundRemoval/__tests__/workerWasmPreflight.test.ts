// @vitest-environment jsdom
/**
 * Regression coverage for the WASM memory preflight gate in worker.ts.
 *
 * Real BiRefNet inference through onnxruntime-web's bare-WASM execution
 * provider has been observed to crash the process with `std::bad_alloc` in
 * GPU-less environments — a native allocation failure that can abort the
 * worker thread outright rather than reject a JS promise. These tests prove
 * the gate refuses the attempt *before* `InferenceSession.create` is ever
 * called, instead of relying on a try/catch around the allocation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

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

function mockCapabilities(preferredOnnxProviders: string[], wasmSafe: boolean) {
  vi.doMock('../environmentCapabilities', () => ({
    getBestOnnxProviders: vi.fn().mockResolvedValue(preferredOnnxProviders),
    isWasmModelSafe: vi.fn().mockResolvedValue(wasmSafe),
  }));
}

async function loadWorkerWithStubbedSelf() {
  const postMessage = vi.fn();
  vi.stubGlobal('self', { postMessage, onmessage: null } as unknown as typeof self);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ close: vi.fn() } as unknown as ImageBitmap),
  );
  await import('../worker');
  const handler = (self as unknown as { onmessage: (e: MessageEvent) => unknown }).onmessage;
  return { postMessage, handler };
}

describe('worker.ts WASM memory preflight', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreate.mockReset();
    vi.unstubAllGlobals();
  });

  it('refuses BiRefNet on bare WASM without calling InferenceSession.create', async () => {
    mockCapabilities(['wasm'], false);
    const { postMessage, handler } = await loadWorkerWithStubbedSelf();

    await handler({
      data: {
        type: 'infer',
        requestId: 'req-1',
        imageData: new ImageData(4, 4),
        modelPath: 'blob:model',
        modelId: 'birefnet-general',
        method: 'ai-quality',
      },
    } as unknown as MessageEvent);

    // Give the async onmessage handler a chance to run to completion.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        requestId: 'req-1',
        message: expect.stringMatching(/exceeds the safe WASM memory limit/i),
      }),
    );
  });

  it('allows u2netp on bare WASM (small model, always considered safe)', async () => {
    mockCapabilities(['wasm'], true);
    mockCreate.mockResolvedValue({
      inputNames: ['input.1'],
      outputNames: ['output.1'],
      run: vi.fn().mockResolvedValue({
        'output.1': {
          data: new Float32Array(320 * 320),
          dims: [1, 1, 320, 320],
          dispose: vi.fn(),
        },
      }),
    });
    const { postMessage, handler } = await loadWorkerWithStubbedSelf();

    await handler({
      data: {
        type: 'infer',
        requestId: 'req-2',
        imageData: new ImageData(4, 4),
        modelPath: 'blob:model',
        modelId: 'u2netp',
        method: 'ai-balanced',
      },
    } as unknown as MessageEvent);

    await new Promise((r) => setTimeout(r, 0));

    expect(mockCreate).toHaveBeenCalledWith('blob:model', { executionProviders: ['wasm'] });
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('keeps U²-Net on WASM when WebGPU is available but lacks MaxPool ceil_mode', async () => {
    mockCapabilities(['webgpu', 'wasm'], true);
    mockCreate.mockResolvedValue({
      inputNames: ['input.1'],
      outputNames: ['1959'],
      run: vi.fn().mockResolvedValue({
        '1959': {
          data: new Float32Array(320 * 320),
          dims: [1, 1, 320, 320],
          dispose: vi.fn(),
        },
      }),
    });
    const { postMessage, handler } = await loadWorkerWithStubbedSelf();

    await handler({
      data: {
        type: 'infer',
        requestId: 'req-u2-wasm',
        imageData: new ImageData(4, 4),
        modelPath: 'blob:model',
        modelId: 'u2netp',
        method: 'ai-balanced',
      },
    } as unknown as MessageEvent);

    await new Promise((r) => setTimeout(r, 0));

    expect(mockCreate).toHaveBeenCalledWith('blob:model', { executionProviders: ['wasm'] });
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('does not gate when an accelerated provider is available, even for BiRefNet', async () => {
    mockCapabilities(['webgpu', 'wasm'], false);
    mockCreate.mockResolvedValue({
      inputNames: ['input.1'],
      outputNames: ['output.1'],
      run: vi.fn().mockResolvedValue({
        'output.1': {
          data: new Float32Array(1024 * 1024),
          dims: [1, 1, 1024, 1024],
          dispose: vi.fn(),
        },
      }),
    });
    const { postMessage, handler } = await loadWorkerWithStubbedSelf();

    await handler({
      data: {
        type: 'infer',
        requestId: 'req-3',
        imageData: new ImageData(4, 4),
        modelPath: 'blob:model',
        modelId: 'birefnet-general',
        method: 'ai-quality',
      },
    } as unknown as MessageEvent);

    await new Promise((r) => setTimeout(r, 0));

    expect(mockCreate).toHaveBeenCalledWith('blob:model', {
      executionProviders: ['webgpu'],
    });
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
});
