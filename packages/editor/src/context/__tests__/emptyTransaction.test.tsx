import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

/**
 * A transaction that mutates nothing must not add an undo entry.
 *
 * Empty transactions are common in practice: a plain click that only selects a
 * node still runs beginTransaction()/commitTransaction(), and the drag-end
 * auto-reparent pass opens one even when no node is reparented. When those
 * pushed a snapshot, one gesture took several undos to reverse and the first
 * "did nothing". commitTransaction now records an entry only when the document
 * reference actually changed.
 */
describe('EditorProvider empty-transaction history', () => {
  function mount() {
    let editor: ReturnType<typeof useEditor> | undefined;
    function Consumer() {
      editor = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <Consumer />
      </EditorProvider>,
    );
    return () => {
      if (!editor) throw new Error('editor not ready');
      return editor;
    };
  }

  it('does not record an undo entry for a transaction that changes nothing', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    // One real edit: create a shape (its own single undo entry).
    act(() => {
      get().setTool('rect');
      get().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(1));
    const id = get().state.selection[0]!;
    expect(get().state.document.nodes[id]).toBeDefined();

    // An empty transaction on top of it.
    act(() => {
      get().beginTransaction();
      get().commitTransaction();
    });
    await waitFor(() => expect(get().state.document.nodes[id]).toBeDefined());

    // A single undo must reach past the empty transaction to the creation.
    // If the empty commit had pushed an entry, this undo would be a no-op and
    // the shape would survive.
    act(() => get().undo());
    await waitFor(() => expect(get().state.document.nodes[id]).toBeUndefined());
  });

  it('does not record an undo entry for a direct no-op document update', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    act(() => {
      get().setTool('rect');
      get().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(1));
    const id = get().state.selection[0]!;

    act(() => get().updateDoc((doc) => doc));

    // Undo must reach the creation, rather than consuming the no-op update.
    act(() => get().undo());
    await waitFor(() => expect(get().state.document.nodes[id]).toBeUndefined());
  });

  it('still records exactly one entry for a transaction that does change the document', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    act(() => {
      get().setTool('rect');
      get().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(1));
    const id = get().state.selection[0]!;
    const initialX = get().state.document.nodes[id]?.transform[4];

    act(() => {
      get().beginTransaction();
      get().updateNode(id, (node) => ({ ...node, transform: [1, 0, 0, 1, 50, 0] }));
      get().commitTransaction();
    });
    await waitFor(() => expect(get().state.document.nodes[id]?.transform[4]).toBe(50));

    // First undo reverts the move; the shape itself must remain (one entry,
    // not zero and not two).
    act(() => get().undo());
    await waitFor(() => expect(get().state.document.nodes[id]?.transform[4]).toBe(initialX));
    expect(get().state.document.nodes[id]).toBeDefined();
  });
});
