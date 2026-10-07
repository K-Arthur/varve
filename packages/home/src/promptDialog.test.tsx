import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PromptDialogProvider, promptDialog } from './promptDialog';

async function openPrompt() {
  let result!: Promise<string | null>;
  // The imperative request schedules React state outside a user event.
  // Flush its commit and showModal effect before querying accessibility.
  await act(async () => {
    result = promptDialog('Rename preset', 'My preset');
  });
  return { result };
}

describe('PromptDialogProvider', () => {
  it('has an accessible name on the text input', async () => {
    render(<PromptDialogProvider />);
    await openPrompt();

    const input = await screen.findByRole('textbox', { name: 'Rename preset' });
    expect(input).toHaveValue('My preset');
  });

  it('confirms with the typed value on Enter', async () => {
    render(<PromptDialogProvider />);
    const { result: promise } = await openPrompt();

    const input = await screen.findByRole('textbox', { name: 'Rename preset' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');

    expect(await promise).toBe('Renamed');
  });

  it('renders Cancel before Confirm', async () => {
    render(<PromptDialogProvider />);
    await openPrompt();

    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Confirm']);
  });

  it('cancel button resolves to null', async () => {
    render(<PromptDialogProvider />);
    const { result: promise } = await openPrompt();

    await screen.findByRole('textbox', { name: 'Rename preset' });
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(await promise).toBeNull();
  });
});
