import type { Platform, VersionEntry } from '@varve/platform';
import { formatAbsoluteTime, formatRelativeTime } from '@varve/platform';
import { AlertDialog, Button, Dialog, Icon, InlineActivityIndicator } from '@varve/ui';
import { useCallback, useEffect, useId, useState } from 'react';

export interface VersionHistoryProps {
  fileId: string;
  platform: Platform;
  onRestore: (versionId: string) => void;
  onClose: () => void;
}

interface DayGroup {
  date: string;
  label: string;
  versions: VersionEntry[];
}

function groupByDay(versions: VersionEntry[]): DayGroup[] {
  const now = Date.now();
  const today = new Date(now).toDateString();
  const yesterday = new Date(now - 86400000).toDateString();
  const groups = new Map<string, VersionEntry[]>();

  for (const v of versions) {
    const ds = new Date(v.timestamp).toDateString();
    const key = ds === today ? 'Today' : ds === yesterday ? 'Yesterday' : ds;
    const list = groups.get(key) ?? [];
    list.push(v);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([label, list]) => ({
    date: label,
    label,
    versions: list.sort((a, b) => b.timestamp - a.timestamp),
  }));
}

function getKindIcon(kind: VersionEntry['kind']): 'ClockArrowUp' | 'Bookmark' | 'Save' {
  switch (kind) {
    case 'named':
      return 'Bookmark';
    case 'checkpoint':
      return 'Save';
    default:
      return 'ClockArrowUp';
  }
}

function getKindLabel(kind: VersionEntry['kind']): string {
  switch (kind) {
    case 'named':
      return 'Named version';
    case 'checkpoint':
      return 'Checkpoint';
    default:
      return 'Auto-save';
  }
}

interface NamingFormProps {
  version: VersionEntry;
  onName: (id: string, name: string) => void;
  onCancel: () => void;
}

