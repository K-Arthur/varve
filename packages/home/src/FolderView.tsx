import type { FileEntry, Folder, Platform } from '@strata/platform';
import { Icon } from '@strata/ui';
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

function buildBreadcrumbs(
  folders: readonly Folder[],
  folderId: string | null,
): { id: string | null; name: string }[] {
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: 'Project' }];
  if (!folderId) return crumbs;

  const map = new Map<string, Folder>();
  for (const f of folders) map.set(f.id, f);

  const chain: Folder[] = [];
  let current = map.get(folderId);
  while (current) {
    chain.push(current);
    current = current.parentId ? map.get(current.parentId) : undefined;
  }

  for (const f of chain.reverse()) {
    crumbs.push({ id: f.id, name: f.name });
  }

  return crumbs;
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

  const breadcrumbs = useMemo(() => buildBreadcrumbs(folders, folderId), [folders, folderId]);

  const allItems = useMemo(
    () => childFolders.length + files.length,
    [childFolders.length, files.length],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
        e.preventDefault();
        const parentFolder = folders.find((f) => f.id === folderId);
        if (parentFolder) {
          onNavigate(parentFolder.parentId);
        } else {
          onNavigate(null);
        }
      }
    },
    [folderId, folders, onNavigate],
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

  const handleBreadcrumbClick = useCallback(
    (id: string | null) => {
      onNavigate(id);
    },
    [onNavigate],
  );

  return (
    <>
      <nav
        className="folder-view__breadcrumb"
        aria-label="Folder navigation"
        onKeyDown={handleKeyDown}
      >
        {breadcrumbs.map((crumb, idx) => (
          <span key={crumb.id ?? 'root'} className="folder-view__breadcrumb-segment">
            {idx > 0 && (
              <Icon
                name="ChevronRight"
                label={undefined}
                size="0.75em"
                className="folder-view__breadcrumb-sep"
              />
            )}
            <button
              type="button"
              className="folder-view__breadcrumb-link"
              onClick={() => handleBreadcrumbClick(crumb.id)}
              tabIndex={0}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div
        ref={containerRef}
        className="folder-view__content"
        role="region"
        aria-label="Folder contents"
      >
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
      </div>
    </>
  );
}
