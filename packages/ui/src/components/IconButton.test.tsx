import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton loading', () => {
  it('prevents duplicate clicks and keeps the action name available', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<IconButton icon="RefreshCw" label="Refresh" loading onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Refresh, loading' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button.querySelector('.varve-spinner')).toBeTruthy();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
