/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeSelect } from './NativeSelect';

afterEach(cleanup);

describe('NativeSelect', () => {
  it('uses the platform select element with grouped options', () => {
    render(
      <NativeSelect
        label="Format"
        defaultValue="svg"
        options={[{ value: 'png', label: 'PNG' }]}
        groups={[{ label: 'Vector', options: [{ value: 'svg', label: 'SVG' }] }]}
        description="Choose the exported file format."
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Format' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('svg');
    expect(screen.getByRole('option', { name: 'SVG' })).toBeInTheDocument();
    expect(screen.getByText('Choose the exported file format.')).toBeInTheDocument();
  });

  it('emits a value change and exposes invalid state', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <NativeSelect
        label="Format"
        value="png"
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'svg', label: 'SVG' },
        ]}
        onValueChange={onValueChange}
        error="Format is required"
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Format' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    await user.selectOptions(select, 'svg');
    expect(onValueChange).toHaveBeenCalledWith('svg');
  });
});
