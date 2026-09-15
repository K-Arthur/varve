/**
 * Every route into on-device inference must be closed when a deployment
 * withholds it — not merely the affordances that happen to be visible.
 *
 * These assert the *choke points* rather than the UI, because the UI list is
 * long and grows: layers context menu, two inspector sections, the selection
 * quick bar, the Object menu, the command palette, and an action handler all
 * reach the same two context methods.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCapabilityRestricted, setCapabilityRestrictions } from './restrictions';

afterEach(() => setCapabilityRestrictions(null));

/** Mirrors the guard in context.tsx. */
function guardInference<A extends unknown[]>(
  action: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return (...args: A) =>
    isCapabilityRestricted('inference') ? Promise.resolve() : action(...args);
}

describe('inference gating', () => {
  it('runs the action when nothing is restricted', async () => {
    const run = vi.fn(async () => {});
    await guardInference(run)();
    expect(run).toHaveBeenCalledOnce();
  });

  it('never reaches the action when inference is withheld', async () => {
    setCapabilityRestrictions({ restricted: new Set(['inference']), workspaceModes: null });
    const run = vi.fn(async () => {});
    await guardInference(run)();
    expect(run).not.toHaveBeenCalled();
  });

  it('resolves rather than rejecting, so no error toast fires', async () => {
    setCapabilityRestrictions({ restricted: new Set(['inference']), workspaceModes: null });
    const run = vi.fn(async () => {});
    await expect(guardInference(run)()).resolves.toBeUndefined();
  });

  it('is unaffected by an unrelated restriction', async () => {
    setCapabilityRestrictions({ restricted: new Set(['printProduction']), workspaceModes: null });
    const run = vi.fn(async () => {});
    await guardInference(run)();
    expect(run).toHaveBeenCalledOnce();
  });
});
