import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Name" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('renders placeholder', () => {
    render(<Input label="Name" placeholder="Enter name" value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText('Enter name')).toBeInTheDocument();
  });

  it('calls onChange on input', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Input label="Name" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText('Name'), 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('shows error message with role alert', () => {
    render(<Input label="Name" value="" onChange={() => {}} error="Required" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('shows hint text', () => {
    render(<Input label="Name" value="" onChange={() => {}} hint="Max 50 chars" />);
    expect(screen.getByText('Max 50 chars')).toBeInTheDocument();
  });

  it('sets aria-invalid when error present', () => {
    render(<Input label="Name" value="" onChange={() => {}} error="Invalid" />);
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders prefix and suffix', () => {
    render(<Input label="Name" value="" onChange={() => {}} prefix="$" suffix="px" />);
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByText('px')).toBeInTheDocument();
  });

  it('disables input when disabled', () => {
    render(<Input label="Name" value="" onChange={() => {}} disabled />);
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });
});
