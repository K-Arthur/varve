import { describe, expect, it } from 'vitest';
import type { Document } from './document';
import {
  activePageNodes,
  addChild,
  createDesignCanvas,
  createDocument,
  deleteDesignCanvas,
  designCanvasChildren,
  designCanvasContentRoot,
  duplicateDesignCanvas,
  getActiveDesignCanvas,
  makeShapeNode,
  nextNodeId,
  renameDesignCanvas,
  reorderDesignCanvases,
  setActiveDesignCanvas,
  validateDocument,
} from './document';
import { owningDesignCanvas, resolveOwnership, validatePageOwnership } from './pageOwnership';
import type { NodeId } from './types';

function canvasDocument(): { doc: Document; canvasId: NodeId } {
  const doc = createDesignCanvas(createDocument('Design', true), { name: 'Campaign' });
  return { doc, canvasId: doc.activeDesignCanvasId! };
}

function addCanvasShape(doc: Document, canvasId: NodeId): { doc: Document; nodeId: NodeId } {
  const { id, doc: withId } = nextNodeId(doc);
  const shape = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 120, h: 80 });
  const root = designCanvasContentRoot(withId, canvasId);
  if (!root) throw new Error('Missing Design Canvas root');
  return { doc: addChild(withId, root, shape), nodeId: id };
}

describe('Design Canvas operations', () => {
  it('creates a separately named unbounded canvas with an owned root', () => {
    const { doc, canvasId } = canvasDocument();
    const canvas = getActiveDesignCanvas(doc)!;

    expect(canvas).toMatchObject({ id: canvasId, name: 'Campaign' });
    expect(doc.nodes[canvas.contentRoot]?.kind).toBe('group');
    expect(designCanvasChildren(doc, canvasId)).toEqual([]);
    expect(activePageNodes(doc)).toEqual([]);
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
    expect(validatePageOwnership(doc)).toEqual([]);
  });

  it('renames and switches canvases without changing authored content', () => {
    const initial = canvasDocument();
    const withSecond = createDesignCanvas(initial.doc, { name: 'Explorations' });
    const firstName = renameDesignCanvas(withSecond, initial.canvasId, 'Launch campaign');
    const selected = setActiveDesignCanvas(firstName, initial.canvasId);

    expect(getActiveDesignCanvas(selected)?.name).toBe('Launch campaign');
    expect(selected.designCanvases?.map((canvas) => canvas.name)).toEqual([
      'Launch campaign',
      'Explorations',
    ]);
  });

  it('uses the active canvas as the legacy active-surface read model', () => {
    const first = canvasDocument();
    const withFirstShape = addCanvasShape(first.doc, first.canvasId);
    const withSecond = createDesignCanvas(withFirstShape.doc, { name: 'Explorations' });
    const secondId = withSecond.activeDesignCanvasId!;
    const withSecondShape = addCanvasShape(withSecond, secondId);

    expect(activePageNodes(withSecondShape.doc)).toEqual([withSecondShape.nodeId]);
    expect(activePageNodes(setActiveDesignCanvas(withSecondShape.doc, first.canvasId))).toEqual([
      withFirstShape.nodeId,
    ]);
  });

  it('deep-copies the canvas subtree and keeps the copy isolated', () => {
    const initial = canvasDocument();
    const withShape = addCanvasShape(initial.doc, initial.canvasId);
    const duplicated = duplicateDesignCanvas(withShape.doc, initial.canvasId);
    const copy = getActiveDesignCanvas(duplicated)!;
    const copyChildren = designCanvasChildren(duplicated, copy.id);

    expect(copy.name).toBe('Campaign copy');
    expect(copy.id).not.toBe(initial.canvasId);
    expect(copyChildren).toHaveLength(1);
    expect(copyChildren[0]).not.toBe(withShape.nodeId);
    expect(resolveOwnership(duplicated, copyChildren[0]!)).toEqual({
      kind: 'designCanvas',
      designCanvasId: copy.id,
    });
    expect(owningDesignCanvas(duplicated, withShape.nodeId)).toBe(initial.canvasId);
  });

  it('moves content to a chosen canvas before deleting its source canvas', () => {
    const initial = canvasDocument();
    const withShape = addCanvasShape(initial.doc, initial.canvasId);
    const withSecond = createDesignCanvas(withShape.doc, { name: 'Archive' });
    const archiveId = withSecond.activeDesignCanvasId!;
    const removed = deleteDesignCanvas(withSecond, initial.canvasId, 'move-to-canvas', archiveId);

    expect(removed.designCanvases?.map((canvas) => canvas.id)).toEqual([archiveId]);
    expect(designCanvasChildren(removed, archiveId)).toEqual([withShape.nodeId]);
    expect(validateDocument(removed)).toEqual({ valid: true, errors: [] });
  });

  it('can move content to the publishing-neutral pasteboard when requested', () => {
    const initial = canvasDocument();
    const withShape = addCanvasShape(initial.doc, initial.canvasId);
    const removed = deleteDesignCanvas(withShape.doc, initial.canvasId, 'move-to-pasteboard');

    expect(removed.designCanvases).toEqual([]);
    expect(removed.rootChildren).toContain(withShape.nodeId);
    expect(removed.nodes[withShape.nodeId]).toBeDefined();
  });

  it('reorders the navigator collection without changing roots or active selection', () => {
    const initial = canvasDocument();
    const withSecond = createDesignCanvas(initial.doc, { name: 'Second' });
    const secondId = withSecond.activeDesignCanvasId!;
    const reordered = reorderDesignCanvases(withSecond, [secondId, initial.canvasId]);

    expect(reordered.designCanvases?.map((canvas) => canvas.id)).toEqual([
      secondId,
      initial.canvasId,
    ]);
    expect(reordered.activeDesignCanvasId).toBe(secondId);
    expect(validateDocument(reordered).valid).toBe(true);
  });
});
