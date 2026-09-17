/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Combobox, type ComboboxOption } from './Combobox';

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

const options: ComboboxOption[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana', disabled: true },
  { value: 'cherry', label: 'Cherry' },
];

function ComboboxFixture({
  onChange = vi.fn(),
  items = options,
  initialValue = '',
  restrictToOptions = false,
}: {
  onChange?: (value: string) => void;
  items?: ComboboxOption[];
  initialValue?: string;
  restrictToOptions?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <Combobox
      label="Fruit"
      value={value}
      options={items}
      restrictToOptions={restrictToOptions}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe('Combobox disabled options', () => {
  it('ArrowDown skips a disabled option', async () => {
    const user = userEvent.setup();
    render(<ComboboxFixture />);
    const input = screen.getByRole('combobox');
    await user.click(input);

    const rendered = screen.getAllByRole('option');
    // Highlight starts on Apple; Banana is disabled, so ArrowDown must land on
    // Cherry rather than making a disabled option the active descendant.
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(rendered[2]?.getAttribute('id'));
  });

  it('Enter never commits a disabled option typed as free text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComboboxFixture onChange={onChange} restrictToOptions />);

    const input = screen.getByRole('combobox');
    await user.click(input);
    // Typing the disabled option's exact label routes through the free-text
    // commit path. Previously that committed the disabled option even though a
    // mouse user cannot select it (WCAG 2.1.1 / 4.1.2 consistency).
    await user.type(input, 'Banana');
    await user.keyboard('{Enter}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('mouse selection still ignores disabled options', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComboboxFixture onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    const disabled = screen.getAllByRole('option')[1];
    if (!disabled) throw new Error('expected a disabled option');
    await user.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the stable option value on pointer selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComboboxFixture onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Cherry' }));

    expect(onChange).toHaveBeenCalledWith('cherry');
    expect(screen.getByRole('combobox')).toHaveValue('Cherry');
  });

  it('allows selecting an enabled option by keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComboboxFixture onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('cherry');
  });

  it('renders the option label while preserving the committed value id', async () => {
    render(<ComboboxFixture initialValue="apple" />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('Apple');

    await userEvent.setup().click(input);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    const selected = screen.getByRole('option', { name: 'Apple' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
  });

  it('Escape restores an unfinished query without committing it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComboboxFixture onChange={onChange} initialValue="apple" />);
    const input = screen.getByRole('combobox');

    await user.click(input);
    await user.clear(input);
    await user.type(input, 'Che');
    await user.keyboard('{ArrowDown}{Escape}');

    expect(input).toHaveValue('Apple');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps duplicate labels navigable by their distinct values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComboboxFixture
        onChange={onChange}
        restrictToOptions
        items={[
          { value: 'system-regular', label: 'System' },
          { value: 'system-bold', label: 'System' },
        ]}
      />,
    );
    const input = screen.getByRole('combobox');
    await user.type(input, 'System');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('system-bold');
  });

  it('exposes loading and empty states through the open listbox', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Combobox
        label="Font"
        value=""
        onChange={() => {}}
        options={[]}
        loading
        description="Choose a document font"
      />,
    );
    const input = screen.getByRole('combobox');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    await user.click(input);
    expect(within(screen.getByRole('listbox')).getByText('Loading options…')).toBeVisible();

    rerender(
      <Combobox
        label="Font"
        value=""
        onChange={() => {}}
        options={[]}
        noResultsLabel="No fonts found"
      />,
    );
    expect(within(screen.getByRole('listbox')).getByText('No fonts found')).toBeVisible();
  });
});
