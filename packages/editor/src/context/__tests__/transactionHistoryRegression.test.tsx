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
});
