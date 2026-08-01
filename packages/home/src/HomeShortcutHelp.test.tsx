/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeShortcutHelp } from './HomeShortcutHelp';

describe('HomeShortcutHelp', () => {
  it('renders shortcut list content', () => {
    const { container } = render(<HomeShortcutHelp open={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain('New file');
    expect(container.textContent).toContain('Ctrl+N');
    expect(container.textContent).toContain('Search files');
    expect(container.textContent).toContain('Ctrl+F');
  });

  it('renders all shortcuts', () => {
    render(<HomeShortcutHelp open={true} onClose={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(8);
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<HomeShortcutHelp open={true} onClose={onClose} />);
    const closeBtn = container.querySelector('.home-shortcut-help__close');
    expect(closeBtn).toBeTruthy();
    if (closeBtn) fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
