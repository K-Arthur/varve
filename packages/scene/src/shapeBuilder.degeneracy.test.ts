import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeShapeNode } from './document';
import type { ShapeBuilderModel } from './shapeBuilder';
import {
  applyShapeBuilderAction,
  buildShapeBuilderModel,
  hitTestShapeBuilderFace,
  previewShapeBuilderSelection,
} from './shapeBuilder';

const identity = [1, 0, 0, 1, 0, 0] as const;

interface RectSpec {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectDoc(
  entries: Array<[string, RectSpec]>,
  transform = identity as readonly [number, number, number, number, number, number],
) {
  let doc = createDocument('degeneracy', true);
  for (const [id, shape] of entries) {
    doc = addNode(
      doc,
      makeShapeNode(id, { kind: 'rect', ...shape }, { transform: [...transform] }),
    );
  }
  return doc;
}

function ringArea(ring: readonly { x: number; y: number }[]): number {
  return Math.abs(
    ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}

function selectableArea(model: ShapeBuilderModel): number {
  const result = previewShapeBuilderSelection(
    model,
    model.faces.filter((face) => face.selectable).map((face) => face.id),
  );
  return result.components.reduce(
    (sum, component) =>
      sum + ringArea(component.outer) - component.holes.reduce((h, hole) => h + ringArea(hole), 0),
    0,
  );
}

function faceAreas(model: ShapeBuilderModel): number[] {
  return model.faces
    .filter((face) => face.selectable)
    .map((face) => face.area)
    .sort((a, b) => a - b);
}

function pathNode(
  id: string,
  points: Array<{ x: number; y: number }>,
  fillRule: 'nonzero' | 'evenodd',
  contours?: Array<Array<{ x: number; y: number }>>,
  closed = true,
) {
  const toPathPoints = (ring: Array<{ x: number; y: number }>) =>
    ring.map((point) => ({ ...point, handleIn: null, handleOut: null }));
  return makeShapeNode(
    id,
    {
      kind: 'path',
      points: toPathPoints(points),
      contours: (contours ?? [points]).map(toPathPoints),
      holes: contours && contours.length > 1 ? [toPathPoints(contours[1]!)] : [],
      closed,
      tolerance: 3,
      fillRule,
    },
    { transform: identity },
  );
}

describe('Shape Builder degeneracy and fill-rule fixtures', () => {
  it('handles externally tangent circles without phantom or missing area', () => {
    let doc = createDocument('tangent-circles', true);
    doc = addNode(
      doc,
      makeShapeNode('a', { kind: 'circle', cx: 0, cy: 0, r: 50 }, { transform: identity }),
    );
    doc = addNode(
      doc,
      makeShapeNode('b', { kind: 'circle', cx: 100, cy: 0, r: 50 }, { transform: identity }),
    );

    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    for (const face of model.faces) {
      expect(Number.isFinite(face.area)).toBe(true);
      expect(face.area).toBeGreaterThan(0);
      expect(face.outer.every((point) => Number.isFinite(point.x))).toBe(true);
      expect(face.outer.every((point) => Number.isFinite(point.y))).toBe(true);
    }
    const total = selectableArea(model);
    expect(total).toBeGreaterThan(15_700);
    expect(total).toBeLessThan(15_710);
    expect(Math.max(...model.faces.map((face) => face.area))).toBeLessThan(7_854);
  });

  it('keeps exact shared-edge rectangles as two owned faces', () => {
    const doc = rectDoc([
      ['a', { x: 0, y: 0, w: 50, h: 100 }],
      ['b', { x: 50, y: 0, w: 50, h: 100 }],
    ]);
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    expect(faceAreas(model)).toEqual([5_000, 5_000]);
    expect(model.faces.map((face) => [...face.filledBy].sort()).sort()).toEqual([['a'], ['b']]);
    expect(model.faces.every((face) => face.holes.length === 0)).toBe(true);
  });

  it('deduplicates fully coincident operands without phantom faces', () => {
    const doc = rectDoc([
      ['a', { x: 0, y: 0, w: 100, h: 100 }],
      ['b', { x: 0, y: 0, w: 100, h: 100 }],
    ]);
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    expect(model.faces).toHaveLength(1);
    expect(model.faces[0]!.area).toBe(10_000);
    expect([...model.faces[0]!.filledBy].sort()).toEqual(['a', 'b']);
  });

  it('deduplicates fully coincident circles with identical sampling', () => {
    let doc = createDocument('coincident-circles', true);
    doc = addNode(
      doc,
      makeShapeNode('a', { kind: 'circle', cx: 10, cy: 10, r: 40 }, { transform: identity }),
    );
    doc = addNode(
      doc,
      makeShapeNode('b', { kind: 'circle', cx: 10, cy: 10, r: 40 }, { transform: identity }),
    );
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    expect(model.faces).toHaveLength(1);
    expect(model.faces[0]!.filledBy).toHaveLength(2);
  });

  it('resolves four quadrants meeting at a single vertex', () => {
    const doc = rectDoc([
      ['tl', { x: 0, y: 0, w: 50, h: 50 }],
      ['tr', { x: 50, y: 0, w: 50, h: 50 }],
      ['bl', { x: 0, y: 50, w: 50, h: 50 }],
      ['br', { x: 50, y: 50, w: 50, h: 50 }],
    ]);
    const model = buildShapeBuilderModel(doc, ['tl', 'tr', 'bl', 'br']);
    expect(model.status).toBe('ready');
    expect(faceAreas(model)).toEqual([2_500, 2_500, 2_500, 2_500]);
    expect(model.faces.every((face) => face.filledBy.length === 1)).toBe(true);
  });

  it('splits a partial overlap into owned remainder and overlap faces', () => {
    const doc = rectDoc([
      ['a', { x: 0, y: 0, w: 100, h: 100 }],
      ['b', { x: 50, y: 50, w: 100, h: 100 }],
    ]);
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    expect(faceAreas(model)).toEqual([2_500, 7_500, 7_500]);
    const overlap = model.faces.find((face) => face.filledBy.length === 2);
    expect(overlap?.area).toBeCloseTo(2_500, 6);
  });

  it('keeps a thin sliver face finite and selectable', () => {
    const doc = rectDoc([
      ['a', { x: 0, y: 0, w: 100, h: 100 }],
      ['b', { x: 99.99, y: 0, w: 100, h: 100 }],
    ]);
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    const areas = faceAreas(model);
    expect(areas).toHaveLength(3);
    expect(areas[0]!).toBeCloseTo(1, 6);
    expect(areas[1]!).toBeCloseTo(9_999, 6);
    expect(areas[2]!).toBeCloseTo(9_999, 6);
  });

  it('is translation stable at very large coordinate offsets', () => {
    const offset = 100_000_000;
    const doc = rectDoc(
      [
        ['a', { x: 0, y: 0, w: 100, h: 100 }],
        ['b', { x: 50, y: 0, w: 100, h: 100 }],
      ],
      [1, 0, 0, 1, offset, -offset],
    );
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    expect(model.faces).toHaveLength(3);
    expect(selectableArea(model)).toBeCloseTo(15_000, 3);
  });

  it('is covariant under rotation and non-uniform scale', () => {
    const entries: Array<[string, RectSpec]> = [
      ['a', { x: 0, y: 0, w: 100, h: 100 }],
      ['b', { x: 50, y: 0, w: 100, h: 100 }],
    ];
    const angle = Math.PI / 6;
    const rotated = buildShapeBuilderModel(
      rectDoc(entries, [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 5, 7]),
      ['a', 'b'],
    );
    expect(rotated.status).toBe('ready');
    expect(rotated.faces).toHaveLength(3);
    expect(selectableArea(rotated)).toBeCloseTo(15_000, 6);

    const scaled = buildShapeBuilderModel(rectDoc(entries, [3, 0, 0, 2, 10, 20]), ['a', 'b']);
    expect(scaled.status).toBe('ready');
    expect(scaled.faces).toHaveLength(3);
    expect(selectableArea(scaled)).toBeCloseTo(90_000, 4);
  });

  it('represents a nested island without treating extra rings as holes automatically', () => {
    const doc = rectDoc([
      ['big', { x: 0, y: 0, w: 100, h: 100 }],
      ['small', { x: 25, y: 25, w: 50, h: 50 }],
    ]);
    const model = buildShapeBuilderModel(doc, ['big', 'small']);
    expect(model.status).toBe('ready');
    expect(model.faces).toHaveLength(2);
    const outer = model.faces.find((face) => face.holes.length === 1);
    expect(outer?.area).toBeCloseTo(7_500, 6);
    const island = model.faces.find((face) => face.area === 2_500);
    expect(island?.filledBy.sort()).toEqual(['big', 'small']);
    expect(selectableArea(model)).toBeCloseTo(10_000, 6);
  });

  it('classifies a self-intersecting pentagram by its authored fill rule', () => {
    const points = Array.from({ length: 5 }, (_, index) => {
      const angle = -Math.PI / 2 + index * ((4 * Math.PI) / 5);
      return { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) };
    });

    let evenoddDoc = createDocument('pentagram-evenodd', true);
    evenoddDoc = addNode(evenoddDoc, pathNode('star', points, 'evenodd'));
    const evenodd = buildShapeBuilderModel(evenoddDoc, ['star']);
    expect(evenodd.status).toBe('ready');
    const evenoddSelectable = evenodd.faces.filter((face) => face.selectable);
    const evenoddEmpty = evenodd.faces.filter((face) => !face.selectable);
    expect(evenoddSelectable).toHaveLength(5);
    expect(evenoddEmpty).toHaveLength(1);
    expect(hitTestShapeBuilderFace(evenodd, { x: 0, y: 0 })).toBeNull();

    let nonzeroDoc = createDocument('pentagram-nonzero', true);
    nonzeroDoc = addNode(nonzeroDoc, pathNode('star', points, 'nonzero'));
    const nonzero = buildShapeBuilderModel(nonzeroDoc, ['star']);
    expect(nonzero.status).toBe('ready');
    expect(nonzero.faces.filter((face) => face.selectable)).toHaveLength(1);
    expect(hitTestShapeBuilderFace(nonzero, { x: 0, y: 0 })).not.toBeNull();

    expect(selectableArea(nonzero)).toBeCloseTo(selectableArea(evenodd) + evenoddEmpty[0]!.area, 6);
  });

  it('treats duplicate evenodd rings as empty and duplicate nonzero rings as filled', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ];
    let evenoddDoc = createDocument('duplicate-evenodd', true);
    evenoddDoc = addNode(evenoddDoc, pathNode('dup', ring, 'evenodd', [ring, ring]));
    const evenodd = buildShapeBuilderModel(evenoddDoc, ['dup']);
    expect(evenodd.status).toBe('ready');
    expect(evenodd.faces.filter((face) => face.selectable)).toHaveLength(0);
    expect(evenodd.message).toMatch(/no filled bounded region/i);

    let nonzeroDoc = createDocument('duplicate-nonzero', true);
    nonzeroDoc = addNode(nonzeroDoc, pathNode('dup', ring, 'nonzero', [ring, ring]));
    const nonzero = buildShapeBuilderModel(nonzeroDoc, ['dup']);
    expect(nonzero.status).toBe('ready');
    expect(nonzero.faces.filter((face) => face.selectable)).toHaveLength(1);
    expect(nonzero.faces.find((face) => face.selectable)?.area).toBeCloseTo(2_500, 6);
  });

