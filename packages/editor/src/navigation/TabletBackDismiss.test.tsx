/** @vitest-environment jsdom */

import { act, cleanup, render } from '@testing-library/react';
import { Dialog, registerOverlay } from '@varve/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_GUARD_FLAG, TabletBackDismiss } from './TabletBackDismiss';

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

function overlay(id: string, dismissOnEscape = true) {
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
      onClose: vi.fn(),
      dismissOnPointerDown: true,
      dismissOnEscape,
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

  it('does not guard browser Back for a non-dismissible tooltip', () => {
    render(<TabletBackDismiss />);
    const pushState = vi.spyOn(history, 'pushState');
    const tooltip = overlay('tooltip', false);

    expect(pushState).not.toHaveBeenCalled();
    expect(history.state?.[OVERLAY_GUARD_FLAG]).not.toBe(true);

    tooltip.unregister();
  });

  it('dismisses the top dialog through its explicit Back handler', async () => {
    const onClose = vi.fn();
    render(
      <>
        <TabletBackDismiss />
        <Dialog open onClose={onClose} title="Settings">
          <button type="button">Apply</button>
        </Dialog>
      </>,
    );
    await act(async () => Promise.resolve());
    const dialog = document.querySelector('dialog');
    expect(dialog?.dataset.backDismiss).toBe('true');
    expect(history.state?.[OVERLAY_GUARD_FLAG]).toBe(true);

    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not add a history guard for a non-dismissible dialog', async () => {
    const pushState = vi.spyOn(history, 'pushState');
    const onClose = vi.fn();
    render(
      <>
        <TabletBackDismiss />
        <Dialog open dismissible={false} onClose={onClose} title="Working">
          <p>Keep this operation open.</p>
        </Dialog>
      </>,
    );
    await act(async () => Promise.resolve());

    expect(document.querySelector('dialog')?.dataset.backDismiss).toBe('false');
    expect(pushState).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
