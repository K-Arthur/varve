/**
 * usePersistentHistory — React wiring for the persistent history session
 * (ADR-0019 Model A, M7/M8 editor integration).
 *
 * Owns the per-document EditorHistorySession, attaches on document switch
 * (genesis/recovery/reconciliation), serializes transaction captures behind
 * attach, and routes undo/redo/navigation through the revision store when
 * history is attached. Falls back to a memory store when IndexedDB is
 * unavailable (jsdom tests, exotic webviews) and degrades to no-ops when
 * the session fails to attach — the editor never blocks on history.
 *
 * The hook follows the AGENTS.md `context/useX.ts` pattern: all heavy state
 * lives here; context.tsx calls it once and threads the returned session
 * into the context value.
 */

import type { HistoryStore } from '@varve/history';
import {
  createIndexedDbHistoryStore,
  createMemoryHistoryStore,
  diffDocuments,
} from '@varve/history';
import type { Document, NodeId } from '@varve/scene';
import {
  createDefaultIsometricGrid,
  initializeDefaultGridSettings as sceneInitializeGridSettings,
} from '@varve/scene';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  EditorHistorySession,
  type HistoryIssue,
  type HistoryStepView,
} from '../history/editorHistorySession';
import {
  createDefaultDocumentGridSettings,
  type EditorState,
  type PersistentHistoryApi,
} from './types';

interface UsePersistentHistoryOptions {
  document: Document | null;
  selection: NodeId[];
  patch: (partial: Partial<EditorState>) => void;
  /** Transaction-open flag owned by context.tsx (skip mid-gesture diffs). */
  inTransactionRef: { current: boolean };
  /** One-shot skip signal set by context.tsx when the commit boundary has
   *  already captured a transition (consumed by the document watcher). */
  historySkipRef: { current: boolean };
}

/** Singleton store factory: IndexedDB when available, memory fallback. */
function createStoreFactory(): () => HistoryStore {
  let store: HistoryStore | null = null;
  return () => {
    if (store) return store;
    const canUseIdb =
      typeof indexedDB !== 'undefined' &&
      typeof indexedDB.open === 'function' &&
      typeof IDBKeyRange !== 'undefined';
    if (canUseIdb) {
      try {
        store = createIndexedDbHistoryStore();
        return store;
      } catch {
        // fall through to memory
      }
    }
    store = createMemoryHistoryStore();
    return store;
  };
}

function syncGridFromDocument(document: Document) {
  const initialized = sceneInitializeGridSettings(document);
  const documentGrid =
    initialized.gridSettings?.documentGrid ?? createDefaultDocumentGridSettings();
  const isometricGrid =
    Object.values(initialized.gridSettings?.isometricGrids ?? {})[0] ??
    createDefaultIsometricGrid();
  return { documentGrid, isometricGrid };
}

