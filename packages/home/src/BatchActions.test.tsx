/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BatchActions } from './BatchActions';

const sampleProjects = [
  { id: 'p1', name: 'Project Alpha', createdAt: 0, updatedAt: 0, pinned: false, trashedAt: null },
  { id: 'p2', name: 'Project Beta', createdAt: 0, updatedAt: 0, pinned: false, trashedAt: null },
];

const noop = () => {};

describe('BatchActions', () => {
  it('renders selected count', () => {
    render(
      <BatchActions
        selectedCount={3}
        projects={sampleProjects}
        onMoveToProject={noop}
        onTrash={noop}
        onFavorite={noop}
        onExport={noop}
        onDeselect={noop}
      />,
    );
    expect(screen.getByText('3 selected')).toBeDefined();
  });

  it('shows action buttons', () => {
    render(
      <BatchActions
        selectedCount={2}
        projects={sampleProjects}
        onMoveToProject={noop}
        onTrash={noop}
        onFavorite={noop}
        onExport={noop}
        onDeselect={noop}
      />,
    );
    expect(screen.getByText('Trash')).toBeDefined();
    expect(screen.getByText('Favorite')).toBeDefined();
    expect(screen.getByText('Export')).toBeDefined();
    expect(screen.getByText('Deselect all')).toBeDefined();
  });

  it('calls onTrash callback on click', async () => {
    const onTrash = vi.fn();
    render(
      <BatchActions
        selectedCount={1}
        projects={[]}
        onMoveToProject={noop}
        onTrash={onTrash}
        onFavorite={noop}
        onExport={noop}
        onDeselect={noop}
      />,
    );
    await userEvent.click(screen.getByText('Trash'));
    expect(onTrash).toHaveBeenCalledTimes(1);
  });

  it('calls onFavorite callback on click', async () => {
    const onFavorite = vi.fn();
    render(
      <BatchActions
        selectedCount={1}
        projects={[]}
        onMoveToProject={noop}
        onTrash={noop}
        onFavorite={onFavorite}
        onExport={noop}
        onDeselect={noop}
      />,
    );
    await userEvent.click(screen.getByText('Favorite'));
    expect(onFavorite).toHaveBeenCalledTimes(1);
  });

  it('calls onDeselect callback on click', async () => {
    const onDeselect = vi.fn();
    render(
      <BatchActions
        selectedCount={1}
        projects={[]}
        onMoveToProject={noop}
        onTrash={noop}
        onFavorite={noop}
        onExport={noop}
        onDeselect={onDeselect}
      />,
    );
    await userEvent.click(screen.getByText('Deselect all'));
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('hidden when count is 0', () => {
    const { container } = render(
      <BatchActions
        selectedCount={0}
        projects={[]}
        onMoveToProject={noop}
        onTrash={noop}
        onFavorite={noop}
        onExport={noop}
        onDeselect={noop}
      />,
    );
    expect(container.querySelector('.batch-actions')).toBeNull();
  });

  it('renders Move to button when projects exist', () => {
    render(
      <BatchActions
        selectedCount={2}
        projects={sampleProjects}
        onMoveToProject={noop}
        onTrash={noop}
        onFavorite={noop}
        onExport={noop}
        onDeselect={noop}
      />,
    );
    expect(screen.getByText(/Move to…/)).toBeDefined();
    expect(screen.getByText('Project Alpha')).toBeDefined();
    expect(screen.getByText('Project Beta')).toBeDefined();
  });
});
