import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getManifestEntry,
  loadModelManifest,
  resetModelManifestCache,
  sha256Hex,
  verifyModelChecksum,
} from '../modelManifest';

describe('modelManifest', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetModelManifestCache();
    vi.unstubAllGlobals();
  });

  it('loads manifest entries by id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: 1,
          models: [
            {
              id: 'u2netp',
              filename: 'u2netp.onnx',
              localPath: '/models/u2netp.onnx',
              sha256: 'abc',
              bundled: true,
              remoteUrl: 'https://example.com/u2netp.onnx',
            },
          ],
        }),
      }),
    );
    const entry = await getManifestEntry('u2netp');
    expect(entry?.bundled).toBe(true);
    expect(entry?.localPath).toBe('/models/u2netp.onnx');
  });

  it('verifyModelChecksum rejects mismatch', async () => {
    const data = new TextEncoder().encode('test').buffer;
    const hash = await sha256Hex(data);
    expect(await verifyModelChecksum(data, hash)).toBe(true);
    expect(await verifyModelChecksum(data, 'deadbeef')).toBe(false);
  });

  it('verifyModelChecksum passes when sha256 is null', async () => {
    const data = new Uint8Array([1, 2, 3]).buffer;
    expect(await verifyModelChecksum(data, null)).toBe(true);
  });

  it('loadModelManifest returns null on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await loadModelManifest()).toBeNull();
  });

  it('loadModelManifest returns null when the request times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise(() => {
            // never resolves
          }),
      ),
    );
    const promise = loadModelManifest();
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(promise).resolves.toBeNull();
  });

  it('getManifestEntry aborts manifest fetch when the caller signal is aborted', async () => {
    const fetchMock = vi.fn(
      () =>
        new Promise(() => {
          // never resolves
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const promise = getManifestEntry('u2netp', controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(promise).resolves.toBeNull();
  });
});
