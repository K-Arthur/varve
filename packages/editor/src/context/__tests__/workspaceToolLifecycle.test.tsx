// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

describe('workspace tool lifecycle', () => {
  it('falls back from a hidden active tool while preserving document state', async () => {
    let editor: ReturnType<typeof useEditor> | undefined;

    function Capture() {
      editor = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <Capture />
      </EditorProvider>,
    );

    await waitFor(() => expect(editor).toBeDefined());
    if (!editor) throw new Error('editor context was not mounted');

    const documentBefore = editor.state.document;
    let switched = false;
    await act(async () => {
      switched = (await editor?.requestWorkspaceSwitch('drawing')) ?? false;
    });
    expect(switched).toBe(true);
    await waitFor(() => expect(editor?.state.workspaceMode).toBe('drawing'));
    act(() => editor?.setTool('paint'));
    await waitFor(() => expect(editor?.state.tool).toBe('paint'));

    await act(async () => {
      switched = (await editor?.requestWorkspaceSwitch('design')) ?? false;
    });
    expect(switched).toBe(true);
    await waitFor(() => expect(editor?.state.workspaceMode).toBe('design'));
    expect(editor.state.tool).toBe('select');
    expect(editor.state.document).toBe(documentBefore);
  });
});
