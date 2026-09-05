// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  function installClipboard(writeText: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  }

  it('renders with aria-label', () => {
    const { container } = render(<CopyButton value="test-value" label="Width" />);
    const btn = container.querySelector('button');
    expect(btn?.getAttribute('aria-label')).toBe('Copy Width');
  });

  it('copies value to clipboard on click', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard(writeText);
    const { container } = render(<CopyButton value="200px" label="Width" />);
    (container.querySelector('button') as HTMLElement).click();
    expect(writeText).toHaveBeenCalledWith('200px');
  });

  it('suppresses rapid duplicate activation while the clipboard promise is pending', async () => {
    let resolveCopy: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    installClipboard(writeText);
    render(<CopyButton value="200px" label="Width" />);
    const button = screen.getByRole('button', { name: 'Copy Width' });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolveCopy?.();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied Width' })).toBeTruthy());
  });

  it('announces clipboard failure and returns to the idle affordance', async () => {
    installClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    render(<CopyButton value="secret" label="token" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy failed for token' })).toBeTruthy(),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Failed to copy to clipboard');
  });
});
