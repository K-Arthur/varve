import type { FileEntry } from '@varve/platform';
import { formatBytes, formatRelativeTime } from '@varve/platform';
import { Button, Icon } from '@varve/ui';
import { confirmDialog } from './confirmDialog';

export interface TrashSectionProps {
  files: FileEntry[];
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onRefresh: () => void;
}

export function TrashSection({ files, onRestore, onPurge, onRefresh }: TrashSectionProps) {
  const handlePurgeAll = async () => {
    if (files.length === 0) return;
    if (
      await confirmDialog(
        'Empty trash',
        `Permanently delete all ${files.length} trashed files? This cannot be undone.`,
        { confirmLabel: 'Delete permanently', variant: 'danger' },
      )
    ) {
      Promise.all(files.map((f) => onPurge(f.id))).then(onRefresh);
    }
  };

  return (
    <div className="trash-section">
      <div className="trash-header">
        <h2 className="trash-header__title">Trash</h2>
        {files.length > 0 && (
          <Button variant="danger" size="sm" onClick={handlePurgeAll}>
            <Icon name="Trash2" label={undefined} size="0.85em" />
            Empty Trash
          </Button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {files.map((file) => (
          <div key={file.id} className="trash-item">
            <span className="trash-item__name">{file.name}</span>
            <span className="trash-item__meta">
              {file.trashedAt ? formatRelativeTime(file.trashedAt) : ''}
            </span>
            <span className="trash-item__meta">{file.size > 0 ? formatBytes(file.size) : ''}</span>
            <div className="trash-item__actions">
              <Button variant="ghost" size="sm" onClick={() => onRestore(file.id)}>
                <Icon name="RotateCcw" label="Restore" size="0.85em" />
                Restore
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  if (
                    await confirmDialog(
                      'Delete permanently',
                      `Permanently delete "${file.name}"? This cannot be undone.`,
                      { confirmLabel: 'Delete', variant: 'danger' },
                    )
                  ) {
                    onPurge(file.id);
                  }
                }}
              >
                <Icon name="Trash2" label="Delete permanently" size="0.85em" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
