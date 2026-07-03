/**
 * Tests for AutoSaveService.
 *
 * Verifies interval-driven and idle-driven auto-save with retry, concurrency
 * guard, and lifecycle management.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Document } from '@strata/scene';
import { type AutoSaveConfig, AutoSaveService } from './autoSaveService';

describe('AutoSaveService', () => {
  let getDoc: () => {
    document: Document;
    meta: { fileId?: string; name: string };
  };
  let saveFn: ReturnType<typeof vi.fn>;
  let config: { intervalMs: number; idleThresholdMs: number; maxSaveRetries: number };

  beforeEach(() => {
    vi.useFakeTimers();
    getDoc = () => ({
      document: {
        formatVersion: '1.0',
        id: 'doc-test',
        name: 'test',
        rootChildren: [],
        nodes: {},
        components: {},
        nextId: 1,
      } as Document,
      meta: { name: 'test' },
    });
    saveFn = vi.fn().mockResolvedValue(true);
    config = { intervalMs: 5000, idleThresholdMs: 1000, maxSaveRetries: 3 };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createService(cfg?: Partial<AutoSaveConfig>) {
    return new AutoSaveService(getDoc, saveFn, { ...config, ...cfg });
  }

  it('starts and stops without error', () => {
    const svc = createService();
    svc.start();
    expect(svc.state).toBe('idle');
    svc.stop();
    expect(svc.state).toBe('idle');
  });

  it('triggers save when dirty and past interval', () => {
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    vi.advanceTimersByTime(config.intervalMs + 500);
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('idle detection: save not triggered immediately on edit', () => {
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    vi.advanceTimersByTime(100);
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('saveNow triggers save', async () => {
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    const result = await svc.saveNow();
    expect(result).toBe(true);
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('concurrency guard: cannot trigger save while saving', async () => {
    let resolveSave: (v: boolean) => void = () => {};
    saveFn = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((r) => {
          resolveSave = r;
        }),
    );
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    const savePromise = svc.saveNow();
    // Try another save while in progress
    const secondResult = await svc.saveNow();
    expect(secondResult).toBe(false);
    resolveSave?.(true);
    await savePromise;
  });

  it('updateConfig changes interval', () => {
    const svc = createService({ intervalMs: 10000 });
    svc.updateConfig({ intervalMs: 500 });
    svc.start();
    svc.notifyEdit();
    vi.advanceTimersByTime(2000);
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure up to maxSaveRetries', async () => {
    saveFn = vi.fn().mockRejectedValue(new Error('fail'));
    const svc = createService({ maxSaveRetries: 2 });
    svc.start();
    svc.notifyEdit();
    const result = await svc.saveNow();
    expect(result).toBe(false);
    expect(saveFn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it('transitions state correctly', async () => {
    const svc = createService();
    svc.start();
    expect(svc.state).toBe('idle');
    svc.notifyEdit();
    const savePromise = svc.saveNow();
    expect(svc.state).toBe('saving');
    await savePromise;
    expect(svc.state).toBe('idle');
  });

  it('does not save if not dirty', () => {
    const svc = createService();
    svc.start();
    vi.advanceTimersByTime(config.intervalMs + 500);
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('updates lastSavedAt after save', async () => {
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    expect(svc.lastSavedAt).toBeNull();
    await svc.saveNow();
    expect(svc.lastSavedAt).not.toBeNull();
    expect(typeof svc.lastSavedAt).toBe('number');
  });

  it('multiple edits only trigger one save', () => {
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    svc.notifyEdit();
    svc.notifyEdit();
    vi.advanceTimersByTime(config.intervalMs + 500);
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('stop prevents saves', () => {
    const svc = createService();
    svc.start();
    svc.stop();
    svc.notifyEdit();
    vi.advanceTimersByTime(config.intervalMs + 500);
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('saveNow with error returns false', async () => {
    saveFn = vi.fn().mockRejectedValue(new Error('fail'));
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    const result = await svc.saveNow();
    expect(result).toBe(false);
  });

  it('returns to idle after successful save', async () => {
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    const savePromise = svc.saveNow();
    expect(svc.state).toBe('saving');
    await savePromise;
    expect(svc.state).toBe('idle');
  });

  it('transitions to error state on failure and back to idle on next success', async () => {
    saveFn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(true);
    const svc = createService({ maxSaveRetries: 1 });
    svc.start();
    svc.notifyEdit();
    const failResult = await svc.saveNow();
    expect(failResult).toBe(false);
    expect(svc.state).toBe('error');
    // Next save succeeds
    svc.notifyEdit();
    const successResult = await svc.saveNow();
    expect(successResult).toBe(true);
    expect(svc.state).toBe('idle');
  });

  it('serializes via getDocument callback', async () => {
    const doc = { formatVersion: '1.0', name: 'My Doc' };
    getDoc = () => ({ document: doc as never, meta: { name: 'My Doc' } });
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    await svc.saveNow();
    const firstCall = saveFn.mock.calls[0];
    expect(firstCall).toBeDefined();
    const calledWith = (firstCall as [string])[0];
    const parsed = JSON.parse(calledWith);
    expect(parsed.name).toBe('My Doc');
  });
});
