import type { BackupIndexEntry, BackupManifest } from '@varve/engine';
import { useCallback, useEffect, useState } from 'react';
import type { BackupService } from '../../backupService';
import { useEditor } from '../../context';
import './backup.css';

interface RestoreBrowserProps {
  backupService: BackupService;
  projectId: string;
  onClose?: () => void;
}

export function RestoreBrowser({ backupService, projectId, onClose }: RestoreBrowserProps) {
  const editor = useEditor();
  const [backups, setBackups] = useState<BackupIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedManifest, setSelectedManifest] = useState<BackupManifest | null>(null);
  const [restoreMode, setRestoreMode] = useState<'copy' | 'replace'>('copy');
  const [restoring, setRestoring] = useState(false);

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await backupService.getBackups(projectId);
      setBackups(entries);
    } finally {
      setLoading(false);
    }
  }, [backupService, projectId]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const handleSelect = useCallback(
    async (id: string) => {
      setSelectedId(id);
      const engine = backupService.getEngine();
      if (engine) {
        const manifest = await engine.getBackupManifest(id);
        setSelectedManifest(manifest);
      }
    },
    [backupService],
  );

  const handleRestore = useCallback(async () => {
    if (!selectedId) return;
    setRestoring(true);
    try {
      const ok = await editor.restoreFromBackup(selectedId, restoreMode === 'copy');
      if (ok) {
        onClose?.();
      } else {
        // Could not retrieve the backup — surface a message
        setRestoring(false);
      }
    } finally {
      setRestoring(false);
    }
  }, [selectedId, restoreMode, editor, onClose]);

  const formatDate = (ts: number): string => {
    return new Date(ts).toLocaleString();
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="restore-browser__loading" role="status">
        Loading backups...
      </div>
    );
  }

  return (
    <section className="restore-browser" aria-label="Restore browser">
      <h3 className="restore-browser__title">Version History & Backups</h3>

      {backups.length === 0 ? (
        <p className="restore-browser__empty">No backups found for this project.</p>
      ) : (
        <div className="restore-browser__list" role="listbox" aria-label="Available backups">
          {backups.map((backup) => {
            const isSelected = backup.id === selectedId;
            return (
              <button
                key={backup.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(backup.id)}
                className={`restore-browser__item ${isSelected ? 'restore-browser__item--selected' : ''}`}
              >
                <div className="restore-browser__item-type">
                  {backup.type === 'snapshot'
                    ? 'Snapshot'
                    : backup.type === 'automatic'
                      ? 'Auto'
                      : backup.type === 'pre-migration'
                        ? 'Pre-migration'
                        : backup.type === 'pre-close'
                          ? 'Pre-close'
                          : backup.type === 'bulk'
                            ? 'Bulk'
                            : 'Manual'}
                </div>
                <div className="restore-browser__item-info">
                  <span className="restore-browser__item-date">{formatDate(backup.createdAt)}</span>
                  <span className="restore-browser__item-size">{formatSize(backup.size)}</span>
                  <span
                    className={`restore-browser__item-status restore-browser__item-status--${backup.verificationStatus}`}
                  >
                    {backup.verificationStatus === 'verified'
                      ? 'Verified'
                      : backup.verificationStatus === 'corrupted'
                        ? 'Corrupted'
                        : 'Unverified'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedManifest && (
        <div className="restore-browser__details" aria-live="polite">
          <h4>Backup Details</h4>
          <dl className="restore-browser__details-list">
            <dt>Name</dt>
            <dd>{selectedManifest.sourceName}</dd>
            <dt>Created</dt>
            <dd>{formatDate(selectedManifest.createdAt)}</dd>
            <dt>Schema version</dt>
            <dd>{selectedManifest.schemaVersion}</dd>
            <dt>Document checksum</dt>
            <dd className="restore-browser__checksum">{selectedManifest.documentChecksum}</dd>
            <dt>Status</dt>
            <dd>{selectedManifest.verificationStatus}</dd>
            {selectedManifest.notes && (
              <>
                <dt>Notes</dt>
                <dd>{selectedManifest.notes}</dd>
              </>
            )}
          </dl>

          <div className="restore-browser__mode">
            <label>
              <input
                type="radio"
                name="restore-mode"
                checked={restoreMode === 'copy'}
                onChange={() => setRestoreMode('copy')}
              />
              Restore as copy
            </label>
            <label>
              <input
                type="radio"
                name="restore-mode"
                checked={restoreMode === 'replace'}
                onChange={() => setRestoreMode('replace')}
              />
              Replace current project
            </label>
            {restoreMode === 'replace' && (
              <p className="restore-browser__warning">
                This will overwrite the current project. A safety snapshot will be created first.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleRestore}
            disabled={restoring}
            className="restore-browser__button restore-browser__button--primary"
            aria-label={restoreMode === 'copy' ? 'Restore as a copy' : 'Replace current project'}
          >
            {restoring
              ? 'Restoring...'
              : restoreMode === 'copy'
                ? 'Restore as Copy'
                : 'Replace Project'}
          </button>
        </div>
      )}

      {onClose && (
        <button type="button" onClick={onClose} className="restore-browser__button">
          Close
        </button>
      )}
    </section>
  );
}
