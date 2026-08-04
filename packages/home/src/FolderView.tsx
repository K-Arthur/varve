import type { FileEntry, Folder, Platform } from '@varve/platform';
import { Icon } from '@varve/ui';
import { useCallback, useMemo, useRef } from 'react';

export interface FolderViewProps {
  platform: Platform;
  projectId: string;
  folderId: string | null;
  files: readonly FileEntry[];
  folders: readonly Folder[];
  onNavigate: (folderId: string | null) => void;
  onOpenFile: (entry: FileEntry) => void;
  onSelect?: (ids: string[]) => void;
}

export function FolderView({
  platform: _platform,
  projectId: _projectId,
  folderId,
  files,
  folders,
  onNavigate,
  onOpenFile,
  onSelect,
}: FolderViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const childFolders = useMemo(
    () =>
      [...folders]
        .filter((f) => f.parentId === folderId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, folderId],
  );

  const allItems = useMemo(
    () => childFolders.length + files.length,
    [childFolders.length, files.length],
  );

  const handleFolderDoubleClick = useCallback(
    (id: string) => {
      onNavigate(id);
    },
    [onNavigate],
  );

  const handleFileDoubleClick = useCallback(
    (entry: FileEntry) => {
      onOpenFile(entry);
    },
    [onOpenFile],
  );

  return (
    <section ref={containerRef} className="folder-view__content" aria-label="Folder contents">
      {childFolders.length > 0 && (
        <>
          <div className="folder-view__section-label">Folders</div>
          <div className="folder-view__folder-list">
            {childFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className="folder-view__folder-row"
                onDoubleClick={() => handleFolderDoubleClick(folder.id)}
                onClick={() => onSelect?.([folder.id])}
                tabIndex={0}
                aria-label={`Open folder ${folder.name}`}
              >
                <Icon
                  name="Folder"
                  label={undefined}
                  size="1.1em"
                  className="folder-view__folder-icon"
                />
                <span className="folder-view__folder-name">{folder.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {childFolders.length > 0 && files.length > 0 && <div className="folder-view__divider" />}

      {files.length > 0 && (
        <>
          <div className="folder-view__section-label">Files</div>
          <div className="folder-view__file-list">
            {files.map((file) => (
              <button
                key={file.id}
                type="button"
                className="folder-view__file-row"
                onDoubleClick={() => handleFileDoubleClick(file)}
                onClick={() => onSelect?.([file.id])}
                tabIndex={0}
                aria-label={`Open file ${file.name}`}
              >
                <Icon name="File" label={undefined} size="1.1em" />
                <span className="folder-view__file-name">{file.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {allItems === 0 && (
        <div className="folder-view__empty">
          <p className="folder-view__empty-text">This folder is empty</p>
        </div>
      )}
    </section>
  );
}
