import { getTransactionHooks } from '@varve/collab';
import type { Document, NodeId } from '@varve/scene';
import { useCallback, useRef } from 'react';
import type { EditorState } from './types';

interface SavedHistory {
  undo: Document[];
  redo: Document[];
  undoSel: NodeId[][];
  redoSel: NodeId[][];
}

const MAX_UNDO = 50;

export function useHistory() {
  const undoStackRef = useRef<Document[]>([]);
  const redoStackRef = useRef<Document[]>([]);
  const undoSelStackRef = useRef<NodeId[][]>([]);
  const redoSelStackRef = useRef<NodeId[][]>([]);

  const inTransactionRef = useRef(false);
  const txSnapshotRef = useRef<Document | null>(null);
  const txSelRef = useRef<NodeId[] | null>(null);

  const pushUndo = useCallback((doc: Document, selection: NodeId[]) => {
    undoStackRef.current = [...undoStackRef.current.slice(-MAX_UNDO), doc];
    undoSelStackRef.current = [...undoSelStackRef.current.slice(-MAX_UNDO), selection];
    redoStackRef.current = [];
    redoSelStackRef.current = [];
  }, []);

  const pushUndoIfNotTransaction = useCallback(
    (doc: Document, selection: NodeId[]) => {
      if (!inTransactionRef.current) {
        pushUndo(doc, selection);
      }
    },
    [pushUndo],
  );

  const undo = useCallback(
    (
      currentDoc: Document,
      currentSel: NodeId[],
      patch: (partial: Partial<EditorState>) => void,
    ) => {
      const prev = undoStackRef.current.pop();
      const prevSel = undoSelStackRef.current.pop();
      if (!prev) return;
      redoStackRef.current = [...redoStackRef.current, currentDoc];
      redoSelStackRef.current = [...redoSelStackRef.current, currentSel];
      patch({ document: prev, selection: prevSel ?? [] });
    },
    [],
  );

  const redo = useCallback(
    (
      currentDoc: Document,
      currentSel: NodeId[],
      patch: (partial: Partial<EditorState>) => void,
    ) => {
      const next = redoStackRef.current.pop();
      const nextSel = redoSelStackRef.current.pop();
      if (!next) return;
      undoStackRef.current = [...undoStackRef.current, currentDoc];
      undoSelStackRef.current = [...undoSelStackRef.current, currentSel];
      patch({ document: next, selection: nextSel ?? [] });
    },
    [],
  );

  const beginTransaction = useCallback((currentDoc: Document, currentSel: NodeId[]) => {
    inTransactionRef.current = true;
    txSnapshotRef.current = currentDoc;
    txSelRef.current = currentSel;
    getTransactionHooks().onBeginTransaction();
  }, []);

  const commitTransaction = useCallback((_patch: (partial: Partial<EditorState>) => void) => {
    if (inTransactionRef.current) {
      inTransactionRef.current = false;
      if (txSnapshotRef.current !== null) {
        undoStackRef.current = [
          ...undoStackRef.current.slice(-(MAX_UNDO - 1)),
          txSnapshotRef.current,
        ];
        undoSelStackRef.current = [
          ...undoSelStackRef.current.slice(-(MAX_UNDO - 1)),
          txSelRef.current ?? [],
        ];
        redoStackRef.current = [];
        redoSelStackRef.current = [];
      }
      txSnapshotRef.current = null;
      txSelRef.current = null;
      getTransactionHooks().onCommitTransaction();
    }
  }, []);

  const abortTransaction = useCallback((patch: (partial: Partial<EditorState>) => void) => {
    if (inTransactionRef.current) {
      inTransactionRef.current = false;
      if (txSnapshotRef.current !== null) {
        patch({ document: txSnapshotRef.current, selection: txSelRef.current ?? [] });
      }
      txSnapshotRef.current = null;
      txSelRef.current = null;
      getTransactionHooks().onAbortTransaction();
    }
  }, []);

  const isInTransaction = useCallback(() => inTransactionRef.current, []);

  const save = useCallback(
    (): SavedHistory => ({
      undo: [...undoStackRef.current],
      redo: [...redoStackRef.current],
      undoSel: [...undoSelStackRef.current],
      redoSel: [...redoSelStackRef.current],
    }),
    [],
  );

  const restore = useCallback((saved: SavedHistory) => {
    undoStackRef.current = [...saved.undo];
    redoStackRef.current = [...saved.redo];
    undoSelStackRef.current = [...saved.undoSel];
    redoSelStackRef.current = [...saved.redoSel];
  }, []);

  const reset = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    undoSelStackRef.current = [];
    redoSelStackRef.current = [];
  }, []);

  return {
    undoStackRef,
    redoStackRef,
    undoSelStackRef,
    redoSelStackRef,
    pushUndo,
    pushUndoIfNotTransaction,
    undo,
    redo,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    isInTransaction,
    save,
    restore,
    reset,
  };
}

export type { SavedHistory };
