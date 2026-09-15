/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover';

// jsdom implements `showPopover`/`hidePopover` but not the popover UA styles
// (`:popover-open` still computes `display: none`). Delete the API before the
// component module captures its feature flag so these tests exercise the
// registry-backed path — the same path non-native browsers use — and the
// Chromium spec covers the native path.
vi.hoisted(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  delete proto.showPopover;
  delete proto.hidePopover;
  delete proto.togglePopover;
});

afterEach(cleanup);

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
  hide: vi.fn(),
  size: vi.fn(),
  arrow: vi.fn(),
}));

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

  it('closes on Escape while focus is still on the trigger', async () => {
    // Regression: a pointer-opened native popover leaves focus on the trigger,
    // and the browser only handles Escape while focus is inside the panel, so
    // the surface used to stay open for the most common dismissal path.
    render(<Popover popover={<div>content</div>}>Open</Popover>);
    const button = screen.getByRole('button', { name: 'Open' });
    button.focus();
    fireEvent.click(button);
    const wrapper = getTriggerWrapper();
    expect(wrapper).toHaveAttribute('aria-expanded', 'true');

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await waitFor(() => {
      expect(wrapper).toHaveAttribute('aria-expanded', 'false');
    });
    expect(button).toHaveFocus();
  });

  it('closes on outside pointerdown and keeps focus on the pressed target', async () => {
    render(
      <div>
        <Popover popover={<div>content</div>}>Open</Popover>
        <button type="button" data-testid="outside">
          Outside
        </button>
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Open' });
    button.focus();
    fireEvent.click(button);
    const wrapper = getTriggerWrapper();
    expect(wrapper).toHaveAttribute('aria-expanded', 'true');

    const outside = screen.getByTestId('outside');
    outside.focus();
    await act(async () => {
      fireEvent.pointerDown(outside);
    });
    await waitFor(() => {
      expect(wrapper).toHaveAttribute('aria-expanded', 'false');
    });
    expect(outside).toHaveFocus();
  });

  it('does not close when pointerdown lands inside the panel', async () => {
    render(<Popover popover={<button type="button">Inside</button>}>Open</Popover>);
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(button);
    const wrapper = getTriggerWrapper();
    expect(wrapper).toHaveAttribute('aria-expanded', 'true');
    const inside = await screen.findByRole('button', { name: 'Inside' });

    await act(async () => {
      fireEvent.pointerDown(inside);
    });
    expect(wrapper).toHaveAttribute('aria-expanded', 'true');
  });

  it('moves focus into the panel when opened from the keyboard', async () => {
    render(<Popover popover={<button type="button">First action</button>}>Open</Popover>);
    const button = screen.getByRole('button', { name: 'Open' });
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus();
    });
  });

  it('does not steal focus when opened with a pointer', async () => {
    render(<Popover popover={<button type="button">First action</button>}>Open</Popover>);
    const button = screen.getByRole('button', { name: 'Open' });
    button.focus();
    fireEvent.click(button);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(button).toHaveFocus();
  });

  it('respects a consumer-declared aria-haspopup instead of forcing dialog', () => {
    render(
      <Popover popover={<div role="listbox" aria-label="Choices" />}>
        <button type="button" aria-haspopup="listbox">
          Open
        </button>
      </Popover>,
    );
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute(
      'aria-haspopup',
      'listbox',
    );
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

  it('closes when the trigger is activated a second time', async () => {
    render(<Popover popover={<div>content</div>}>Open</Popover>);
    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(button);
    const wrapper = getTriggerWrapper();
    expect(wrapper).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    await waitFor(() => {
      expect(wrapper).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