function NamingForm({ version, onName, onCancel }: NamingFormProps) {
  const inputId = useId();
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent | React.KeyboardEvent) => {
      e.preventDefault();
      if (value.trim()) {
        onName(version.id, value.trim());
        setValue('');
      }
    },
    [value, version.id, onName],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [onCancel],
  );

  return (
    <form className="version-history__naming-form" onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="version-history__naming-label">
        Name this version
      </label>
      <div className="version-history__naming-row">
        <input
          id={inputId}
          type="text"
          value={value}
          placeholder="e.g. Final, v2, Client approved"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="version-history__naming-input"
        />
        <Button variant="primary" size="sm" type="submit" disabled={!value.trim()}>
          Save
        </Button>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function VersionHistory({ fileId, platform, onRestore, onClose }: VersionHistoryProps) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [namingId, setNamingId] = useState<string | null>(null);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [revertVersionId, setRevertVersionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await platform.listVersions(fileId);
      setVersions(list);
    } catch {
      setError('Failed to load version history');
    } finally {
      setLoading(false);
    }
  }, [fileId, platform]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveVersion = useCallback(async () => {
    setSaving(true);
    try {
      await platform.saveVersion(fileId, '', undefined);
      await load();
    } catch {
      setError('Failed to save version');
    } finally {
      setSaving(false);
    }
  }, [fileId, platform, load]);

  const handleNameVersion = useCallback(
    async (_versionId: string, name: string) => {
      try {
        await platform.saveVersion(fileId, name, undefined);
        setNamingId(null);
        await load();
      } catch {
        setError('Failed to name version');
      }
    },
    [fileId, platform, load],
  );

  const handleDuplicate = useCallback(
    async (vid: string) => {
      try {
        const hash = await platform.restoreVersion(fileId, vid);
        if (hash) {
          await platform.saveVersion(fileId, `Copy of version ${vid.slice(0, 8)}`, undefined);
          await load();
        }
      } catch {
        setError('Failed to duplicate version');
      }
    },
    [fileId, platform, load],
  );

  const groups = groupByDay(versions);

  return (
    <>
      <Dialog open title="Version History" onClose={onClose} className="version-history">
        <div className="version-history__header">
          <Button variant="primary" size="sm" loading={saving} onClick={handleSaveVersion}>
            <Icon name="Save" label={undefined} />
            Save to Version History
          </Button>
        </div>

        {loading && (
          <div className="version-history__loading" role="status">
            <InlineActivityIndicator label="Loading version history" />
          </div>
        )}

        {error && (
          <div className="version-history__error" role="alert">
            <Icon name="TriangleAlert" label={undefined} />
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && versions.length === 0 && (
          <div className="version-history__empty">
            <div className="version-history__empty-icon">
              <Icon name="ClockArrowUp" size={48} label={undefined} />
            </div>
            <p className="version-history__empty-title">No versions yet</p>
            <p className="version-history__empty-desc">
              Every time you save, Varve creates a version so you can track changes, compare
              snapshots, and restore earlier work with confidence.
            </p>
            <Button variant="secondary" size="sm" onClick={handleSaveVersion}>
              <Icon name="Save" label={undefined} />
              Save your first version
            </Button>
          </div>
        )}

        {!loading && !error && versions.length > 0 && (
          <div className="version-history__timeline">
            {groups.map((group) => (
              <div key={group.date} className="version-history__day-group">
                <div className="version-history__day-label">
                  <span>{group.label}</span>
                  <span className="version-history__day-count">
                    {group.versions.length} version{group.versions.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="version-history__versions">
                  {group.versions.map((version) => (
                    <div key={version.id} className="version-history__version">
                      <div className="version-history__version-line">
                        <div className="version-history__version-dot" />
                        <div className="version-history__version-line-bar" />
                      </div>
                      <div className="version-history__version-body">
                        <div className="version-history__version-header">
                          <div className="version-history__version-icon">
                            <Icon name={getKindIcon(version.kind)} label={undefined} />
                          </div>
                          <div className="version-history__version-info">
                            {version.name ? (
                              <span className="version-history__version-name">{version.name}</span>
                            ) : (
                              <span className="version-history__version-kind">
                                {getKindLabel(version.kind)}
                              </span>
                            )}
                            <span className="version-history__version-time">
                              {formatRelativeTime(version.timestamp)}
                            </span>
                            <span className="version-history__version-absolute">
                              {formatAbsoluteTime(version.timestamp)}
                            </span>
                          </div>
                        </div>
                        {version.description && (
                          <p className="version-history__version-desc">{version.description}</p>
                        )}
                        <div className="version-history__version-actions">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setRevertVersionId(version.id)}
                          >
                            Restore
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setCompareVersionId(
                                compareVersionId === version.id ? null : version.id,
                              )
                            }
                          >
                            {compareVersionId === version.id ? 'Stop comparing' : 'Compare'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setNamingId(namingId === version.id ? null : version.id)}
                          >
                            {version.kind === 'named' ? 'Rename' : 'Name this version'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDuplicate(version.id)}
                          >
                            Duplicate
                          </Button>
                        </div>
                        {compareVersionId === version.id && (
                          <div className="version-history__diff" role="status">
                            <Icon name="GitCompare" label={undefined} />
                            <span>
                              Comparing {version.name ?? version.id.slice(0, 8)} with current
                              version
                            </span>
                          </div>
                        )}
                        {namingId === version.id && (
                          <NamingForm
                            version={version}
                            onName={handleNameVersion}
                            onCancel={() => setNamingId(null)}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      {revertVersionId && (
        <AlertDialog
          open
          onClose={() => setRevertVersionId(null)}
          onConfirm={() => {
            onRestore(revertVersionId);
            setRevertVersionId(null);
          }}
          title="Restore this version?"
          description="This will replace your current document with the selected version. You can undo this later by restoring another version."
          confirmLabel="Restore"
          cancelLabel="Cancel"
          variant="danger"
        />
      )}
    </>
  );
}
