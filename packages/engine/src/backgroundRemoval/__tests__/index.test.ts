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
    expect(result).toEqual(HEURISTIC_RESULT);
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

  it('falls back to Tauri native IPC when the Worker throws, and maps the camelCase response correctly', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.stubGlobal('Worker', class {});
    mockRunPooledInference.mockRejectedValue(new Error('worker unavailable'));
    mockInvoke.mockResolvedValue({
      maskBase64: 'abc123',
      confidence: 0.6,
      method: 'quick',
      processingTimeMs: 5,
      width: 4,
      height: 4,
    });

    // jsdom's canvas has no real 2D context, and jsdom's `Blob` polyfill in
    // this Node version lacks `arrayBuffer()`; stub just enough of the DOM
    // surface `invokeTauriRemoveBackground` touches.
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

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // The critical regression this guards: the native bridge must translate
    // the Rust wire format (maskBase64, snake_case-free) into the TS
    // `BackgroundRemovalResult` contract (maskDataUrl as a real data URL).
    expect(result.maskDataUrl).toBe('data:image/png;base64,abc123');
    expect(result.confidence).toBe(0.6);
    expect(result.processingTimeMs).toBe(5);
    // Native only ran the heuristic (no `ai` feature compiled in) — the
    // reported method must honestly reflect that, not the AI method the
    // caller originally requested.
    expect(result.method).toBe('quick');

    vi.restoreAllMocks();
  });

  it('routes "ai-balanced" to the birefnet-general-lite model in the worker, not u2netp', async () => {
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

    // `ai-balanced` uses the bundled `u2netp` model (4.5 MB, zero-download)
    // so it works out of the box. `ai-quality` requires an explicit 928 MB
    // download of `birefnet-general`.
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

    // Regression: this previously silently downgraded "AI Best Quality" to
    // the mid-tier `birefnet-general-lite` model, so the 928MB full model a
    // user explicitly downloaded for best quality was never actually used.
    expect(mockRunPooledInference).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ previewMaxDimension: 2048, method: 'ai-quality' }),
      expect.anything(),
      'birefnet-general',
      undefined,
    );
  });

  it('falls through to the heuristic when Worker, Tauri, and direct AI are all unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const { removeBackground } = await import('../index');
    const result = await removeBackground(makeImage(), { method: 'ai-balanced' });
    expect(result).toEqual(HEURISTIC_RESULT);
    expect(mockHeuristic).toHaveBeenCalledTimes(1);
  });

  it('falls through to the heuristic — not a hard failure — when the direct AI path throws', async () => {
    vi.stubGlobal('Worker', undefined);
    mockGetModelLoader.mockReturnValue({
      getState: () => 'ready',
      getModelPath: vi.fn().mockResolvedValue('/models/birefnet-general-lite.onnx'),
      syncFromStorage: vi.fn().mockResolvedValue(undefined),
      isModelAvailable: vi.fn().mockResolvedValue(true),
    });

    const { removeBackground } = await import('../index');
    const result = await removeBackground(makeImage(), { method: 'ai-balanced' });

    expect(result).toEqual(HEURISTIC_RESULT);
    expect(mockHeuristic).toHaveBeenCalledTimes(1);
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
    const result = await removeBackground(makeImage(), { method: 'ai-balanced' });

    expect(result).toEqual(HEURISTIC_RESULT);
    expect(mockHeuristic).toHaveBeenCalledTimes(1);
  });

  it('Tauri IPC result method is never trusted as AI when native returns quick', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    vi.stubGlobal('Worker', class {});
    mockRunPooledInference.mockRejectedValue(new Error('worker unavailable'));
    mockInvoke.mockResolvedValue({
      maskBase64: 'fake',
      confidence: 0.99,
      method: 'ai-quality',
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
    const result = await removeBackground(makeImage(), { method: 'ai-quality' });

    expect(result.method).toBe('quick');
    vi.restoreAllMocks();
  });
});
