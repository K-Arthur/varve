/**
 * Termination lifecycle types — the shared contract for the coordinator,
 * dialog host, save plan, and platform bridges.
 *
 * Invariant (ADR-0216): every graceful termination request converges on the
 * coordinator's data-integrity decision. No presentation component, native
 * menu item, shortcut, OS window event, or browser lifecycle event may
 * independently decide that user data can be destroyed.
 */

/** Semantic termination scopes. 'close-document' closes only the active
 *  session; 'close-window' closes one native window and its sessions;
 *  'quit-application' closes everything. reload/restart reuse the same
 *  save-resolution guard as quitting. */
export type TerminationIntent =
  | 'close-document'
  | 'close-window'
  | 'quit-application'
  | 'reload'
  | 'restart';

/** Coordinator state machine (ADR-0216 D1). */
export type TerminationPhase =
  | 'idle'
  | 'checking'
  | 'awaiting-user'
  | 'saving'
  | 'finalizing'
  | 'committed'
  | 'cancelled';

/** Which set of sessions a termination scope inspects. */
export type DirtyScope = 'document' | 'window' | 'application';

/** Structured persistence failure taxonomy — never raw stack traces. */
export type SaveFailureCategory =
  | 'permission'
  | 'disk-full'
  | 'path-missing'
  | 'cancelled'
  | 'serialization'
  | 'platform-unavailable'
  | 'conflict'
  | 'unknown';

/** One unsaved document as seen by the termination dialog. */
export interface UnsavedDocument {
  sessionId: string;
  name: string;
  /** Bound to a path on disk (opened from Recent/disk). */
  filePath?: string;
  /** Bound to an app-store id (identity in the Home index — NOT itself a
   *  save destination; see SessionFileMeta). */
  fileId?: string;
  /** Explicitly chose Varve Library as the document's destination. */
  libraryStorage?: boolean;
  /** A persisted browser File System Access handle key. */
  saveHandleId?: string;
  /** No real destination chosen yet — needs Save As to persist. */
  untitled: boolean;
}

/** Per-document outcome after the save plan resolves it (ADR-0216 D4). */
export type QuitDocumentResult =
  | { kind: 'saved'; sessionId: string }
  | { kind: 'discarded'; sessionId: string }
  | { kind: 'failed'; sessionId: string; category: SaveFailureCategory }
  | { kind: 'cancelled'; sessionId: string };

/** Final result of a termination transaction. */
export type TerminationResult =
  | { outcome: 'committed' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; failures: QuitDocumentResult[] };

/** User choice for one unsaved document (unsaved prompt). */
export type UnsavedChoice = 'save' | 'discard';

/** User choice for one failed save (save-failed prompt). */
export type FailureChoice = 'retry' | 'save-as' | 'discard' | 'cancel';

export interface DialogOutcome {
  kind: 'proceed';
  choices: Array<{ sessionId: string; choice: UnsavedChoice | FailureChoice }>;
}

export type PromptKind = 'unsaved' | 'save-failed';

/** A dialog request issued by the coordinator. The host renders from the
 *  latest request; `respond` resolves the coordinator's wait. When a broader
 *  request supersedes a pending one, the coordinator resolves the old
 *  `respond` with `null` and the host replaces the dialog. */
export interface PromptRequest {
  promptId: number;
  docs: Array<UnsavedDocument & { failureCategory?: SaveFailureCategory }>;
  intent: TerminationIntent;
  kind: PromptKind;
  respond: (outcome: DialogOutcome | null) => void;
}

/** Result of an editor save attempt. `cancelled: true` means the user
 *  dismissed a Save As picker — never interpreted as "discard". */
export type SaveOutcome = { ok: true } | { ok: false; cancelled: boolean };

/** Editor surface the coordinator drives. Implemented by the React host
 *  (LifecycleProvider) against the editor context; faked in tests. */
export interface EditorLifecycleApi {
  /** All sessions owned by this window (today: the single window). */
  getSessions(): ReadonlyArray<{
    id: string;
    name: string;
    dirty: boolean;
    filePath?: string;
    fileId?: string;
    libraryStorage?: boolean;
    saveHandleId?: string;
  }>;
  getActiveSessionId(): string | null;
  /** Save the session (switching tabs when it is not active). */
  saveSession(sessionId: string): Promise<SaveOutcome>;
  /** Force a Save As flow for the session. */
  saveSessionAs(sessionId: string): Promise<SaveOutcome>;
  /** Fresh dirty read after a save (revision-race detection). */
  isSessionDirty(sessionId: string): boolean;
  /** Close a tab. `force` bypasses the dirty guard (resolved documents). */
  closeTab(sessionId: string, force?: boolean): boolean;
  switchTab(sessionId: string): void;
  /** Last save failure category (default 'unknown' until M5 classifies). */
  getLastSaveFailure(sessionId: string): SaveFailureCategory;
  /** Navigate back to Home without closing documents (Resume Editing). */
  goHome(): void;
}

/** Optional, bounded commit-phase cleanup (ADR-0216 D8). */
export interface Finalizer {
  id: string;
  /** Which scope the finalizer belongs to. */
  scope: DirtyScope;
  /** Lower priority runs first. */
  priority: number;
  /** Must honour the signal; must not wait forever. */
  finalize(signal: AbortSignal): Promise<void> | void;
}

/** Structured diagnostics events (dev-only; no document contents). */
export type TerminationTraceEvent =
  | { type: 'request'; intent: TerminationIntent; source?: string }
  | { type: 'scope'; intent: TerminationIntent; scope: DirtyScope; dirtyCount: number }
  | { type: 'dialog'; kind: PromptKind; count: number }
  | { type: 'dialog-resolved'; outcome: 'proceed' | 'cancel' | 'superseded' }
  | { type: 'save.start'; sessionId: string }
  | { type: 'save.finish'; sessionId: string; ok: boolean }
  | { type: 'finalize'; intent: TerminationIntent }
  | { type: 'clean-marker' }
  | { type: 'commit'; intent: TerminationIntent }
  | { type: 'cancel'; reason: 'user' | 'save-as-cancelled' | 'finalize-failed' };

/** Snapshot of the coordinator surfaced to the dialog host / bridge. */
export interface TerminationState {
  phase: TerminationPhase;
  intent: TerminationIntent | null;
  dirtyDocs: UnsavedDocument[];
  /** Session ids in the current scope (for commit-time closing). */
  scopeSessionIds: string[];
  failures: QuitDocumentResult[];
}
