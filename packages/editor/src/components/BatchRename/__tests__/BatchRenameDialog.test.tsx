// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchRenameDialog } from '../BatchRenameDialog';

afterEach(cleanup);

const allNodeNames = [
  { nodeId: 'n1', name: 'Rectangle 1' },
  { nodeId: 'n2', name: 'Ellipse 1' },
  { nodeId: 'n3', name: 'Text Layer' },
  { nodeId: 'n4', name: 'Rectangle 2' },
  { nodeId: 'n5', name: 'oldLayer' },
];

vi.mock('../../../context', () => ({
  useEditor: () => ({
    updateDoc: vi.fn((fn: (doc: unknown) => unknown) => fn({})),
  }),
}));

function renderDialog(
  overrides: Partial<{
    open: boolean;
    scopeNodeIds: string[];
    allNodeNames: Array<{ nodeId: string; name: string }>;
    defaultAll: boolean;
  }> = {},
) {
  const onClose = vi.fn();
  const utils = render(
    <BatchRenameDialog
      open={overrides.open ?? true}
      onClose={onClose}
      allNodeNames={overrides.allNodeNames ?? allNodeNames}
      scopeNodeIds={overrides.scopeNodeIds}
      defaultAll={overrides.defaultAll}
    />,
  );
  return { onClose, ...utils };
}

describe('BatchRenameDialog', () => {
  it('renders dialog when open', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: /batch rename/i })).toBeTruthy();
    expect(screen.getByText('Batch Rename')).toBeTruthy();
  });

  it('does not render when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog', { name: /batch rename/i })).toBeNull();
  });

  it('shows match count', () => {
    renderDialog({ scopeNodeIds: ['n5'], allNodeNames: allNodeNames });
    const findInput = screen.getByPlaceholderText(/Text to find/);
    fireEvent.change(findInput, { target: { value: 'old' } });
    const matchCount = document.querySelector('.batch-rename-dialog__match-count');
    expect(matchCount?.textContent).toContain('1 match');
  });

  it('shows scope selection when scopeNodeIds provided', () => {
    renderDialog({ scopeNodeIds: ['n1', 'n2'] });
    expect(screen.getByText(/Selection \(2\)/)).toBeTruthy();
    expect(screen.getByText(/All layers \(5\)/)).toBeTruthy();
  });

  it('validates regex and shows error', () => {
    renderDialog();
    const regexCheckbox = screen.getByText('Regex').previousElementSibling as HTMLInputElement;
    fireEvent.click(regexCheckbox);
    const findInput = screen.getByPlaceholderText(/Text to find/);
    fireEvent.change(findInput, { target: { value: '[invalid' } });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('calls onClose on cancel', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape', () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on overlay click', () => {
    const { onClose } = renderDialog();
    const overlay = document.querySelector('.batch-rename-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('rename button is disabled when no matches', () => {
    renderDialog();
    const findInput = screen.getByPlaceholderText(/Text to find/);
    fireEvent.change(findInput, { target: { value: 'xyz' } });
    const renameBtn = screen.getByRole('button', { name: /^rename$/i });
    expect(renameBtn).toBeDisabled();
  });

  it('rename button is enabled when matches exist', () => {
    renderDialog();
    const findInput = screen.getByPlaceholderText(/Text to find/);
    fireEvent.change(findInput, { target: { value: 'Rectangle' } });
    const renameBtn = screen.getByRole('button', { name: /rename all \(2\)/i });
    expect(renameBtn).not.toBeDisabled();
  });
});
