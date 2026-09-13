import { createDocument } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import type { EditorState } from './types';
import { makeSetRefs } from './useSelectionCommands';

describe('makeSetRefs', () => {
  it('clears a stale text range when the same object is reselected', () => {
    const document = createDocument('selection-range');
    document.nodes.t1 = { kind: 'text', id: 't1' } as never;
    const state = {
      document,
      selection: ['t1'],
      selectionRange: {
        start: { paragraphIndex: 0, offset: 0 },
        end: { paragraphIndex: 0, offset: 0 },
      },
      pendingFormat: { fontWeight: 700 },
    } as unknown as EditorState;
    const stateRef = { current: state };
    const setState = vi.fn();
    const selectionHistory = { push: vi.fn() };
    const onSelectionChangeRef = { current: undefined };

    const setSelectionRefs = makeSetRefs(
      stateRef,
      setState,
      selectionHistory,
      onSelectionChangeRef,
    );
    setSelectionRefs(['t1'], { primary: 't1', origin: 'layers' });

    expect(stateRef.current.selectionRange).toBeNull();
    expect(stateRef.current.pendingFormat).toBeNull();
    expect(selectionHistory.push).not.toHaveBeenCalled();
    expect(setState).toHaveBeenCalledTimes(1);
    const nextState = setState.mock.calls[0]?.[0](state) as EditorState;
    expect(nextState.selectionRange).toBeNull();
    expect(nextState.pendingFormat).toBeNull();
  });
});
