/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
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
  restrictToOptions = false,
}: {
  onChange?: (value: string) => void;
  items?: ComboboxOption[];
  restrictToOptions?: boolean;
}) {
  const [value, setValue] = useState('');
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

  it('allows selecting an enabled option by keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComboboxFixture onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('Cherry');
  });
});
