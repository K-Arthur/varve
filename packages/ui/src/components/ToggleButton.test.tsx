import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToggleButton } from './ToggleButton';

describe('ToggleButton', () => {
  it('renders with accessible label', () => {
    render(<ToggleButton pressed={false} onPressedChange={() => {}} label="Bold" />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
  });

  it('reflects pressed state via aria-pressed', () => {
    render(<ToggleButton pressed onPressedChange={() => {}} label="Bold" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles pressed state on click', async () => {
    const onPressedChange = vi.fn();
    const user = userEvent.setup();
    render(<ToggleButton pressed={false} onPressedChange={onPressedChange} label="Bold" />);
    await user.click(screen.getByRole('button'));
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it('does not fire when disabled', async () => {
    const onPressedChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ToggleButton pressed={false} onPressedChange={onPressedChange} label="Bold" disabled />,
    );
    await user.click(screen.getByRole('button'));
    expect(onPressedChange).not.toHaveBeenCalled();
  });
});
