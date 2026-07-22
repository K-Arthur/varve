import { describe, expect, it, vi } from 'vitest';
import { beginRecoverySession, createLifecycleFlushCoordinator } from './lifecycleFlush';

describe('lifecycle flush coordinator', () => {
  it('deduplicates concurrent visibility, pagehide, and unload saves', async () => {
    let resolveSave: () => void = () => undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const coordinator = createLifecycleFlushCoordinator({
      save,
      isDirty: () => true,
      getRevision: () => 4,
      markClean: vi.fn(),
    });

    const first = coordinator.request();
    const second = coordinator.request();
    const third = coordinator.request(true);
    expect(save).toHaveBeenCalledOnce();
    expect(coordinator.isSaving()).toBe(true);
    resolveSave();
    await Promise.all([first, second, third]);
    expect(coordinator.isSaving()).toBe(false);
  });

  it('marks shutdown clean only when the saved revision is still current', async () => {
    let revision = 7;
    const markClean = vi.fn();
    const coordinator = createLifecycleFlushCoordinator({
      save: async () => {
        revision++;
      },
      isDirty: () => true,
      getRevision: () => revision,
      markClean,
    });

    await coordinator.request(true);
    expect(markClean).not.toHaveBeenCalled();
  });

  it('marks an already-clean session without issuing a save', async () => {
    const save = vi.fn();
    const markClean = vi.fn();
    const coordinator = createLifecycleFlushCoordinator({
      save,
      isDirty: () => false,
      getRevision: () => 1,
      markClean,
    });

    await coordinator.request(true);
    expect(save).not.toHaveBeenCalled();
    expect(markClean).toHaveBeenCalledOnce();
  });
});

describe('recovery session marker', () => {
  it('reads the previous marker before marking the new session active', () => {
    const values = new Map([['shutdown', 'true']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(beginRecoverySession(storage, 'shutdown')).toBe(true);
    expect(values.get('shutdown')).toBe('false');
  });
});
