// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusTrap } from './FocusTrap';

/**
 * In jsdom, offsetParent is always null (no layout engine), which breaks
 * FocusTrap's getFocusable filter.  Polyfill makeFocusable so tests can
 * exercise the focus-trapping logic.
 */
function makeFocusable(el: HTMLElement) {
  Object.defineProperty(el, 'offsetParent', { value: document.body, configurable: true });
}

/** Wait for requestAnimationFrame to fire (FocusTrap uses RAF for initial focus). */
function tick() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('FocusTrap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Tab on last element wraps to first', async () => {
    render(
      <FocusTrap active={true}>
        <button type="button" data-testid="btn1">
          First
        </button>
        <button type="button" data-testid="btn2">
          Second
        </button>
        <button type="button" data-testid="btn3">
          Third
        </button>
      </FocusTrap>,
    );
    await tick();
    const btn1 = screen.getByTestId('btn1');
    const btn3 = screen.getByTestId('btn3');
    makeFocusable(btn1);
    makeFocusable(btn3);

    btn3.focus();
    fireEvent.keyDown(btn3, { key: 'Tab' });
    expect(document.activeElement).toBe(btn1);
  });

  it('Shift+Tab on first element wraps to last', async () => {
    render(
      <FocusTrap active={true}>
        <button type="button" data-testid="btn1">
          First
        </button>
        <button type="button" data-testid="btn2">
          Second
        </button>
        <button type="button" data-testid="btn3">
          Third
        </button>
      </FocusTrap>,
    );
    await tick();
    const btn1 = screen.getByTestId('btn1');
    const btn3 = screen.getByTestId('btn3');
    makeFocusable(btn1);
    makeFocusable(btn3);

    btn1.focus();
    fireEvent.keyDown(btn1, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(btn3);
  });

  it('Tab on middle element does not wrap', async () => {
    render(
      <FocusTrap active={true}>
        <button type="button" data-testid="btn1">
          First
        </button>
        <button type="button" data-testid="btn2">
          Second
        </button>
        <button type="button" data-testid="btn3">
          Third
        </button>
      </FocusTrap>,
    );
    await tick();
    const btn2 = screen.getByTestId('btn2');
    makeFocusable(btn2);

    btn2.focus();
    fireEvent.keyDown(btn2, { key: 'Tab' });
    expect(document.activeElement).toBe(btn2);
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    render(
      <FocusTrap active={true} onClose={onClose}>
        <button type="button">Test</button>
      </FocusTrap>,
    );
    await tick();
    const btn = screen.getByText('Test');
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not trap focus when active=false', () => {
    render(
      <FocusTrap active={false}>
        <button type="button" data-testid="btn">
          Test
        </button>
      </FocusTrap>,
    );

    const btn = screen.getByTestId('btn');
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Tab' });
    expect(document.activeElement).toBe(btn);
  });

  it('initial focus goes to specified element', async () => {
    render(
      <FocusTrap active={true} initialFocus="#focus-me">
        <button type="button">First</button>
        <button type="button" id="focus-me" data-testid="target">
          Target
        </button>
        <button type="button">Last</button>
      </FocusTrap>,
    );
    await tick();
    const target = screen.getByTestId('target');
    expect(document.activeElement).toBe(target);
  });

  it('focus trap container has no visual impact', async () => {
    const { container } = render(
      <FocusTrap active={true}>
        <button type="button">Test</button>
      </FocusTrap>,
    );
    await tick();
    const div = container.firstElementChild;
    expect(div?.tagName).toBe('DIV');
    expect(div?.getAttribute('style')).toBe('display: contents;');
  });
});
