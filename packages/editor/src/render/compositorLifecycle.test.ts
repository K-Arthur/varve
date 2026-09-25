// @vitest-environment jsdom
import type { CompositorBackend, CompositorDiagnostics } from '@varve/compositor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCompositorDiagnosticsSnapshot,
  setCompositorDiagnostics,
} from './compositorDiagnosticsStore';
import { startCanvasCompositor } from './compositorLifecycle';

const createBackend = vi.hoisted(() => vi.fn());
vi.mock('@varve/compositor', () => ({ createCompositorBackend: createBackend }));

function diagnostics(): CompositorDiagnostics {
  return {
    backendId: 'webgpu',
    gpuActive: true,
    vertexPoolEntries: 0,
    bundleCacheEntries: 0,
    lastFrameVertexBytes: 0,
    adapterIsFallback: false,
  };
}

afterEach(() => {
  createBackend.mockReset();
  setCompositorDiagnostics(null);
});

describe('canvas compositor lifecycle', () => {
  it('destroys a late backend instead of attaching it to a disposed canvas', async () => {
    let resolve: (value: {
      backend: CompositorBackend;
      capabilities: { webgpu: boolean };
    }) => void = () => {};
    createBackend.mockReturnValue(new Promise((r) => (resolve = r)));
    const backend = {
      id: 'webgpu',
      getDiagnostics: diagnostics,
      destroy: vi.fn(),
    } as unknown as CompositorBackend;
    const handlers = {
      onReady: vi.fn(),
      onDispose: vi.fn(),
      onRedraw: vi.fn(),
      onFallback: vi.fn(),
    };
    const dispose = startCanvasCompositor(document.createElement('canvas'), true, handlers);
    dispose();
    resolve({ backend, capabilities: { webgpu: true } });
    await Promise.resolve();
    expect(backend.destroy).toHaveBeenCalledOnce();
    expect(handlers.onReady).not.toHaveBeenCalled();
    expect(handlers.onRedraw).not.toHaveBeenCalled();
    expect(getCompositorDiagnosticsSnapshot()).toBeNull();
  });

  it('publishes loss immediately and requests an authoritative redraw', async () => {
    let current = diagnostics();
    const backend = {
      id: 'webgpu',
      getDiagnostics: () => current,
      destroy: vi.fn(),
      onDeviceLost: undefined as (() => Promise<void>) | undefined,
    } as unknown as CompositorBackend;
    createBackend.mockResolvedValue({ backend, capabilities: { webgpu: true } });
    const handlers = {
      onReady: vi.fn(),
      onDispose: vi.fn(),
      onRedraw: vi.fn(),
      onFallback: vi.fn(),
    };
    const dispose = startCanvasCompositor(document.createElement('canvas'), true, handlers);
    await vi.waitFor(() => expect(handlers.onReady).toHaveBeenCalledWith(backend));
    expect(handlers.onRedraw).toHaveBeenCalledWith('compositor-init');
    current = { ...current, gpuActive: false, deviceLost: true };
    await backend.onDeviceLost?.();
    expect(getCompositorDiagnosticsSnapshot()?.deviceLost).toBe(true);
    expect(handlers.onRedraw).toHaveBeenCalledWith('gpu-device-lost');
    dispose();
    expect(backend.destroy).toHaveBeenCalledOnce();
  });

  it('reports a failed canvas initialization without claiming a working fallback', async () => {
    createBackend.mockRejectedValue(new Error('Canvas2D context unavailable'));
    const handlers = {
      onReady: vi.fn(),
      onDispose: vi.fn(),
      onRedraw: vi.fn(),
      onFallback: vi.fn(),
    };
    const dispose = startCanvasCompositor(document.createElement('canvas'), true, handlers);
    await vi.waitFor(() =>
      expect(getCompositorDiagnosticsSnapshot()?.fatalError).toBe(
        'Canvas compositor initialization failed',
      ),
    );
    expect(handlers.onReady).not.toHaveBeenCalled();
    expect(handlers.onFallback).not.toHaveBeenCalled();
    dispose();
  });
});
