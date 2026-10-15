import { act, render, waitFor } from '@testing-library/react';
import {
  colorConfigWithDefaults,
  createDocument,
  DocumentCodec,
  makeFrameNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

function mount(initialDocumentJson?: string) {
  let editor: ReturnType<typeof useEditor> | undefined;
  function Consumer() {
    editor = useEditor();
    return null;
  }
  render(
    <EditorProvider initialDocumentJson={initialDocumentJson}>
      <Consumer />
    </EditorProvider>,
  );
  return () => {
    if (!editor) throw new Error('editor not ready');
    return editor;
  };
}

describe('EditorProvider owned-transaction history', () => {
  it('undo restores the document after addMaskToSelected', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    act(() => {
      get().setTool('rect');
      get().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(1));
    const id = get().state.selection[0]!;
    expect(get().state.document.nodes[id]?.mask).toBeUndefined();
    const before = get().state.document;

    act(() => get().addMaskToSelected('alpha'));
    await waitFor(() => expect(get().state.document.nodes[id]?.mask).toBeDefined());
    expect(get().state.document).not.toBe(before);

    act(() => get().undo());
    await waitFor(() => expect(get().state.document.nodes[id]?.mask).toBeUndefined());
  });

  it('undo restores the document after applyPanelLayout', async () => {
    const source = createDocument('Panel history', true);
    const frame = makeFrameNode('layout-frame', { w: 400, h: 600, children: [] });
    const initial = {
      ...source,
      nodes: { ...source.nodes, [frame.id]: frame },
      rootChildren: [...source.rootChildren, frame.id],
    };
    const get = mount(DocumentCodec.encode(initial));
    await waitFor(() => expect(get()).toBeDefined());
    act(() => get().setSelection(frame.id));
    await waitFor(() => expect(get().state.selection).toEqual([frame.id]));

    const childrenBefore = [
      ...((get().state.document.nodes[frame.id] as { children?: string[] })?.children ?? []),
    ];

    act(() => get().applyPanelLayout('two-up'));
    await waitFor(() => {
      const children = (get().state.document.nodes[frame.id] as { children?: string[] })?.children;
      expect(children?.length).toBeGreaterThan(childrenBefore.length);
    });

    act(() => get().undo());
    await waitFor(() => {
      const children = (get().state.document.nodes[frame.id] as { children?: string[] })?.children;
      expect(children ?? []).toEqual(childrenBefore);
    });
  });

  it('undo restores the document after a blend evaluation change', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    const before = colorConfigWithDefaults(get().state.document.colorConfig).blendEvaluationSpace;
    expect(before).not.toBe('linear-srgb');

    act(() => get().setDocumentBlendEvaluationSpace('linear-srgb'));
    await waitFor(() =>
      expect(colorConfigWithDefaults(get().state.document.colorConfig).blendEvaluationSpace).toBe(
        'linear-srgb',
      ),
    );

    act(() => get().undo());
    await waitFor(() =>
      expect(colorConfigWithDefaults(get().state.document.colorConfig).blendEvaluationSpace).toBe(
        before,
      ),
    );
  });
});
