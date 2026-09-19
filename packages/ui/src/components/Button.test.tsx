import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = `
    .varve-btn { min-height: 44px; min-width: 44px; }
  `;
  document.head.appendChild(style);
});

afterEach(cleanup);

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('defaults to the default action variant and non-submit type', () => {
    render(<Button>Default</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('varve-btn--default');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('renders all variants', () => {
    const variants = [
      'default',
      'secondary',
      'outline',
      'ghost',
      'destructive',
      'link',
      'toolbar',
    ] as const;
    for (const variant of variants) {
      const { container } = render(<Button variant={variant}>{variant}</Button>);
      expect(container.querySelector(`.varve-btn--${variant}`)).toBeTruthy();
    }
  });

  it('shows spinner and aria-busy when loading', () => {
    vi.useFakeTimers();
    try {
      render(<Button loading>Processing</Button>);
      const btn = screen.getByRole('button');
      expect(btn.querySelector('.varve-spinner')).toBeFalsy();
      expect(btn).toHaveAttribute('aria-busy', 'true');
      act(() => vi.advanceTimersByTime(150));
      expect(btn.querySelector('.varve-spinner')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps children in DOM when loading (hidden visually)', () => {
    render(<Button loading>Processing</Button>);
    const content = screen.getByRole('button').querySelector('.varve-btn__content');
    expect(content?.textContent).toBe('Processing');
  });

  it('sets aria-disabled when loading', () => {
    render(<Button loading>Processing</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toHaveAttribute('disabled');
  });

  it('prevents duplicate clicks while loading', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onClick on normal state', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Click
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire onClick when softDisabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button softDisabled onClick={onClick}>
        Click
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('requires two clicks for danger with confirmLabel', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button variant="destructive" confirmLabel="Delete?" onClick={onClick}>
        Delete
      </Button>,
    );
    const btn = screen.getByRole('button');
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('meets 44px minimum touch target for md size', () => {
    render(<Button size="md">Touch</Button>);
    const btn = screen.getByRole('button');
    const styles = getComputedStyle(btn);
    expect(styles.minHeight).toBe('44px');
    expect(styles.minWidth).toBe('44px');
  });

  describe('disabledReason', () => {
    it('keeps the control focusable and describes why it is unavailable', async () => {
      const user = userEvent.setup();
      render(
        <Button disabled disabledReason="Select a layer first">
          Align
        </Button>,
      );
      const btn = screen.getByRole('button', { name: 'Align' });
      expect(btn).toHaveAttribute('aria-disabled', 'true');
      expect(btn).not.toHaveAttribute('disabled');
      const description = btn.getAttribute('aria-describedby');
      expect(description).toBeTruthy();
      expect(screen.getByText('Select a layer first')).toHaveAttribute('id', description);
      await user.tab();
      expect(btn).toHaveFocus();
    });

    it('does not fire onClick and exposes the reason as a pointer tooltip', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();
      render(
        <Button disabled disabledReason="Nothing selected" onClick={onClick}>
          Duplicate
        </Button>,
      );
      const btn = screen.getByRole('button');
      expect(btn).toHaveAttribute('title', 'Nothing selected');
      await user.click(btn);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('ignores the reason while the action is available', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();
      render(
        <Button disabledReason="Not now" onClick={onClick}>
          Export
        </Button>,
      );
      const btn = screen.getByRole('button');
      expect(btn).not.toHaveAttribute('aria-disabled');
      expect(btn).not.toHaveAttribute('title');
      expect(screen.queryByText('Not now')).toBeFalsy();
      await user.click(btn);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('merges an existing aria-describedby instead of replacing it', () => {
      render(
        <Button disabled disabledReason="Select a layer first" aria-describedby="hint">
          Align
        </Button>,
      );
      const describedBy = screen.getByRole('button').getAttribute('aria-describedby');
      expect(describedBy).toContain('hint');
      expect(describedBy?.split(' ').length).toBe(2);
    });
  });
});
