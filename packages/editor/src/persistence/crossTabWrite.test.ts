import { describe, expect, it, vi } from 'vitest';
import { shouldSkipStaleWrite, withDocumentWriteLock } from './crossTabWrite';

describe('shouldSkipStaleWrite', () => {
  it('allows the first write in a tab (no baseline)', () => {
    expect(shouldSkipStaleWrite(1700, null)).toBe(false);
    expect(shouldSkipStaleWrite(undefined, null)).toBe(false);
  });

  it('allows a write when the stored record is not newer', () => {
    expect(shouldSkipStaleWrite(undefined, 1000)).toBe(false);
    expect(shouldSkipStaleWrite(1000, 1000)).toBe(false);
    expect(shouldSkipStaleWrite(900, 1000)).toBe(false);
  });

  it('skips only when another writer stored a newer record', () => {
    expect(shouldSkipStaleWrite(1001, 1000)).toBe(true);
  });
});

describe('withDocumentWriteLock', () => {
  it('falls back to a direct write without Web Locks', async () => {
    const write = vi.fn(async () => 'written');
    expect(await withDocumentWriteLock(undefined, 'file-1', write)).toBe('written');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent writes for the same document', async () => {
    const events: string[] = [];
    const queues = new Map<string, Promise<void>>();
    const locks = {
      request: async <T>(name: string, callback: () => Promise<T>): Promise<T> => {
        const previous = queues.get(name) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        queues.set(
          name,
          previous.then(() => gate),
        );
        await previous;
        events.push(`start:${name}`);
        try {
          return await callback();
        } finally {
          release();
          events.push(`end:${name}`);
        }
      },
    };

    let releaseFirstWrite!: () => void;
    const first = withDocumentWriteLock(locks, 'file-1', async () => {
      await new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
      events.push('first-write');
      return 1;
    });
    const second = withDocumentWriteLock(locks, 'file-1', async () => {
      events.push('second-write');
      return 2;
    });

    await vi.waitFor(() => expect(events).toContain('start:varve-doc-write:file-1'));
    // The second write is queued behind the first, not interleaved with it.
    expect(events.filter((event) => event.startsWith('start:'))).toHaveLength(1);

    releaseFirstWrite();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(events.indexOf('first-write')).toBeLessThan(events.indexOf('second-write'));
  });
});
