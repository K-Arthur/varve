import { Select } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackupService, IncludeAssetsPolicy } from '../../backupService';
import './backup.css';

interface BackupSettingsPanelProps {
  backupService: BackupService;
  onClose?: () => void;
}

type BusyOp = 'backup' | 'verify' | null;

export function BackupSettingsPanel({ backupService, onClose }: BackupSettingsPanelProps) {
  const config = backupService.getConfig();
  const [enabled, setEnabled] = useState(config.enabled);
  const [interval, setInterval] = useState(config.intervalMs / 1000 / 60);
  const [includeAssets, setIncludeAssets] = useState(config.includeAssets);
  const [storageInfo, setStorageInfo] = useState({ totalBytes: 0, entryCount: 0, projectCount: 0 });
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [lastVerification, setLastVerification] = useState<string | null>(null);
  const [nextBackup, setNextBackup] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyOp>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const [info, state] = await Promise.all([
      backupService.getStorageInfo(),
      Promise.resolve(backupService.getState()),
    ]);
    setStorageInfo(info);
    if (state.lastBackupAt) setLastBackup(new Date(state.lastBackupAt).toLocaleString());
    if (state.lastVerificationAt) {
      setLastVerification(new Date(state.lastVerificationAt).toLocaleString());
    }
    if (state.nextBackupAt) setNextBackup(new Date(state.nextBackupAt).toLocaleString());
    else setNextBackup(null);
  }, [backupService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(() => {
    backupService.updateConfig({
      enabled,
      intervalMs: interval * 60 * 1000,
      includeAssets: includeAssets as 'none' | 'used' | 'all',
    });
    setError(null);
    setMessage('Settings saved.');
    void refresh();
    onClose?.();
  }, [backupService, enabled, interval, includeAssets, onClose, refresh]);

  const handleBackupNow = useCallback(async () => {
    setBusy('backup');
    setError(null);
    setMessage('Backing up dirty projects...');
    try {
      const { backedUp, failed } = await backupService.backupAllDirty();
      if (failed > 0) {
        setError(`Backed up ${backedUp}, ${failed} failed.`);
      } else if (backedUp === 0) {
        setMessage('No dirty projects to back up.');
      } else {
        setMessage(`Backed up ${backedUp} project(s).`);
      }
    } catch (e) {
      setError(`Backup failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      void refresh();
    }
  }, [backupService, refresh]);

  const handleVerifyNow = useCallback(async () => {
    setBusy('verify');
    setError(null);
    setMessage('Verifying all backups...');
    abortRef.current = new AbortController();
    try {
      const store = backupService.getEngine();
      if (!store) {
        setError('Backup engine not initialized.');
        return;
      }
      const projects = await store.getStorageInfo();
      let totalValid = 0;
      let totalCorrupted = 0;
      for (const projectId of await store.listProjects()) {
        if (abortRef.current.signal.aborted) break;
        const result = await backupService.verifyAllBackups(projectId);
        totalValid += result.valid;
        totalCorrupted += result.corrupted;
      }
      if (abortRef.current.signal.aborted) {
        setMessage('Verification cancelled.');
      } else if (totalCorrupted > 0) {
        setError(`Found ${totalCorrupted} corrupted of ${totalValid + totalCorrupted} total.`);
      } else {
        setMessage(
          `All backups verified (${projects.projectCount} projects, ${totalValid} entries).`,
        );
      }
    } catch (e) {
      setError(`Verification failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      abortRef.current = null;
      void refresh();
    }
  }, [backupService, refresh]);

  const handleCancelOp = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <section className="backup-settings" aria-label="Backup settings">
      <h3 className="backup-settings__title">Backup &amp; Recovery</h3>

      <div className="backup-settings__section">
        <label className="backup-settings__toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-describedby="backup-toggle-desc"
          />
          <span>Enable automatic backups</span>
        </label>
        <p id="backup-toggle-desc" className="backup-settings__description">
          Periodically save versioned backups of your projects
        </p>
      </div>

      {enabled && (
        <>
          <div className="backup-settings__field">
            <label htmlFor="backup-interval">Backup interval (minutes)</label>
            <input
              id="backup-interval"
              type="number"
              min={1}
              max={120}
              value={interval}
              onChange={(e) => setInterval(Math.max(1, Number(e.target.value)))}
              className="backup-settings__input"
            />
          </div>

          <div className="backup-settings__field">
            <Select
              label="Include assets"
              value={includeAssets}
              onChange={(v) => setIncludeAssets(v as IncludeAssetsPolicy)}
              options={[
                { value: 'none', label: 'None (document only)' },
                { value: 'used', label: 'Used in project' },
                { value: 'all', label: 'All linked assets' },
              ]}
            />
          </div>

          <div className="backup-settings__status" role="status" aria-live="polite">
            <h4>Storage</h4>
            <div className="backup-settings__stat">
              <span>Projects backed up:</span>
              <span>{storageInfo.projectCount}</span>
            </div>
            <div className="backup-settings__stat">
              <span>Total backup entries:</span>
              <span>{storageInfo.entryCount}</span>
            </div>
            <div className="backup-settings__stat">
              <span>Storage used:</span>
              <span>{formatBytes(storageInfo.totalBytes)}</span>
            </div>
            {lastBackup && (
              <div className="backup-settings__stat">
                <span>Last backup:</span>
                <span>{lastBackup}</span>
              </div>
            )}
            {nextBackup && (
              <div className="backup-settings__stat">
                <span>Next backup:</span>
                <span>{nextBackup}</span>
              </div>
            )}
            {lastVerification && (
              <div className="backup-settings__stat">
                <span>Last verification:</span>
                <span>{lastVerification}</span>
              </div>
            )}
          </div>

          {message && (
            <p className="backup-settings__message" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="backup-settings__message backup-settings__message--error" role="alert">
              {error}
            </p>
          )}

          <div className="backup-settings__actions">
            <button
              type="button"
              onClick={busy === 'backup' ? handleCancelOp : handleBackupNow}
              disabled={busy === 'verify'}
              className="backup-settings__button"
              aria-label={busy === 'backup' ? 'Cancel backup' : 'Backup all projects now'}
            >
              {busy === 'backup' ? 'Cancel' : 'Backup Now'}
            </button>
            <button
              type="button"
              onClick={busy === 'verify' ? handleCancelOp : handleVerifyNow}
              disabled={busy === 'backup'}
              className="backup-settings__button"
              aria-label={busy === 'verify' ? 'Cancel verification' : 'Verify all backups'}
            >
              {busy === 'verify' ? 'Cancel' : 'Verify Backups'}
            </button>
          </div>
        </>
      )}

      <div className="backup-settings__actions">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy !== null}
          className="backup-settings__button backup-settings__button--primary"
        >
          Save Settings
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="backup-settings__button">
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
