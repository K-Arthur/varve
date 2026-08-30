// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { EffectStudioDialogHost } from './EffectStudioDialogHost';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

function DialogTrigger() {
  const { openEffectStudioDialog } = useEditor();
  return (
    <button type="button" onClick={openEffectStudioDialog}>
      Launch Effect Studio
    </button>
  );
}

describe('EffectStudioDialogHost', () => {
  it('opens and closes over the live primary editor without a secondary window', async () => {
    render(
      <EditorProvider>
        <DialogTrigger />
        <EffectStudioDialogHost />
      </EditorProvider>,
    );

    const dialog = screen.getByTestId('effect-studio-dialog');
    expect(dialog).not.toHaveAttribute('open');

    fireEvent.click(screen.getByRole('button', { name: 'Launch Effect Studio' }));
    await waitFor(() => expect(dialog).toHaveAttribute('open'));
    expect(screen.getByText('Select an object')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
  });
});
