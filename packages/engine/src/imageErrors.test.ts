import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyInlineImageFailure,
  classifyRemoteImageFailure,
  ImageLoadError,
  isPermanentImageFailure,
} from './imageErrors';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('image error classification', () => {
  it('classifies inline decode failures as corrupt', () => {
    const error = classifyInlineImageFailure('data:image/png;base64,AAAA');
    expect(error).toBeInstanceOf(ImageLoadError);
    expect(error.code).toBe('corrupt');
    expect(error.source).toBe('data:image/png;base64,AAAA');
  });

  it('classifies non-image MIME payloads as unsupported', () => {
    expect(classifyInlineImageFailure('data:application/xml;base64,PD8=').code).toBe('unsupported');
  });

  it('never throws for inline classification', () => {
    expect(() =>
      classifyInlineImageFailure('data:image/png;base64,AA', new Error('x')),
    ).not.toThrow();
  });

  it('maps HTTP status codes to typed failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: 410 })
      .mockResolvedValueOnce({ status: 403 })
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect((await classifyRemoteImageFailure('https://x/y.png')).code).toBe('missing');
    expect((await classifyRemoteImageFailure('https://x/y.png')).code).toBe('missing');
    expect((await classifyRemoteImageFailure('https://x/y.png')).code).toBe('permission');
    expect((await classifyRemoteImageFailure('https://x/y.png')).code).toBe('unavailable');
    // 200 but the decoder still failed -> corrupt.
    expect((await classifyRemoteImageFailure('https://x/y.png')).code).toBe('corrupt');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('classifies CORS-restricted sources as cors (displays but taints)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ type: 'opaque' }) as unknown as typeof fetch;
    const error = await classifyRemoteImageFailure('https://cdn.example.com/photo.jpg');
    expect(error.code).toBe('cors');
  });

  it('classifies unreachable servers as unavailable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    const error = await classifyRemoteImageFailure('https://offline.example.com/photo.jpg');
    expect(error.code).toBe('unavailable');
  });

  it('binds the probe with a timeout so a hung server cannot stall classification', async () => {
    // A fetch that never resolves on its own but rejects when aborted —
    // mirroring a hung server that the probe's abort timeout must cut off.
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const started = Date.now();
    // Two bounded probes (cors + no-cors), each up to 4s.
    const error = await classifyRemoteImageFailure('https://hung.example.com/photo.jpg');
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(['unknown', 'unavailable', 'cors', 'corrupt']).toContain(error.code);
  }, 20_000);

  it('rejects non-http(s) sources without probing the network', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const error = await classifyRemoteImageFailure('file:///etc/passwd');
    expect(error.code).toBe('unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flags permanent failures that retry cannot fix', () => {
    expect(isPermanentImageFailure('missing')).toBe(true);
    expect(isPermanentImageFailure('corrupt')).toBe(true);
    expect(isPermanentImageFailure('unsupported')).toBe(true);
    expect(isPermanentImageFailure('cors')).toBe(true);
    expect(isPermanentImageFailure('unavailable')).toBe(false);
    expect(isPermanentImageFailure('admission')).toBe(false);
    expect(isPermanentImageFailure('cancelled')).toBe(false);
    expect(isPermanentImageFailure('unknown')).toBe(false);
  });
});
