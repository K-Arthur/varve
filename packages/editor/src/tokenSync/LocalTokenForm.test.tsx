// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type LocalTokenCandidate, LocalTokenForm } from './LocalTokenForm';

afterEach(cleanup);

async function chooseOption(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('option', { name: label }));
}

describe('LocalTokenForm', () => {
  it('requires an explicit type and creates a typed dimension with Enter', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<LocalTokenForm onCreate={onCreate} tokens={[]} />);

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    const path = screen.getByLabelText('Full token path');
    expect(path).toHaveFocus();
    await user.type(path, 'space.page.gutter');
    expect(screen.getByRole('combobox', { name: 'Token type' }).textContent).toContain(
      'Choose a type',
    );

    await user.click(screen.getByRole('combobox', { name: 'Token type' }));
    await chooseOption(user, 'Dimension');
    await user.type(screen.getByLabelText('Dimension value'), '1.5');
    await user.click(screen.getByRole('combobox', { name: 'Dimension unit' }));
    await chooseOption(user, 'rem');
    screen.getByLabelText('Dimension value').focus();
    await user.keyboard('{Enter}');

    expect(onCreate).toHaveBeenCalledWith({
      path: 'space.page.gutter',
      type: 'dimension',
      value: '1.5',
      unit: 'rem',
    });
    expect(screen.queryByRole('form', { name: 'Create local token' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    expect(screen.getByLabelText('Full token path')).toHaveValue('');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'Create local token' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create token' })).toHaveFocus();
  });

  it('offers only exact-type alias candidates and submits the full path', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const tokens: LocalTokenCandidate[] = [
      { path: 'color.brand.primary', type: 'color' },
      { path: 'spacing.small', type: 'number' },
      { path: 'spacing.large', type: 'number' },
      { path: 'font.body', type: 'fontFamily' },
    ];
    render(<LocalTokenForm onCreate={onCreate} tokens={tokens} />);

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await user.type(screen.getByLabelText('Full token path'), 'spacing.compact');
    await user.click(screen.getByRole('combobox', { name: 'Token type' }));
    await chooseOption(user, 'Number');
    await user.click(screen.getByRole('button', { name: 'Create as alias' }));
    expect(screen.queryByLabelText('Number value')).toBeNull();
    expect(screen.getByText('The value will come from the selected same-type token.')).toBeTruthy();
    await user.click(screen.getByRole('combobox', { name: 'Alias target' }));

    expect(screen.getByRole('option', { name: 'spacing.small' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'spacing.large' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'color.brand.primary' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'font.body' })).toBeNull();
    await chooseOption(user, 'spacing.small');
    await user.click(screen.getByRole('button', { name: 'Add token' }));

    expect(onCreate).toHaveBeenCalledWith({
      path: 'spacing.compact',
      type: 'number',
      value: '',
      reference: 'spacing.small',
    });
    expect(screen.queryByRole('form', { name: 'Create local token' })).toBeNull();
  });

  it('keeps the form and entered draft visible when creation throws', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => {
      throw new Error('That token path already exists. Choose a different path.');
    });
    render(<LocalTokenForm onCreate={onCreate} tokens={[]} />);

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await user.type(screen.getByLabelText('Full token path'), 'color.brand.primary');
    await user.click(screen.getByRole('combobox', { name: 'Token type' }));
    await chooseOption(user, 'Color');
    await user.type(screen.getByLabelText('Hex color value'), '#336699');
    await user.click(screen.getByRole('button', { name: 'Add token' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'That token path already exists. Choose a different path.',
    );
    expect(screen.getByRole('form', { name: 'Create local token' })).toBeTruthy();
    expect(screen.getByLabelText('Full token path')).toHaveValue('color.brand.primary');
    expect(screen.getByLabelText('Hex color value')).toHaveValue('#336699');
  });

  it('keeps intentional rem creation available while explaining that it is source-retained', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<LocalTokenForm onCreate={onCreate} tokens={[]} />);

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await user.type(screen.getByLabelText('Full token path'), 'space.page.gutter');
    await user.click(screen.getByRole('combobox', { name: 'Token type' }));
    await chooseOption(user, 'Dimension');
    await user.type(screen.getByLabelText('Dimension value'), '1.5');
    await user.click(screen.getByRole('combobox', { name: 'Dimension unit' }));
    await chooseOption(user, 'rem');

    expect(screen.getByText(/This rem dimension stays in the token source/)).toHaveTextContent(
      'cannot drive a length property until Varve has a document root font size',
    );
    await user.click(screen.getByRole('button', { name: 'Add token' }));

    expect(onCreate).toHaveBeenCalledWith({
      path: 'space.page.gutter',
      type: 'dimension',
      value: '1.5',
      unit: 'rem',
    });
    expect(screen.queryByRole('form', { name: 'Create local token' })).toBeNull();
  });

  it('explains that color values with none components need interpolation before binding', async () => {
    const user = userEvent.setup();
    render(<LocalTokenForm onCreate={vi.fn()} tokens={[]} />);

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await user.type(screen.getByLabelText('Full token path'), 'color.partial');
    await user.click(screen.getByRole('combobox', { name: 'Token type' }));
    await chooseOption(user, 'Color');
    fireEvent.change(screen.getByLabelText('Hex color value'), {
      target: { value: '{"colorSpace":"srgb","components":[0.2,"none",0.8]}' },
    });

    expect(screen.getByText(/This color stays in the token source/)).toHaveTextContent(
      '“none” component needs an interpolation context before it can drive artwork',
    );
  });

  it('shows the retained-only reason when aliasing a rem dimension', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <LocalTokenForm
        onCreate={onCreate}
        tokens={[
          { path: 'space.page.gutter', type: 'dimension', value: { value: 1.5, unit: 'rem' } },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await user.type(screen.getByLabelText('Full token path'), 'space.layout.gutter');
    await user.click(screen.getByRole('combobox', { name: 'Token type' }));
    await chooseOption(user, 'Dimension');
    await user.click(screen.getByRole('button', { name: 'Create as alias' }));
    await user.click(screen.getByRole('combobox', { name: 'Alias target' }));
    await chooseOption(user, 'space.page.gutter');

    expect(screen.getByText(/This rem dimension stays in the token source/)).toHaveTextContent(
      'cannot drive a length property until Varve has a document root font size',
    );
    await user.click(screen.getByRole('button', { name: 'Add token' }));
    expect(onCreate).toHaveBeenCalledWith({
      path: 'space.layout.gutter',
      type: 'dimension',
      value: '',
      unit: 'px',
      reference: 'space.page.gutter',
    });
  });

  it('handles Escape without propagating it to the containing dialog', async () => {
    const user = userEvent.setup();
    const onParentKeyDown = vi.fn();
    render(
      <dialog open aria-label="Token editor dialog" onKeyDown={onParentKeyDown}>
        <LocalTokenForm onCreate={vi.fn()} tokens={[]} />
      </dialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await user.keyboard('{Escape}');

    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(screen.queryByRole('form', { name: 'Create local token' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create token' })).toHaveFocus();
  });
});