  it('tolerates duplicate consecutive points and zero-length segments', () => {
    let doc = createDocument('duplicate-points', true);
    doc = addNode(
      doc,
      pathNode(
        'dup-points',
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
          { x: 0, y: 100 },
        ],
        'nonzero',
      ),
    );
    const model = buildShapeBuilderModel(doc, ['dup-points']);
    expect(model.status).toBe('ready');
    expect(model.faces.filter((face) => face.selectable)).toHaveLength(1);
    expect(model.faces[0]!.area).toBeCloseTo(10_000, 6);
  });

  it('rejects open boundaries and visible strokes with actionable reasons', () => {
    let doc = createDocument('open-and-stroked', true);
    const open = pathNode(
      'open',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      'nonzero',
      undefined,
      false,
    );
    doc = addNode(doc, open);
    const openModel = buildShapeBuilderModel(doc, ['open']);
    expect(openModel.status).toBe('unsupported');
    expect(openModel.message).toMatch(/open|divider|close|outline/i);

    let strokeDoc = createDocument('stroked', true);
    strokeDoc = addNode(
      strokeDoc,
      makeShapeNode(
        'stroked',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        {
          transform: identity,
          strokes: [
            {
              color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
              weight: 4,
              cap: 'butt',
              join: 'miter',
              visible: true,
            } as never,
          ],
        },
      ),
    );
    const strokeModel = buildShapeBuilderModel(strokeDoc, ['stroked']);
    expect(strokeModel.status).toBe('unsupported');
    expect(strokeModel.message).toMatch(/stroke|outline/i);
  });

  it('is deterministic for repeated builds of the same revision', () => {
    const doc = rectDoc([
      ['a', { x: 0, y: 0, w: 100, h: 100 }],
      ['b', { x: 50, y: 0, w: 100, h: 100 }],
    ]);
    const first = buildShapeBuilderModel(doc, ['a', 'b']);
    const second = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(second.revision).toBe(first.revision);
    expect(second.faces.map((face) => face.id)).toEqual(first.faces.map((face) => face.id));
    expect(second.faces.map((face) => face.edgeIds)).toEqual(
      first.faces.map((face) => face.edgeIds),
    );
  });

  it('applies divide, erase, and extract with the documented source policy', () => {
    const disconnected = rectDoc([
      ['left', { x: 0, y: 0, w: 20, h: 20 }],
      ['right', { x: 100, y: 0, w: 20, h: 20 }],
    ]);
    const divideModel = buildShapeBuilderModel(disconnected, ['left', 'right']);
    const divided = applyShapeBuilderAction(
      disconnected,
      ['left', 'right'],
      divideModel.faces.filter((face) => face.selectable).map((face) => face.id),
      'divide',
      { expectedRevision: divideModel.revision },
    );
    expect(divided.ok).toBe(true);
    if (!divided.ok) return;
    expect(divided.createdNodeIds).toHaveLength(2);
    expect(divided.removedNodeIds.sort()).toEqual(['left', 'right']);
    const outputs = divided.createdNodeIds.map((id) => divided.doc.nodes[id]);
    expect(outputs.every((node) => node?.kind === 'shape')).toBe(true);
    for (const node of outputs) {
      if (node?.kind !== 'shape' || node.shape.kind !== 'path') continue;
      const contours = node.shape.contours ?? [];
      expect(contours).toHaveLength(1);
      expect(contours[0]!.length).toBeGreaterThanOrEqual(4);
    }

    const overlapping = rectDoc([
      ['a', { x: 0, y: 0, w: 100, h: 100 }],
      ['b', { x: 50, y: 0, w: 100, h: 100 }],
    ]);
    const eraseModel = buildShapeBuilderModel(overlapping, ['a', 'b']);
    const overlapFace = eraseModel.faces.find((face) => face.filledBy.length === 2);
    const erased = applyShapeBuilderAction(
      overlapping,
      ['a', 'b'],
      overlapFace ? [overlapFace.id] : [],
      'erase',
      { expectedRevision: eraseModel.revision },
    );
    expect(erased.ok).toBe(true);
    if (!erased.ok) return;
    expect(erased.createdNodeIds).toHaveLength(0);
    expect(erased.doc.nodes.a).toBeDefined();
    expect(erased.doc.nodes.b).toBeDefined();
    const remainderA = erased.doc.nodes.a;
    expect(remainderA?.kind).toBe('shape');
    if (remainderA?.kind === 'shape' && remainderA.shape.kind === 'path') {
      expect(remainderA.shape.contours?.[0]).toHaveLength(4);
      expect(ringArea(remainderA.shape.contours![0]!)).toBeCloseTo(5_000, 6);
    }

    const extractModel = buildShapeBuilderModel(overlapping, ['a', 'b']);
    const extractFace = extractModel.faces.find((face) => face.filledBy.length === 2);
    const extracted = applyShapeBuilderAction(
      overlapping,
      ['a', 'b'],
      extractFace ? [extractFace.id] : [],
      'extract',
      { expectedRevision: extractModel.revision },
    );
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.createdNodeIds).toHaveLength(1);
    expect(extracted.doc.nodes.a).toBeDefined();
    expect(extracted.doc.nodes.b).toBeDefined();
  });

  it('emits one compound node for Merge and separate nodes for Extract', () => {
    const disconnected = rectDoc([
      ['left', { x: 0, y: 0, w: 20, h: 20 }],
      ['right', { x: 100, y: 0, w: 20, h: 20 }],
    ]);
    const mergeModel = buildShapeBuilderModel(disconnected, ['left', 'right']);
    const selected = mergeModel.faces.filter((face) => face.selectable).map((face) => face.id);
    const merged = applyShapeBuilderAction(disconnected, ['left', 'right'], selected, 'merge', {
      expectedRevision: mergeModel.revision,
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.createdNodeIds).toHaveLength(1);
    expect(Object.keys(merged.doc.nodes)).toHaveLength(1);
    const mergedNode = merged.doc.nodes[merged.createdNodeIds[0]!];
    expect(mergedNode?.kind).toBe('shape');
    if (mergedNode?.kind === 'shape' && mergedNode.shape.kind === 'path') {
      expect(mergedNode.shape.contours).toHaveLength(2);
      expect(mergedNode.shape.points).toEqual(mergedNode.shape.contours?.[0]);
    }

    const extractModel = buildShapeBuilderModel(disconnected, ['left', 'right']);
    const extracted = applyShapeBuilderAction(
      disconnected,
      ['left', 'right'],
      extractModel.faces.filter((face) => face.selectable).map((face) => face.id),
      'extract',
      { expectedRevision: extractModel.revision },
    );
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.createdNodeIds).toHaveLength(2);
    for (const id of extracted.createdNodeIds) {
      const node = extracted.doc.nodes[id];
      if (node?.kind === 'shape' && node.shape.kind === 'path') {
        expect(node.shape.contours).toHaveLength(1);
      }
    }
  });

  it('fills a bounded empty region with Create and rejects destructive actions on it', () => {
    let doc = createDocument('empty-region', true);
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
    expect(model.status).toBe('ready');
    const emptyFace = model.faces.find((face) => !face.selectable && face.area === 2_500);
    expect(emptyFace).toBeDefined();
    expect(hitTestShapeBuilderFace(model, { x: 50, y: 50 })).toBeNull();
    expect(
      hitTestShapeBuilderFace(model, { x: 50, y: 50 }, undefined, { includeEmpty: true })?.id,
    ).toBe(emptyFace!.id);

    const created = applyShapeBuilderAction(doc, ['donut'], [emptyFace!.id], 'create', {
      expectedRevision: model.revision,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.createdNodeIds).toHaveLength(1);
    expect(created.removedNodeIds).toHaveLength(0);
    expect(created.doc.nodes.donut).toBeDefined();
    const result = created.doc.nodes[created.createdNodeIds[0]!];
    if (result?.kind === 'shape' && result.shape.kind === 'path') {
      expect(ringArea(result.shape.contours![0]!)).toBeCloseTo(2_500, 6);
    }

    const merged = applyShapeBuilderAction(doc, ['donut'], [emptyFace!.id], 'merge', {
      expectedRevision: model.revision,
    });
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.reason).toMatch(/empty|create/i);
  });
});
