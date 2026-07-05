// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FocusTrap } from './FocusTrap';

describe('FocusTrap', () => {
  it('Tab on last element wraps to first', () => {
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
    const btn1 = screen.getByTestId('btn1');
    const btn2 = screen.getByTestId('btn2');
    const btn3 = screen.getByTestId('btn3');

    // Focus the last element, then Tab should wrap to first
    btn3.focus();
    fireEvent.keyDown(btn3, { key: 'Tab' });
    expect(document.activeElement).toBe(btn1);
  });

  it('Shift+Tab on first element wraps to last', () => {
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
    const btn1 = screen.getByTestId('btn1');
    const btn3 = screen.getByTestId('btn3');

    // Focus the first element, then Shift+Tab should wrap to last
    btn1.focus();
    fireEvent.keyDown(btn1, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(btn3);
  });

  it('Tab on middle element does not wrap', () => {
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
    const btn1 = screen.getByTestId('btn1');
    const btn2 = screen.getByTestId('btn2');

    // Focus middle element, Tab should NOT wrap (not at boundary)
    btn2.focus();
    fireEvent.keyDown(btn2, { key: 'Tab' });
    expect(document.activeElement).toBe(btn2);
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(
      <FocusTrap active={true} onClose={onClose}>
        <button type="button">Test</button>
      </FocusTrap>,
    );
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
    // With only one button and active=false, Tab should not trigger wrapping
    fireEvent.keyDown(btn, { key: 'Tab' });
    // Focus should remain on btn (no wrap since trap is inactive)
    expect(document.activeElement).toBe(btn);
  });

  it('initial focus goes to specified element', () => {
    render(
      <FocusTrap active={true} initialFocus="#focus-me">
        <button type="button">First</button>
        <button type="button" id="focus-me" data-testid="target">
          Target
        </button>
        <button type="button">Last</button>
      </FocusTrap>,
    );
    const target = screen.getByTestId('target');
    expect(document.activeElement).toBe(target);
  });

  it('focus trap container has no visual impact', () => {
    const { container } = render(
      <FocusTrap active={true}>
        <button type="button">Test</button>
      </FocusTrap>,
    );
    const div = container.firstElementChild;
    expect(div?.tagName).toBe('DIV');
    expect(div?.getAttribute('style')).toBeNull();
  });
});
