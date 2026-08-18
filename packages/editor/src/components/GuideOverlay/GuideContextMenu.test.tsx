import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GuideContextMenu } from './GuideContextMenu';

describe('GuideContextMenu', () => {
  const defaultProps = {
    x: 100,
    y: 200,
    guideId: 'guide-1',
    isLocked: false,
    onToggleLock: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders Lock menu item when unlocked', () => {
    render(<GuideContextMenu {...defaultProps} />);
    expect(screen.getByText('Lock')).toBeTruthy();
  });

  it('renders Unlock menu item when locked', () => {
    render(<GuideContextMenu {...defaultProps} isLocked />);
    expect(screen.getByText('Unlock')).toBeTruthy();
  });

  it('renders Delete menu item', () => {
    render(<GuideContextMenu {...defaultProps} />);
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('fires onToggleLock when Lock/Unlock is clicked', () => {
    const onToggleLock = vi.fn();
    render(<GuideContextMenu {...defaultProps} onToggleLock={onToggleLock} />);
    fireEvent.click(screen.getByText('Lock'));
    expect(onToggleLock).toHaveBeenCalledWith('guide-1');
  });

  it('fires onRemove when Delete is clicked', () => {
    const onRemove = vi.fn();
    render(<GuideContextMenu {...defaultProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onRemove).toHaveBeenCalledWith('guide-1');
  });

  it('fires onClose after Lock/Unlock action', () => {
    const onClose = vi.fn();
    render(<GuideContextMenu {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Lock'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('fires onClose after Delete action', () => {
    const onClose = vi.fn();
    render(<GuideContextMenu {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders a separator between Lock/Unlock and Delete', () => {
    render(<GuideContextMenu {...defaultProps} />);
    // ContextMenu portals to document.body — scope the query to the menu itself.
    const menu = screen.getByRole('menu');
    const separators = menu.querySelectorAll('hr.varve-menu__sep');
    expect(separators.length).toBe(1);
  });

  it('fires onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<GuideContextMenu {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
