/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiSelect } from './MultiSelect';
import type { SelectOption } from './Select';

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

const options: SelectOption[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana', disabled: true, disabledReason: 'Not available' },
  { value: 'cherry', label: 'Cherry' },
];

function Fixture({ initialValues = [] }: { initialValues?: string[] }) {
  const [values, setValues] = useState(initialValues);
  return <MultiSelect label="Fruit" options={options} values={values} onValuesChange={setValues} />;
}

describe('MultiSelect', () => {
  it('uses a compact summary and toggles multiple values without closing', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole('combobox', { name: 'Fruit' });
    expect(trigger).toHaveTextContent('Select options');

    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Apple' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Apple');

    await user.click(screen.getByRole('option', { name: 'Cherry' }));
    expect(trigger).toHaveTextContent('2 selected');
    expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute('aria-selected', 'true');
  });

  it('skips disabled options during keyboard navigation and exposes their reason', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole('combobox', { name: 'Fruit' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');

    expect(trigger).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Cherry' }).getAttribute('id'),
    );
    expect(screen.getByText('Not available')).toBeInTheDocument();
  });

  it('keeps selected values when search hides them', async () => {
    const user = userEvent.setup();
    const manyOptions = Array.from({ length: 12 }, (_, index) => ({
      value: `option-${index}`,
      label: `Option ${index}`,
    }));
    function SearchFixture() {
      const [values, setValues] = useState(['option-0']);
      return (
        <MultiSelect
          label="Options"
          options={manyOptions}
          values={values}
          onValuesChange={setValues}
          searchable
        />
      );
    }

    render(<SearchFixture />);
    await user.click(screen.getByRole('combobox', { name: 'Options' }));
    await user.type(screen.getByRole('searchbox'), '11');
    await user.click(screen.getByRole('option', { name: 'Option 11' }));

    expect(screen.getByRole('combobox', { name: 'Options' })).toHaveTextContent('2 selected');
  });

  it('does not add values beyond maxSelected and announces the limit', async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect
        label="Fruit"
        options={options}
        defaultValues={['apple']}
        maxSelected={1}
        onValuesChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Fruit' }));
    await user.click(screen.getByRole('option', { name: 'Cherry' }));

    expect(screen.getByRole('combobox', { name: 'Fruit' })).toHaveTextContent('Apple');
    expect(screen.getByText('Selection limit reached')).toBeInTheDocument();
  });

  it('retains stale selections and wires helper/error text to the trigger', () => {
    render(
      <MultiSelect
        label="Profiles"
        values={['removed']}
        options={[{ value: 'current', label: 'Current' }]}
        description="Profiles are stored with the document."
        error="Choose a compatible profile"
        onValuesChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Profiles' });
    expect(trigger).toHaveTextContent('Unavailable selection');
    expect(screen.getByText('Some selected values are unavailable')).toBeInTheDocument();
    expect(trigger.getAttribute('aria-describedby')?.split(' ')).toHaveLength(3);
  });
});
