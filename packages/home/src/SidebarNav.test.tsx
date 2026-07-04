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

  it('renders new project button when onCreateProject is provided', () => {
    const { container } = render(
      <SidebarNav entries={entries} activeId="all" onSelect={vi.fn()} onCreateProject={vi.fn()} />,
    );
    const newBtn = container.querySelector('.sidebar-item--new-project');
    expect(newBtn).toBeTruthy();
    expect(newBtn?.textContent).toContain('New Project');
  });

  it('does not render new project button when onCreateProject is omitted', () => {
    const { container } = render(
      <SidebarNav entries={entries} activeId="all" onSelect={vi.fn()} />,
    );
    const newBtn = container.querySelector('.sidebar-item--new-project');
    expect(newBtn).toBeFalsy();
  });

  it('calls onCreateProject when new project button clicked', () => {
    const onCreateProject = vi.fn();
    const { container } = render(
      <SidebarNav
        entries={entries}
        activeId="all"
        onSelect={vi.fn()}
        onCreateProject={onCreateProject}
      />,
    );
    const newBtn = container.querySelector('.sidebar-item--new-project');
    expect(newBtn).toBeTruthy();
    if (newBtn) fireEvent.click(newBtn);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });
});
