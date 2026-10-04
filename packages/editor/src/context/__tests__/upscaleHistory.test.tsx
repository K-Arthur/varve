import { act, render, waitFor } from '@testing-library/react';
import * as engine from '@varve/engine';
import {
  createDocument,
  type Document,
  DocumentCodec,
  makeImageShapeNode,
  type ShapeNode,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

const IMAGE_ID = 'upscale-history-image';
const SOURCE = 'data:image/png;base64,AA==';

function imageSource(node: ShapeNode | undefined): string | undefined {
  return node?.fills?.find((fill) => fill.type === 'image')?.image?.src;
}

describe('image enhancement persistent history', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records replace-source output in one persistent undo step', async () => {
    const sourceDoc = createDocument('Upscale history', true);
    const imageNode = makeImageShapeNode(IMAGE_ID, {
      src: SOURCE,
      w: 2,
      h: 2,
      imageWidth: 2,
      imageHeight: 2,
    });
    const initialDocument: Document = {
      ...sourceDoc,
      nodes: { ...sourceDoc.nodes, [IMAGE_ID]: imageNode },
      rootChildren: [...sourceDoc.rootChildren, IMAGE_ID],
    };
    let editor: ReturnType<typeof useEditor> | undefined;
    function Consumer() {
      editor = useEditor();
      return null;
    }
    render(
      <EditorProvider initialDocumentJson={DocumentCodec.encode(initialDocument)}>
        <Consumer />
      </EditorProvider>,
    );
    await waitFor(() => expect(editor?.persistentHistory.attached).toBe(true));
    act(() => editor!.setSelection(IMAGE_ID));

    const historyBefore = await editor!.persistentHistory.steps();
    const imageCache = engine.getImageCache();
    vi.spyOn(imageCache, 'load').mockResolvedValue({ width: 2, height: 2 } as ImageBitmap);
    vi.spyOn(engine, 'dispatchUpscale').mockResolvedValue(new ImageData(4, 4));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      await editor!.upscaleSelectedImage({ method: 'bicubic', scale: 2, output: 'replace-source' });
    });

    await waitFor(async () =>
      expect(await editor!.persistentHistory.steps()).toHaveLength(historyBefore.length + 1),
    );
    expect(imageSource(editor!.state.document.nodes[IMAGE_ID] as ShapeNode)).not.toBe(SOURCE);
    expect(warn).not.toHaveBeenCalledWith(
      '[history] updateDoc called outside transaction — this mutation bypasses persistent history capture',
    );

    await act(async () => editor!.persistentHistory.undo());
    await waitFor(() =>
      expect(imageSource(editor!.state.document.nodes[IMAGE_ID] as ShapeNode)).toBe(SOURCE),
    );
  });
});
