import {
  addChild,
  createDesignCanvas,
  createDocument,
  type Document,
  designCanvasContentRoot,
  type FrameNode,
  getBuiltinMockupTemplates,
  getMockupTemplate,
  type MockupInstanceData,
  makeFrameNode,
  type NodeId,
  nextNodeId,
  resolveOwnership,
  setMockupBinding,
  setMockupSurfaceOverride,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { applyMockupToSources, replaceMockupSurfaceSource } from './mockupActions';

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
    // Fresh on every access: replacement actions read `editor.state.document`
    // after earlier `updateDoc` calls, and a snapshot would go stale.
    get state() {
      return { document, selection: [sourceId] };
    },
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

describe('source replacement preserves placement (market failure modes C1/C2)', () => {
  /**
   * C1: "every time I make a change inside the smart object, the warp
   * transformation resets" — replacement must be a pure source swap on the
   * binding record. C2: "cannot fit an image without cropping" — the chosen
   * fit policy must survive replacement untouched (never silently stretch).
   * Placement lives in `overrides`/the template; binding lives in
   * `surfaceBindings`; replacing one must be structurally incapable of
   * touching the other. Byte-identical comparison, not field spot-checks.
   */
  it('rebinding a surface leaves geometry, fit, and appearance byte-identical', () => {
    let doc = createDesignCanvas(createDocument('Mockup replace', { flat: true }), {
      name: 'Canvas 1',
    });
    const canvasId = doc.activeDesignCanvasId!;
    const contentRoot = designCanvasContentRoot(doc, canvasId)!;
    const first = addSourceFrame(doc, contentRoot);
    doc = first.doc;
    const harness = mockEditor(doc, first.sourceId, { x: 120, y: 90, w: 140, h: 180 });

    const mockupId = applyMockupToSources(harness.editor, getBuiltinMockupTemplates()[0]!.id, [
      first.sourceId,
    ]);
    expect(mockupId).toBeTruthy();
    doc = harness.document();
    const frame = doc.nodes[mockupId!] as FrameNode & { mockup: MockupInstanceData };
    const template = getMockupTemplate(doc, frame.mockup.templateId);
    expect(template).toBeTruthy();
    const surfaceId = template!.surfaces[0]!.id;

    // User-tuned placement: slot rect, fit policy, rotation, flip, shadow.
    doc = setMockupSurfaceOverride(doc, mockupId!, surfaceId, {
      x: 12,
      y: 24,
      width: 200,
      height: 100,
      fit: 'cover',
      rotation: 12,
      flipH: true,
      shadow: { blur: 18, offsetY: 6, opacity: 0.4 },
    });
    const beforeFrame = doc.nodes[mockupId!] as FrameNode & { mockup: MockupInstanceData };
    const overridesBefore = JSON.stringify(beforeFrame.mockup.overrides);
    const templateBefore = JSON.stringify(doc.mockupTemplates?.[template!.id]);

    // Replace with a different source (different dimensions by construction).
    const second = addSourceFrame(doc, contentRoot);
    doc = setMockupBinding(second.doc, mockupId!, surfaceId, {
      mode: 'live',
      nodeId: second.sourceId,
    });

    const after = doc.nodes[mockupId!] as FrameNode & { mockup: MockupInstanceData };
    expect(JSON.stringify(after.mockup.overrides)).toBe(overridesBefore);
    expect(JSON.stringify(doc.mockupTemplates?.[template!.id])).toBe(templateBefore);
    expect(after.mockup.surfaceBindings[surfaceId]).toEqual({
      mode: 'live',
      nodeId: second.sourceId,
    });
    expect(after.mockup.overrides?.[surfaceId]?.fit).toBe('cover');
    expect(after.mockup.overrides?.[surfaceId]?.rotation).toBe(12);
    expect(after.mockup.overrides?.[surfaceId]?.flipH).toBe(true);
    expect(after.mockup.overrides?.[surfaceId]?.shadow).toEqual({
      blur: 18,
      offsetY: 6,
      opacity: 0.4,
    });
  });
});

describe('replaceMockupSurfaceSource (drop-to-replace integration seam)', () => {
  function mockupFixture(): {
    harness: ReturnType<typeof mockEditor>;
    mockupId: NodeId;
    surfaceId: string;
    contentRoot: NodeId;
    doc: () => Document;
  } {
    let doc = createDesignCanvas(createDocument('Mockup seam', { flat: true }), {
      name: 'Canvas 1',
    });
    const canvasId = doc.activeDesignCanvasId!;
    const contentRoot = designCanvasContentRoot(doc, canvasId)!;
    const first = addSourceFrame(doc, contentRoot);
    doc = first.doc;
    const harness = mockEditor(doc, first.sourceId, { x: 120, y: 90, w: 140, h: 180 });
    const mockupId = applyMockupToSources(harness.editor, getBuiltinMockupTemplates()[0]!.id, [
      first.sourceId,
    ]);
    doc = harness.document();
    const frame = doc.nodes[mockupId!] as FrameNode & { mockup: MockupInstanceData };
    const template = getMockupTemplate(doc, frame.mockup.templateId);
    return {
      harness,
      mockupId: mockupId!,
      surfaceId: template!.surfaces[0]!.id,
      contentRoot,
      doc: () => harness.document(),
    };
  }

  it('binds a valid source as one transaction and reports success', () => {
    const fx = mockupFixture();
    // The fixture's apply step already used the transaction boundary; count
    // only the replacement action from here.
    vi.mocked(fx.harness.editor.beginTransaction).mockClear();
    vi.mocked(fx.harness.editor.commitTransaction).mockClear();
    const second = addSourceFrame(fx.doc(), fx.contentRoot);
    fx.harness.editor.updateDoc(() => second.doc);
    const ok = replaceMockupSurfaceSource(
      fx.harness.editor,
      fx.mockupId,
      fx.surfaceId,
      second.sourceId,
    );
    expect(ok).toBe(true);
    expect(fx.harness.editor.beginTransaction).toHaveBeenCalledTimes(1);
    expect(fx.harness.editor.commitTransaction).toHaveBeenCalledTimes(1);
    const frame = fx.doc().nodes[fx.mockupId] as FrameNode & { mockup: MockupInstanceData };
    expect(frame.mockup.surfaceBindings[fx.surfaceId]).toEqual({
      mode: 'live',
      nodeId: second.sourceId,
    });
  });

  it('rejects self-sourcing and unknown frames without opening a transaction', () => {
    const fx = mockupFixture();
    // The fixture's apply step already used the transaction boundary.
    vi.mocked(fx.harness.editor.beginTransaction).mockClear();
    vi.mocked(fx.harness.editor.commitTransaction).mockClear();
    expect(
      replaceMockupSurfaceSource(fx.harness.editor, fx.mockupId, fx.surfaceId, fx.mockupId),
    ).toBe(false);
    expect(
      replaceMockupSurfaceSource(fx.harness.editor, 'missing-frame', fx.surfaceId, fx.mockupId),
    ).toBe(false);
    expect(
      replaceMockupSurfaceSource(fx.harness.editor, fx.mockupId, 'missing-surface', fx.mockupId),
    ).toBe(false);
    expect(fx.harness.editor.beginTransaction).not.toHaveBeenCalled();
  });
});
