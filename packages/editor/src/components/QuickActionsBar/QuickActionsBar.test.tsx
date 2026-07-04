import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActionRegistry, resetActionRegistryForTesting } from '../../actions/ActionRegistry';
import { QuickActionsBar } from './QuickActionsBar';

afterEach(cleanup);

describe('QuickActionsBar', () => {
  beforeEach(() => {
    resetActionRegistryForTesting();
    const r = getActionRegistry();
    r.register({ id: 'undo', label: 'Undo', category: 'edit' }, () => {});
    r.register({ id: 'redo', label: 'Redo', category: 'edit' }, () => {});
    r.register({ id: 'group', label: 'Group', category: 'object' }, () => {});
    r.register({ id: 'copy', label: 'Copy', category: 'edit', keywords: ['duplicate'] }, () => {});
    r.register({ id: 'toggleSnap', label: 'Toggle Snap', category: 'view' }, () => {});
  });

  it('does not render when closed', () => {
    render(<QuickActionsBar open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders when open', () => {
    render(<QuickActionsBar open={true} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Search actions')).toBeInTheDocument();
  });

  it('shows all actions with empty query', () => {
    render(<QuickActionsBar open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Undo')).toBeInTheDocument();
    expect(screen.getByText('Redo')).toBeInTheDocument();
    expect(screen.getByText('Group')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Toggle Snap')).toBeInTheDocument();
  });

  it('filters actions by search query', () => {
    render(<QuickActionsBar open={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Search actions');
    fireEvent.change(input, { target: { value: 'undo' } });
    expect(screen.getByText('Undo')).toBeInTheDocument();
    expect(screen.queryByText('Redo')).not.toBeInTheDocument();
  });

  it('searches by keyword', () => {
    render(<QuickActionsBar open={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Search actions');
    fireEvent.change(input, { target: { value: 'duplicate' } });
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<QuickActionsBar open={true} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('executes action on click', () => {
    const onExecute = vi.fn();
    render(<QuickActionsBar open={true} onClose={vi.fn()} onExecute={onExecute} />);
    fireEvent.click(screen.getByText('Undo'));
    expect(onExecute).toHaveBeenCalledWith('undo');
  });

  it('calls onClose after executing action', () => {
    const onClose = vi.fn();
    render(<QuickActionsBar open={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Redo'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('navigates with arrow keys and executes with Enter', () => {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    render(<QuickActionsBar open={true} onClose={onClose} onExecute={onExecute} />);
    const dialog = screen.getByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'Enter' });

    expect(onExecute).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows no results message when no match', () => {
    render(<QuickActionsBar open={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Search actions');
    fireEvent.change(input, { target: { value: 'zzzznotfound' } });
    expect(screen.getByText('No actions found')).toBeInTheDocument();
  });

  it('closes on close button click', () => {
    const onClose = vi.fn();
    render(<QuickActionsBar open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close quick actions'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows categories on action items', () => {
    render(<QuickActionsBar open={true} onClose={vi.fn()} />);
    expect(screen.getAllByText('edit').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('object')).toBeInTheDocument();
    expect(screen.getByText('view')).toBeInTheDocument();
  });

  it('positions at cursor when position prop given', () => {
    const { container } = render(
      <QuickActionsBar open={true} onClose={vi.fn()} position={{ x: 100, y: 200 }} />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('200px');
  });

  it('positions at bottom center when no position given', () => {
    const { container } = render(<QuickActionsBar open={true} onClose={vi.fn()} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.bottom).toBe('var(--space-8)');
    expect(el.style.left).toBe('50%');
  });
});
