import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FontDownloadManager } from './fontDownloadManager';
import type { ParsedFontMetadata } from './fontIdentity';
import { parseFontData } from './fontParser';

let bytes: ArrayBuffer;
let metadata: ParsedFontMetadata;
beforeAll(async () => {
  bytes = new Uint8Array(
    readFileSync(new URL('./__fixtures__/geist/geist-latin-wght-normal.woff2', import.meta.url)),
  ).buffer;
  metadata = await parseFontData(bytes);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness(maxConcurrent?: number) {
  const complete = vi.fn();
  const failed = vi.fn();
  const manager = new FontDownloadManager(
    { maxConcurrent, validateIntegrity: false, allowedHosts: ['example.com'] },
    { onJobComplete: complete, onJobFailed: failed },
  );
  const download = vi.spyOn(manager, 'downloadFile').mockResolvedValue(bytes);
  const validate = vi.spyOn(manager, 'validateFont').mockResolvedValue(metadata);
  const add = () => manager.addJob('https://example.com/geist.woff2', 'Geist', 'woff2');
  return { manager, complete, failed, download, validate, add };
}

describe('font download attempt lifecycle', () => {
  it('does not revive cancellation when a download resolves late', async () => {
    const h = harness();
    const transport = deferred<ArrayBuffer>();
    h.download.mockReturnValueOnce(transport.promise);
    const job = h.add();
    await setImmediate();
    h.manager.cancelJob(job.id);
    transport.resolve(bytes);
    await setImmediate();
    expect(job.status).toBe('cancelled');
    expect(h.validate).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a cancelled validator that later %ss after retry',
    async (settlement) => {
      const h = harness(1);
      const first = deferred<ParsedFontMetadata>();
      const second = deferred<ParsedFontMetadata>();
      h.validate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const job = h.add();
      await setImmediate();
      expect(job.status).toBe('validating');
      h.manager.cancelJob(job.id);
      h.manager.retryJob(job.id);
      await setImmediate();
      if (settlement === 'resolve') first.resolve(metadata);
      else first.reject(new Error('Old validation failed'));
      await setImmediate();
      expect(h.validate).toHaveBeenCalledTimes(2);
      expect(job.status).toBe('validating');
      expect(h.complete).not.toHaveBeenCalled();
      expect(h.failed).not.toHaveBeenCalled();
      second.resolve(metadata);
      await setImmediate();
      expect(job.status).toBe('complete');
      expect(h.complete).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps validation in the concurrency budget and drains the next job', async () => {
    const h = harness(1);
    const validation = deferred<ParsedFontMetadata>();
    h.validate.mockReturnValueOnce(validation.promise);
    h.add();
    await setImmediate();
    const next = h.add();
    await setImmediate();
    expect(h.download).toHaveBeenCalledTimes(1);
    expect(next.status).toBe('queued');
    validation.resolve(metadata);
    await setImmediate();
    expect(next.status).toBe('complete');
    expect(h.complete).toHaveBeenCalledTimes(2);
  });

  it('waits for a paused transport to settle before resuming the same job', async () => {
    const h = harness();
    const first = deferred<ArrayBuffer>();
    h.download.mockReturnValueOnce(first.promise);
    const job = h.add();
    await setImmediate();
    expect(h.manager.pauseJob(job.id)).toBe(true);
    expect(h.manager.resumeJob(job.id)).toBe(true);
    await setImmediate();
    expect(h.download).toHaveBeenCalledTimes(1);
    first.resolve(bytes);
    await setImmediate();
    expect(h.download).toHaveBeenCalledTimes(2);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('complete');
  });

  it('does not publish a removed job after validation completes', async () => {
    const h = harness();
    const validation = deferred<ParsedFontMetadata>();
    h.validate.mockReturnValueOnce(validation.promise);
    const job = h.add();
    await setImmediate();
    h.manager.cancelJob(job.id);
    expect(h.manager.removeJob(job.id)).toBe(true);
    validation.resolve(metadata);
    await setImmediate();
    expect(h.manager.getJob(job.id)).toBeUndefined();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.failed).not.toHaveBeenCalled();
  });

  it.each([undefined, 10, 0, Number.NaN])(
    'bounds configured concurrency %s to one or two attempts',
    async (configured) => {
      const h = harness(configured);
      const transport = deferred<ArrayBuffer>();
      h.download.mockReturnValue(transport.promise);
      for (let i = 0; i < 5; i++) h.add();
      await setImmediate();
      expect(h.download.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(h.download.mock.calls.length).toBeLessThanOrEqual(2);
      h.manager.cancelAll();
      transport.resolve(bytes);
      await setImmediate();
      expect(h.complete).not.toHaveBeenCalled();
    },
  );
});

describe('font transport lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('checks the actual artifact hash and rejects modified bytes', async () => {
    const manager = new FontDownloadManager();
    const expected = metadata.identity.contentHash;
    expect(await manager.verifyIntegrityAsync(bytes, expected)).toBe(true);
    const corrupted = new Uint8Array(bytes.slice(0));
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    expect(await manager.verifyIntegrityAsync(corrupted.buffer, expected)).toBe(false);
    expect(manager.verifyIntegrity(bytes, expected)).toBe(false);
  });

  it('fails an expected-hash download when SHA-256 is unavailable', async () => {
    // Keep the already parsed real metadata; isolate capability loss at verification.
    const manager = new FontDownloadManager({ allowedHosts: ['example.com'] });
    vi.spyOn(manager, 'downloadFile').mockResolvedValue(bytes);
    vi.spyOn(manager, 'validateFont').mockResolvedValue(metadata);
    vi.stubGlobal('crypto', undefined);
    const job = manager.addJob('https://example.com/geist.woff2', 'Geist', 'woff2', {
      sha256: metadata.identity.contentHash,
    });
    await setImmediate();
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/SHA-256.*unavailable/i);
    expect(job.data).toBeUndefined();
  });

  it.each(['headers', 'buffer', 'chunk'] as const)(
    'does not publish progress after cancellation during %s',
    async (phase) => {
      const progress = vi.fn();
      const complete = vi.fn();
      const manager = new FontDownloadManager(
        { allowedHosts: ['example.com'] },
        { onJobProgress: progress, onJobComplete: complete },
      );
      const pending = deferred<void>();
      let read = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (phase === 'headers') await pending.promise;
          return {
            ok: true,
            headers: new Headers({ 'content-length': String(bytes.byteLength) }),
            body:
              phase === 'buffer'
                ? null
                : {
                    getReader: () => ({
                      read: async () => {
                        if (phase === 'chunk') await pending.promise;
                        if (read) return { done: true };
                        read = true;
                        return { done: false, value: new Uint8Array(bytes) };
                      },
                      releaseLock: vi.fn(),
                    }),
                  },
            arrayBuffer: async () => {
              await pending.promise;
              return bytes;
            },
          };
        }),
      );
      const job = manager.addJob('https://example.com/geist.woff2', 'Geist');
      await setImmediate();
      manager.cancelJob(job.id);
      pending.resolve();
      await setImmediate();
      expect(job.status).toBe('cancelled');
      expect(progress).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    },
  );

  it.each(['headers', 'body'] as const)(
    'times out stalled %s, drains the queue and can retry',
    async (phase) => {
      vi.useFakeTimers();
      const failed = vi.fn();
      const manager = new FontDownloadManager(
        { maxConcurrent: 1, allowedHosts: ['example.com'] },
        { onJobFailed: failed },
      );
      vi.spyOn(manager, 'validateFont').mockResolvedValue(metadata);
      const fetchMock = vi
        .fn()
        .mockImplementationOnce((_url: string, options: RequestInit) => {
          if (phase === 'body') {
            return Promise.resolve(
              new Response(
                new ReadableStream({
                  start(controller) {
                    options.signal?.addEventListener(
                      'abort',
                      () => controller.error(options.signal?.reason),
                      { once: true },
                    );
                  },
                }),
              ),
            );
          }
          return new Promise<Response>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true,
            });
          });
        })
        .mockImplementation(async () => new Response(bytes));
      vi.stubGlobal('fetch', fetchMock);
      const stalled = manager.addJob('https://example.com/geist.woff2', 'Geist');
      const next = manager.addJob('https://example.com/geist.woff2', 'Geist');
      await vi.advanceTimersByTimeAsync(30_001);
      expect(stalled.status).toBe('failed');
      expect(stalled.error).toMatch(/timed out.*retry/i);
      expect(failed).toHaveBeenCalledTimes(1);
      expect(next.status).toBe('complete');
      expect(manager.retryJob(stalled.id)).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(stalled.status).toBe('complete');
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
