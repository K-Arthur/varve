/**
 * Document Info dialog — answers "where did my file actually save?".
 *
 * Shows the authoritative save location (never a hidden SQLite path or
 * recovery storage), the save status, and location actions:
 * Save / Save As / Reveal in Files / Copy File Path.
 *
 * Accessibility: the shared @varve/ui Dialog handles modal semantics, focus
 * trapping and Escape; path text uses bidi isolation and full-length
 * tooltips so long paths never break the layout.
 */
import { Button, Dialog } from '@varve/ui';
import { useCallback, useState } from 'react';
import { useEditor } from '../../context';

const MAX_PATH_CHARS = 60;

/** Middle-truncate a long path so it never breaks a narrow dialog. */
export function truncatePathMiddle(path: string, max = MAX_PATH_CHARS): string {
  if (path.length <= max) return path;
  const keep = Math.floor((max - 1) / 2);
  return `${path.slice(0, keep)}\u2026${path.slice(-keep)}`;
}

export function DocumentInfoDialog() {
  const { state, setShowDocumentInfo, save, saveAs, platform } = useEditor();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'save' | 'save-as' | null>(null);

  const meta = state.sessions.find((sess) => sess.id === state.activeId);
  const dirty = state.dirty || meta?.dirty === true;
  const path = meta?.filePath;

  const location = ((): { label: string; full: string } => {
    if (meta?.filePath) {
      return { label: truncatePathMiddle(meta.filePath), full: meta.filePath };
    }
    if (meta?.saveHandleId) {
      return {
        label: `Browser file — ${meta.saveHandleName ?? meta.name ?? 'document.varve'}`,
        full: meta.saveHandleName ?? '',
      };
    }
    if (meta?.libraryStorage && meta.fileId) {
      return { label: 'Varve Library', full: 'Varve Library' };
    }
    if (meta?.downloadName) {
      return {
        label: `Browser download — ${meta.downloadName}`,
        full: 'Downloaded snapshots have no persistent location',
      };
    }
    return { label: 'Not saved to a file', full: 'Choose a location with Save or Save As' };
  })();

  const status = ((): string => {
    if (state.saveState === 'saving') return 'Saving…';
    if (state.saveState === 'error') return state.saveIssue?.message ?? 'Save failed';
    if (state.saveState === 'saved' && !dirty) return 'Saved';
    if (
      meta &&
      !meta.filePath &&
      !meta.libraryStorage &&
      !meta.saveHandleId &&
      !meta.downloadName
    ) {
      return 'Not saved';
    }
    return 'Modified';
  })();

  const handleSave = useCallback(async () => {
    setBusy('save');
    try {
      await save();
    } finally {
      setBusy(null);
    }
  }, [save]);

  const handleSaveAs = useCallback(async () => {
    setBusy('save-as');
    try {
      await saveAs();
    } finally {
      setBusy(null);
    }
  }, [saveAs]);

  const handleReveal = useCallback(() => {
    if (path) void platform?.revealInFileManager(path);
  }, [path, platform]);

  const handleCopyPath = useCallback(() => {
    if (!path) return;
    void navigator.clipboard
      .writeText(path)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }, [path]);

  const canReveal = Boolean(path);

  return (
    <Dialog
      open={state.documentInfoOpen}
      onClose={() => setShowDocumentInfo(false)}
      title="Document Info"
      footer={
        <div className="document-info__actions">
          <Button onClick={handleSave} disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
          <Button onClick={handleSaveAs} disabled={busy !== null}>
            {busy === 'save-as' ? 'Saving…' : 'Save As…'}
          </Button>
          <Button onClick={handleReveal} disabled={!canReveal || busy !== null}>
            {platform?.fileManagerLabel() ?? 'Reveal in Files'}
          </Button>
          <Button onClick={handleCopyPath} disabled={!canReveal}>
            {copied ? 'Path copied' : 'Copy File Path'}
          </Button>
        </div>
      }
    >
      <dl className="document-info">
        <div>
          <dt>Name</dt>
          <dd>{meta?.name ?? 'Untitled'}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            <span
              dir="ltr"
              title={location.full}
              className="document-info__path"
              data-testid="document-info-location"
            >
              {location.label}
            </span>
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd data-testid="document-info-status">{status}</dd>
        </div>
        <div>
          <dt>Last saved</dt>
          <dd>
            {state.lastSavedAt !== null ? new Date(state.lastSavedAt).toLocaleString() : 'Never'}
          </dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>Varve document</dd>
        </div>
      </dl>
    </Dialog>
  );
}
