/**
 * Dirty-document registry — derives the authoritative unsaved-work set from
 * the editor's session array (ADR-0216 D3). Hidden/inactive sessions count:
 * the registry lives above purely visual state, so quitting from Home still
 * sees every dirty editor session.
 */

import type { DirtyScope, EditorLifecycleApi, TerminationIntent, UnsavedDocument } from './types';

/** Intent → which set of sessions it inspects. */
export function scopeForIntent(intent: TerminationIntent): DirtyScope {
  switch (intent) {
    case 'close-document':
      return 'document';
    case 'close-window':
      return 'window';
    case 'quit-application':
    case 'reload':
    case 'restart':
      return 'application';
  }
}

/** Session ids in the given scope (all sessions today — single window). */
export function scopeSessionIds(api: EditorLifecycleApi, scope: DirtyScope): string[] {
  const sessions = api.getSessions();
  if (scope === 'document') {
    const active = api.getActiveSessionId();
    return active && sessions.some((s) => s.id === active) ? [active] : [];
  }
  return sessions.map((s) => s.id);
}

/**
 * Collect the unsaved documents a scope must resolve before termination.
 * A recovery/autosave snapshot does NOT make a document clean — dirty
 * + snapshot still counts as unsaved work for intentional termination.
 */
export function collectUnsavedDocuments(
  api: EditorLifecycleApi,
  scope: DirtyScope,
): UnsavedDocument[] {
  const sessions = api.getSessions();
  const ids = scopeSessionIds(api, scope);
  const docs: UnsavedDocument[] = [];
  for (const session of sessions) {
    if (!session.dirty || !ids.includes(session.id)) continue;
    docs.push({
      sessionId: session.id,
      name: displayName(sessions, session),
      filePath: session.filePath,
      fileId: session.fileId,
      untitled: !session.filePath && !session.fileId,
    });
  }
  return docs;
}

/** Fast check used by unload handlers. */
export function hasUnsavedDocuments(api: EditorLifecycleApi, scope: DirtyScope): boolean {
  const ids = scopeSessionIds(api, scope);
  return api.getSessions().some((s) => s.dirty && ids.includes(s.id));
}

/**
 * Display name with duplicate-untitled disambiguation: two unsaved tabs both
 * named "Untitled" render as "Untitled 1" / "Untitled 2" by session order.
 * Never exposes filesystem paths beyond the name itself.
 */
export function displayName(
  sessions: ReadonlyArray<{ id: string; name: string }>,
  session: { id: string; name: string },
): string {
  const index = sessions.findIndex((s) => s.id === session.id);
  if (index < 0) return session.name;
  const base = stripUntitledNumber(session.name);
  if (base === null) return session.name;
  // Position among untitled-name sessions up to and including this one.
  const position = sessions
    .slice(0, index + 1)
    .filter((s) => stripUntitledNumber(s.name) !== null).length;
  return position > 1 ? `${base} ${position}` : base;
}

/** 'Untitled' / 'Untitled 2' → 'Untitled'; anything else → null. */
function stripUntitledNumber(name: string): string | null {
  const match = /^Untitled(\s+\d+)?$/.exec(name);
  return match ? 'Untitled' : null;
}
