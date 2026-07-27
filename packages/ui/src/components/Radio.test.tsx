import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Radio, RadioGroup } from './Radio';

describe('Radio', () => {
  it('renders with label', () => {
    render(<Radio label="Option A" name="test" />);
    expect(screen.getByLabelText('Option A')).toBeInTheDocument();
  });

  it('is a radio input', () => {
    render(<Radio label="Option" name="test" />);
    expect(screen.getByRole('radio')).toBeInTheDocument();
  });
});

describe('RadioGroup', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ];

  it('renders radiogroup with label', () => {
    render(<RadioGroup label="Choose" value="a" options={options} onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('checks the selected option', () => {
    render(<RadioGroup label="Choose" value="b" options={options} onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });

  it('calls onChange when option clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioGroup label="Choose" value="a" options={options} onChange={onChange} />);
    await user.click(screen.getByLabelText('Beta'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('supports disabled state', () => {
    render(<RadioGroup label="Choose" value="a" options={options} onChange={() => {}} disabled />);
    const radios = screen.getAllByRole('radio');
    for (const r of radios) {
      expect(r).toBeDisabled();
    }
  });
});
