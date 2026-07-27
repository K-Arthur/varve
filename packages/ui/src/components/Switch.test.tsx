import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

describe('Switch', () => {
  it('renders with label', () => {
    render(<Switch label="Enable" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Enable' })).toBeInTheDocument();
  });

  it('reflects checked state via aria-checked', () => {
    render(<Switch label="Enable" checked onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch label="Enable" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalled();
  });

  it('disables when disabled', () => {
    render(<Switch label="Enable" checked={false} onChange={() => {}} disabled />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
