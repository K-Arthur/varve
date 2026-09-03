import {
  addChild,
  addNode,
  createDocument,
  imageFill,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
} from '@varve/scene';
import type { Point } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  sliceDocumentWithKnife,
  splitPolygonByKnifeLine,
  splitPolylineByKnifeLine,
} from './knifeSlice';

const UNIT_SQUARE: Point[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

/** A cut that crosses the unit square horizontally at y = 50. */
const acrossMiddle = { start: [-20, 50] as Point, end: [120, 50] as Point };

function area(points: readonly Point[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    total += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(total / 2);
}

function boundsOf(points: readonly Point[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe('splitPolygonByKnifeLine — convex', () => {
  it('splits a square into two halves of equal area', () => {
    const pieces = splitPolygonByKnifeLine(UNIT_SQUARE, acrossMiddle);

    expect(pieces).toHaveLength(2);
    expect(area(pieces![0]!)).toBeCloseTo(5000, 6);
    expect(area(pieces![1]!)).toBeCloseTo(5000, 6);
    // The pieces tile the source exactly: no gap, no overlap.
    expect(area(pieces![0]!) + area(pieces![1]!)).toBeCloseTo(area(UNIT_SQUARE), 6);
  });

  it('splits on a diagonal', () => {
    const pieces = splitPolygonByKnifeLine(UNIT_SQUARE, {
      start: [-10, -10],
      end: [110, 110],
    });

    expect(pieces).toHaveLength(2);
    expect(area(pieces![0]!)).toBeCloseTo(5000, 6);
    expect(area(pieces![1]!)).toBeCloseTo(5000, 6);
  });

  it('splits an approximated circle into two halves', () => {
    const circle: Point[] = Array.from({ length: 64 }, (_, index) => {
      const theta = (2 * Math.PI * index) / 64;
      return [50 + 50 * Math.cos(theta), 50 + 50 * Math.sin(theta)] as Point;
    });

    const pieces = splitPolygonByKnifeLine(circle, acrossMiddle);

    expect(pieces).toHaveLength(2);
    expect(area(pieces![0]!)).toBeCloseTo(area(pieces![1]!), 6);
  });
});

describe('splitPolygonByKnifeLine — the cut must pass all the way through', () => {
  it('returns null when the cut misses entirely', () => {
    expect(splitPolygonByKnifeLine(UNIT_SQUARE, { start: [-20, 150], end: [120, 150] })).toBeNull();
  });

  it('returns null when the cut stops inside the shape', () => {
    // Entering at x = 0 but stopping at x = 50 is a partial cut: extending it
    // to the far edge would split geometry the user never dragged across.
    expect(splitPolygonByKnifeLine(UNIT_SQUARE, { start: [-20, 50], end: [50, 50] })).toBeNull();
  });

  it('returns null when the cut starts inside the shape', () => {
    expect(splitPolygonByKnifeLine(UNIT_SQUARE, { start: [50, 50], end: [120, 50] })).toBeNull();
  });

  it('returns null when the cut only grazes an edge', () => {
    expect(splitPolygonByKnifeLine(UNIT_SQUARE, { start: [-20, 0], end: [120, 0] })).toBeNull();
  });

  it('returns null for a degenerate zero-length cut', () => {
    expect(splitPolygonByKnifeLine(UNIT_SQUARE, { start: [50, 50], end: [50, 50] })).toBeNull();
  });

  it('splits when the cut passes exactly through two opposite corners', () => {
    const pieces = splitPolygonByKnifeLine(UNIT_SQUARE, { start: [-1, -1], end: [101, 101] });
    expect(pieces).toHaveLength(2);
    expect(area(pieces![0]!) + area(pieces![1]!)).toBeCloseTo(10000, 6);
  });
});

describe('splitPolygonByKnifeLine — concave shapes yield every real piece', () => {
  // A U opening upwards. A horizontal cut above the base crosses both arms,
  // which leaves one piece below and two above. Half-plane clipping merges
  // those two into one; this is the case that rules it out.
  const uShape: Point[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [7, 10],
    [7, 3],
    [3, 3],
    [3, 10],
    [0, 10],
  ];

  it('produces three pieces from a U cut across both arms', () => {
    const pieces = splitPolygonByKnifeLine(uShape, { start: [-1, 6], end: [11, 6] });

    expect(pieces).toHaveLength(3);
    const total = pieces!.reduce((sum, piece) => sum + area(piece), 0);
    expect(total).toBeCloseTo(area(uShape), 6);
  });

  it('keeps the base of the U as one connected piece', () => {
    const pieces = splitPolygonByKnifeLine(uShape, { start: [-1, 6], end: [11, 6] })!;
    const base = pieces.find((piece) => boundsOf(piece).minY === 0);

    expect(base).toBeDefined();
    // The base spans the full width: it is the connected bottom, not one arm.
    expect(boundsOf(base!).minX).toBeCloseTo(0, 6);
    expect(boundsOf(base!).maxX).toBeCloseTo(10, 6);
  });

  it('splits a five-pointed star into every piece the cut creates', () => {
    const star: Point[] = [];
    for (let index = 0; index < 10; index++) {
      const radius = index % 2 === 0 ? 50 : 20;
      const theta = (Math.PI * index) / 5 - Math.PI / 2;
      star.push([50 + radius * Math.cos(theta), 50 + radius * Math.sin(theta)]);
    }

    const pieces = splitPolygonByKnifeLine(star, { start: [-10, 60], end: [110, 60] });

    expect(pieces).not.toBeNull();
    expect(pieces!.length).toBeGreaterThanOrEqual(2);
    const total = pieces!.reduce((sum, piece) => sum + area(piece), 0);
    expect(total).toBeCloseTo(area(star), 4);
  });
});

describe('splitPolygonByKnifeLine — coordinate ranges', () => {
  it('splits a shape far from the origin', () => {
    const offset = 1_000_000;
    const far = UNIT_SQUARE.map(([x, y]) => [x + offset, y + offset] as Point);

    const pieces = splitPolygonByKnifeLine(far, {
      start: [offset - 20, offset + 50],
      end: [offset + 120, offset + 50],
    });

    expect(pieces).toHaveLength(2);
    expect(area(pieces![0]!)).toBeCloseTo(5000, 3);
  });

  it('splits a very small shape', () => {
    const tiny: Point[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];

    const pieces = splitPolygonByKnifeLine(tiny, { start: [-1, 0.5], end: [2, 0.5] });

    expect(pieces).toHaveLength(2);
    expect(area(pieces![0]!)).toBeCloseTo(0.5, 6);
  });

  it('discards a sliver below the minimum area', () => {
    // A cut a hair inside the edge would leave a piece too thin to edit.
    const pieces = splitPolygonByKnifeLine(UNIT_SQUARE, {
      start: [-20, 0.00005],
      end: [120, 0.00005],
    });

    expect(pieces).toBeNull();
  });
});

describe('splitPolylineByKnifeLine', () => {
  it('splits an open polyline at a single crossing', () => {
    const pieces = splitPolylineByKnifeLine(
      [
        [0, 0],
        [100, 0],
      ],
      { start: [50, -10], end: [50, 10] },
    );

    expect(pieces).toHaveLength(2);
    expect(pieces![0]).toEqual([
      [0, 0],
      [50, 0],
    ]);
    expect(pieces![1]).toEqual([
      [50, 0],
      [100, 0],
    ]);
  });

  it('splits at every crossing of a zig-zag', () => {
    const pieces = splitPolylineByKnifeLine(
      [
        [0, -10],
        [10, 10],
        [20, -10],
        [30, 10],
      ],
      { start: [-5, 0], end: [35, 0] },
    );

    expect(pieces).toHaveLength(4);
  });

  it('leaves a polyline alone when the cut misses it', () => {
    expect(
      splitPolylineByKnifeLine(
        [
          [0, 0],
          [100, 0],
        ],
        { start: [50, 10], end: [50, 30] },
      ),
    ).toBeNull();
  });

  it('leaves a polyline alone when the crossing is beyond the drag', () => {
    // The cut's line would cross at x = 50, but the drag stopped short of it.
    expect(
      splitPolylineByKnifeLine(
        [
          [0, 0],
          [100, 0],
        ],
        { start: [50, -10], end: [50, -5] },
      ),
    ).toBeNull();
  });
});

describe('sliceDocumentWithKnife', () => {
  function documentWithRect(options: Parameters<typeof makeShapeNode>[2] = {}) {
    let doc = createDocument('Knife test', true);
    const shape = makeShapeNode(
      'shape',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Rectangle 1', transform: [1, 0, 0, 1, 0, 0], ...options },
    );
    doc = addNode(doc, shape);
    return doc;
  }

  it('keeps the source id, inserts the second piece above it, and preserves transforms', () => {
    let doc = createDocument('Knife test', true);
    const frame = makeFrameNode('frame', {
      name: 'Frame',
      transform: [1, 0, 0, 1, 100, 100],
      children: [],
    });
    doc = addNode(doc, frame);
    const shape = makeShapeNode(
      'shape',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Rectangle 1', transform: [1, 0, 0, 1, 10, 10] },
    );
    doc = addChild(doc, frame.id, shape);

    const result = sliceDocumentWithKnife(doc, { start: [80, 160], end: [240, 160] }, [shape.id]);

    expect(result.slicedNodeIds).toEqual([shape.id]);
    expect(result.resultNodeIds).toHaveLength(2);
    const parent = result.document.nodes[frame.id];
    expect(parent?.kind).toBe('frame');
    if (parent?.kind !== 'frame') return;
    expect(parent.children).toHaveLength(2);
    expect(parent.children[0]).toBe(shape.id);
    // Both pieces keep the source's transform: the geometry moved into local
    // space, not the node.
    expect(result.document.nodes[shape.id]?.transform).toEqual([1, 0, 0, 1, 10, 10]);
    expect(result.document.nodes[parent.children[1]!]?.transform).toEqual([1, 0, 0, 1, 10, 10]);
  });

  it('names the second piece by advancing the trailing index', () => {
    const doc = documentWithRect();
    const result = sliceDocumentWithKnife(doc, { start: [-20, 50], end: [120, 50] }, ['shape']);

    const names = result.resultNodeIds.map((id) => result.document.nodes[id]?.name);
    expect(names).toEqual(['Rectangle 1', 'Rectangle 2']);
  });

  it('does not reuse a name already taken in the document', () => {
    let doc = documentWithRect();
    doc = addNode(
      doc,
      makeShapeNode(
        'other',
        { kind: 'rect', x: 500, y: 500, w: 10, h: 10 },
        { name: 'Rectangle 2' },
      ),
    );

    const result = sliceDocumentWithKnife(doc, { start: [-20, 50], end: [120, 50] }, ['shape']);
    const names = result.resultNodeIds.map((id) => result.document.nodes[id]?.name);
    expect(names).toEqual(['Rectangle 1', 'Rectangle 3']);
  });

  it('returns the document untouched when nothing is cut', () => {
    const doc = documentWithRect();
    const result = sliceDocumentWithKnife(doc, { start: [-20, 500], end: [120, 500] }, ['shape']);

    expect(result.slicedNodeIds).toEqual([]);
    expect(result.document).toBe(doc);
  });

  it('does not split content under a locked ancestor', () => {
    let doc = createDocument('Knife locked test', true);
    const frame = makeFrameNode('locked-frame', {
      name: 'Locked Frame',
      locked: true,
      w: 100,
      h: 100,
      children: [],
    });
    doc = addNode(doc, frame);
    const shape = makeShapeNode('locked-shape', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    doc = addChild(doc, frame.id, shape);

    const result = sliceDocumentWithKnife(doc, { start: [-10, 50], end: [110, 50] }, [shape.id]);

    expect(result.slicedNodeIds).toEqual([]);
    expect(result.document).toBe(doc);
  });

  it('does not split a hidden node', () => {
    const doc = documentWithRect({ visible: false });
    const result = sliceDocumentWithKnife(doc, { start: [-20, 50], end: [120, 50] }, ['shape']);

    expect(result.slicedNodeIds).toEqual([]);
  });

  it('cuts geometry inside a group without touching the hierarchy', () => {
    let doc = createDocument('Knife group test', true);
    const group = { ...makeFrameNode('group-frame', { name: 'G', w: 200, h: 200, children: [] }) };
    doc = addNode(doc, group);
    doc = addChild(
      doc,
      group.id,
      makeShapeNode(
        'inner',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        { name: 'Inner', transform: [1, 0, 0, 1, 0, 0] },
      ),
    );

    // The container is the selection root; the cut must reach its leaf.
    const result = sliceDocumentWithKnife(doc, { start: [-20, 50], end: [120, 50] }, [group.id]);

    expect(result.slicedNodeIds).toEqual(['inner']);
    const parent = result.document.nodes[group.id];
    expect(parent?.kind).toBe('frame');
    if (parent?.kind !== 'frame') return;
    // Both pieces stay inside the container: the hierarchy is untouched.
    expect(parent.children).toHaveLength(2);
  });

  it('reports live text as unsupported rather than corrupting it', () => {
    let doc = createDocument('Knife text test', true);
    const text = makeTextNode('text', 'Hello', {
      name: 'Hello',
      transform: [1, 0, 0, 1, 0, 0],
      fontSize: 16,
      w: 100,
      h: 40,
    });
    doc = addNode(doc, text);

    // y = 10 is inside the measured single-line height, so the cut genuinely
    // reaches the text rather than passing under it.
    const result = sliceDocumentWithKnife(doc, { start: [-20, 10], end: [120, 10] }, ['text']);

    expect(result.slicedNodeIds).toEqual([]);
    expect(result.document).toBe(doc);
    expect(result.skipped).toEqual([{ nodeId: 'text', name: 'Hello', reason: 'text' }]);
  });

  it('does not report objects the cut never reached', () => {
    let doc = createDocument('Knife reach test', true);
    doc = addNode(
      doc,
      makeTextNode('far-text', 'Far away', {
        name: 'Far away',
        transform: [1, 0, 0, 1, 5000, 5000],
        fontSize: 16,
        w: 100,
        h: 40,
      }),
    );

    const result = sliceDocumentWithKnife(doc, { start: [-20, 20], end: [120, 20] });

    expect(result.skipped).toEqual([]);
  });

  it('leaves a compound path whole and says why', () => {
    let doc = createDocument('Knife holes test', true);
    doc = addNode(
      doc,
      makeShapeNode(
        'donut',
        {
          kind: 'path',
          closed: true,
          tolerance: 3,
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 100, handleIn: null, handleOut: null },
            { x: 0, y: 100, handleIn: null, handleOut: null },
          ],
          holes: [
            [
              { x: 30, y: 30, handleIn: null, handleOut: null },
              { x: 70, y: 30, handleIn: null, handleOut: null },
              { x: 70, y: 70, handleIn: null, handleOut: null },
              { x: 30, y: 70, handleIn: null, handleOut: null },
            ],
          ],
        },
        { name: 'Donut' },
      ),
    );

    const result = sliceDocumentWithKnife(doc, { start: [-20, 50], end: [120, 50] }, ['donut']);

    expect(result.slicedNodeIds).toEqual([]);
    expect(result.skipped).toEqual([{ nodeId: 'donut', name: 'Donut', reason: 'compound-path' }]);
  });

  it('splits an image without duplicating the asset, keeping it in place', () => {
    let doc = createDocument('Knife image test', true);
    const node = makeShapeNode(
      'photo',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Photo', transform: [1, 0, 0, 1, 0, 0] },
    );
    doc = addNode(doc, {
      ...node,
      fills: [imageFill('data:image/png;base64,AAAA', { imageWidth: 100, imageHeight: 100 })],
    });

    const result = sliceDocumentWithKnife(doc, { start: [-20, 50], end: [120, 50] }, ['photo']);

    expect(result.slicedNodeIds).toEqual(['photo']);
    const pieces = result.resultNodeIds.map((id) => result.document.nodes[id]);
    for (const piece of pieces) {
      expect(piece?.kind).toBe('shape');
      if (piece?.kind !== 'shape') continue;
      const fill = piece.fills?.[0];
      // Same asset reference on both pieces: no pixels were copied.
      expect(fill?.image?.src).toBe('data:image/png;base64,AAAA');
      // The placement is pinned explicitly so each piece keeps painting the
      // region of the picture it covered before the cut.
      expect(fill?.image?.fit).toBe('crop');
      expect(fill?.image?.scale).toBeCloseTo(1, 6);
    }

    // The top piece spans local y 0..50, so the source still starts at y = 0;
    // the bottom piece starts at y = 50, so the source is pulled up by 50.
    const offsets = pieces
      .map((piece) => (piece?.kind === 'shape' ? piece.fills?.[0]?.image?.y : undefined))
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(offsets[0]).toBeCloseTo(-50, 6);
    expect(offsets[1]).toBeCloseTo(0, 6);
  });

  it('leaves an image alone when its natural size is unknown', () => {
    let doc = createDocument('Knife image size test', true);
    const node = makeShapeNode(
      'photo',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Photo' },
    );
    doc = addNode(doc, { ...node, fills: [imageFill('data:image/png;base64,AAAA')] });

    const result = sliceDocumentWithKnife(doc, { start: [-20, 50], end: [120, 50] }, ['photo']);

    expect(result.slicedNodeIds).toEqual([]);
    expect(result.skipped).toEqual([
      { nodeId: 'photo', name: 'Photo', reason: 'unsupported-image-placement' },
    ]);
  });

  it('cuts every selected object with one cut', () => {
    let doc = createDocument('Knife multi test', true);
    doc = addNode(
      doc,
      makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 50, h: 100 }, { name: 'A' }),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'b',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 100 },
        { name: 'B', transform: [1, 0, 0, 1, 100, 0] },
      ),
    );

    const result = sliceDocumentWithKnife(doc, { start: [-20, 50], end: [200, 50] }, ['a', 'b']);

    expect(result.slicedNodeIds.sort()).toEqual(['a', 'b']);
    expect(result.resultNodeIds).toHaveLength(4);
  });
});

