/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Select, type SelectOption } from './Select';

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

const fruitOptions: SelectOption[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'date', label: 'Date' },
];

function SelectFixture({
  options = fruitOptions,
  placeholder,
  searchable,
  error,
  initialValue = '',
}: {
  options?: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  error?: string;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <Select
      options={options}
      value={value}
      onChange={setValue}
      label="Fruit"
      placeholder={placeholder}
      searchable={searchable}
      error={error}
    />
  );
}

describe('Select', () => {
  it('renders trigger with placeholder text', () => {
    render(<SelectFixture placeholder="Choose a fruit" />);
    expect(screen.getByText('Choose a fruit')).toBeInTheDocument();
  });

  it('opens listbox on click', async () => {
    const user = userEvent.setup();
    render(<SelectFixture />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBe(fruitOptions.length);
  });

  it('portals listbox to document.body when open', async () => {
    const user = userEvent.setup();
    render(<SelectFixture />);
    await user.click(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox');
    expect(listbox.parentElement?.parentElement).toBe(document.body);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<SelectFixture />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selects option on Enter', async () => {
    const user = userEvent.setup();
    render(<SelectFixture />);
    await user.click(screen.getByRole('combobox'));

    // First option (Apple) is highlighted by default
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText('Apple')).toBeInTheDocument();
  });

  it('shows selected option with checkmark', async () => {
    const user = userEvent.setup();
    render(<SelectFixture initialValue="banana" />);
    await user.click(screen.getByRole('combobox'));

    const options = screen.getAllByRole('option');
    const bananaOption = options[1];
    expect(bananaOption).toHaveAttribute('aria-selected', 'true');
  });

  it('sets correct aria attributes (expanded, controls, activedescendant)', async () => {
    const user = userEvent.setup();
    render(<SelectFixture />);
    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveAttribute('aria-expanded', 'false');

    await user.click(combobox);
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    expect(combobox).toHaveAttribute('aria-controls');
    expect(combobox).toHaveAttribute('aria-activedescendant');
  });

  it('navigates options with ArrowDown', async () => {
    const user = userEvent.setup();
    render(<SelectFixture />);
    await user.click(screen.getByRole('combobox'));

    const combobox = screen.getByRole('combobox');
    const options = screen.getAllByRole('option');

    expect(combobox.getAttribute('aria-activedescendant')).toBe(options[0]?.getAttribute('id'));

    await user.keyboard('{ArrowDown}');
    expect(combobox.getAttribute('aria-activedescendant')).toBe(options[1]?.getAttribute('id'));

    await user.keyboard('{ArrowDown}');
    expect(combobox.getAttribute('aria-activedescendant')).toBe(options[2]?.getAttribute('id'));
  });

  it('shows error message and sets aria-invalid', () => {
    render(<SelectFixture error="Please select a fruit" />);
    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Please select a fruit')).toBeInTheDocument();
    expect(screen.getByText('Please select a fruit')).toHaveAttribute('role', 'alert');
  });

  // Regression: keyboard navigation used to step onto disabled options, so a
  // keyboard user could highlight (and activate) an option a mouse user
  // cannot select. WCAG 2.1.1 / 4.1.2.
  describe('disabled options', () => {
    const withDisabled: SelectOption[] = [
      { value: 'apple', label: 'Apple' },
      { value: 'banana', label: 'Banana', disabled: true },
      { value: 'cherry', label: 'Cherry' },
    ];

    it('ArrowDown skips a disabled option', async () => {
      const user = userEvent.setup();
      render(<SelectFixture options={withDisabled} />);
      await user.click(screen.getByRole('combobox'));

      const combobox = screen.getByRole('combobox');
      const options = screen.getAllByRole('option');
      expect(combobox.getAttribute('aria-activedescendant')).toBe(options[0]?.getAttribute('id'));

      await user.keyboard('{ArrowDown}');
      // Banana (index 1) is disabled — the highlight must land on Cherry.
      expect(combobox.getAttribute('aria-activedescendant')).toBe(options[2]?.getAttribute('id'));
    });

    it('ArrowUp skips a disabled option', async () => {
      const user = userEvent.setup();
      render(<SelectFixture options={withDisabled} initialValue="cherry" />);
      await user.click(screen.getByRole('combobox'));

      const combobox = screen.getByRole('combobox');
      const options = screen.getAllByRole('option');
      await user.keyboard('{ArrowUp}');
      expect(combobox.getAttribute('aria-activedescendant')).toBe(options[0]?.getAttribute('id'));
    });

    it('never opens with a disabled option active', async () => {
      const user = userEvent.setup();
      const disabledFirst: SelectOption[] = [
        { value: 'apple', label: 'Apple', disabled: true },
        { value: 'banana', label: 'Banana' },
      ];
      render(<SelectFixture options={disabledFirst} />);
      await user.click(screen.getByRole('combobox'));

      const options = screen.getAllByRole('option');
      expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe(
        options[1]?.getAttribute('id'),
      );
    });

    it('Enter on a disabled option neither selects nor closes', async () => {
      const user = userEvent.setup();
      // Every option disabled: navigation cannot escape to a selectable one,
      // so this asserts the guard inside selectHighlighted rather than the
      // navigation skipping above.
      const allDisabled: SelectOption[] = [
        { value: 'apple', label: 'Apple', disabled: true },
        { value: 'banana', label: 'Banana', disabled: true },
      ];
      render(<SelectFixture options={allDisabled} />);
      await user.click(screen.getByRole('combobox'));

      await user.keyboard('{Enter}');
      // Previously the listbox closed (consuming the activation) even though
      // nothing could be selected.
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByText('Select...')).toBeInTheDocument();
    });
  });

  it('searchable filter input owns the active descendant and has a name', async () => {
    const user = userEvent.setup();
    const many: SelectOption[] = Array.from({ length: 12 }, (_, i) => ({
      value: `v${i}`,
      label: `Option ${i}`,
    }));
    render(<SelectFixture options={many} searchable />);
    await user.click(screen.getByRole('combobox'));

    // Focus moves to the filter input, so that input — not the trigger — must
    // expose the highlighted option to assistive technology.
    const search = screen.getByRole('searchbox', { name: /filter fruit/i });
    expect(search).toHaveAttribute('aria-activedescendant');
    const before = search.getAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}');
    expect(search.getAttribute('aria-activedescendant')).not.toBe(before);
  });
});

describe('Select — searchable', () => {
  const manyOptions: SelectOption[] = Array.from({ length: 15 }, (_, i) => ({
    value: `opt${i + 1}`,
    label: `Option ${i + 1}`,
  }));

  it('shows search input when searchable and > 10 options', async () => {
    const user = userEvent.setup();
    render(<SelectFixture options={manyOptions} searchable />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('filters options when typing in search input', async () => {
    const user = userEvent.setup();
    render(<SelectFixture options={manyOptions} searchable />);
    await user.click(screen.getByRole('combobox'));

    const searchInput = screen.getByRole('searchbox');
    await user.type(searchInput, '11');

    const options = screen.getAllByRole('option');
    expect(options.length).toBe(1);
    expect(options[0]).toHaveTextContent('Option 11');
  });
});
