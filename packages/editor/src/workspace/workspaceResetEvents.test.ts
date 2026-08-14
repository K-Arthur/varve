import { describe, expect, it, vi } from 'vitest';
import { emitWorkspaceReset, subscribeWorkspaceReset } from './workspaceResetEvents';

describe('workspace reset events', () => {
  it('notifies subscribers and allows cleanup', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceReset(listener);

    emitWorkspaceReset({ kind: 'mode', mode: 'design' });
    expect(listener).toHaveBeenCalledWith({ kind: 'mode', mode: 'design' });

    unsubscribe();
    emitWorkspaceReset({ kind: 'all' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed event details', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceReset(listener);

    window.dispatchEvent(new CustomEvent('varve:workspace-reset', { detail: { kind: 'bad' } }));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
