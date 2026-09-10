import {
  addChild,
  createDesignCanvas,
  createDocument,
  type Document,
  designCanvasContentRoot,
  getBuiltinMockupTemplates,
  makeFrameNode,
  type NodeId,
  nextNodeId,
  resolveOwnership,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { applyMockupToSources } from './mockupActions';

const identity: Affine = [1, 0, 0, 1, 0, 0];

function addSourceFrame(doc: Document, parentId: NodeId): { doc: Document; sourceId: NodeId } {
  const { id, doc: withId } = nextNodeId(doc);
  return {
    doc: addChild(
      withId,
      parentId,
      makeFrameNode(id, {
        name: 'Source frame',
        transform: [1, 0, 0, 1, 120, 90],
        w: 140,
        h: 180,
      }),
    ),
    sourceId: id,
  };
}

function mockEditor(
  initialDocument: Document,
  sourceId: NodeId,
  sourceBounds: { x: number; y: number; w: number; h: number },
  getWorldTransform: (id: NodeId) => Affine = () => identity,
): { editor: EditorContextValue; document: () => Document } {
  let document = initialDocument;
  const editor = {
    state: { document, selection: [sourceId] },
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    getWorldBounds: vi.fn(() => sourceBounds),
    getWorldTransform: vi.fn(getWorldTransform),
    setSelection: vi.fn(),
    updateDoc: vi.fn((updater: (doc: Document) => Document) => {
      document = updater(document);
    }),
  } as unknown as EditorContextValue;

  return { editor, document: () => document };
}

describe('applyMockupToSources', () => {
  it('adds a Design Canvas mockup to the source canvas content root', () => {
    let doc = createDesignCanvas(createDocument('Mockup canvas', { flat: true }), {
      name: 'Canvas 1',
    });
    const canvasId = doc.activeDesignCanvasId!;
    const contentRoot = designCanvasContentRoot(doc, canvasId)!;
    const source = addSourceFrame(doc, contentRoot);
    doc = source.doc;
    const harness = mockEditor(doc, source.sourceId, { x: 120, y: 90, w: 140, h: 180 });

    const mockupId = applyMockupToSources(harness.editor, getBuiltinMockupTemplates()[0]!.id, [
      source.sourceId,
    ]);

    expect(mockupId).toBeTruthy();
    const result = harness.document();
    expect(result.nodes[contentRoot]?.kind).toBe('group');
    expect((result.nodes[contentRoot] as { children: NodeId[] }).children).toEqual([
      source.sourceId,
      mockupId,
    ]);
    expect(result.rootChildren).toEqual([contentRoot]);
    expect(resolveOwnership(result, mockupId!)).toEqual({
      kind: 'designCanvas',
      designCanvasId: canvasId,
    });
    expect(harness.editor.setSelection).toHaveBeenCalledWith(mockupId);
  });

  it('keeps a page-owned mockup in page-local coordinates', () => {
    let doc = createDocument('Mockup page');
    const pageRoot = doc.pages![0]!.contentRoot;
    const source = addSourceFrame(doc, pageRoot);
    doc = source.doc;
    const pageTransform: Affine = [1, 0, 0, 1, 500, 0];
    const harness = mockEditor(doc, source.sourceId, { x: 620, y: 90, w: 140, h: 180 }, (id) =>
      id === pageRoot ? pageTransform : identity,
    );

    const mockupId = applyMockupToSources(harness.editor, getBuiltinMockupTemplates()[0]!.id, [
      source.sourceId,
    ]);

    const result = harness.document();
    expect((result.nodes[pageRoot] as { children: NodeId[] }).children).toEqual([
      source.sourceId,
      mockupId,
    ]);
    expect(result.nodes[mockupId!]!.transform).toEqual([1, 0, 0, 1, 340, 90]);
  });
});
