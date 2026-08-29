import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog, confirmDialog } from './PromptDialog';

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
