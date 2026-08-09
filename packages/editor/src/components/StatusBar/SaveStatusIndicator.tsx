import { formatAbsoluteTime } from '@varve/platform';
import { Tooltip } from '@varve/ui';
import { useEffect, useRef } from 'react';
import { useEditor } from '../../context';

/**
 * Subtle save-status segment for the status bar.
 *
 * Reports the truth about persistence, not about recovery:
 *   - "Saving…"      — a write to the authoritative destination is in flight
 *   - "Saved"        — the current revision was written to the destination
 *   - "Modified"     — edits exist that have not been written (still true
 *                      after a stale-revision save completes)
 *   - "Not saved"    — no destination has ever been chosen
 *   - "Save failed"  — last save attempt failed; tooltip carries the issue
 *
 * Transitions into Saving / Saved / failed are announced through an
 * aria-live region (screen readers hear "Saving Poster.varve" /
 * "Poster.varve saved"); routine state renders stay silent.
 */
export function SaveStatusIndicator() {
  const { state, setShowDocumentInfo } = useEditor();
  const meta = state.sessions.find((sess) => sess.id === state.activeId);
  const name = meta?.name ?? 'Untitled';
  const dirty = state.dirty || meta?.dirty === true;

  const label = ((): string => {
    if (state.saveState === 'saving') return 'Saving…';
    if (state.saveState === 'error') return 'Save failed';
    if (state.saveState === 'saved' && !dirty) return 'Saved';
    // Modified beats "Not saved": an edited, never-saved document is first
    // and foremost modified — "Not saved" alone would be misleading.
    if (dirty) return 'Modified';
    if (meta && isUntitledSession(meta)) return 'Not saved';
    return 'Not saved';
  })();

  // Announce only meaningful transitions (never per-keystroke state).
  const announcedRef = useRef<string | null>(null);
  const announcement = ((): string | null => {
    if (state.saveState === 'saving') return `Saving ${name}`;
    if (state.saveState === 'saved' && !dirty && state.lastSavedAt !== null) {
      return `${name} saved`;
    }
    if (state.saveState === 'error') return `Could not save ${name}`;
    return null;
  })();

  useEffect(() => {
    if (announcement && announcement !== announcedRef.current) {
      announcedRef.current = announcement;
    } else if (!announcement) {
      announcedRef.current = null;
    }
  }, [announcement]);

  const lastAnnounced = announcedRef.current;
  const errorDetail =
    state.saveState === 'error' && state.saveIssue ? state.saveIssue.message : null;

  return (
    <>
      <Tooltip
        label={
          errorDetail ??
          (state.lastSavedAt !== null
            ? `Last saved ${formatAbsoluteTime(state.lastSavedAt)}`
            : name)
        }
      >
        <button
          type="button"
          className={`save-status save-status--${state.saveState === 'error' ? 'error' : dirty ? 'dirty' : 'ok'}`}
          aria-label={`${label} — open Document Info`}
          onClick={() => setShowDocumentInfo(true)}
        >
          {label}
        </button>
      </Tooltip>
      <span className="save-status__live" role="status" aria-live="polite">
        {lastAnnounced}
      </span>
    </>
  );
}

function isUntitledSession(meta: {
  filePath?: string;
  fileId?: string;
  libraryStorage?: boolean;
  saveHandleId?: string;
  downloadName?: string;
}): boolean {
  // A bare fileId is library identity (minted at creation), not a
  // destination — only an explicit library choice counts as saved.
  return !meta.filePath && !meta.libraryStorage && !meta.saveHandleId && !meta.downloadName;
}
