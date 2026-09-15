/** @vitest-environment jsdom */

import { act, cleanup, render } from '@testing-library/react';
import { registerOverlay } from '@varve/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_GUARD_FLAG, TabletBackDismiss } from './TabletBackDismiss';

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

function overlay(id: string) {
  const node = document.createElement('div');
  document.body.appendChild(node);
  return {
    node,
    unregister: registerOverlay({
      id,
      kind: 'popover',
      ownerDocument: document,
      portalRoot: document.body,
      node,
      dismissOnPointerDown: true,
    }),
  };
}

describe('TabletBackDismiss', () => {
  it('does not turn a pending guard cleanup into Escape for a new overlay', () => {
    render(<TabletBackDismiss />);
    const historyBack = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const pushState = vi.spyOn(history, 'pushState');
    const keydown = vi.fn();
    document.addEventListener('keydown', keydown);

    const first = overlay('first');
    expect(history.state?.[OVERLAY_GUARD_FLAG]).toBe(true);
    expect(pushState).toHaveBeenCalledOnce();

    act(() => first.unregister());
    expect(historyBack).toHaveBeenCalledOnce();

    let second: ReturnType<typeof overlay>;
    act(() => {
      second = overlay('second');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(keydown).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(2);

    document.removeEventListener('keydown', keydown);
    act(() => second.unregister());
  });
});
