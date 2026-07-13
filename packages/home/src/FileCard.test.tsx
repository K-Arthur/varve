/** @vitest-environment jsdom */

import { DndContext } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import type { FileEntry } from '@strata/platform';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileCard } from './FileCard';

function makeEntry(overrides: Partial<FileEntry> & { id: string; name: string }): FileEntry {
  const now = Date.now();
  return {
    kind: 'strata',
    projectId: null,
    createdAt: now,
    updatedAt: now,
    openedAt: 0,
    size: 0,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: '00000000',
    ...overrides,
  };
}

function renderCard(
  props: Partial<React.ComponentProps<typeof FileCard>> & {
    entry: FileEntry;
    onStartRename?: (id: string | null) => void;
  },
) {
  const { entry, ...rest } = props;
  return render(
    <DndContext>
      <SortableContext items={[entry.id]} strategy={rectSortingStrategy}>
        <FileCard
          entry={entry}
          thumbnail={null}
          thumbnailLoading={false}
          selected={false}
          onOpen={vi.fn()}
          onContext={vi.fn()}
          {...rest}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe('FileCard rename', () => {
  it('calls onStartRename(null) on Enter after committing rename', () => {
    const onRename = vi.fn();
    const onStartRename = vi.fn();
    const entry = makeEntry({ id: 'f1', name: 'Old' });

    renderCard({
      entry,
      isRenaming: true,
      onRename,
      onStartRename,
    });

    const input = screen.getByDisplayValue('Old');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith('f1', 'New Name');
    expect(onStartRename).toHaveBeenCalledWith(null);
  });

  it('calls onStartRename(null) on Escape without renaming', () => {
    const onRename = vi.fn();
    const onStartRename = vi.fn();
    const entry = makeEntry({ id: 'f1', name: 'Old' });

    renderCard({
      entry,
      isRenaming: true,
      onRename,
      onStartRename,
    });

    const input = screen.getByDisplayValue('Old');
    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRename).not.toHaveBeenCalled();
    expect(onStartRename).toHaveBeenCalledWith(null);
  });

  it('calls onStartRename(entry.id) on F2 to enter rename', () => {
    const onStartRename = vi.fn();
    const entry = makeEntry({ id: 'f1', name: 'Logo' });

    renderCard({
      entry,
      isRenaming: false,
      onStartRename,
    });

    const card = screen.getByRole('gridcell');
    fireEvent.keyDown(card, { key: 'F2' });

    expect(onStartRename).toHaveBeenCalledWith('f1');
  });
});
