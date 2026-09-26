import { describe, expect, it } from 'vitest';
import { createDesignCanvas, designCanvasContentRoot, setActiveDesignCanvas } from './designCanvas';
import type { Document } from './document';
import { addChild, createDocument, makeShapeNode, nextNodeId } from './document';
import { resolveEditorSceneScope } from './editorSceneScope';

function addNamedShape(doc: Document, parentId: string, name: string) {
  const { id, doc: withId } = nextNodeId(doc);
  return {
    id,
    doc: addChild(
      withId,
      parentId,
      makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 120, h: 80 }, { name }),
    ),
  };
}

function mixedCanvasDocument(): {
  doc: Document;
  firstCanvasId: string;
  secondCanvasId: string;
  firstNodeId: string;
  secondNodeId: string;
} {
  let doc = createDesignCanvas(createDocument('mixed', false), { name: 'A' });
  const firstCanvasId = doc.activeDesignCanvasId!;
  const firstRoot = designCanvasContentRoot(doc, firstCanvasId)!;
  const first = addNamedShape(doc, firstRoot, 'A_ONLY_FRAME');
  doc = first.doc;
  doc = createDesignCanvas(doc, { name: 'B' });
  const secondCanvasId = doc.activeDesignCanvasId!;
  const secondRoot = designCanvasContentRoot(doc, secondCanvasId)!;
  const second = addNamedShape(doc, secondRoot, 'B_ONLY_FRAME');
  return {
    doc: second.doc,
    firstCanvasId,
    secondCanvasId,
    firstNodeId: first.id,
    secondNodeId: second.id,
  };
}

describe('resolveEditorSceneScope', () => {
  it('keeps Design Canvas membership exact in a mixed document', () => {
    const fixture = mixedCanvasDocument();
    const first = resolveEditorSceneScope(fixture.doc, {
      workspaceMode: 'design',
      activeDesignCanvasId: fixture.firstCanvasId,
    });
    const second = resolveEditorSceneScope(fixture.doc, {
      workspaceMode: 'design',
      activeDesignCanvasId: fixture.secondCanvasId,
    });

    expect(first.surfaceKey).toBe(`designCanvas:${fixture.firstCanvasId}`);
    expect(first.occurrences.map((entry) => entry.nodeId)).toEqual([fixture.firstNodeId]);
    expect(second.occurrences.map((entry) => entry.nodeId)).toEqual([fixture.secondNodeId]);
    expect(first.authoredNodeIds.has(fixture.secondNodeId)).toBe(false);
  });

  it('falls back to the first canvas for a stale active id', () => {
    const fixture = mixedCanvasDocument();
    const scope = resolveEditorSceneScope(fixture.doc, {
      workspaceMode: 'design',
      activeDesignCanvasId: 'deleted-canvas',
    });

    expect(scope.surfaceKey).toBe(`designCanvas:${fixture.firstCanvasId}`);
    expect([...scope.authoredNodeIds]).toEqual([fixture.firstNodeId]);
  });

  it('uses all placed publishing pages in Print without leaking canvas content', () => {
    const fixture = mixedCanvasDocument();
    const pageRoot = fixture.doc.pages?.[0]?.contentRoot;
    if (!pageRoot) throw new Error('expected default page');
    const pageNode = addNamedShape(fixture.doc, pageRoot, 'PAGE_FRAME');
    const scope = resolveEditorSceneScope(pageNode.doc, {
      workspaceMode: 'print',
      activePageId: pageNode.doc.activePageId,
      activeDesignCanvasId: fixture.secondCanvasId,
    });

    expect(scope.context.base).toMatchObject({
      kind: 'publishing',
      membership: 'allPlacedPages',
    });
    expect(scope.authoredNodeIds.has(pageNode.id)).toBe(true);
    expect(scope.authoredNodeIds.has(fixture.firstNodeId)).toBe(false);
    expect(scope.authoredNodeIds.has(fixture.secondNodeId)).toBe(false);
  });

  it('re-roots isolation and excludes siblings', () => {
    const fixture = mixedCanvasDocument();
    let doc = setActiveDesignCanvas(fixture.doc, fixture.firstCanvasId);
    const root = designCanvasContentRoot(doc, fixture.firstCanvasId)!;
    const nested = addNamedShape(doc, root, 'A_CHILD');
    doc = nested.doc;
    const scope = resolveEditorSceneScope(doc, {
      workspaceMode: 'design',
      activeDesignCanvasId: fixture.firstCanvasId,
      isolatedNodeId: fixture.firstNodeId,
    });

    expect(scope.occurrences[0]).toMatchObject({
      nodeId: fixture.firstNodeId,
      parentId: null,
      depth: 0,
    });
    expect(scope.authoredNodeIds.has(nested.id)).toBe(false);
  });

  it('terminates safely for a cyclic child graph', () => {
    const fixture = mixedCanvasDocument();
    const root = designCanvasContentRoot(fixture.doc, fixture.firstCanvasId)!;
    const node = fixture.doc.nodes[fixture.firstNodeId]!;
    const cyclic = {
      ...fixture.doc,
      nodes: {
        ...fixture.doc.nodes,
        [root]: { ...fixture.doc.nodes[root]!, children: [fixture.firstNodeId] },
        [node.id]: { ...node, children: [root] },
      },
    } as Document;

    expect(() =>
      resolveEditorSceneScope(cyclic, {
        workspaceMode: 'design',
        activeDesignCanvasId: fixture.firstCanvasId,
      }),
    ).not.toThrow();
  });
});