export function usePersistentHistory(options: UsePersistentHistoryOptions): PersistentHistoryApi {
  const { document, selection, patch, inTransactionRef, historySkipRef } = options;
  const documentId = document?.id ?? null;

  const sessionRef = useRef<EditorHistorySession | null>(null);
  const attachPromiseRef = useRef<Promise<void> | null>(null);
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  /** Previous document reference seen by the watcher (per document id). */
  const prevDocumentRef = useRef<{ documentId: string | null; document: Document | null }>({
    documentId: null,
    document: null,
  });

  const [attached, setAttached] = useState(false);
  const [attachIssues, setAttachIssues] = useState<HistoryIssue[]>([]);
  const [reconciled, setReconciled] = useState(false);
  const [version, bump] = useReducer((v: number) => v + 1, 0);

  const getStore = useMemo(() => createStoreFactory(), []);

  /**
   * In-flight attach dedupe: React StrictMode double-mounts effects in dev,
   * and document switches can re-run the effect before the previous attach
   * settled. Two concurrent attaches would each see "no branches" and
   * create duplicate genesis revisions and duplicate main branches. A
   * shared in-flight promise per document id makes attach idempotent: the
   * second caller awaits the first attach and reuses its session.
   */
  const inflightAttachRef = useRef<Map<string, Promise<EditorHistorySession>>>(new Map());

  useEffect(() => {
    let cancelled = false;
    if (!documentId || !document) {
      sessionRef.current = null;
      attachPromiseRef.current = null;
      setAttached(false);
      setAttachIssues([]);
      return;
    }
    const inflight = inflightAttachRef.current.get(documentId);
    if (inflight) {
      // A previous attach for this document is still running; reuse it so
      // genesis/branches are never created twice (StrictMode double-mount,
      // rapid document switches).
      const existing = inflight.then((session) => {
        if (cancelled) return;
        sessionRef.current = session;
        setAttached(true);
        setReconciled(session.lastAttach?.reconciled ?? false);
        setAttachIssues(session.lastAttach?.issues ?? []);
        bump();
      });
      attachPromiseRef.current = existing as unknown as Promise<void>;
      prevDocumentRef.current = { documentId, document };
      return () => {
        cancelled = true;
      };
    }
    const session = new EditorHistorySession({
      store: getStore(),
      documentId,
      authorActorId: 'local-user',
    });
    sessionRef.current = session;
    const attachPromise = session.attach(document);
    const tracked = attachPromise
      .then(() => session)
      .catch((err) => {
        if (cancelled) throw err;
        console.warn('[history] attach failed; history disabled for this document', err);
        setAttachIssues([
          { severity: 'error', code: 'history.attach-failed', message: String(err) },
        ]);
        setAttached(false);
        throw err;
      });
    inflightAttachRef.current.set(documentId, tracked);
    tracked.finally(() => {
      inflightAttachRef.current.delete(documentId);
    });
    void attachPromise
      .then(() => {
        if (cancelled) return;
        setAttached(true);
        setReconciled(session.lastAttach?.reconciled ?? false);
        setAttachIssues(session.lastAttach?.issues ?? []);
        bump();
      })
      .catch(() => {
        if (cancelled) return;
        setAttached(false);
      });
    attachPromiseRef.current = tracked as unknown as Promise<void>;
    prevDocumentRef.current = { documentId, document };
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, getStore]);

  /**
   * Document watcher: captures EVERY document reference change into the
   * persistent log, no matter which mutation path produced it (updateDoc
   * outside transactions, direct setState replacements, paste, load).
   * Guards:
   * - session-applied changes (undo/redo/checkout) set `historySkipRef`
   * - transaction-commit captures are signaled by context.tsx setting the
   *   skip flag BEFORE the render that carries the committed document
   * - mid-gesture updates inside an open transaction are skipped — the
   *   commit boundary captures the whole step
   */
  useEffect(() => {
    const session = sessionRef.current;
    const prev = prevDocumentRef.current;
    const currentDocument = document ?? null;
    prevDocumentRef.current = { documentId, document: currentDocument };
    if (!session || !currentDocument) return;
    if (documentId !== prev.documentId) return;
    const before = prev.document;
    if (!before || before === currentDocument) return;
    if (historySkipRef.current) {
      historySkipRef.current = false;
      return;
    }
    if (inTransactionRef.current) return;
    const label = captureLabelFor(before, currentDocument);
    void session
      .capture(before, currentDocument, selectionRef.current, { label, kind: 'modify' })
      .then(() => bump())
      .catch((err) => console.warn('[history] watcher capture failed', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, documentId, inTransactionRef, historySkipRef]);

  /** Deterministic step label: best single change summary from the diff. */
  function captureLabelFor(before: Document, after: Document): string {
    const diff = diffDocuments(before, after);
    if (diff.changes.length === 0) return 'Edit';
    const counts = diff.summary;
    if (counts.added > 0 && counts.removed === 0 && counts.modified === 0) return 'Create';
    if (counts.removed > 0 && counts.added === 0 && counts.modified === 0) return 'Delete';
    if (counts.text > 0 && counts.added + counts.removed + counts.modified === 0) {
      return 'Edit text';
    }
    if (diff.changes.length === 1) return diff.changes[0]!.summary;
    return 'Edit';
  }

  const applyLoadedRevision = useCallback(
    (result: { document: Document; selection: NodeId[] }, canUndo: boolean, canRedo: boolean) => {
      historySkipRef.current = true;
      const synced = syncGridFromDocument(result.document);
      patchRef.current({
        document: result.document,
        selection: result.selection,
        documentGrid: synced.documentGrid,
        isometricGrid: synced.isometricGrid,
        snapGrid: synced.documentGrid.spacingX,
        canUndo,
        canRedo,
        undoLabel: sessionRef.current?.undoLabel ?? 'Undo',
        redoLabel: sessionRef.current?.redoLabel ?? 'Redo',
      });
      bump();
    },
    [],
  );

  const capture = useCallback((before: Document, after: Document, label: string, kind: string) => {
    const session = sessionRef.current;
    if (!session) return;
    const run = async () => {
      await attachPromiseRef.current;
      try {
        await session.capture(before, after, selectionRef.current, { label, kind });
        bump();
      } catch (err) {
        console.warn('[history] capture failed', err);
      }
    };
    void run();
  }, []);

  const undo = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session || !session.attached) return false;
    await attachPromiseRef.current;
    const result = await session.undo();
    if (!result) return false;
    applyLoadedRevision(result, session.canUndo, session.canRedo);
    return true;
  }, [applyLoadedRevision]);

  const redo = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session || !session.attached) return false;
    await attachPromiseRef.current;
    const result = await session.redo();
    if (!result) return false;
    applyLoadedRevision(result, session.canUndo, session.canRedo);
    return true;
  }, [applyLoadedRevision]);

  const undoTo = useCallback(
    async (revisionId: string): Promise<boolean> => {
      const session = sessionRef.current;
      if (!session || !session.attached) return false;
      await attachPromiseRef.current;
      const result = await session.undoToRevision(revisionId);
      if (!result) return false;
      applyLoadedRevision(result, session.canUndo, session.canRedo);
      return true;
    },
    [applyLoadedRevision],
  );

  const checkout = useCallback(
    async (revisionId: string): Promise<boolean> => {
      const session = sessionRef.current;
      if (!session || !session.attached) return false;
      await attachPromiseRef.current;
      const result = await session.checkout(revisionId);
      if (!result) return false;
      applyLoadedRevision(result, session.canUndo, session.canRedo);
      return true;
    },
    [applyLoadedRevision],
  );

  const previewRevision = useCallback(async (revisionId: string): Promise<Document | null> => {
    const session = sessionRef.current;
    if (!session || !session.attached) return null;
    return session.loadRevisionDocument(revisionId);
  }, []);

  const steps = useCallback(async (): Promise<HistoryStepView[]> => {
    const session = sessionRef.current;
    if (!session || !session.attached) return [];
    return session.steps();
  }, []);

  return {
    session: sessionRef.current,
    attached,
    attachIssues,
    reconciled,
    version,
    capture,
    undo,
    redo,
    undoTo,
    checkout,
    previewRevision,
    steps,
  };
}
