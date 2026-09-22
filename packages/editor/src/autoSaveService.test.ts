/**
 * Tests for AutoSaveService.
 *
 * Verifies interval-driven and idle-driven auto-save with retry, concurrency
 * guard, and lifecycle management.
 */

import type { Document } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AutoSaveConfig, AutoSaveService } from './autoSaveService';
import { createPersistenceRevision } from './persistence/documentRevision';

describe('AutoSaveService', () => {
  let getDoc: () => {
    document: Document;
    meta: { fileId?: string; name: string };
  };
  let saveFn: (json: string) => Promise<boolean>;
  let config: { intervalMs: number; idleThresholdMs: number; maxSaveRetries: number };
  let scheduleBackground: ((job: () => void) => void) | undefined;

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
    saveFn = vi.fn<(json: string) => Promise<boolean>>().mockResolvedValue(true);
    config = { intervalMs: 5000, idleThresholdMs: 1000, maxSaveRetries: 3 };
    scheduleBackground = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createService(cfg?: Partial<AutoSaveConfig>) {
    return new AutoSaveService(getDoc, saveFn, { ...config, ...cfg }, scheduleBackground);
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

  it('defers an automatic save to the background scheduler', async () => {
    const queued: Array<() => void> = [];
    scheduleBackground = (job) => queued.push(job);
    const svc = createService();
    svc.start();
    svc.notifyEdit();
    vi.advanceTimersByTime(config.intervalMs + 500);
    expect(saveFn).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);
    queued.shift()?.();
    await vi.waitFor(() => expect(saveFn).toHaveBeenCalledTimes(1));
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
    const firstCall = vi.mocked(saveFn).mock.calls[0];
    expect(firstCall).toBeDefined();
    const calledWith = (firstCall as [string])[0];
    const parsed = JSON.parse(calledWith);
    expect(parsed.name).toBe('My Doc');
  });

  it('calls onSaveRecovery after successful save', async () => {
    const recoveryFn = vi.fn().mockResolvedValue(undefined);
    const svc = createService();
    svc.setOnSaveRecovery(recoveryFn);
    svc.start();
    svc.notifyEdit();
    await svc.saveNow();
    expect(recoveryFn).toHaveBeenCalledTimes(1);
    const [docArg, metaArg] = recoveryFn.mock.calls[0] as [{ name: string }, { name: string }];
    expect(docArg.name).toBe('test');
    expect(metaArg.name).toBe('test');
  });

  it('does not call onSaveRecovery when save fails', async () => {
    const recoveryFn = vi.fn().mockResolvedValue(undefined);
    saveFn = vi.fn().mockResolvedValue(false);
    const svc = createService({ maxSaveRetries: 1 });
    svc.setOnSaveRecovery(recoveryFn);
    svc.start();
    svc.notifyEdit();
    await svc.saveNow();
    expect(recoveryFn).not.toHaveBeenCalled();
  });

  it('save succeeds even if onSaveRecovery throws', async () => {
    const recoveryFn = vi.fn().mockRejectedValue(new Error('recovery fail'));
    const svc = createService();
    svc.setOnSaveRecovery(recoveryFn);
    svc.start();
    svc.notifyEdit();
    const result = await svc.saveNow();
    expect(result).toBe(true);
  });

  it('onStateChange callback receives state transitions', async () => {
    const states: string[] = [];
    const svc = createService();
    svc.onStateChange((s) => states.push(s));
    svc.start();
    svc.notifyEdit();
    await svc.saveNow();
    expect(states).toContain('saving');
    expect(states).toContain('idle');
  });

  it('onStateChange callback receives error state on failure', async () => {
    const states: string[] = [];
    saveFn = vi.fn().mockRejectedValue(new Error('fail'));
    const svc = createService({ maxSaveRetries: 1 });
    svc.onStateChange((s) => states.push(s));
    svc.start();
    svc.notifyEdit();
    await svc.saveNow();
    expect(states).toContain('saving');
    expect(states).toContain('error');
  });

  it('onStateChange unsubscribe stops callbacks', async () => {
    const states: string[] = [];
    const svc = createService();
    const unsub = svc.onStateChange((s) => states.push(s));
    unsub();
    svc.start();
    svc.notifyEdit();
    await svc.saveNow();
    expect(states).toHaveLength(0);
  });

  describe('Untitled documents (no fileId)', () => {
    it('saves Untitled documents via recovery point', async () => {
      let capturedJson: string | undefined;
      getDoc = () => ({
        document: {
          formatVersion: '1.0',
          id: 'doc-untitled',
          name: 'Untitled',
          rootChildren: [],
          nodes: {},
          components: {},
          nextId: 1,
        } as Document,
        meta: { name: 'Untitled' },
      });
      saveFn = vi.fn().mockImplementation(async (json: string) => {
        capturedJson = json;
        return true;
      });
      const svc = createService();
      svc.start();
      svc.notifyEdit();
      const result = await svc.saveNow();
      expect(result).toBe(true);
      expect(capturedJson).toBeDefined();
      if (!capturedJson) throw new Error('Expected captured JSON');
      const parsed = JSON.parse(capturedJson);
      expect(parsed.id).toBe('doc-untitled');
    });

    it('still tracks lastSavedAt for Untitled recovery saves', async () => {
      const svc = createService();
      svc.start();
      svc.notifyEdit();
      expect(svc.lastSavedAt).toBeNull();
      await svc.saveNow();
      expect(svc.lastSavedAt).not.toBeNull();
      expect(typeof svc.lastSavedAt).toBe('number');
    });

    it('resets auto-save interval after Untitled recovery save', async () => {
      const svc = createService({ intervalMs: 5000, idleThresholdMs: 1000 });
      svc.start();
      svc.notifyEdit();
      await svc.saveNow();
      // Should not try to save again until next edit + interval
      vi.mocked(saveFn).mockClear();
      vi.advanceTimersByTime(3000);
      expect(saveFn).not.toHaveBeenCalled();
    });

    it('calls onSaveRecovery for Untitled documents', async () => {
      const recoveryFn = vi.fn().mockResolvedValue(undefined);
      const svc = createService();
      svc.setOnSaveRecovery(recoveryFn);
      svc.start();
      svc.notifyEdit();
      await svc.saveNow();
      expect(recoveryFn).toHaveBeenCalledTimes(1);
      const [, metaArg] = recoveryFn.mock.calls[0] as [unknown, { name: string }];
      expect(metaArg.name).toBe('test');
    });

    it('triggers another save after new edit on Untitled doc', async () => {
      const svc = createService();
      svc.start();
      svc.notifyEdit();
      await svc.saveNow();
      vi.mocked(saveFn).mockClear();
      // Another edit
      svc.notifyEdit();
      vi.advanceTimersByTime(config.intervalMs + 500);
      expect(saveFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('immutable revisions', () => {
    function revision(sessionId: string, value: number, materialize: () => string) {
      const created = createPersistenceRevision({
        sessionId,
        projectId: sessionId,
        fileName: sessionId,
        revision: value,
        document: {
          formatVersion: '1.0',
          id: `doc-${sessionId}`,
          name: sessionId,
          rootChildren: [],
          nodes: {},
          components: {},
          nextId: value,
        } as Document,
        capturedAt: Date.now(),
      });
      // Keep the test serializer independent of the font registry.
      return { ...created, materialize };
    }

    it('serializes only the latest revision and never reads the active tab', async () => {
      const writes: string[] = [];
      let firstEncodes = 0;
      let latestEncodes = 0;
      const svc = new AutoSaveService(async (_revision, json) => {
        writes.push(json);
        return true;
      }, config);
      svc.notifyEdit(
        revision('session-a', 1, () => {
          firstEncodes++;
          return 'old';
        }),
      );
      svc.notifyEdit(
        revision('session-a', 2, () => {
          latestEncodes++;
          return 'latest';
        }),
      );

      expect(await svc.saveNow('session-a')).toBe(true);
      expect(writes).toEqual(['latest']);
      expect(firstEncodes).toBe(0);
      expect(latestEncodes).toBe(1);
    });

    it('keeps a newer revision pending when an older write completes', async () => {
      let resolveWrite: (value: boolean) => void = () => undefined;
      let writeCount = 0;
      const writes: string[] = [];
      const svc = new AutoSaveService((_revision, json) => {
        writes.push(json);
        writeCount++;
        if (writeCount > 1) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          resolveWrite = resolve;
        });
      }, config);
      const first = revision('session-a', 1, () => 'old');
      const latest = revision('session-a', 2, () => 'latest');
      svc.notifyEdit(first);
      const firstSave = svc.saveNow('session-a');
      svc.notifyEdit(latest);
      resolveWrite(true);
      expect(await firstSave).toBe(true);
      expect(await svc.saveNow('session-a')).toBe(true);
      expect(writes).toEqual(['old', 'latest']);
    });

    it('does not materialize a queued job after disposal', async () => {
      const queued: Array<() => void> = [];
      let encodes = 0;
      const svc = new AutoSaveService(
        async () => true,
        { ...config, intervalMs: 0, idleThresholdMs: 0 },
        (job) => queued.push(job),
      );
      svc.start();
      svc.notifyEdit(
        revision('session-a', 1, () => {
          encodes++;
          return 'queued';
        }),
      );
      vi.advanceTimersByTime(1000);
      expect(queued).toHaveLength(1);
      await svc.dispose();
      queued.shift()?.();
      expect(encodes).toBe(0);
    });

    it('rechecks the interaction lease before automatic materialization', async () => {
      const queued: Array<() => void> = [];
      let active = true;
      let encodes = 0;
      const svc = new AutoSaveService(
        async () => true,
        { ...config, intervalMs: 0, idleThresholdMs: 0 },
        (job) => queued.push(job),
        () => active,
      );
      svc.start();
      svc.notifyEdit(
        revision('session-a', 1, () => {
          encodes++;
          return 'queued';
        }),
      );
      vi.advanceTimersByTime(1000);
      queued.shift()?.();
      await Promise.resolve();
      expect(encodes).toBe(0);
      active = false;
      vi.advanceTimersByTime(1000);
      queued.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(encodes).toBe(1);
    });
  });
});
