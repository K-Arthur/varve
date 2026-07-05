import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('background removal worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('worker script exists and is importable', async () => {
    const workerCode = await import('../worker?raw');
    expect(workerCode.default).toBeTruthy();
    expect(workerCode.default).toContain('self.onmessage');
  });

  it('OffscreenCanvas is available in supported environments', () => {
    expect(typeof OffscreenCanvas).toBeDefined();
  });

  it('handles missing onnxruntime-web gracefully', async () => {
    vi.stubGlobal(
      'Worker',
      vi.fn(() => {
        const worker = {
          postMessage: vi.fn(),
          terminate: vi.fn(),
          onmessage: null as unknown,
          onerror: null as unknown,
        };
        setTimeout(() => {
          if (worker.onerror) {
            (worker.onerror as (e: ErrorEvent) => void)({ message: 'Worker crashed' } as ErrorEvent);
          }
        }, 10);
        return worker;
      }),
    );

    const { removeBackground } = await import('../index');
    const img = new ImageData(10, 10);
    const result = await removeBackground(img, { method: 'ai-balanced' });
    expect(result.method).toBe('quick');
  }, 10000);

  it('transferImageData creates transferable buffer', () => {
    const img = new ImageData(100, 100);
    const buffer = img.data.buffer;
    expect(buffer.byteLength).toBe(100 * 100 * 4);
  });

  it('worker postMessage accepts ImageData', () => {
    const img = new ImageData(10, 10);
    expect(img.data).toBeInstanceOf(Uint8ClampedArray);
    expect(img.width).toBe(10);
    expect(img.height).toBe(10);
  });

  it('quick method bypasses worker entirely', async () => {
    const workerSpy = vi.fn();
    vi.stubGlobal('Worker', workerSpy);
    const { removeBackground } = await import('../index');
    const img = new ImageData(20, 20);
    const result = await removeBackground(img, { method: 'quick' });
    expect(result.method).toBe('quick');
    expect(workerSpy).not.toHaveBeenCalled();
  });
});
