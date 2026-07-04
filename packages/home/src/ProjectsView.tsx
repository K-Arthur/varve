import type { FileEntry, Folder, Platform, Project } from '@strata/platform';
import { Button, Icon } from '@strata/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
}: ProjectsViewProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project?.name ?? '');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

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

  const handleNavigate = useCallback((folderId: string | null) => {
    setActiveFolderId(folderId);
  }, []);

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
          <h2
            className="project-view__name"
            onDoubleClick={() => {
              setName(project.name);
              setEditing(true);
            }}
            title="Double-click to rename"
          >
            {project.name}
          </h2>
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
            <Icon name="Pen" label={undefined} size="0.85em" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm(`Delete project "${project.name}"? Files will become unfiled.`)) {
                onDelete(project.id);
              }
            }}
          >
            <Icon name="Trash2" label={undefined} size="0.85em" />
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
