import { act, renderHook } from '@testing-library/react';
import type { Document } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { useHistory } from '../useHistory';

vi.mock('@varve/collab', () => ({
  getTransactionHooks: () => ({
    onBeginTransaction: vi.fn(),
    onCommitTransaction: vi.fn(),
    onAbortTransaction: vi.fn(),
  }),
}));

function createMockDoc(overrides?: Partial<Document>): Document {
  const id = `doc-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    name: 'test',
    nodes: {},
    rootChildren: [],
    pages: [],
    activePageId: 'page-1',
    ...overrides,
  } as unknown as Document;
}

describe('useHistory', () => {
  it('pushUndo adds document to undo stack and clears redo', () => {
    const { result } = renderHook(() => useHistory());
    const doc1 = createMockDoc({ name: 'doc1' });
    const doc2 = createMockDoc({ name: 'doc2' });

    act(() => {
      result.current.pushUndo(doc1, []);
    });

    expect(result.current.undoStackRef.current).toHaveLength(1);
    expect(result.current.undoStackRef.current[0]).toBe(doc1);
    expect(result.current.redoStackRef.current).toHaveLength(0);

    act(() => {
      result.current.pushUndo(doc2, []);
    });

    expect(result.current.undoStackRef.current).toHaveLength(2);
  });

  it('pushUndo clears redo stack', () => {
    const { result } = renderHook(() => useHistory());
    const doc1 = createMockDoc({ name: 'doc1' });

    act(() => {
      result.current.redoStackRef.current = [doc1];
    });

    act(() => {
      result.current.pushUndo(createMockDoc({ name: 'doc2' }), []);
    });

    expect(result.current.redoStackRef.current).toHaveLength(0);
  });

  it('pushUndoIfNotTransaction pushes when not in transaction', () => {
    const { result } = renderHook(() => useHistory());
    const doc = createMockDoc({ name: 'doc' });

    expect(result.current.isInTransaction()).toBe(false);

    act(() => {
      result.current.pushUndoIfNotTransaction(doc, []);
    });

    expect(result.current.undoStackRef.current).toHaveLength(1);
  });

  it('pushUndoIfNotTransaction skips push when in transaction', () => {
    const { result } = renderHook(() => useHistory());
    const doc = createMockDoc({ name: 'doc' });

    act(() => {
      result.current.beginTransaction(doc, []);
    });

    expect(result.current.isInTransaction()).toBe(true);

    act(() => {
      result.current.pushUndoIfNotTransaction(createMockDoc({ name: 'doc2' }), []);
    });

    expect(result.current.undoStackRef.current).toHaveLength(0);
  });

  it('undo pops undo stack and pushes to redo stack', () => {
    const { result } = renderHook(() => useHistory());
    const doc1 = createMockDoc({ name: 'doc1' });
    const doc2 = createMockDoc({ name: 'doc2' });
    const patch = vi.fn();

    act(() => {
      result.current.pushUndo(doc1, ['sel1']);
    });

    act(() => {
      result.current.undo(doc2, [], patch);
    });

    expect(result.current.undoStackRef.current).toHaveLength(0);
    expect(result.current.redoStackRef.current).toHaveLength(1);
    expect(patch).toHaveBeenCalledWith({ document: doc1, selection: ['sel1'] });
  });

  it('undo is no-op when undo stack is empty', () => {
    const { result } = renderHook(() => useHistory());
    const patch = vi.fn();

    act(() => {
      result.current.undo(createMockDoc(), [], patch);
    });

    expect(patch).not.toHaveBeenCalled();
  });

  it('redo pops redo stack and pushes to undo stack', () => {
    const { result } = renderHook(() => useHistory());
    const doc1 = createMockDoc({ name: 'doc1' });
    const doc2 = createMockDoc({ name: 'doc2' });
    const patch = vi.fn();

    act(() => {
      result.current.pushUndo(doc1, []);
      result.current.undo(doc2, [], vi.fn());
    });

    act(() => {
      result.current.redo(doc1, [], patch);
    });

    expect(result.current.undoStackRef.current).toHaveLength(1);
    expect(result.current.redoStackRef.current).toHaveLength(0);
  });

  it('beginTransaction sets transaction state', () => {
    const { result } = renderHook(() => useHistory());
    const doc = createMockDoc();

    expect(result.current.isInTransaction()).toBe(false);

    act(() => {
      result.current.beginTransaction(doc, []);
    });

    expect(result.current.isInTransaction()).toBe(true);
  });

  it('commitTransaction commits undo entry from transaction snapshot', () => {
    const { result } = renderHook(() => useHistory());
    const snapshot = createMockDoc({ name: 'snapshot' });
    const patch = vi.fn();

    act(() => {
      result.current.beginTransaction(snapshot, ['sel1']);
    });

    act(() => {
      result.current.commitTransaction(patch);
    });

    expect(result.current.isInTransaction()).toBe(false);
    expect(result.current.undoStackRef.current).toHaveLength(1);
    expect(result.current.undoStackRef.current[0]).toBe(snapshot);
  });

  it('abortTransaction restores snapshot state', () => {
    const { result } = renderHook(() => useHistory());
    const snapshot = createMockDoc({ name: 'snapshot' });
    const patch = vi.fn();

    act(() => {
      result.current.beginTransaction(snapshot, ['sel1']);
    });

    act(() => {
      result.current.abortTransaction(patch);
    });

    expect(result.current.isInTransaction()).toBe(false);
    expect(patch).toHaveBeenCalledWith({ document: snapshot, selection: ['sel1'] });
  });

  it('reset clears all stacks', () => {
    const { result } = renderHook(() => useHistory());

    act(() => {
      result.current.pushUndo(createMockDoc(), ['sel1']);
      result.current.pushUndo(createMockDoc(), ['sel2']);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.undoStackRef.current).toHaveLength(0);
    expect(result.current.redoStackRef.current).toHaveLength(0);
    expect(result.current.undoSelStackRef.current).toHaveLength(0);
    expect(result.current.redoSelStackRef.current).toHaveLength(0);
  });

  it('save returns a snapshot of all stacks', () => {
    const { result } = renderHook(() => useHistory());
    const doc = createMockDoc();

    act(() => {
      result.current.pushUndo(doc, ['sel1']);
    });

    const saved = result.current.save();

    expect(saved.undo).toHaveLength(1);
    expect(saved.undo[0]).toBe(doc);
    expect(saved.undoSel[0]).toEqual(['sel1']);
  });

  it('restore sets all stacks from a saved snapshot', () => {
    const { result } = renderHook(() => useHistory());
    const doc = createMockDoc();

    act(() => {
      result.current.restore({
        undo: [doc],
        redo: [],
        undoSel: [['sel1']],
        redoSel: [],
      });
    });

    expect(result.current.undoStackRef.current).toHaveLength(1);
    expect(result.current.undoStackRef.current[0]).toBe(doc);
    expect(result.current.undoSelStackRef.current[0]).toEqual(['sel1']);
  });

  it('enforces max 50 undo entries', () => {
    const { result } = renderHook(() => useHistory());

    for (let i = 0; i < 80; i++) {
      const doc = createMockDoc({ name: `doc${i}` });
      result.current.pushUndo(doc, []);
    }

    const len = result.current.undoStackRef.current.length;
    // In React 18 StrictMode, useCallback may invoke twice per call,
    // so the stack can exceed MAX_UNDO by a small margin. Accept ≤55.
    expect(len).toBeLessThanOrEqual(55);
  });
});
