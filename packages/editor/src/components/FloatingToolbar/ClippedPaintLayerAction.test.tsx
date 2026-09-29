import { fireEvent, render, screen } from '@testing-library/react';
import {
  addChild,
  createDesignCanvas,
  createDocument,
  designCanvasContentRoot,
  makeRasterLayerNode,
  nextNodeId,
} from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const editorMock = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../context', () => ({ useEditor: () => editorMock.value }));

import { ClippedPaintLayerAction } from './ClippedPaintLayerAction';

describe('ClippedPaintLayerAction', () => {
  beforeEach(() => {
    editorMock.value = null;
  });

  it('creates and selects a clipped shading layer from one raster selection', () => {
    const document = createDesignCanvas(createDocument('clipped action'));
    const rootId = designCanvasContentRoot(document)!;
    const { id: sourceId, doc: allocated } = nextNodeId(document);
    const source = makeRasterLayerNode(sourceId, { width: 64, height: 64 }, { name: 'Ink' });
    const selectedDocument = addChild(allocated, rootId, source);
    const updateDoc = vi.fn();
    const setSelection = vi.fn();
    const announce = vi.fn();
    const groupCompoundOperation = vi.fn((_label: string, action: () => void) => action());
    editorMock.value = {
      state: { document: selectedDocument, selection: [sourceId], workspaceMode: 'design' },
      getWorldTransform: (id: string) =>
        id === sourceId ? [1, 0, 0, 1, 0, 0] : [1, 0, 0, 1, 0, 0],
      updateDoc,
      setSelection,
      announce,
      groupCompoundOperation,
    };

    render(<ClippedPaintLayerAction />);
    fireEvent.click(screen.getByRole('button', { name: 'Create clipped paint layer' }));

    expect(groupCompoundOperation).toHaveBeenCalledWith(
      'Create clipped paint layer',
      expect.any(Function),
    );
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledWith(expect.stringMatching(/^n/));
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining('Created clipped Shading layer for Ink'),
    );
  });

  it('does not offer clipping without exactly one selected raster layer', () => {
    editorMock.value = {
      state: { document: createDocument('empty action'), selection: [], workspaceMode: 'design' },
      getWorldTransform: () => [1, 0, 0, 1, 0, 0],
      updateDoc: vi.fn(),
      setSelection: vi.fn(),
      announce: vi.fn(),
      groupCompoundOperation: vi.fn(),
    };

    const { container } = render(<ClippedPaintLayerAction />);
    expect(container).toBeEmptyDOMElement();
  });
});
