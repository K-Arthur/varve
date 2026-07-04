/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BulkImportDialog, type BulkImportFileResult } from './BulkImportDialog';
import type { FileEntry, Platform } from '@strata/platform';

function createMockPlatform(): Platform {
  return {
    kind: 'memory',
    listFiles: vi.fn().mockResolvedValue([]),
    listTrashedFiles: vi.fn().mockResolvedValue([]),
    getFile: vi.fn(),
    readFile: vi.fn(),
    upsertFile: vi.fn().mockResolvedValue(undefined),
    touchFile: vi.fn(),
    renameFile: vi.fn(),
    setPinned: vi.fn(),
    moveToProject: vi.fn(),
    trashFile: vi.fn(),
    restoreFile: vi.fn(),
    purgeFile: vi.fn(),
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
    setProjectPinned: vi.fn(),
    listDrafts: vi.fn().mockResolvedValue([]),
    moveFileToDrafts: vi.fn(),
    promoteFromDrafts: vi.fn(),
    listFolders: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    moveFileToFolder: vi.fn(),
    reorderFolder: vi.fn(),
    listCollections: vi.fn().mockResolvedValue([]),
    createCollection: vi.fn(),
    updateCollection: vi.fn(),
    deleteCollection: vi.fn(),
    addFileToCollection: vi.fn(),
    removeFileFromCollection: vi.fn(),
    listCollectionFiles: vi.fn().mockResolvedValue([]),
    reorderCollection: vi.fn(),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    moveProjectToWorkspace: vi.fn(),
    listLibraries: vi.fn().mockResolvedValue([]),
    createLibrary: vi.fn(),
    enableLibrary: vi.fn(),
    deleteLibrary: vi.fn(),
    searchFileContent: vi.fn().mockResolvedValue([]),
    listTemplates: vi.fn().mockResolvedValue([]),
    createTemplateFromFile: vi.fn(),
    deleteTemplate: vi.fn(),
    searchTemplates: vi.fn().mockResolvedValue([]),
    listProjectTemplates: vi.fn().mockResolvedValue([]),
    createProjectFromTemplate: vi.fn(),
    listAssets: vi.fn().mockResolvedValue([]),
    importAsset: vi.fn(),
    deleteAsset: vi.fn(),
    searchAssets: vi.fn().mockResolvedValue([]),
    createAssetFolder: vi.fn(),
    deleteAssetFolder: vi.fn(),
    listVersions: vi.fn().mockResolvedValue([]),
    saveVersion: vi.fn(),
    restoreVersion: vi.fn(),
    deleteVersionInfo: vi.fn(),
    listBranches: vi.fn().mockResolvedValue([]),
    createBranch: vi.fn(),
    listPermissions: vi.fn().mockResolvedValue([]),
    setPermission: vi.fn(),
    listActivity: vi.fn().mockResolvedValue([]),
    recordActivity: vi.fn(),
    listTags: vi.fn().mockResolvedValue([]),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    listFileTags: vi.fn().mockResolvedValue([]),
    addFileTag: vi.fn(),
    removeFileTag: vi.fn(),
    listFilesByTag: vi.fn().mockResolvedValue([]),
    listSavedSearches: vi.fn().mockResolvedValue([]),
    createSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
    searchFiles: vi.fn().mockResolvedValue([]),
    reorderFile: vi.fn(),
    listenForChanges: vi.fn().mockResolvedValue(vi.fn()),
    fileExists: vi.fn().mockResolvedValue(true),
    getThumbnail: vi.fn().mockResolvedValue(undefined),
    putThumbnail: vi.fn(),
    evictThumbnails: vi.fn().mockResolvedValue(0),
    getViewState: vi.fn(),
    setViewState: vi.fn(),
    openDocumentFromDisk: vi.fn().mockResolvedValue(null),
    importDocumentFromDisk: vi.fn().mockResolvedValue({ result: null, unsupported: false }),
    saveDocumentToDisk: vi.fn().mockResolvedValue(null),
    saveBinaryFile: vi.fn().mockResolvedValue(null),
    revealInFileManager: vi.fn(),
    fileManagerLabel: vi.fn().mockReturnValue('File Manager'),
  } as unknown as Platform;
}

function createMockFile(name: string, content: string, mime = 'text/plain'): File {
  return new File([content], name, { type: mime });
}

