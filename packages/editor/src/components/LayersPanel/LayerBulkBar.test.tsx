import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LayerBulkBar } from './LayerBulkBar';

describe('LayerBulkBar', () => {
  const defaultProps = {
    selectedCount: 3,
    onGroup: () => {},
    onLockAll: () => {},
    onUnlockAll: () => {},
    onHideAll: () => {},
    onShowAll: () => {},
    onColorTag: () => {},
    onDeleteAll: () => {},
  };

  it('renders when 2+ nodes selected', () => {
    render(<LayerBulkBar {...defaultProps} />);
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByRole('toolbar')).toBeTruthy();
  });

  it('does not render when 0-1 selected', () => {
    const { container } = render(<LayerBulkBar {...defaultProps} selectedCount={1} />);
    expect(container.innerHTML).toBe('');
  });

  it('does not render when 0 selected', () => {
    const { container } = render(<LayerBulkBar {...defaultProps} selectedCount={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders action buttons', () => {
    render(<LayerBulkBar {...defaultProps} />);
    expect(screen.getByLabelText('Group')).toBeTruthy();
    expect(screen.getByLabelText('Lock all')).toBeTruthy();
    expect(screen.getByLabelText('Unlock all')).toBeTruthy();
    expect(screen.getByLabelText('Hide all')).toBeTruthy();
    expect(screen.getByLabelText('Show all')).toBeTruthy();
    expect(screen.getByLabelText('Delete all')).toBeTruthy();
  });

  it('renders color tag buttons', () => {
    render(<LayerBulkBar {...defaultProps} />);
    expect(screen.getByLabelText('Red')).toBeTruthy();
    expect(screen.getByLabelText('Green')).toBeTruthy();
    expect(screen.getByLabelText('Blue')).toBeTruthy();
  });

  it('calls onGroup when Group button clicked', () => {
    let called = false;
    render(<LayerBulkBar {...defaultProps} onGroup={() => { called = true; }} />);
    screen.getByLabelText('Group').click();
    expect(called).toBe(true);
  });

  it('calls onLockAll when Lock All button clicked', () => {
    let called = false;
    render(<LayerBulkBar {...defaultProps} onLockAll={() => { called = true; }} />);
    screen.getByLabelText('Lock all').click();
    expect(called).toBe(true);
  });

  it('calls onUnlockAll when Unlock All button clicked', () => {
    let called = false;
    render(<LayerBulkBar {...defaultProps} onUnlockAll={() => { called = true; }} />);
    screen.getByLabelText('Unlock all').click();
    expect(called).toBe(true);
  });

  it('calls onHideAll when Hide All button clicked', () => {
    let called = false;
    render(<LayerBulkBar {...defaultProps} onHideAll={() => { called = true; }} />);
    screen.getByLabelText('Hide all').click();
    expect(called).toBe(true);
  });

  it('calls onShowAll when Show All button clicked', () => {
    let called = false;
    render(<LayerBulkBar {...defaultProps} onShowAll={() => { called = true; }} />);
    screen.getByLabelText('Show all').click();
    expect(called).toBe(true);
  });

  it('calls onColorTag with correct color', () => {
    let received: string | null = null;
    render(
      <LayerBulkBar
        {...defaultProps}
        onColorTag={(c) => { received = c; }}
      />,
    );
    screen.getByLabelText('Green').click();
    expect(received).toBe('green');
  });

  it('calls onDeleteAll when Delete All button clicked', () => {
    let called = false;
    render(<LayerBulkBar {...defaultProps} onDeleteAll={() => { called = true; }} />);
    screen.getByLabelText('Delete all').click();
    expect(called).toBe(true);
  });
});
