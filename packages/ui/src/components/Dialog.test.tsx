/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertDialog, Dialog } from './Dialog';
import { NestedOverlayProvider } from './NestedOverlayContext';
import { Select } from './Select';

beforeEach(() => {
  // jsdom implements neither of these; Dialog and the listbox need them.
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
  Element.prototype.scrollIntoView = () => {};
});

describe('Dialog', () => {
  it('renders when open with title and content', () => {
    const { container } = render(
      <Dialog open title="Hello" onClose={vi.fn()}>
        <p>content</p>
      </Dialog>,
    );
    expect(container.textContent).toContain('Hello');
    expect(container.textContent).toContain('content');
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open title="Hello" onClose={onClose}>
        <p>content</p>
      </Dialog>,
    );
    const closeBtn = container.querySelector('.varve-dialog__close') as HTMLButtonElement;
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not mount expensive dialog content while closed', () => {
    const mounted = vi.fn();
    function ExpensiveContent() {
      mounted();
      return <p>expensive content</p>;
    }

    const { container } = render(
      <Dialog open={false} title="Hidden" onClose={vi.fn()}>
        <ExpensiveContent />
      </Dialog>,
    );

    expect(container.querySelector('dialog')).not.toBeNull();
    expect(mounted).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('expensive content');
  });

  // Regression: NestedOverlayProvider exposed a boolean snapshot captured at
  // its last render, so the Dialog still saw "no nested overlay" after a Select
  // opened and closed itself on the same Escape that dismissed the dropdown.
  it('does not close when Escape dismisses a nested Select', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    function Fixture() {
      return (
        <NestedOverlayProvider>
          <Dialog open title="Settings" onClose={onClose}>
            <Select
              label="Theme"
              value=""
              onChange={() => {}}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Dialog>
        </NestedOverlayProvider>
      );
    }

    render(<Fixture />);

    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // The dropdown closes; the dialog stays open.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes on Escape when no nested overlay is open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <NestedOverlayProvider>
        <Dialog open title="Settings" onClose={onClose}>
          <button type="button">focusable</button>
        </Dialog>
      </NestedOverlayProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'focusable' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  // Regression: `...rest` was spread after the internal handlers, so a consumer
  // onKeyDown replaced Escape dismissal instead of composing with it.
  it('composes a consumer onKeyDown with internal Escape dismissal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <Dialog open title="Settings" onClose={onClose} onKeyDown={onKeyDown}>
        <button type="button">focusable</button>
      </Dialog>,
    );

    await user.click(screen.getByRole('button', { name: 'focusable' }));
    await user.keyboard('{Escape}');

    expect(onKeyDown).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('dismisses when the press and release both happen on the backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open title="Settings" onClose={onClose}>
        <p>content</p>
      </Dialog>,
    );
    const dialog = container.querySelector('dialog') as HTMLDialogElement;

    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(dialog);
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledOnce();
  });

  // Regression: a press that begins inside the dialog and is released over
  // the backdrop (text selection, a drag past the edge) dispatches its click
  // on the dialog element — the press/release common ancestor. Treating that
  // as a backdrop click closed the dialog mid-interaction.
  it('does not dismiss when a press inside the content is released on the backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open title="Settings" onClose={onClose}>
        <input aria-label="field" />
      </Dialog>,
    );
    const dialog = container.querySelector('dialog') as HTMLDialogElement;

    fireEvent.pointerDown(screen.getByLabelText('field'));
    fireEvent.pointerUp(dialog);
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not dismiss when a press on the backdrop is released inside the content', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open title="Settings" onClose={onClose}>
        <input aria-label="field" />
      </Dialog>,
    );
    const dialog = container.querySelector('dialog') as HTMLDialogElement;

    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(screen.getByLabelText('field'));
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears a pending backdrop press when the pointer is cancelled', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open title="Settings" onClose={onClose}>
        <p>content</p>
      </Dialog>,
    );
    const dialog = container.querySelector('dialog') as HTMLDialogElement;

    fireEvent.pointerDown(dialog);
    fireEvent.pointerCancel(dialog);
    fireEvent.pointerUp(dialog);
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  // Regression: only Settings and EffectStudio wrapped their Dialog in a
  // NestedOverlayProvider, so every other dialog closed on the same Escape
  // that dismissed a nested Select. Escape now stops at the layer it closes.
  it('does not close when Escape dismisses a nested Select without a provider', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <Dialog open title="Export" onClose={onClose}>
        <Select
          label="Units"
          value=""
          onChange={() => {}}
          options={[
            { value: 'px', label: 'Pixels' },
            { value: 'pt', label: 'Points' },
          ]}
        />
      </Dialog>,
    );

    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // A context menu item that opened a dialog unmounts when the menu closes,
  // so native close() has no invoker to restore focus to and the browser
  // leaves focus on <body>. A surface that owns a stable hierarchy marks it
  // with data-dialog-focus-fallback.
  it('focuses the marked fallback when the invoker is gone at close', () => {
    const fallback = document.createElement('div');
    fallback.setAttribute('data-dialog-focus-fallback', '');
    fallback.tabIndex = 0;
    document.body.appendChild(fallback);

    function Fixture() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onClose={() => setOpen(false)} title="Batch Rename">
          <button type="button">focusable</button>
        </Dialog>
      );
    }

    render(<Fixture />);
    const inside = screen.getByRole('button', { name: 'focusable' });
    inside.focus();
    expect(inside).toHaveFocus();
    // The real failure mode: nothing holds focus when the dialog closes.
    inside.blur();

    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(fallback).toHaveFocus();
    fallback.remove();
  });
});

describe('AlertDialog', () => {
  it('renders title and description', () => {
    const { container } = render(
      <AlertDialog
        open
        title="Delete?"
        description="Are you sure?"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        variant="destructive"
      />,
    );
    expect(container.textContent).toContain('Delete?');
    expect(container.textContent).toContain('Are you sure?');
  });

  it('calls onConfirm when confirm clicked', () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <AlertDialog
        open
        title="Delete?"
        description="Sure?"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const buttons = container.querySelectorAll('button');
    const confirmBtn = Array.from(buttons).find((b) => b.textContent?.trim() === 'Confirm');
    expect(confirmBtn).toBeDefined();
    if (!confirmBtn) throw new Error('confirmBtn not found');
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  // APG alertdialog guidance: initial focus belongs on the least destructive
  // action. It previously landed on the header Close button, so an immediate
  // Enter would confirm the destructive action.
  it('moves initial focus to the cancel action', () => {
    render(
      <AlertDialog
        open
        title="Delete layer?"
        description="This cannot be undone."
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        confirmLabel="Delete"
        variant="destructive"
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
