import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Radio, RadioCard, RadioGroup } from './Radio';

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

  it('supports an uncontrolled default value', async () => {
    const user = userEvent.setup();
    render(<RadioGroup label="Choose" defaultValue="a" options={options} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toBeChecked();
    await user.click(radios[2]!);
    expect(radios[2]).toBeChecked();
  });

  it('connects descriptions and errors to the group', () => {
    render(
      <RadioGroup
        label="Choose"
        value="a"
        options={[{ value: 'a', label: 'Alpha', description: 'The first choice' }]}
        description="Select one option."
        error="A choice is required."
      />,
    );
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAccessibleDescription('Select one option. A choice is required.');
    expect(screen.getByRole('alert')).toHaveTextContent('A choice is required.');
  });

  it('provides a card composition with a unique input id', () => {
    render(<RadioCard name="profile" value="fast" label="Fast" />);
    const radio = screen.getByRole('radio');
    expect(radio).toHaveAttribute('id');
    expect(screen.getByLabelText('Fast')).toBe(radio);
  });
});
