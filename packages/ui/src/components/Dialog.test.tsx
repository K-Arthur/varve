/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
        variant="danger"
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
});
