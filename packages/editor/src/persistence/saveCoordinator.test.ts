import { describe, expect, it, vi } from 'vitest';
import { createSaveCoordinator } from './saveCoordinator';
import type { SaveOutcome } from './saveTypes';

function outcome(status: SaveOutcome['status']): SaveOutcome {
  if (status === 'saved') return { status: 'saved' };
  if (status === 'saved-copy') return { status: 'saved-copy' };
  if (status === 'cancelled') return { status: 'cancelled' };
  return { status: 'failed', issue: { category: 'unknown-io', message: 'boom' } };
}

describe('createSaveCoordinator', () => {
  it('serializes requests that arrive while a write is in flight', async () => {
    const calls: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const run = vi.fn(async (intent: 'save' | 'save-as' | 'save-copy') => {
      calls.push(`${intent}:start`);
      if (calls.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      calls.push(`${intent}:end`);
      return outcome('saved');
    });
    const coordinator = createSaveCoordinator(run);

    const p1 = coordinator.request('save');
    // Let the first write start and block on the gate.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const p2 = coordinator.request('save');
    expect(coordinator.isRunning()).toBe(true);
    releaseFirst?.();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe('saved');
    expect(r2.status).toBe('saved');
    // The second write only started after the first completed.
    expect(calls.indexOf('save:start')).toBe(0);
    expect(calls.indexOf('save:end') < calls.lastIndexOf('save:start')).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(coordinator.isRunning()).toBe(false);
  });

  it('coalesces a burst of plain saves into latest-wins', async () => {
    const run = vi.fn(async (_intent: 'save' | 'save-as' | 'save-copy') => {
      await Promise.resolve();
      return outcome('saved');
    });
    const coordinator = createSaveCoordinator(run);

    const results = await Promise.all([
      coordinator.request('save'),
      coordinator.request('save'),
      coordinator.request('save'),
    ]);

    // Intermediate requests were superseded: only one write happened, and
    // every request resolved with the outcome of the final run.
    expect(run).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === 'saved')).toBe(true);
  });

  it('never coalesces Save As or Save a Copy', async () => {
    const run = vi.fn(async (intent: 'save' | 'save-as' | 'save-copy') => {
      await Promise.resolve();
      return intent === 'save-copy' ? outcome('saved-copy') : outcome('saved');
    });
    const coordinator = createSaveCoordinator(run);

    await Promise.all([
      coordinator.request('save'),
      coordinator.request('save-as'),
      coordinator.request('save-copy'),
    ]);

    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.map(([i]) => i)).toEqual(['save', 'save-as', 'save-copy']);
  });

  it('preserves request order across mixed intents', async () => {
    const order: string[] = [];
    const run = vi.fn(async (intent: 'save' | 'save-as' | 'save-copy') => {
      order.push(intent);
      return outcome('saved');
    });
    const coordinator = createSaveCoordinator(run);

    await Promise.all([
      coordinator.request('save-as'),
      coordinator.request('save'),
      coordinator.request('save-copy'),
    ]);

    expect(order).toEqual(['save-as', 'save', 'save-copy']);
  });
});
