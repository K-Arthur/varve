/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type SidebarEntry, SidebarNav } from './SidebarNav';

const entries: SidebarEntry[] = [
  { id: 'recent', label: 'Recent', icon: 'Clock', count: 3 },
  { id: 'all', label: 'All Files', icon: 'FileText', count: 12 },
];

const entriesWithProject: SidebarEntry[] = [
  ...entries,
  { id: 'my-project', label: 'My Project', icon: 'Folder', count: 5 },
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
    const buttons = container.querySelectorAll('button.sidebar-item');
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
    const active = container.querySelector('button[aria-current="page"]');
    expect(active).toBeDefined();
    expect(active?.textContent).toContain('All Files');
  });

  it('renders new project button when onCreateProject is provided', () => {
    const { container } = render(
      <SidebarNav
        entries={entriesWithProject}
        activeId="all"
        onSelect={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );
    const newBtn = container.querySelector('.sidebar-group__add');
    expect(newBtn).toBeTruthy();
  });

  it('does not render new project button when onCreateProject is omitted', () => {
    const { container } = render(
      <SidebarNav entries={entriesWithProject} activeId="all" onSelect={vi.fn()} />,
    );
    const newBtn = container.querySelector('.sidebar-group__add');
    expect(newBtn).toBeFalsy();
  });

  it('calls onCreateProject when new project button clicked', () => {
    const onCreateProject = vi.fn();
    const { container } = render(
      <SidebarNav
        entries={entriesWithProject}
        activeId="all"
        onSelect={vi.fn()}
        onCreateProject={onCreateProject}
      />,
    );
    const newBtn = container.querySelector('.sidebar-group__add');
    expect(newBtn).toBeTruthy();
    if (newBtn) fireEvent.click(newBtn);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });

  it('offers an accessible first-project action when the projects list is empty', () => {
    const onCreateProject = vi.fn();
    render(
      <SidebarNav
        entries={entries}
        activeId="all"
        onSelect={vi.fn()}
        onCreateProject={onCreateProject}
      />,
    );

    expect(screen.getByText('No projects yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New project' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create your first project' }));
    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });
});
