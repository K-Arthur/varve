// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FocusTrap } from './FocusTrap';

describe('FocusTrap', () => {
  it('Tab cycles through focusable elements', () => {
    render(
      <FocusTrap active={true}>
        <button type="button" data-testid="btn1">First</button>
        <button type="button" data-testid="btn2">Second</button>
        <button type="button" data-testid="btn3">Third</button>
      </FocusTrap>,
    );
    const btn1 = screen.getByTestId('btn1');
    const btn2 = screen.getByTestId('btn2');
    const btn3 = screen.getByTestId('btn3');

    btn1.focus();
    fireEvent.keyDown(btn1, { key: 'Tab' });
    expect(document.activeElement).toBe(btn2);

    fireEvent.keyDown(btn2, { key: 'Tab' });
    expect(document.activeElement).toBe(btn3);

    // Wrap around
    fireEvent.keyDown(btn3, { key: 'Tab' });
    expect(document.activeElement).toBe(btn1);
  });

  it('Shift+Tab cycles in reverse', () => {
    render(
      <FocusTrap active={true}>
        <button type="button" data-testid="btn1">First</button>
        <button type="button" data-testid="btn2">Second</button>
        <button type="button" data-testid="btn3">Third</button>
      </FocusTrap>,
    );
    const btn1 = screen.getByTestId('btn1');
    const btn3 = screen.getByTestId('btn3');

    btn3.focus();
    fireEvent.keyDown(btn3, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(btn2);

    // Go past first
    btn1.focus();
    fireEvent.keyDown(btn1, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(btn3);
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
        <button type="button" data-testid="btn">Test</button>
      </FocusTrap>,
    );

    // With only one button, pressing Tab should NOT wrap (no trap)
    const btn = screen.getByTestId('btn');
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Tab' });
    expect(document.activeElement).toBe(btn);
  });

  it('initial focus goes to specified element', () => {
    render(
      <FocusTrap active={true} initialFocus="#focus-me">
        <button type="button">First</button>
        <button type="button" id="focus-me" data-testid="target">Target</button>
        <button type="button">Last</button>
      </FocusTrap>,
    );
    // The focus-me button should get initial focus
    const target = screen.getByTestId('target');
    // In jsdom, focus() on an element should set document.activeElement
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
    // The wrapping div should not set any visual style
    expect(div?.getAttribute('style')).toBeNull();
  });
});
