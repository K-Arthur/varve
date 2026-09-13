import { applyAffine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';
import {
  applyShapeBuilderAction,
  buildShapeBuilderModel,
  facesCrossedBySegment,
  hitTestShapeBuilderFace,
  previewShapeBuilderAction,
  previewShapeBuilderSelection,
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

  it('matches the rectangle boolean areas while preserving selectable ownership', () => {
    const doc = rectangles();
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    const area = (faceIds: string[]) =>
      previewShapeBuilderSelection(model, faceIds).components.reduce(
        (sum, component) =>
          sum +
          Math.abs(
            component.outer.reduce((ringArea, point, index) => {
              const next = component.outer[(index + 1) % component.outer.length]!;
              return ringArea + point.x * next.y - next.x * point.y;
            }, 0) / 2,
          ) -
          component.holes.reduce(
            (holesArea, hole) =>
              holesArea +
              Math.abs(
                hole.reduce((ringArea, point, index) => {
                  const next = hole[(index + 1) % hole.length]!;
                  return ringArea + point.x * next.y - next.x * point.y;
                }, 0) / 2,
              ),
            0,
          ),
        0,
      );
    const union = model.faces.map((face) => face.id);
    const intersection = model.faces
      .filter((face) => face.filledBy.includes('a') && face.filledBy.includes('b'))
      .map((face) => face.id);
    const onlyA = model.faces
      .filter((face) => face.filledBy.includes('a') && !face.filledBy.includes('b'))
      .map((face) => face.id);
    const xor = model.faces.filter((face) => face.filledBy.length === 1).map((face) => face.id);

    expect(area(union)).toBeCloseTo(15_000, 6);
    expect(area(intersection)).toBeCloseTo(5_000, 6);
    expect(area(onlyA)).toBeCloseTo(5_000, 6);
    expect(area(xor)).toBeCloseTo(10_000, 6);
    expect(intersection).toHaveLength(1);
    expect(onlyA).toHaveLength(1);
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

  it('decomposes one self-intersecting path under its authored fill rule', () => {
    let doc = createDocument('self-intersection', true);
    const point = (x: number, y: number) => ({ x, y, handleIn: null, handleOut: null });
    const points = [point(0, 0), point(100, 100), point(0, 100), point(100, 0)];
    doc = addNode(
      doc,
      makeShapeNode(
        'bowtie',
        {
          kind: 'path',
          points,
          contours: [points],
          holes: [],
          closed: true,
          tolerance: 3,
          fillRule: 'evenodd',
        },
        { transform: identity },
      ),
    );
    const model = buildShapeBuilderModel(doc, ['bowtie']);
    const selectable = model.faces.filter((face) => face.selectable);
    expect(model.status).toBe('ready');
    expect(selectable).toHaveLength(2);
    expect(selectable.reduce((sum, face) => sum + face.area, 0)).toBeCloseTo(5_000, 6);
    expect(new Set(model.faces.map((face) => face.id)).size).toBe(model.faces.length);
    expect(model.faces.every((face) => face.outer.length >= 3)).toBe(true);
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

  it('keeps disconnected selected output as separate components', () => {
    let doc = createDocument('disconnected', true);
    doc = addNode(
      doc,
      makeShapeNode('left', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }, { transform: identity }),
    );
    doc = addNode(
      doc,
      makeShapeNode('right', { kind: 'rect', x: 100, y: 0, w: 20, h: 20 }, { transform: identity }),
    );
    const model = buildShapeBuilderModel(doc, ['left', 'right']);
    const output = previewShapeBuilderSelection(
      model,
      model.faces.filter((face) => face.selectable).map((face) => face.id),
    );
    expect(output.components).toHaveLength(2);
    expect(output.components.every((component) => component.outer.length === 4)).toBe(true);
  });

  it('previews destructive remainders separately from the selected output', () => {
    const doc = rectangles();
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    const selected = model.faces
      .filter((face) => face.filledBy.includes('a') && face.filledBy.includes('b'))
      .map((face) => face.id);
    const preview = previewShapeBuilderAction(model, selected, 'erase');

    expect(preview.output).toHaveLength(0);
    expect(preview.remainders).toHaveLength(2);
    expect(preview.remainders.every((remainder) => remainder.regions.length > 0)).toBe(true);
  });

  it('uses the rendered rounded-rectangle boundary for region hit testing', () => {
    let doc = createDocument('rounded-rectangle', true);
    doc = addNode(
      doc,
      makeShapeNode(
        'rounded',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 60 },
        { transform: identity, cornerRadius: 10 },
      ),
    );

    const model = buildShapeBuilderModel(doc, ['rounded']);
    expect(model.status).toBe('ready');
    expect(model.faces.filter((face) => face.selectable)).toHaveLength(1);
    expect(model.faces[0]!.outer.length).toBeGreaterThan(4);
    expect(hitTestShapeBuilderFace(model, { x: 1, y: 1 })).toBeNull();
    expect(hitTestShapeBuilderFace(model, { x: 50, y: 30 })).not.toBeNull();
  });

  it('keeps per-corner radii and bounds for negative-direction rectangles', () => {
    let doc = createDocument('negative-rounded-rectangle', true);
    doc = addNode(
      doc,
      makeShapeNode(
        'negative-rounded',
        { kind: 'rect', x: 100, y: 60, w: -100, h: -60 },
        { transform: identity, cornerRadius: [4, 8, 12, 16] },
      ),
    );

    const model = buildShapeBuilderModel(doc, ['negative-rounded']);
    expect(model.status).toBe('ready');
    expect(model.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 60 });
    expect(model.faces.filter((face) => face.selectable)).toHaveLength(1);
    expect(model.faces[0]!.outer.length).toBeGreaterThan(4);
    expect(hitTestShapeBuilderFace(model, { x: 50, y: 30 })).not.toBeNull();
  });

  it('does not discard a small feature inside a very large operand', () => {
    let doc = createDocument('mixed-scale', true);
    doc = addNode(
      doc,
      makeShapeNode(
        'large',
        { kind: 'rect', x: 1_000_000_000, y: -1_000_000_000, w: 1_000_000_000, h: 1_000_000_000 },
        { transform: identity },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'small',
        { kind: 'rect', x: 1_000_001_000, y: -999_999_000, w: 0.001, h: 0.001 },
        { transform: identity },
      ),
    );

    const model = buildShapeBuilderModel(doc, ['large', 'small']);
    expect(model.status).toBe('ready');
    expect(model.faces.filter((face) => face.selectable)).toHaveLength(2);
    expect(model.faces.some((face) => face.area < 0.000002)).toBe(true);
  });

  it('rejects zero-area primitive operands with an actionable reason', () => {
    let doc = createDocument('zero-area', true);
    doc = addNode(
      doc,
      makeShapeNode('flat', { kind: 'rect', x: 0, y: 0, w: 0, h: 100 }, { transform: identity }),
    );

    const model = buildShapeBuilderModel(doc, ['flat']);
    expect(model.status).toBe('unsupported');
    expect(model.message).toMatch(/degenerate|area|geometry/i);
  });

  it('rejects bounds-relative image and pattern paints instead of shifting them', () => {
    for (const type of ['image', 'pattern'] as const) {
      let doc = createDocument(`${type}-paint`, true);
      const node = makeShapeNode(
        type,
        { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        { transform: identity },
      );
      node.fills =
        type === 'image'
          ? [
              {
                type,
                image: { src: 'fixture.png', fit: 'fill', x: 0, y: 0, scale: 1 },
                opacity: 1,
                blendMode: 'normal',
                visible: true,
              },
            ]
          : [
              {
                type,
                pattern: { tileSrc: 'fixture.png', spacing: 0, rotation: 0 },
                opacity: 1,
                blendMode: 'normal',
                visible: true,
              },
            ];
      doc = addNode(doc, node);

      const model = buildShapeBuilderModel(doc, [type]);
      expect(model.status).toBe('unsupported');
      expect(model.message).toMatch(/image|pattern|vector|solid/i);
    }
  });

  it('rebases inline gradient placement through a transformed result parent', () => {
    let doc = createDocument('gradient-rebase', true);
    const sourceTransform = [2, 0, 0, 2, 10, 20] as const;
    const source = makeShapeNode(
      'gradient-source',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { transform: sourceTransform },
    );
    const sourceGradientTransform = [60, 10, -5, 40, 12, 18] as const;
    source.fills = [
      {
        type: 'gradient',
        gradient: {
          type: 'linear',
          stops: [],
          transform: sourceGradientTransform,
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ];
    doc = addNode(doc, source);

    const model = buildShapeBuilderModel(doc, ['gradient-source']);
    const applied = applyShapeBuilderAction(
      doc,
      ['gradient-source'],
      model.faces.map((f) => f.id),
      'create',
      {
        expectedRevision: model.revision,
      },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const output = applied.doc.nodes[applied.createdNodeIds[0]!];
    const outputTransform =
      output?.kind === 'shape' ? output.fills?.[0]?.gradient?.transform : undefined;
    expect(outputTransform).toBeDefined();
    if (!outputTransform) return;
    const sourcePaintPoint = applyAffine(
      sourceTransform,
      applyAffine(sourceGradientTransform, [0.35, 0.65]),
    );
    const outputPaintPoint = applyAffine(outputTransform, [0.35, 0.65]);
    expect(outputPaintPoint[0]).toBeCloseTo(sourcePaintPoint[0], 8);
    expect(outputPaintPoint[1]).toBeCloseTo(sourcePaintPoint[1], 8);
  });

  it('round-trips created components and holes through the document codec', () => {
    let doc = createDocument('persisted-shape-builder', true);
    const point = (x: number, y: number) => ({ x, y, handleIn: null, handleOut: null });
    const outer = [point(0, 0), point(100, 0), point(100, 100), point(0, 100)];
    const hole = [point(25, 25), point(25, 75), point(75, 75), point(75, 25)];
    doc = addNode(
      doc,
      makeShapeNode(
        'donut',
        {
          kind: 'path',
          points: outer,
          contours: [outer, hole],
          holes: [hole],
          closed: true,
          tolerance: 3,
          fillRule: 'evenodd',
        },
        { transform: identity },
      ),
    );
    const model = buildShapeBuilderModel(doc, ['donut']);
    const selected = model.faces.filter((face) => face.selectable).map((face) => face.id);
    const applied = applyShapeBuilderAction(doc, ['donut'], selected, 'create', {
      expectedRevision: model.revision,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const reopened = DocumentCodec.decode(DocumentCodec.encode(applied.doc));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const result = reopened.document.nodes[applied.createdNodeIds[0]!];
    expect(result?.kind).toBe('shape');
    if (result?.kind !== 'shape' || result.shape.kind !== 'path') return;
    expect(result.shape.contours?.length).toBeGreaterThan(0);
    expect(result.shape.holes?.length).toBeGreaterThan(0);
  });
});
