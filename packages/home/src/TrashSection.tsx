import type { FileEntry } from '@strata/platform';
import { formatBytes, formatRelativeTime } from '@strata/platform';
import { Button, Icon } from '@strata/ui';

export interface TrashSectionProps {
  files: FileEntry[];
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onRefresh: () => void;
}

export function TrashSection({ files, onRestore, onPurge, onRefresh }: TrashSectionProps) {
  const handlePurgeAll = () => {
    if (files.length === 0) return;
    if (confirm(`Permanently delete all ${files.length} trashed files? This cannot be undone.`)) {
      Promise.all(files.map((f) => onPurge(f.id))).then(onRefresh);
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-3)',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'var(--font-weight-semibold)',
            margin: 0,
          }}
        >
          Trash
        </h2>
        {files.length > 0 && (
          <Button variant="danger" size="sm" onClick={handlePurgeAll}>
            <Icon name="Trash2" label={undefined} size="0.85em" />
            Empty Trash
          </Button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {files.map((file) => (
          <div
            key={file.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-raised)',
            }}
          >
            <span
              style={{
                flex: 1,
                fontWeight: 'var(--font-weight-medium)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              {file.name}
            </span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {file.trashedAt ? formatRelativeTime(file.trashedAt) : ''}
            </span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {file.size > 0 ? formatBytes(file.size) : ''}
            </span>
            <Button variant="ghost" size="sm" onClick={() => onRestore(file.id)}>
              <Icon name="RotateCcw" label="Restore" size="0.85em" />
              Restore
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (confirm(`Permanently delete "${file.name}"? This cannot be undone.`)) {
                  onPurge(file.id);
                }
              }}
            >
              <Icon name="Trash2" label="Delete permanently" size="0.85em" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
