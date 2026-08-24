import type { FileEntry, Folder, Platform, Project } from '@varve/platform';
import { Button, SemanticIcon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BreadcrumbSegment } from './BreadcrumbNav';
import { confirmDialog } from './confirmDialog';
import { FileGrid } from './FileGrid';
import { FolderView } from './FolderView';

export interface ProjectsViewProps {
  project: Project | null;
  files: readonly FileEntry[];
  thumbnails: Map<string, string | null>;
  platform: Platform;
  onOpen: (entry: FileEntry) => void;
  onContext: (e: React.MouseEvent, entry: FileEntry) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onSelectRange: (fromIdx: number, toIdx: number) => void;
  onSelectAll: () => void;
  onFileRename?: (id: string, newName: string) => void;
  renamingId?: string | null;
  onStartRename?: (id: string | null) => void;
  missingFiles?: Set<string>;
  activeFolderId: string | null;
  onSetFolderId: (id: string | null) => void;
  onFolderBreadcrumb: (chain: BreadcrumbSegment[]) => void;
}

export function ProjectsView({
  project,
  files,
  thumbnails,
  platform,
  onOpen,
  onContext,
  onRename,
  onDelete,
  selectedIds,
  onSelect,
  onToggleSelect,
  onSelectRange,
  onSelectAll,
  onFileRename,
  renamingId,
  onStartRename,
  missingFiles = new Set(),
  activeFolderId,
  onSetFolderId,
  onFolderBreadcrumb,
}: ProjectsViewProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project?.name ?? '');
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    if (!project) return;
    platform
      .listFolders(project.id)
      .then(setFolders)
      .catch(() => setFolders([]));
  }, [platform, project]);

  const folderFiles = useMemo(
    () => files.filter((f) => f.projectId === project?.id),
    [files, project],
  );

  const handleNavigate = useCallback(
    (folderId: string | null) => {
      onSetFolderId(folderId);
    },
    [onSetFolderId],
  );

  useEffect(() => {
    const crumbs: BreadcrumbSegment[] = [];
    if (activeFolderId) {
      const map = new Map<string, Folder>();
      for (const f of folders) map.set(f.id, f);
      const chain: Folder[] = [];
      let current = map.get(activeFolderId);
      while (current) {
        chain.push(current);
        current = current.parentId ? map.get(current.parentId) : undefined;
      }
      for (const f of chain.reverse()) {
        crumbs.push({ id: f.id, name: f.name });
      }
    }
    onFolderBreadcrumb(crumbs);
  }, [folders, activeFolderId, onFolderBreadcrumb]);

  if (!project) {
    return <div>Project not found</div>;
  }

  const handleRename = () => {
    if (name.trim() && name !== project.name) {
      onRename(project.id, name.trim());
    }
    setEditing(false);
  };

  return (
    <div>
      <div className="project-view__header">
        {editing ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') {
                setName(project.name);
                setEditing(false);
              }
            }}
            className="project-view__rename-input"
          />
        ) : (
          <Tooltip label="Double-click to rename">
            <h2
              className="project-view__name"
              onDoubleClick={() => {
                setName(project.name);
                setEditing(true);
              }}
            >
              {project.name}
            </h2>
          </Tooltip>
        )}
        <div className="project-view__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setName(project.name);
              setEditing(true);
            }}
          >
            <SemanticIcon name="Edit" size="sm" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (
                await confirmDialog(
                  'Delete project',
                  `Delete project "${project.name}"? Files will become unfiled.`,
                  { confirmLabel: 'Delete', variant: 'danger' },
                )
              ) {
                onDelete(project.id);
              }
            }}
          >
            <SemanticIcon name="Delete" size="sm" />
          </Button>
        </div>
      </div>
      {folders.length > 0 && (
        <FolderView
          platform={platform}
          projectId={project.id}
          folderId={activeFolderId}
          files={folderFiles}
          folders={folders}
          onNavigate={handleNavigate}
          onOpenFile={onOpen}
          onSelect={(ids) => onSelect(ids[0] ?? '')}
        />
      )}
      <FileGrid
        files={files}
        thumbnails={thumbnails}
        onLoadThumbnail={() => {}}
        onOpen={onOpen}
        onContext={onContext}
        selectedIds={selectedIds}
        onSelect={onSelect}
        onToggleSelect={onToggleSelect}
        onSelectRange={onSelectRange}
        onSelectAll={onSelectAll}
        onRename={onFileRename}
        renamingId={renamingId}
        onStartRename={onStartRename}
        missingFiles={missingFiles}
      />
    </div>
  );
}
