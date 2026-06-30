import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = `
    .strata-btn { min-height: 44px; min-width: 44px; }
  `;
  document.head.appendChild(style);
});

afterEach(cleanup);

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('defaults to primary variant', () => {
    render(<Button>Primary</Button>);
    expect(screen.getByRole('button').className).toContain('strata-btn--primary');
  });

  it('renders all variants', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;
    for (const variant of variants) {
      const { container } = render(<Button variant={variant}>{variant}</Button>);
      expect(container.querySelector(`.strata-btn--${variant}`)).toBeTruthy();
    }
  });

  it('shows spinner and aria-busy when loading', () => {
    render(<Button loading>Processing</Button>);
    const btn = screen.getByRole('button');
    expect(btn.querySelector('.strata-btn__spinner')).toBeTruthy();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps children in DOM when loading (hidden visually)', () => {
    render(<Button loading>Processing</Button>);
    const content = screen.getByRole('button').querySelector('.strata-btn__content');
    expect(content?.textContent).toBe('Processing');
  });

  it('sets aria-disabled when loading', () => {
    render(<Button loading>Processing</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toHaveAttribute('disabled');
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
      <Button variant="danger" confirmLabel="Delete?" onClick={onClick}>
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
});
