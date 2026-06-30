/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type SidebarEntry, SidebarNav } from './SidebarNav';

const entries: SidebarEntry[] = [
  { id: 'recent', label: 'Recent', icon: 'Clock', count: 3 },
  { id: 'all', label: 'All Files', icon: 'FileText', count: 12 },
];

describe('SidebarNav', () => {
  it('renders all entries', () => {
    const { container } = render(
      <SidebarNav entries={entries} activeId="all" onSelect={vi.fn()} />,
    );
    expect(container.textContent).toContain('Recent');
    expect(container.textContent).toContain('All Files');
  });

  it('calls onSelect when an item is clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SidebarNav entries={entries} activeId="all" onSelect={onSelect} />,
    );
    const buttons = container.querySelectorAll('button[role="option"]');
    const recentBtn = Array.from(buttons).find((b) => b.textContent?.includes('Recent'));
    expect(recentBtn).toBeDefined();
    if (!recentBtn) throw new Error('recentBtn not found');
    fireEvent.click(recentBtn);
    expect(onSelect).toHaveBeenCalledWith('recent');
  });

  it('marks the active item', () => {
    const { container } = render(
      <SidebarNav entries={entries} activeId="all" onSelect={vi.fn()} />,
    );
    const buttons = container.querySelectorAll('button[role="option"]');
    const active = Array.from(buttons).find((b) => b.getAttribute('aria-selected') === 'true');
    expect(active).toBeDefined();
    expect(active?.textContent).toContain('All Files');
  });
});
