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

    expect(scope.surfaceKey).toBe(`designCanvas:${fixture.secondCanvasId}`);
    expect([...scope.authoredNodeIds]).toEqual([fixture.secondNodeId]);
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