describe('resolveEditorSceneScope caching', () => {
  const options = { workspaceMode: 'design', activePageId: null, activeDesignCanvasId: null };

  it('shares one resolution for identical document and options', () => {
    const doc = createDocument('cache', false);
    const first = resolveEditorSceneScope(doc, options);
    expect(resolveEditorSceneScope(doc, { ...options })).toBe(first);
  });

  it('ignores camera motion on a design canvas, which never culls by viewport', () => {
    const { doc } = mixedCanvasDocument();
    const first = resolveEditorSceneScope(doc, {
      ...options,
      viewportWorldRect: { x: 0, y: 0, w: 100, h: 100 },
    });
    const panned = resolveEditorSceneScope(doc, {
      ...options,
      viewportWorldRect: { x: 5_000, y: -300, w: 100, h: 100 },
    });
    expect(panned).toBe(first);
  });

  it('still resolves page culling per viewport on a publishing surface', () => {
    const doc = createDocument('cache-print', false);
    expect(doc.pages?.length ?? 0).toBeGreaterThan(0);
    const printOptions = { workspaceMode: 'print', activePageId: doc.activePageId ?? null };
    const near = resolveEditorSceneScope(doc, {
      ...printOptions,
      viewportWorldRect: { x: 0, y: 0, w: 100, h: 100 },
    });
    const far = resolveEditorSceneScope(doc, {
      ...printOptions,
      viewportWorldRect: { x: 9_000_000, y: 9_000_000, w: 100, h: 100 },
    });
    expect(far).not.toBe(near);
  });

  it('re-resolves a new document produced by an edit', () => {
    const doc = createDocument('cache-edit', false);
    const before = resolveEditorSceneScope(doc, options);
    const { id, doc: withId } = nextNodeId(doc);
    const edited: Document = {
      ...withId,
      nodes: { ...withId.nodes, [id]: makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 1, h: 1 }) },
      rootChildren: [...withId.rootChildren, id],
    };
    const after = resolveEditorSceneScope(edited, options);
    expect(after).not.toBe(before);
    expect(after.authoredNodeIds.has(id)).toBe(true);
    expect(before.authoredNodeIds.has(id)).toBe(false);
  });
});
