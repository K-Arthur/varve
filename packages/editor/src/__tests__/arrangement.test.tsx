// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import {
  addChild,
  addNode,
  createDocument,
  DocumentCodec,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

afterEach(cleanup);

function makeArrangementDocument() {
  let doc = createDocument('arrangement command');
  const frame = makeFrameNode('frame', { w: 400, h: 200 });
  doc = addNode(doc, frame);
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    doc = addChild(
      doc,
      frame.id,
      makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }, { name: id }),
    );
  }
  return doc;
}

describe('EditorProvider arrangement command', () => {
  it('uses one stable arrangement mutation with undo and redo', async () => {
    let editor: ReturnType<typeof useEditor> | undefined;
    function Consumer() {
      editor = useEditor();
      return null;
    }

    render(
      <EditorProvider initialDocumentJson={DocumentCodec.encode(makeArrangementDocument())}>
        <Consumer />
      </EditorProvider>,
    );
    const get = () => {
      if (!editor) throw new Error('Editor is not ready');
      return editor;
    };
    await waitFor(() => expect(get().state.document.nodes.frame).toBeDefined());

    act(() => {
      get().setSelection('b');
      get().toggleSelection('c', true);
    });
    await waitFor(() => expect(get().state.selection).toEqual(['b', 'c']));

    act(() => get().arrangeSelected('forward'));
    await waitFor(() => {
      const frame = get().state.document.nodes.frame;
      expect(frame?.kind === 'frame' && frame.children).toEqual(['a', 'd', 'b', 'c', 'e']);
    });

    act(() => get().undo());
    await waitFor(() => {
      const frame = get().state.document.nodes.frame;
      expect(frame?.kind === 'frame' && frame.children).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    act(() => get().redo());
    await waitFor(() => {
      const frame = get().state.document.nodes.frame;
      expect(frame?.kind === 'frame' && frame.children).toEqual(['a', 'd', 'b', 'c', 'e']);
    });
  });
});
