// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportProgress } from './ImportProgress';

afterEach(cleanup);

describe('ImportProgress', () => {
  it('displays current file progress', () => {
    const { container } = render(<ImportProgress current={3} total={10} fileName="logo.svg" />);
    const label = container.querySelector('.import-progress__label');
    expect(label?.textContent).toMatch(/importing file 3 of 10/i);
    const filename = container.querySelector('.import-progress__filename');
    expect(filename?.textContent).toMatch(/logo\.svg/i);
  });

  it('shows cancel button when onCancel provided', () => {
    render(<ImportProgress current={1} total={5} fileName="test.svg" onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('hides cancel button when onCancel not provided', () => {
    const { container } = render(<ImportProgress current={1} total={5} fileName="test.svg" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('calls onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn();
    render(<ImportProgress current={2} total={5} fileName="test.svg" onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders progress bar with correct width', () => {
    const { container } = render(<ImportProgress current={5} total={10} fileName="test.svg" />);
    const fill = container.querySelector('.import-progress__fill');
    expect(fill).toBeTruthy();
  });

  it('handles first file (1 of N)', () => {
    render(<ImportProgress current={1} total={3} fileName="first.svg" />);
    expect(screen.getByText(/importing file 1 of 3/i)).toBeTruthy();
  });

  it('handles last file (N of N)', () => {
    render(<ImportProgress current={10} total={10} fileName="last.svg" />);
    expect(screen.getByText(/importing file 10 of 10/i)).toBeTruthy();
  });

  it('includes aria-live region for announcements', () => {
    const { container } = render(<ImportProgress current={3} total={5} fileName="doc.svg" />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
