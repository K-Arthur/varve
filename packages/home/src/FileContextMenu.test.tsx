// @ts-nocheck
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileContextMenu } from './FileContextMenu';

function makeFile(id: string, name: string) {
  return {
    id,
    name,
    kind: 'design',
    projectId: null,
    createdAt: 0,
    updatedAt: 0,
    openedAt: 0,
    size: 0,
    pinned: false,
    trashedAt: null,
    ordering: '',
  };
}

describe('FileContextMenu', () => {
  it('offers a non-drag way to reorder files (WCAG 2.5.7)', () => {
    const onAction = vi.fn();
    render(
      <FileContextMenu
        file={makeFile('f1', 'Design 1')}
        position={{ x: 0, y: 0 }}
        onAction={onAction}
        onMoveToProject={vi.fn()}
        onClose={vi.fn()}
        projects={[]}
      />,
    );

    fireEvent.click(screen.getByText('Move earlier in order'));
    expect(onAction).toHaveBeenCalledWith('move-earlier');

    fireEvent.click(screen.getByText('Move later in order'));
    expect(onAction).toHaveBeenCalledWith('move-later');
  });

  it('disables Move earlier/later at the ends of the manual order', () => {
    render(
      <FileContextMenu
        file={makeFile('f1', 'Design 1')}
        position={{ x: 0, y: 0 }}
        onAction={vi.fn()}
        onMoveToProject={vi.fn()}
        onClose={vi.fn()}
        projects={[]}
        canMoveEarlier={false}
        canMoveLater={false}
      />,
    );

    expect(screen.getByText('Move earlier in order').closest('button')).toBeDisabled();
    expect(screen.getByText('Move later in order').closest('button')).toBeDisabled();
  });

  it('does not offer reordering in the trash or missing-file menus', () => {
    render(
      <FileContextMenu
        file={makeFile('f1', 'Design 1')}
        position={{ x: 0, y: 0 }}
        onAction={vi.fn()}
        onMoveToProject={vi.fn()}
        onClose={vi.fn()}
        projects={[]}
        isTrash
      />,
    );
    expect(screen.queryByText('Move earlier in order')).toBeNull();
  });
});
