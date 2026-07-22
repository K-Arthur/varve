/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * The native provider leans on `invoke`/`listen` from `@tauri-apps/api`, which
 * are only present inside a Tauri webview. These tests cover the behavior that
 * doesn't need a live runtime: Tauri detection, option assembly, and the
 * early-exit cancellation path. The progress-listener wiring is exercised in
 * Tauri E2E where a real invoke exists.
 */

function setTauri(present: boolean) {
  if (present) {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = true;
  } else {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  }
}

describe('nativeUpscaleProvider', () => {
  it('reports not-available outside the Tauri webview', async () => {
    setTauri(false);
    const { nativeUpscaleProvider } = await import('./nativeProvider');
    await expect(nativeUpscaleProvider.isAvailable({ method: 'ai' })).toBe(false);
  });

  it('reports available inside the Tauri webview', async () => {
    setTauri(true);
    vi.resetModules();
    const { nativeUpscaleProvider } = await import('./nativeProvider');
    await expect(nativeUpscaleProvider.isAvailable({ method: 'ai' })).toBe(true);
  });

  it('uses the default Real-ESRGAN model when no modelId is supplied', async () => {
    setTauri(true);
    vi.resetModules();

    // Stub the PNG encode so the test doesn't depend on a canvas impl.
    vi.doMock('./pngDecode', () => ({
      encodeImageDataToPngBytes: async () => new Uint8Array([1, 2, 3]),
      decodeImageBytesToImageData: (_b: Uint8Array) => new ImageData(2, 2),
    }));

    const invokeMock = vi.fn(async (cmd: string, _args?: unknown, _options?: unknown) => {
      if (cmd === 'begin_upscale_job') return null;
      if (cmd === 'upscale_image_binary') return new Uint8Array([1, 2, 3]).buffer;
      return null;
    });
    const listenMock = vi.fn(async () => () => {});

    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: listenMock }));

    const { nativeUpscaleProvider } = await import('./nativeProvider');
    const source = new ImageData(2, 2);
    await nativeUpscaleProvider.upscale(source, { method: 'ai' }, new AbortController().signal);

    const invokeCalls = invokeMock.mock.calls.map((c) => c[0]);
    expect(invokeCalls).toContain('begin_upscale_job');
    expect(invokeCalls).toContain('upscale_image_binary');

    const upscaleCall = invokeMock.mock.calls.find((c) => c[0] === 'upscale_image_binary');
    const body = upscaleCall?.[1];
    const invokeOptions = upscaleCall?.[2] as { headers?: Record<string, string> } | undefined;
    const opts = JSON.parse(invokeOptions?.headers?.['x-strata-upscale-options'] ?? '{}') as Record<
      string,
      unknown
    >;
    expect(opts?.modelId).toBe('upscale-realesr-general');
    expect(opts?.maxPixels).toBe(64 * 1024 * 1024);
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(body as ArrayBuffer))).toEqual([1, 2, 3]);
  });

  it('keeps compatibility with legacy JSON-array responses byte-for-byte', async () => {
    setTauri(true);
    vi.resetModules();
    const decoded: number[][] = [];
    vi.doMock('./pngDecode', () => ({
      encodeImageDataToPngBytes: async () => new Uint8Array([4, 5, 6]),
      decodeImageBytesToImageData: (bytes: Uint8Array) => {
        decoded.push(Array.from(bytes));
        return new ImageData(1, 1);
      },
    }));
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async (cmd: string) =>
        cmd === 'upscale_image_binary' ? [0, 127, 128, 255] : null,
      ),
    }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { nativeUpscaleProvider } = await import('./nativeProvider');
    await nativeUpscaleProvider.upscale(new ImageData(1, 1), {}, new AbortController().signal);

    expect(decoded).toEqual([[0, 127, 128, 255]]);
  });

  it('rejects cancellation signaled before invoke', async () => {
    setTauri(true);
    vi.resetModules();
    const controller = new AbortController();
    controller.abort();

    const invokeMock = vi.fn(async () => []);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { nativeUpscaleProvider } = await import('./nativeProvider');
    await expect(
      nativeUpscaleProvider.upscale(new ImageData(2, 2), { method: 'ai' }, controller.signal),
    ).rejects.toThrow('cancelled');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
