import type { FileEntry, Project } from '@strata/platform';
import { Button, Icon } from '@strata/ui';
import { useState } from 'react';
import { FileGrid } from './FileGrid';

export interface ProjectsViewProps {
  project: Project | null;
  files: readonly FileEntry[];
  thumbnails: Map<string, string | null>;
  onOpen: (entry: FileEntry) => void;
  onContext: (e: React.MouseEvent, entry: FileEntry) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function ProjectsView({
  project,
  files,
  thumbnails,
  onOpen,
  onContext,
  onRename,
  onDelete,
}: ProjectsViewProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project?.name ?? '');

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
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--font-size-xl)',
              fontWeight: 'var(--font-weight-semibold)',
              background: 'transparent',
              border: 'none',
              borderBottom: '2px solid var(--color-interactive-default)',
              color: 'var(--color-text-primary)',
              outline: 'none',
            }}
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
      <FileGrid
        files={files}
        thumbnails={thumbnails}
        onLoadThumbnail={() => {}}
        onOpen={onOpen}
        onContext={onContext}
        selectedIds={[]}
      />
    </div>
  );
}
