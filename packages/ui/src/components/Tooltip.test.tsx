/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip';

afterEach(cleanup);

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
}));

describe('Tooltip', () => {
  it('does not render tooltip initially', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders tooltip on hover after delay', async () => {
    render(
      <Tooltip label="Helpful tip" delay={200}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    const tooltip = await screen.findByRole('tooltip', {}, { timeout: 500 });
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Helpful tip');
  });

  it('shows immediately on focus', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
  });

  it('hides on Escape', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('has correct role and aria-describedby linkage', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(button);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveAttribute('id');
    const wrapper = button.parentElement;
    expect(wrapper).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('does not render when label is empty', () => {
    render(
      <Tooltip label="">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders shortcut badge when shortcut prop is provided', () => {
    render(
      <Tooltip label="Select" shortcut="V">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole('tooltip');
    const shortcut = tooltip.querySelector('.strata-tip__shortcut');
    expect(shortcut).toBeInTheDocument();
    expect(shortcut).toHaveTextContent('V');
  });

  it('hides on mouse leave', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('hides on blur', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cleans up timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const { unmount } = render(
      <Tooltip label="Helpful tip" delay={300}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.mouseEnter(trigger);
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('does not show tooltip after trigger unmounts', async () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Tooltip label="Helpful tip" delay={100}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.mouseEnter(trigger);
    unmount();
    vi.advanceTimersByTime(200);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('TooltipProvider warm-up timing', () => {
  it('uses warm delay for subsequent tooltips within window', async () => {
    vi.useFakeTimers();
    render(
      <TooltipProvider>
        <Tooltip label="First" delay={300}>
          <button type="button">One</button>
        </Tooltip>
        <Tooltip label="Second" delay={300}>
          <button type="button">Two</button>
        </Tooltip>
      </TooltipProvider>,
    );

    const buttonOne = screen.getByRole('button', { name: 'One' });
    const buttonTwo = screen.getByRole('button', { name: 'Two' });

    act(() => {
      fireEvent.focus(buttonOne);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('First');

    act(() => {
      fireEvent.keyDown(buttonOne, { key: 'Escape' });
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => {
      fireEvent.mouseEnter(buttonTwo);
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Second');

    vi.useRealTimers();
  });
});

describe('Tooltip truncation-only mode', () => {
  it('does not show tooltip when content is not truncated', () => {
    render(
      <Tooltip label="Full text" truncationOnly>
        <button type="button">Short</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Short' });
    fireEvent.focus(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
