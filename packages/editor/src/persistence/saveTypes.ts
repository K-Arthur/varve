/**
 * @varve/editor — save intents, outcomes and save-target resolution.
 *
 * One authoritative save service (see saveCoordinator.ts) serves every
 * entry point: menu Save, keyboard Save, quit Save, Save As, Save a Copy.
 * Intents differ in what they are allowed to mutate:
 *   - save      — writes to the CURRENT target (choosing one on first save);
 *                 only a successful write to the authoritative destination
 *                 may mark the document clean.
 *   - save-as   — chooses a NEW destination; the session adopts it ONLY
 *                 after the write succeeds. Document identity is stable.
 *   - save-copy — writes elsewhere WITHOUT adopting and WITHOUT touching
 *                 dirty state; the active document stays as it was.
 */
import type { SaveTarget } from '@varve/platform';
import type { SaveIssue, SessionFileMeta } from '../context/types';

export type SaveIntent = 'save' | 'save-as' | 'save-copy';

export type SaveOutcome =
  | { status: 'saved' }
  | { status: 'saved-copy' }
  | { status: 'cancelled' }
  | { status: 'failed'; issue: SaveIssue };

/** Coalescible intents may be skipped when a newer request supersedes them
 *  (Ctrl+S spam). Save As / Save a Copy always run — they are deliberate,
 *  state-affecting choices. */
export function isCoalescibleIntent(intent: SaveIntent): boolean {
  return intent === 'save';
}

/**
 * Resolve a session's current save destination.
 *
 * Order matters: a native path, a browser file handle, explicit Varve
 * Library storage, a download-only snapshot, or nothing. Recovery and the
 * internal Home mirror are NEVER destinations — they are autosave internals
 * and must never be reported as "Saved".
 */
export function saveTargetFromSession(meta: SessionFileMeta | undefined): SaveTarget {
  if (meta?.filePath) return { kind: 'native-file', path: meta.filePath };
  if (meta?.saveHandleId) {
    return {
      kind: 'web-file-handle',
      handleId: meta.saveHandleId,
      displayName: meta.saveHandleName ?? meta.name ?? 'document.varve',
    };
  }
  if (meta?.fileId) return { kind: 'app-storage', fileId: meta.fileId };
  if (meta?.downloadName) return { kind: 'download-only', suggestedName: meta.downloadName };
  return { kind: 'unsaved' };
}