describe('sliceDocumentWithKnife — transforms', () => {
  it('cuts a rotated object along the world-space cut, not its local axes', () => {
    let doc = createDocument('Knife rotate test', true);
    // 45° rotation about the origin, then translated so the square sits in
    // positive space. cos45 = sin45 ≈ 0.7071.
    const c = Math.SQRT1_2;
    doc = addNode(
      doc,
      makeShapeNode(
        'rotated',
        { kind: 'rect', x: -50, y: -50, w: 100, h: 100 },
        { name: 'Rotated', transform: [c, c, -c, c, 200, 200] },
      ),
    );

    const result = sliceDocumentWithKnife(doc, { start: [100, 200], end: [300, 200] }, ['rotated']);

    expect(result.slicedNodeIds).toEqual(['rotated']);
    const pieces = result.resultNodeIds.map((id) => result.document.nodes[id]);
    for (const piece of pieces) {
      expect(piece?.kind).toBe('shape');
      // The transform is untouched; only the local geometry changed, so the
      // pieces land exactly where the source was.
      expect(piece?.transform).toEqual([c, c, -c, c, 200, 200]);
    }
  });

  it('cuts a non-uniformly scaled object correctly', () => {
    let doc = createDocument('Knife scale test', true);
    doc = addNode(
      doc,
      makeShapeNode(
        'scaled',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        { name: 'Scaled', transform: [3, 0, 0, 0.5, 0, 0] },
      ),
    );

    // In world space the object spans x 0..300, y 0..50.
    const result = sliceDocumentWithKnife(doc, { start: [150, -10], end: [150, 60] }, ['scaled']);

    expect(result.slicedNodeIds).toEqual(['scaled']);
    expect(result.resultNodeIds).toHaveLength(2);
  });

  it('cuts a flipped (negatively scaled) object', () => {
    let doc = createDocument('Knife flip test', true);
    doc = addNode(
      doc,
      makeShapeNode(
        'flipped',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        { name: 'Flipped', transform: [-1, 0, 0, 1, 100, 0] },
      ),
    );

    const result = sliceDocumentWithKnife(doc, { start: [-20, 50], end: [120, 50] }, ['flipped']);

    expect(result.slicedNodeIds).toEqual(['flipped']);
    expect(result.resultNodeIds).toHaveLength(2);
  });

  it('cuts through a nested transformed hierarchy', () => {
    let doc = createDocument('Knife nested test', true);
    const outer = makeFrameNode('outer', {
      name: 'Outer',
      transform: [2, 0, 0, 2, 50, 50],
      w: 200,
      h: 200,
      children: [],
    });
    doc = addNode(doc, outer);
    const inner = makeFrameNode('inner', {
      name: 'Inner',
      transform: [1, 0, 0, 1, 10, 10],
      w: 100,
      h: 100,
      children: [],
    });
    doc = addChild(doc, outer.id, inner);
    doc = addChild(
      doc,
      inner.id,
      makeShapeNode(
        'leaf',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { name: 'Leaf', transform: [1, 0, 0, 1, 0, 0] },
      ),
    );

    // Leaf world bounds: origin (50 + 2*10, 50 + 2*10) = (70, 70), size 100.
    const result = sliceDocumentWithKnife(doc, { start: [50, 120], end: [200, 120] }, ['leaf']);

    expect(result.slicedNodeIds).toEqual(['leaf']);
    const parent = result.document.nodes.inner;
    expect(parent?.kind).toBe('frame');
    if (parent?.kind !== 'frame') return;
    expect(parent.children).toHaveLength(2);
  });
});
