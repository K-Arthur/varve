/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const mockWorkspaces = [
  { id: 'personal', name: 'Personal', kind: 'personal' as const },
  { id: 'team-a', name: 'Team A', kind: 'team' as const },
  { id: 'team-b', name: 'Team B', kind: 'team' as const },
];

describe('WorkspaceSwitcher', () => {
  it('renders workspace name', () => {
    render(
      <WorkspaceSwitcher workspaces={mockWorkspaces} activeId="personal" onSwitch={vi.fn()} />,
    );
    const labels = screen.getAllByText('Personal');
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "Personal" as default when activeId not in workspaces', () => {
    render(<WorkspaceSwitcher workspaces={[]} activeId="nonexistent" onSwitch={vi.fn()} />);
    const labels = screen.getAllByText('Personal');
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it('opens dropdown on click', () => {
    render(
      <WorkspaceSwitcher workspaces={mockWorkspaces} activeId="personal" onSwitch={vi.fn()} />,
    );
    const button = screen.getByLabelText('Switch workspace');
    fireEvent.click(button);
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
  });

  it('lists all workspaces in dropdown', () => {
    render(
      <WorkspaceSwitcher workspaces={mockWorkspaces} activeId="personal" onSwitch={vi.fn()} />,
    );
    const button = screen.getByLabelText('Switch workspace');
    fireEvent.click(button);
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByText('Team A')).toBeInTheDocument();
    expect(screen.getByText('Team B')).toBeInTheDocument();
  });

  // APG listbox content model: children of role="listbox" are options (or
  // groups); static chrome such as the title and the empty message must be
  // presentational so assistive tech does not read a generic element as a
  // listbox child. The DOM is queried directly because Floating-UI never
  // runs its positioning pass in jsdom, so the panel keeps its inline
  // `visibility: hidden` and role queries (which respect accessibility
  // visibility) cannot see it — the real-browser e2e in
  // tests/e2e/home/workspace-switcher.spec.ts owns visibility.
  const assertContentModel = () => {
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute('aria-label')).toBe('Workspaces');
    const children = Array.from(listbox?.children ?? []);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(['option', 'presentation']).toContain(child.getAttribute('role'));
    }
  };

  it('keeps non-option listbox children presentational', () => {
    render(
      <WorkspaceSwitcher workspaces={mockWorkspaces} activeId="personal" onSwitch={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText('Switch workspace'));
    assertContentModel();
  });

  it('keeps the empty-state message presentational inside the listbox', () => {
    render(<WorkspaceSwitcher workspaces={[]} activeId="personal" onSwitch={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Switch workspace'));
    expect(screen.getByText('No workspaces')).toBeInTheDocument();
    assertContentModel();
  });

  it('calls onSwitch when workspace selected', () => {
    const onSwitch = vi.fn();
    render(
      <WorkspaceSwitcher workspaces={mockWorkspaces} activeId="personal" onSwitch={onSwitch} />,
    );
    const button = screen.getByLabelText('Switch workspace');
    fireEvent.click(button);
    fireEvent.click(screen.getByText('Team A'));
    expect(onSwitch).toHaveBeenCalledWith('team-a');
  });
});
