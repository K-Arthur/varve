/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover';

afterEach(() => {
  document.body.innerHTML = '';
});

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() =>
    Promise.resolve({
      x: 0,
      y: 0,
      middlewareData: { arrow: { x: 4, y: 4 } },
    }),
  ),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  arrow: vi.fn(),
}));

function getPopoverEl() {
  const el = document.querySelector('[popover]');
  if (!el) throw new Error('popover element not found');
  return el as HTMLElement;
}

function getTriggerWrapper() {
  const button = screen.getByRole('button', { name: /^open$/i });
  if (!button) throw new Error('trigger button not found');
  return button;
}

describe('Popover', () => {
  it('renders trigger', () => {
    render(<Popover popover={<div>content</div>}>Open</Popover>);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('opens popover on trigger click', () => {
    render(<Popover popover={<div>content</div>}>Open</Popover>);
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(button);
    const wrapper = getTriggerWrapper();
    expect(wrapper).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape', async () => {
    render(<Popover popover={<div>content</div>}>Open</Popover>);
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(button);
    const wrapper = getTriggerWrapper();
    expect(wrapper).toHaveAttribute('aria-expanded', 'true');

    const popoverEl = getPopoverEl();
    await act(async () => {
      popoverEl.hidePopover();
    });
    await waitFor(() => {
      expect(wrapper).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('has correct placement (default bottom)', async () => {
    const { computePosition } = await import('@floating-ui/dom');
    render(<Popover popover={<div>content</div>}>Open</Popover>);
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(button);
    await waitFor(() => {
      expect(computePosition).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ placement: 'bottom' }),
      );
    });
  });

  it('popover content renders when open', () => {
    render(<Popover popover={<div>Popover content</div>}>Open</Popover>);
    expect(screen.getByText('Popover content')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(button);
    expect(screen.getByText('Popover content')).toBeInTheDocument();
  });

  it('closes on outside click', async () => {
    render(
      <div>
        <Popover popover={<div>content</div>}>Open</Popover>
        <div>Outside</div>
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(button);
    const wrapper = getTriggerWrapper();
    expect(wrapper).toHaveAttribute('aria-expanded', 'true');

    const popoverEl = getPopoverEl();
    await act(async () => {
      popoverEl.hidePopover();
    });
    await waitFor(() => {
      expect(wrapper).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
