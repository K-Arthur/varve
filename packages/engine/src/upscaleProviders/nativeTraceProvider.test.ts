/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * The native trace provider leans on `invoke`/`listen` from `@tauri-apps/api`,
 * which are only present inside a Tauri webview. These tests cover the
 * behavior that doesn't need a live runtime: Tauri detection, camelCase wire
 * option assembly, binary request body, cancellation, and result mapping.
 */

function setTauri(present: boolean) {
  if (present) {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = true;
  } else {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  }
}

function nativeResult(paths: unknown[], omittedHoles?: number) {
  return { paths, ...(omittedHoles !== undefined ? { omittedHoles } : {}) };
}

describe('nativeTraceProvider', () => {
  it('reports not-available outside the Tauri webview', async () => {
    setTauri(false);
    const { nativeTraceProvider } = await import('./nativeTraceProvider');
    await expect(nativeTraceProvider.isAvailable({})).toBe(false);
  });

  it('reports available inside the Tauri webview for every mode', async () => {
    setTauri(true);
    vi.resetModules();
    const { nativeTraceProvider } = await import('./nativeTraceProvider');
    await expect(nativeTraceProvider.isAvailable({ mode: 'pixel-art' })).toBe(true);
    await expect(
      nativeTraceProvider.isAvailable({ mode: 'monochrome', traceMode: 'centerline' }),
    ).toBe(true);
  });

  it('sends camelCase options with full passthrough and a raw binary body', async () => {
    setTauri(true);
    vi.resetModules();
    vi.doMock('./pngDecode', () => ({
      encodeImageDataToPngBytes: async () => new Uint8Array([9, 8, 7]),
      decodeImageBytesToImageData: (_b: Uint8Array) => new ImageData(2, 2),
    }));
    const invokeMock = vi.fn(async (cmd: string, _args?: unknown, _options?: unknown) => {
      if (cmd === 'begin_trace_job') return null;
      if (cmd === 'trace_image_binary') return nativeResult([]);
      return null;
    });
    const listenMock = vi.fn(async () => () => {});
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: listenMock }));

    const { nativeTraceProvider } = await import('./nativeTraceProvider');
    const source = new ImageData(2, 2);
    await nativeTraceProvider.trace(
      source,
      {
        mode: 'color',
        maxColors: 12,
        minArea: 6,
        threshold: 140,
        cornerAngle: 160,
        maxError: 0.5,
        simplifyTolerance: 1.25,
        maxPaths: 500,
        alphaThreshold: 4,
        compoundHoles: true,
      },
      new AbortController().signal,
    );

    const invokeCalls = invokeMock.mock.calls.map((c) => c[0]);
    expect(invokeCalls).toContain('begin_trace_job');
    expect(invokeCalls).toContain('trace_image_binary');

    const traceCall = invokeMock.mock.calls.find((c) => c[0] === 'trace_image_binary');
    const body = traceCall?.[1];
    const invokeOptions = traceCall?.[2] as { headers?: Record<string, string> } | undefined;
    const opts = JSON.parse(invokeOptions?.headers?.['x-varve-trace-options'] ?? '{}') as Record<
      string,
      unknown
    >;
    expect(opts.threshold).toBe(140);
    expect(opts.minPixels).toBe(6);
    expect(opts.maxColors).toBe(12);
    expect(opts.cornerAngle).toBe(160);
    expect(opts.maxError).toBe(0.5);
    expect(opts.simplifyTolerance).toBe(1.25);
    expect(opts.maxPaths).toBe(500);
    expect(opts.alphaThreshold).toBe(4);
    expect(opts.compoundHoles).toBe(true);
    expect(opts.traceMode).toBe('silhouette');
    // Every option key is camelCase — snake_case keys would be silently
    // ignored by the Rust `rename_all = "camelCase"` contract.
    for (const key of Object.keys(opts)) {
      expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      expect(key).not.toContain('_');
    }
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(body as ArrayBuffer))).toEqual([9, 8, 7]);
  });

  it('maps holes, omittedHoles, and centerline stroke width', async () => {
    setTauri(true);
    vi.resetModules();
    vi.doMock('./pngDecode', () => ({
      encodeImageDataToPngBytes: async () => new Uint8Array([1]),
      decodeImageBytesToImageData: (_b: Uint8Array) => new ImageData(2, 2),
    }));
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === 'begin_trace_job') return null;
        if (cmd === 'trace_image_binary') {
          return nativeResult(
            [
              {
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0, handle_in: [-2, 0], handle_out: [2, 0] },
                  { x: 10, y: 10 },
                  { x: 0, y: 10 },
                ],
                closed: true,
                fill: { r: 30, g: 30, b: 30, a: 255 },
                holes: [
                  [
                    { x: 4, y: 4 },
                    { x: 6, y: 4 },
                    { x: 6, y: 6 },
                    { x: 4, y: 6 },
                  ],
                ],
              },
              {
                points: [
                  { x: 2, y: 2 },
                  { x: 8, y: 8 },
                ],
                closed: false,
                fill: null,
              },
            ],
            1,
          );
        }
        return null;
      }),
    }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { nativeTraceProvider } = await import('./nativeTraceProvider');
    const result = await nativeTraceProvider.trace(
      new ImageData(16, 16),
      { mode: 'monochrome', traceMode: 'centerline', centerlineWidth: 3 },
      new AbortController().signal,
    );
    expect(result.omittedHoles).toBe(1);
    expect(result.paths).toHaveLength(2);
    const ring = result.paths[0];
    expect(ring?.closed).toBe(true);
    expect(ring?.curveFitted).toBe(true);
    expect(ring?.points[1]).toEqual({ x: 10, y: 0, handleIn: [-2, 0], handleOut: [2, 0] });
    expect(ring?.holes).toHaveLength(1);
    expect(ring?.holes?.[0]?.[0]).toEqual({ x: 4, y: 4 });
    const open = result.paths[1];
    expect(open?.closed).toBe(false);
    expect(open?.strokeWidth).toBe(3);
    expect(open?.fill).toBeUndefined();
  });

  it('forwards cancellation to cancel_trace and rejects after abort', async () => {
    setTauri(true);
    vi.resetModules();
    vi.doMock('./pngDecode', () => ({
      encodeImageDataToPngBytes: async () => new Uint8Array([1]),
      decodeImageBytesToImageData: (_b: Uint8Array) => new ImageData(2, 2),
    }));
    const cancelMock = vi.fn(async () => null);
    let resolveInvoke: (() => void) | undefined;
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn((cmd: string) => {
        if (cmd === 'begin_trace_job') return Promise.resolve(null);
        if (cmd === 'cancel_trace') return cancelMock();
        if (cmd === 'trace_image_binary') {
          // Stay pending until the test aborts, so the abort listener fires
          // while the IPC is in flight.
          return new Promise((resolve) => {
            resolveInvoke = () => resolve({ paths: [], omittedHoles: 0 });
          });
        }
        return Promise.resolve(null);
      }),
    }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { nativeTraceProvider } = await import('./nativeTraceProvider');
    const controller = new AbortController();
    const pending = nativeTraceProvider.trace(new ImageData(2, 2), {}, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(cancelMock).toHaveBeenCalled();
    resolveInvoke?.();
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('rejects cancellation signaled before invoke', async () => {
    setTauri(true);
    vi.resetModules();
    const invokeMock = vi.fn(async () => nativeResult([]));
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

    const { nativeTraceProvider } = await import('./nativeTraceProvider');
    const controller = new AbortController();
    controller.abort();
    await expect(
      nativeTraceProvider.trace(new ImageData(2, 2), {}, controller.signal),
    ).rejects.toThrow('cancelled');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
