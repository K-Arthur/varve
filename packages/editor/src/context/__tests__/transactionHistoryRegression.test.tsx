import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

describe('EditorProvider transaction history ordering', () => {
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
