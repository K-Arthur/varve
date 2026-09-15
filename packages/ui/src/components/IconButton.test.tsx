import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton loading', () => {
  it('prevents duplicate clicks and keeps the action name available', () => {
    vi.useFakeTimers();
    try {
      const onClick = vi.fn();
      render(<IconButton icon="RefreshCw" label="Refresh" loading onClick={onClick} />);

      const button = screen.getByRole('button', { name: 'Refresh, loading' });
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button.querySelector('.varve-spinner')).toBeFalsy();
      act(() => vi.advanceTimersByTime(150));
      expect(button.querySelector('.varve-spinner')).toBeTruthy();
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
