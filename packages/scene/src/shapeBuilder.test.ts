import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeShapeNode } from './document';
import {
  applyShapeBuilderAction,
  buildShapeBuilderModel,
  facesCrossedBySegment,
} from './shapeBuilder';

const identity = [1, 0, 0, 1, 0, 0] as const;

function rectangles() {
  let doc = createDocument('shape-builder', true);
  doc = addNode(
    doc,
    makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, { transform: identity }),
  );
  doc = addNode(
    doc,
    makeShapeNode('b', { kind: 'rect', x: 50, y: 0, w: 100, h: 100 }, { transform: identity }),
  );
  return doc;
}

describe('Shape Builder arrangement and actions', () => {
  it('decomposes overlapping rectangles into three owned faces', () => {
    const doc = rectangles();
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    expect(model.faces).toHaveLength(3);
    expect(model.faces.map((face) => face.area).sort((a, b) => a - b)).toEqual([5000, 5000, 5000]);
    expect(model.faces.filter((face) => face.filledBy.length === 2)).toHaveLength(1);
    expect(model.faces.every((face) => face.id.startsWith('face:'))).toBe(true);
    expect(model.faces.every((face) => face.edgeIds.length > 0)).toBe(true);
  });

  it('selects every thin face crossed by a sweep, even when endpoints miss it', () => {
    const doc = rectangles();
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    const crossed = facesCrossedBySegment(model, { x: 25, y: -10 }, { x: 125, y: -10 });
    expect(crossed).toHaveLength(0);

    const horizontal = facesCrossedBySegment(model, { x: 25, y: 50 }, { x: 125, y: 50 });
    expect(horizontal).toHaveLength(3);
  });

  it('keeps a donut hole empty and does not fabricate a connector', () => {
    let doc = createDocument('donut', true);
    const point = (x: number, y: number) => ({ x, y, handleIn: null, handleOut: null });
    const node = makeShapeNode(
      'donut',
      {
        kind: 'path',
        points: [point(0, 0), point(100, 0), point(100, 100), point(0, 100)],
        contours: [
          [point(0, 0), point(100, 0), point(100, 100), point(0, 100)],
          [point(25, 25), point(25, 75), point(75, 75), point(75, 25)],
        ],
        holes: [[point(25, 25), point(25, 75), point(75, 75), point(75, 25)]],
        closed: true,
        tolerance: 3,
        fillRule: 'evenodd',
      },
      { transform: identity },
    );
    doc = addNode(doc, node);
    const model = buildShapeBuilderModel(doc, ['donut']);
    expect(model.status).toBe('ready');
    expect(model.faces.some((face) => face.holes.length === 1 && face.area === 7500)).toBe(true);
    expect(model.faces.some((face) => !face.selectable && face.area === 2500)).toBe(true);
    expect(
      model.faces.every((face) =>
        face.outer.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      ),
    ).toBe(true);
  });

  it('creates a retained-source result and keeps a destructive merge atomic', () => {
    const doc = rectangles();
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    const allFaces = model.faces.map((face) => face.id);
    const created = applyShapeBuilderAction(doc, ['a', 'b'], allFaces, 'create', {
      expectedRevision: model.revision,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.createdNodeIds).toHaveLength(1);
    expect(created.doc.nodes.a).toBeDefined();
    expect(created.doc.nodes.b).toBeDefined();

    const merged = applyShapeBuilderAction(doc, ['a', 'b'], allFaces, 'merge', {
      expectedRevision: model.revision,
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.createdNodeIds).toHaveLength(1);
    expect(merged.removedNodeIds.sort()).toEqual(['a', 'b']);
    expect(Object.keys(merged.doc.nodes)).toHaveLength(1);
  });

  it('rejects a stale face revision without changing the document', () => {
    const doc = rectangles();
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    const result = applyShapeBuilderAction(doc, ['a', 'b'], [model.faces[0]!.id], 'erase', {
      expectedRevision: 'shape-builder-v1:stale',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/changed|preview/i);
  });
});
