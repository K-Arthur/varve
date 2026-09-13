// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createAreaSelection } from '@varve/engine';
import { addChild, createDocument, makeRasterLayerNode } from '@varve/scene';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { SelectionSourcesPanel } from './SelectionSourcesPanel';

function FillSetup() {
  const editor = useEditor();
  useEffect(() => {
    editor.setSelection('pixels');
    editor.setAreaSelection?.(
      createAreaSelection({
        kind: 'rectangle',
        x: 8,
        y: 8,
        w: 4,
        h: 4,
        feather: 0,
        antialias: false,
      }),
    );
    // The fixture intentionally sets the selection once. Depending on the
    // whole context would repeat this state mutation after every document
    // update and keep the test mounted forever.
  }, []);
  return null;
}

describe('SelectionSourcesPanel fill workflow', () => {
  it('fills the selected pixel layer while keeping the selection as the source boundary', async () => {
    let document = createDocument('selection-fill');
    const rootId = document.pages?.[0]?.contentRoot as string;
    document = addChild(document, rootId, makeRasterLayerNode('pixels', { width: 64, height: 64 }));

    let editor: ReturnType<typeof useEditor> | undefined;
    function CaptureEditor() {
      editor = useEditor();
      return null;
    }

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(document)}>
        <CaptureEditor />
        <FillSetup />
        <SelectionSourcesPanel />
      </EditorProvider>,
    );

    await waitFor(() => expect(editor?.state.selection).toEqual(['pixels']));
    fireEvent.click(screen.getByRole('button', { name: 'Selection Sources' }));
    const fill = await screen.findByRole('button', { name: 'Fill pixel layer' });
    expect(fill).toBeEnabled();
    fireEvent.click(fill);

    await waitFor(() => {
      const node = editor?.state.document.nodes.pixels;
      expect(node?.kind).toBe('rasterLayer');
      if (node?.kind !== 'rasterLayer') return;
      const tile = node.tiles.get('0:0');
      expect(tile?.pixels[(9 * 128 + 9) * 4 + 3]).toBe(255);
      expect(tile?.pixels[(20 * 128 + 20) * 4 + 3] ?? 0).toBe(0);
    });
    expect(editor?.state.areaSelection).not.toBeNull();
    expect(editor?.state.canUndo).toBe(true);
  });
});
