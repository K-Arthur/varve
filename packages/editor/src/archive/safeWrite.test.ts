/**
 * Tests for safe-write module.
 *
 * Verifies atomic write, temp file cleanup, retry with backoff,
 * and in-memory filesystem fallback.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inMemoryClear,
  inMemoryFileExists,
  inMemoryReadFile,
  resetSafeWriteIo,
  safeWriteFile,
  safeWriteWithRetry,
} from './safeWrite';

describe('safeWrite', () => {
  beforeEach(() => {
    inMemoryClear();
  });

  afterEach(() => {
    resetSafeWriteIo();
    inMemoryClear();
  });

  describe('safeWriteFile', () => {
    it('writes data to destination', async () => {
      const data = new TextEncoder().encode('hello world');
      await safeWriteFile({ destination: '/test/file.txt', bytes: data });
      expect(inMemoryFileExists('/test/file.txt')).toBe(true);
      expect(inMemoryReadFile('/test/file.txt')).toEqual(data);
    });

    it('does not leave temp file on success', async () => {
      const data = new TextEncoder().encode('clean');
      await safeWriteFile({ destination: '/test/clean.txt', bytes: data });
      expect(inMemoryFileExists('/test/clean.txt')).toBe(true);
    });

    it('cleans up temp file on validation failure', async () => {
      const data = new TextEncoder().encode('invalid');
      await expect(
        safeWriteFile({
          destination: '/test/fail.txt',
          bytes: data,
          validate: () => false,
        }),
      ).rejects.toThrow('Validation failed');
      expect(inMemoryFileExists('/test/fail.txt')).toBe(false);
    });

    it('does not write destination on validation failure', async () => {
      const data = new TextEncoder().encode('fail');
      try {
        await safeWriteFile({
          destination: '/test/nodest.txt',
          bytes: data,
          validate: () => false,
        });
      } catch {
        // expected
      }
      expect(inMemoryFileExists('/test/nodest.txt')).toBe(false);
    });

    it('supports AbortSignal cancellation', async () => {
      const controller = new AbortController();
      controller.abort();
      const data = new TextEncoder().encode('aborted');
      await expect(
        safeWriteFile({
          destination: '/test/abort.txt',
          bytes: data,
          signal: controller.signal,
        }),
      ).rejects.toThrow('Aborted');
    });
  });

  describe('safeWriteWithRetry', () => {
    it('succeeds on first attempt', async () => {
      const data = new TextEncoder().encode('first try');
      await safeWriteWithRetry({ destination: '/test/first.txt', bytes: data });
      expect(inMemoryFileExists('/test/first.txt')).toBe(true);
    });

    it('does not retry validation failures', async () => {
      const data = new TextEncoder().encode('no retry');
      await expect(
        safeWriteWithRetry(
          {
            destination: '/test/noretry.txt',
            bytes: data,
            validate: () => false,
          },
          3,
        ),
      ).rejects.toThrow('Validation failed');
    });

    it('respects AbortSignal on first attempt', async () => {
      const controller = new AbortController();
      controller.abort();
      const data = new TextEncoder().encode('aborted retry');
      await expect(
        safeWriteWithRetry(
          { destination: '/test/abort-retry.txt', bytes: data, signal: controller.signal },
          3,
        ),
      ).rejects.toThrow('Aborted');
    });
  });

  describe('in-memory filesystem', () => {
    it('tracks files written through safeWriteFile', async () => {
      const data = new TextEncoder().encode('tracked');
      await safeWriteFile({ destination: '/tracked.txt', bytes: data });
      expect(inMemoryFileExists('/tracked.txt')).toBe(true);
      expect(inMemoryReadFile('/tracked.txt')).toEqual(data);
    });

    it('inMemoryClear removes all files', async () => {
      await safeWriteFile({
        destination: '/a.txt',
        bytes: new TextEncoder().encode('a'),
      });
      inMemoryClear();
      expect(inMemoryFileExists('/a.txt')).toBe(false);
    });
  });
});
