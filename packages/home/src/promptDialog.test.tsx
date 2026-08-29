import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PromptDialogProvider, promptDialog } from './promptDialog';

describe('PromptDialogProvider', () => {
  it('has an accessible name on the text input', async () => {
    render(<PromptDialogProvider />);
    promptDialog('Rename preset', 'My preset');

    const input = await screen.findByRole('textbox', { name: 'Rename preset' });
    expect(input).toHaveValue('My preset');
  });

  it('confirms with the typed value on Enter', async () => {
    render(<PromptDialogProvider />);
    const promise = promptDialog('Rename preset', 'My preset');

    const input = await screen.findByRole('textbox', { name: 'Rename preset' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');

    expect(await promise).toBe('Renamed');
  });

  it('renders Cancel before Confirm', async () => {
    render(<PromptDialogProvider />);
    promptDialog('Rename preset', 'My preset');

    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Confirm']);
  });

  it('cancel button resolves to null', async () => {
    render(<PromptDialogProvider />);
    const promise = promptDialog('Rename preset', 'My preset');

    await screen.findByRole('textbox', { name: 'Rename preset' });
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(await promise).toBeNull();
  });
});
