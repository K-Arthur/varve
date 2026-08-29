import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog, confirmDialog, PromptDialog, promptDialog } from './PromptDialog';

describe('PromptDialog', () => {
  it('has an accessible name on the text input', async () => {
    render(<PromptDialog />);
    promptDialog('Rename page', 'Page 1');

    const input = await screen.findByRole('textbox', { name: 'Rename page' });
    expect(input).toHaveValue('Page 1');
  });

  it('confirms with the typed value on Enter', async () => {
    render(<PromptDialog />);
    const promise = promptDialog('Rename page', 'Page 1');

    const input = await screen.findByRole('textbox', { name: 'Rename page' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Cover{Enter}');

    expect(await promise).toBe('Cover');
  });

  it('renders Cancel before Confirm, matching ConfirmDialog', async () => {
    render(<PromptDialog />);
    promptDialog('Rename page', 'Page 1');

    await screen.findByRole('textbox', { name: 'Rename page' });
    // Scoped to the actions row: Dialog's header also renders its own
    // "Close dialog" button, which isn't part of this ordering convention.
    const actions = document.querySelector('.varve-dialog__actions');
    const buttons = actions?.querySelectorAll('button') ?? [];
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(['Cancel', 'Confirm']);
  });

  it('cancel button resolves to null', async () => {
    render(<PromptDialog />);
    const promise = promptDialog('Rename page', 'Page 1');

    await screen.findByRole('textbox', { name: 'Rename page' });
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(await promise).toBeNull();
  });
});

describe('ConfirmDialog', () => {
  it('renders with role="alertdialog" when triggered', async () => {
    render(<ConfirmDialog />);

    confirmDialog('Delete item?', 'This action cannot be undone.', {
      confirmLabel: 'Delete',
      variant: 'danger',
    });

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeTruthy();
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
  });

  it('shows title and description', async () => {
    render(<ConfirmDialog />);

    confirmDialog('Are you sure?', 'This will delete all data.');

    const heading = await screen.findByText('Are you sure?');
    expect(heading).toBeTruthy();

    const desc = screen.getByText('This will delete all data.');
    expect(desc).toBeTruthy();
  });

  it('prevents backdrop-click dismissal', async () => {
    render(<ConfirmDialog />);

    confirmDialog('Confirm?', 'Description');

    const dialog = await screen.findByRole('alertdialog');

    // Click on the dialog backdrop (the dialog element itself)
    await userEvent.click(dialog);

    // The dialog should still be visible
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('cancel button resolves to false', async () => {
    render(<ConfirmDialog />);

    const promise = confirmDialog('Title', 'Desc');

    await screen.findByRole('alertdialog');

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    await userEvent.click(cancelBtn);

    const result = await promise;
    expect(result).toBe(false);
  });

  it('confirm button resolves to true', async () => {
    render(<ConfirmDialog />);

    const promise = confirmDialog('Title', 'Desc', { confirmLabel: 'OK' });

    await screen.findByRole('alertdialog');

    const confirmBtn = screen.getByRole('button', { name: /ok/i });
    await userEvent.click(confirmBtn);

    const result = await promise;
    expect(result).toBe(true);
  });
});
