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
    const group = screen.getByRole('radiogroup', { name: 'Choose' });
    expect(group).toBeInTheDocument();
    expect(group.tagName).toBe('FIELDSET');
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

  it('keeps controlled selection authoritative when the callback does not rerender', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioGroup label="Choose" value="a" options={options} onChange={onChange} />);

    await user.click(screen.getByLabelText('Beta'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Alpha')).toBeChecked();
    expect(screen.getByLabelText('Beta')).not.toBeChecked();
  });

  it('associates option descriptions with their radio inputs', () => {
    render(
      <RadioGroup
        label="Choose"
        value="a"
        options={[{ value: 'a', label: 'Alpha', description: 'The first choice' }]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAccessibleDescription(
      'The first choice',
    );
  });

  it('marks one enabled radio as required for form validation', () => {
    render(
      <RadioGroup
        label="Choose"
        defaultValue="b"
        required
        options={[{ value: 'a', label: 'Alpha', disabled: true }, ...options.slice(1)]}
      />,
    );
    expect(screen.getByLabelText('Alpha')).not.toBeRequired();
    expect(screen.getByLabelText('Beta')).toBeRequired();
    expect(screen.getByLabelText('Gamma')).not.toBeRequired();
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
