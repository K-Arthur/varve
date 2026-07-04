import type { FileEntry, Folder, Platform } from '@strata/platform';
import { createMemoryPlatform } from '@strata/platform';
import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByText('Project')).toBeTruthy();
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

  it('breadcrumb renders project name and folder names', () => {
    const folders = [
      makeFolder('f1', 'Work', projectId, null),
      makeFolder('f2', 'Logos', projectId, 'f1'),
    ];
    const files: FileEntry[] = [];
    render(
      <FolderView
        platform={createMemoryPlatform() as unknown as Platform}
        projectId={projectId}
        folderId="f2"
        files={files}
        folders={folders}
        onNavigate={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByText('Project')).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.getByText('Logos')).toBeTruthy();
  });

  it('breadcrumb click navigates to parent folder', () => {
    const folders = [
      makeFolder('f1', 'Work', projectId, null),
      makeFolder('f2', 'Logos', projectId, 'f1'),
    ];
    const files: FileEntry[] = [];
    const onNavigate = vi.fn();
    render(
      <FolderView
        platform={createMemoryPlatform() as unknown as Platform}
        projectId={projectId}
        folderId="f2"
        files={files}
        folders={folders}
        onNavigate={onNavigate}
        onOpenFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Work'));
    expect(onNavigate).toHaveBeenCalledWith('f1');
  });

  it('backspace navigates to parent folder', () => {
    const folders = [
      makeFolder('f1', 'Work', projectId, null),
      makeFolder('f2', 'Logos', projectId, 'f1'),
    ];
    const files: FileEntry[] = [];
    const onNavigate = vi.fn();
    render(
      <FolderView
        platform={createMemoryPlatform() as unknown as Platform}
        projectId={projectId}
        folderId="f2"
        files={files}
        folders={folders}
        onNavigate={onNavigate}
        onOpenFile={vi.fn()}
      />,
    );

    const breadcrumb = screen.getByLabelText('Folder navigation');
    fireEvent.keyDown(breadcrumb, { key: 'Backspace' });
    expect(onNavigate).toHaveBeenCalledWith('f1');
  });

  it('alt+up navigates to parent folder', () => {
    const folders = [
      makeFolder('f1', 'Work', projectId, null),
      makeFolder('f2', 'Logos', projectId, 'f1'),
    ];
    const files: FileEntry[] = [];
    const onNavigate = vi.fn();
    render(
      <FolderView
        platform={createMemoryPlatform() as unknown as Platform}
        projectId={projectId}
        folderId="f2"
        files={files}
        folders={folders}
        onNavigate={onNavigate}
        onOpenFile={vi.fn()}
      />,
    );

    const breadcrumb = screen.getByLabelText('Folder navigation');
    fireEvent.keyDown(breadcrumb, { key: 'ArrowUp', altKey: true });
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
