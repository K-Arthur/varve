import { fireEvent, render, screen } from '@testing-library/react';
import type { FileEntry, Folder, Platform } from '@varve/platform';
import { createMemoryPlatform } from '@varve/platform';
import { describe, expect, it, vi } from 'vitest';
import { FolderView } from './FolderView';

function makeFolder(id: string, name: string, projectId: string, parentId: string | null): Folder {
  return { id, name, projectId, parentId, createdAt: 1000, updatedAt: 1000, ordering: '' };
}

function makeFile(id: string, name: string, projectId: string): FileEntry {
  return {
    id,
    name,
    kind: 'strata',
    projectId,
    createdAt: 1000,
    updatedAt: 1000,
    openedAt: 0,
    size: 100,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: '',
  };
}

describe('FolderView', () => {
  const projectId = 'proj-1';

  it('renders folders with folder icon', () => {
    const folders = [makeFolder('f1', 'Designs', projectId, null)];
    const files: FileEntry[] = [];
    const onNavigate = vi.fn();
    render(
      <FolderView
        platform={createMemoryPlatform() as unknown as Platform}
        projectId={projectId}
        folderId={null}
        files={files}
        folders={folders}
        onNavigate={onNavigate}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByText('Designs')).toBeTruthy();
    expect(screen.getByText('Folders')).toBeTruthy();
  });

  it('renders files below folders', () => {
    const folders: Folder[] = [];
    const files = [makeFile('file1', 'MyDesign', projectId)];
    const onNavigate = vi.fn();
    render(
      <FolderView
        platform={createMemoryPlatform() as unknown as Platform}
        projectId={projectId}
        folderId={null}
        files={files}
        folders={folders}
        onNavigate={onNavigate}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByText('MyDesign')).toBeTruthy();
    expect(screen.getByText('Files')).toBeTruthy();
  });

  it('double-clicking folder calls onNavigate', () => {
    const folders = [makeFolder('f1', 'Assets', projectId, null)];
    const files: FileEntry[] = [];
    const onNavigate = vi.fn();
    const { container } = render(
      <FolderView
        platform={createMemoryPlatform() as unknown as Platform}
        projectId={projectId}
        folderId={null}
        files={files}
        folders={folders}
        onNavigate={onNavigate}
        onOpenFile={vi.fn()}
      />,
    );

    const folderRow = container.querySelector('.folder-view__folder-row');
    expect(folderRow).toBeTruthy();
    fireEvent.doubleClick(folderRow!);
    expect(onNavigate).toHaveBeenCalledWith('f1');
  });

  it('shows empty state when no items in folder', () => {
    const folders: Folder[] = [];
    const files: FileEntry[] = [];
    render(
      <FolderView
        platform={createMemoryPlatform() as unknown as Platform}
        projectId={projectId}
        folderId={null}
        files={files}
        folders={folders}
        onNavigate={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByText('This folder is empty')).toBeTruthy();
  });
});
