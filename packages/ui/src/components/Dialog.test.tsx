/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertDialog, Dialog } from './Dialog';

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