describe('BulkImportDialog', () => {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    platform: createMockPlatform(),
    workspaceId: 'test-ws',
    onImportComplete: vi.fn(),
  };

  it('renders drop zone', () => {
    const { container } = render(<BulkImportDialog {...baseProps} />);
    expect(container.querySelector('.bulk-import__dropzone')).toBeTruthy();
    expect(container.textContent).toContain('Drag and drop files here');
  });

  it('has a file picker button', () => {
    const { container } = render(<BulkImportDialog {...baseProps} />);
    const link = container.querySelector('.bulk-import__dropzone-link');
    expect(link).toBeTruthy();
    expect(link?.textContent).toBe('browse');
  });

  it('has a hidden file input', () => {
    const { container } = render(<BulkImportDialog {...baseProps} />);
    const input = container.querySelector('.bulk-import__hidden-input');
    expect(input).toBeTruthy();
  });

  it('lists queued files', () => {
    const { container } = render(<BulkImportDialog {...baseProps} />);
    const file = createMockFile('test.svg', '<svg/>');
    const input = container.querySelector<HTMLInputElement>('.bulk-import__hidden-input')!;

    Object.defineProperty(input, 'files', {
      value: [file],
    });
    fireEvent.change(input);

    expect(container.textContent).toContain('test.svg');
    expect(container.textContent).toContain('1 file selected');
  });

  it('shows kind badges for queued files', () => {
    const { container } = render(<BulkImportDialog {...baseProps} />);
    const file = createMockFile('icon.svg', '<svg/>');
    const input = container.querySelector<HTMLInputElement>('.bulk-import__hidden-input')!;

    Object.defineProperty(input, 'files', {
      value: [file],
    });
    fireEvent.change(input);

    const badge = container.querySelector('.bulk-import__queue-badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('svg');
  });

  it('import button starts the process', async () => {
    const platform = createMockPlatform();
    const onImportComplete = vi.fn();
    const { container } = render(
      <BulkImportDialog
        {...baseProps}
        platform={platform}
        onImportComplete={onImportComplete}
      />,
    );

    const file = createMockFile('design.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const input = container.querySelector<HTMLInputElement>('.bulk-import__hidden-input')!;
    Object.defineProperty(input, 'files', {
      value: [file],
    });
    fireEvent.change(input);

    const importBtn = container.querySelector('.bulk-import__actions button:last-child') as HTMLButtonElement;
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(platform.upsertFile).toHaveBeenCalledOnce();
    });

    expect(onImportComplete).toHaveBeenCalledOnce();
    const results = onImportComplete.mock.calls[0]![0] as BulkImportFileResult[];
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.name).toBe('design.svg');
  });

  it('shows progress during import', async () => {
    const platform = createMockPlatform();
    const { container } = render(
      <BulkImportDialog {...baseProps} platform={platform} />,
    );

    const file1 = createMockFile('a.svg', '<svg/>');
    const file2 = createMockFile('b.svg', '<svg/>');
    const input = container.querySelector<HTMLInputElement>('.bulk-import__hidden-input')!;
    Object.defineProperty(input, 'files', {
      value: [file1, file2],
    });
    fireEvent.change(input);

    const importBtn = container.querySelector('.bulk-import__actions button:last-child') as HTMLButtonElement;
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(container.textContent).toContain('Importing file');
    });
  });

  it('shows results on completion', async () => {
    const platform = createMockPlatform();
    const { container } = render(
      <BulkImportDialog {...baseProps} platform={platform} />,
    );

    const file = createMockFile('test.svg', '<svg/>');
    const input = container.querySelector<HTMLInputElement>('.bulk-import__hidden-input')!;
    Object.defineProperty(input, 'files', {
      value: [file],
    });
    fireEvent.change(input);

    const importBtn = container.querySelector('.bulk-import__actions button:last-child') as HTMLButtonElement;
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(container.textContent).toContain('1 file imported');
    });
  });

  it('cancel button works during queue phase', () => {
    const onClose = vi.fn();
    const { container } = render(
      <BulkImportDialog {...baseProps} onClose={onClose} />,
    );

    const cancelBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel',
    );
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn!);
    expect(onClose).toHaveBeenCalled();
  });

  it('accepts dropped files', () => {
    const { container } = render(<BulkImportDialog {...baseProps} />);
    const dropzone = container.querySelector('.bulk-import__dropzone')!;

    const file = createMockFile('doc.svg', '<svg/>');
    const dt = new DataTransfer();
    dt.items.add(file);

    fireEvent.dragOver(dropzone);
    expect(dropzone.classList.contains('bulk-import__dropzone--active')).toBe(true);

    fireEvent.drop(dropzone, { dataTransfer: dt });

    expect(container.textContent).toContain('doc.svg');
  });
});
