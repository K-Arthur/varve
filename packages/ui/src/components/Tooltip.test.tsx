/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

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
        <button>Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders tooltip on hover after delay', async () => {
    render(
      <Tooltip label="Helpful tip" delay={200}>
        <button>Trigger</button>
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
        <button>Trigger</button>
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
        <button>Trigger</button>
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
        <button>Trigger</button>
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
        <button>Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
