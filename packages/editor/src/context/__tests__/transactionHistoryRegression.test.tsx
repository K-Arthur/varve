import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

describe('EditorProvider transaction history ordering', () => {
  it('does not resurrect shadow-stack content when Undo is requested at genesis', async () => {
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
    await waitFor(() => expect(editor?.persistentHistory.attached).toBe(true));
    act(() => {
      editor!.setTool('rect');
      editor!.createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(editor?.state.selection).toHaveLength(1));
    const firstId = editor!.state.selection[0]!;
    await waitFor(async () => expect(await editor!.persistentHistory.steps()).toHaveLength(2));
    act(() => editor!.createShapeAt({ x: 150, y: 10 }, { w: 100, h: 60 }));
    await waitFor(async () => expect(await editor!.persistentHistory.steps()).toHaveLength(3));
    act(() => editor!.undo());
    await waitFor(() => expect(editor!.persistentHistory.session!.undoLabel).not.toBe('Undo'));
    await act(async () => {
      await editor!.persistentHistory.undo();
    });
    await waitFor(() => expect(editor!.state.document.nodes[firstId]).toBeUndefined());
    await act(async () => {
      editor!.undo();
    });
    expect(editor!.state.document.nodes[firstId]).toBeUndefined();
  });

  it('marks the document and its tab dirty when restoring history after Save', async () => {
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
    await waitFor(() => expect(editor?.persistentHistory.attached).toBe(true));
    act(() => {
      editor!.setTool('rect');
      editor!.createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(async () => expect(await editor!.persistentHistory.steps()).toHaveLength(2));
    // The persistence coordinator publishes these flags after a successful save.
    act(() =>
      editor!.patch({
        dirty: false,
        sessions: editor!.state.sessions.map((session) => ({ ...session, dirty: false })),
      }),
    );
    await act(async () => {
      await editor!.persistentHistory.undo();
    });
    expect(editor!.state.dirty).toBe(true);
    expect(
      editor!.state.sessions.find((session) => session.id === editor!.state.activeId)?.dirty,
    ).toBe(true);
    await act(async () => {
      await editor!.persistentHistory.redo();
    });
    expect(editor!.state.dirty).toBe(false);
    expect(
      editor!.state.sessions.find((session) => session.id === editor!.state.activeId)?.dirty,
    ).toBe(false);
  });

  it('undoes a transform on the first undo after commit', async () => {
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
    await waitFor(() => expect(editor).toBeDefined());

    act(() => {
      editor?.setTool('rect');
      editor?.createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(editor?.state.selection).toHaveLength(1));
    const id = editor?.state.selection[0];
    if (!id) throw new Error('expected selected shape');
    const initialX = editor?.state.document.nodes[id]?.transform[4];

    act(() => {
      editor?.beginTransaction();
      editor?.updateNode(id, (node) => ({ ...node, transform: [1, 0, 0, 1, 50, 0] }));
      editor?.commitTransaction();
    });
    await waitFor(() => expect(editor?.state.document.nodes[id]?.transform[4]).toBe(50));

    act(() => editor?.undo());
    await waitFor(() => expect(editor?.state.document.nodes[id]?.transform[4]).toBe(initialX));
  });

  it('restores selection, dirty state, and history after a cancelled selection move', async () => {
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
    await waitFor(() => expect(editor?.persistentHistory.attached).toBe(true));
    act(() => {
      editor!.setTool('rect');
      editor!.createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(editor?.state.selection).toHaveLength(1));
    const firstId = editor!.state.selection[0]!;
    act(() => editor!.createShapeAt({ x: 150, y: 10 }, { w: 100, h: 60 }));
    await waitFor(() => expect(editor?.state.selection).toHaveLength(1));
    const secondId = editor!.state.selection[0]!;
    expect(secondId).not.toBe(firstId);

    act(() => {
      editor!.setSelection(firstId);
      editor!.patch({
        dirty: false,
        sessions: editor!.state.sessions.map((session) => ({ ...session, dirty: false })),
      });
    });
    const before = {
      selection: [...editor!.state.selection],
      primaryId: editor!.state.primaryId,
      focusedNodeId: editor!.state.focusedNodeId,
      selectionRevision: editor!.state.selectionRevision,
      dirty: editor!.state.dirty,
      canUndo: editor!.state.canUndo,
      canRedo: editor!.state.canRedo,
      undoLabel: editor!.state.undoLabel,
      redoLabel: editor!.state.redoLabel,
      revision: editor!.state.revision,
      persistentSteps: await editor!.persistentHistory.steps(),
      x: editor!.state.document.nodes[firstId]!.transform[4],
    };

    act(() => {
      editor!.beginTransaction();
      editor!.setSelection(secondId);
      editor!.updateNode(firstId, (node) => ({
        ...node,
        transform: [1, 0, 0, 1, 500, 10],
      }));
    });
    await waitFor(() => expect(editor?.state.document.nodes[firstId]?.transform[4]).toBe(500));
    act(() => editor!.abortTransaction());

    await waitFor(() => expect(editor?.state.document.nodes[firstId]?.transform[4]).toBe(before.x));
    expect(editor!.state.selection).toEqual(before.selection);
    expect(editor!.state.primaryId).toBe(before.primaryId);
    expect(editor!.state.focusedNodeId).toBe(before.focusedNodeId);
    expect(editor!.state.selectionRevision).toBe(before.selectionRevision);
    expect(editor!.state.dirty).toBe(before.dirty);
    expect(editor!.state.canUndo).toBe(before.canUndo);
    expect(editor!.state.canRedo).toBe(before.canRedo);
    expect(editor!.state.undoLabel).toBe(before.undoLabel);
    expect(editor!.state.redoLabel).toBe(before.redoLabel);
    expect(editor!.state.revision).toBe(before.revision);
    expect(await editor!.persistentHistory.steps()).toEqual(before.persistentSteps);

    act(() => editor!.undo());
    await waitFor(() => expect(editor?.state.document.nodes[secondId]).toBeUndefined());
    expect(editor!.state.document.nodes[firstId]?.transform[4]).toBe(before.x);
  });

  it('flattens nested transactions until the outermost commit', async () => {
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
    await waitFor(() => expect(editor).toBeDefined());

    act(() => {
      editor?.setTool('rect');
      editor?.createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(editor?.state.selection).toHaveLength(1));
    const id = editor?.state.selection[0];
    if (!id) throw new Error('expected selected shape');
    const initialX = editor?.state.document.nodes[id]?.transform[4];

    act(() => {
      editor?.beginTransaction();
      editor?.updateNode(id, (node) => ({ ...node, transform: [1, 0, 0, 1, 30, 0] }));
      editor?.beginTransaction();
      editor?.updateNode(id, (node) => ({ ...node, transform: [1, 0, 0, 1, 60, 0] }));
      editor?.commitTransaction();
      editor?.updateNode(id, (node) => ({ ...node, transform: [1, 0, 0, 1, 90, 0] }));
      editor?.commitTransaction();
    });
    await waitFor(() => expect(editor?.state.document.nodes[id]?.transform[4]).toBe(90));

    act(() => editor?.undo());
    await waitFor(() => expect(editor?.state.document.nodes[id]?.transform[4]).toBe(initialX));
  });

  it('records a compound operation under its supplied label', async () => {
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
    await waitFor(() => expect(editor).toBeDefined());

    act(() => {
      editor?.setTool('rect');
      editor?.createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(editor?.state.selection).toHaveLength(1));
    const id = editor?.state.selection[0];
    if (!id) throw new Error('expected selected shape');

    act(() => {
      editor?.groupCompoundOperation('Create styled object', () => {
        editor?.updateNode(id, (node) => ({ ...node, opacity: 0.5 }));
        editor?.updateNode(id, (node) => ({ ...node, opacity: 0.75 }));
      });
    });
    await waitFor(() => expect(editor?.state.undoLabel).toBe('Create styled object'));

    act(() => editor?.undo());
    await waitFor(() => expect(editor?.state.document.nodes[id]?.opacity).toBe(1));
  });
});
