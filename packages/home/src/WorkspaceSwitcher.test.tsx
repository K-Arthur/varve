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
    render(
      <WorkspaceSwitcher workspaces={[]} activeId="nonexistent" onSwitch={vi.fn()} />,
    );
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
