import type { Project } from '@strata/platform';
import { Button, Icon } from '@strata/ui';

export interface BatchActionsProps {
  selectedCount: number;
  projects: Project[];
  onMoveToProject: (projectId: string | null) => void;
  onTrash: () => void;
  onFavorite: () => void;
  onExport: () => void;
  onDeselect: () => void;
}

export function BatchActions({
  selectedCount,
  projects,
  onMoveToProject,
  onTrash,
  onFavorite,
  onExport,
  onDeselect,
}: BatchActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="batch-actions" role="toolbar" aria-label="Batch file actions">
      <span className="batch-actions__count">{selectedCount} selected</span>

      <div className="batch-actions__group">
        {projects.length > 0 && (
          <div className="batch-actions__move-group">
            <Button
              variant="secondary"
              className="batch-actions__move-btn"
              aria-label="Move to project"
              onClick={() => onMoveToProject(null)}
            >
              <Icon name="Folder" label={undefined} size="0.9rem" />
              Move to…
            </Button>
            {projects.slice(0, 3).map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                className="batch-actions__project-btn"
                title={`Move to ${p.name}`}
                onClick={() => onMoveToProject(p.id)}
              >
                {p.name}
              </Button>
            ))}
          </div>
        )}

        <Button variant="secondary" onClick={onTrash}>
          <Icon name="Trash2" label={undefined} size="0.9rem" />
          Trash
        </Button>

        <Button variant="secondary" onClick={onFavorite}>
          <Icon name="Star" label={undefined} size="0.9rem" />
          Favorite
        </Button>

        <Button variant="secondary" onClick={onExport}>
          <Icon name="Download" label={undefined} size="0.9rem" />
          Export
        </Button>
      </div>

      <Button variant="ghost" className="batch-actions__deselect" onClick={onDeselect}>
        Deselect all
      </Button>
    </div>
  );
}
