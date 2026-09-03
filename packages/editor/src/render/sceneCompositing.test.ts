import {
  addChild,
  addNode,
  createDocument,
  imageFill,
  makeAdjustment,
  makeAdjustmentNode,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeSmartFilter,
  patternFill,
  solidFill,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  sceneCanUseWorkerRenderer,
  sceneHasImageFills,
  sceneNeedsStructuralCompositing,
} from './sceneCompositing';

describe('sceneNeedsStructuralCompositing', () => {
  it('returns false for flat shapes only', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, { name: 'Rect' }),
    );
    expect(sceneNeedsStructuralCompositing(doc)).toBe(false);
  });

  it('returns true when a visible mask is present', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      makeFrameNode('f1', {
        name: 'Frame',
        w: 200,
        h: 160,
      }),
    );
    doc.nodes.f1 = {
      ...(doc.nodes.f1 as import('@varve/scene').FrameNode),
      mask: { type: 'clip', sourceNodeId: 'm1', visible: true },
    };
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('routes a masked visual leaf through structural compositing', () => {
    let doc = createDocument('leaf mask');
    doc = addNode(doc, {
      ...makeShapeNode('leaf', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }),
      mask: {
        type: 'alpha',
        visible: true,
        vectorMask: {
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 80, handleIn: null, handleOut: null },
          ],
          closed: true,
          fillRule: 'nonzero',
        },
      },
    });

    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('returns true for isolated groups with children', () => {
    let doc = createDocument('test');
    doc = addNode(doc, makeGroupNode('g1', { name: 'Group', children: ['r1'], isolated: true }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { name: 'Rect', transform: [1, 0, 0, 1, 10, 10] },
      ),
    );
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('routes groups with visible effects through structural surface compositing', () => {
    let doc = createDocument('group effects');
    const group = {
      ...makeGroupNode('g1'),
      effects: [{ type: 'layerBlur' as const, radius: 6, visible: true }],
    };
    doc = addNode(doc, group);
    doc = addChild(
      doc,
      group.id,
      makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
    );

    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('routes live effect mattes through structural replay', () => {
    let doc = createDocument('effect matte');
    const source = makeShapeNode('source', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 });
    const target = {
      ...makeShapeNode('target', { kind: 'rect', x: 0, y: 0, w: 80, h: 80 }),
      effects: [
        {
          id: 'fx-target-1',
          type: 'layerBlur' as const,
          radius: 6,
          visible: true,
          mask: {
            source: { kind: 'scene-node' as const, nodeId: source.id },
            type: 'alpha' as const,
            coordinateSpace: 'world' as const,
          },
        },
      ],
    };
    doc = addNode(doc, source);
    doc = addNode(doc, target);

    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('returns true for frames with children and default clipContent', () => {
    let doc = createDocument('test');
    doc = addNode(doc, makeFrameNode('f1', { name: 'Frame', w: 200, h: 160, children: ['r1'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { name: 'Rect', transform: [1, 0, 0, 1, 10, 10] },
      ),
    );
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('routes an active adjustment layer through structural backdrop compositing', () => {
    let doc = createDocument('adjustment');
    doc = addNode(doc, {
      ...makeAdjustmentNode(
        'a1',
        'levels',
        {
          channel: 'rgb',
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 255,
        },
        { opacity: 1 },
      ),
      adjustments: [makeAdjustment('brightness-1', 'brightness', { value: 20 })],
    });

    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('routes container Object Filters through structural compositing', () => {
    let doc = createDocument('Object Filter group');
    const group = makeGroupNode('group');
    doc = addNode(doc, group);
    doc = addChild(doc, group.id, {
      ...makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
      smartFilters: [makeSmartFilter('invert', 'invert')],
    });
    expect(sceneNeedsStructuralCompositing(doc)).toBe(false);

    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        group: { ...doc.nodes.group!, smartFilters: [makeSmartFilter('group-invert', 'invert')] },
      },
    };
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('does not route a bypassed container Object Filter through compositing', () => {
    let doc = createDocument('Disabled Object Filter group');
    const group = makeGroupNode('group');
    doc = addNode(doc, group);
    doc = addChild(
      doc,
      group.id,
      makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
    );
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        group: {
          ...doc.nodes.group!,
          smartFilters: [makeSmartFilter('group-invert-disabled', 'invert')],
          smartFiltersEnabled: false,
        },
      },
    };
    expect(sceneNeedsStructuralCompositing(doc)).toBe(false);
  });
});

describe('sceneHasImageFills', () => {
  // The render worker cannot decode images (no `Image` in a Worker, separate
  // ImageCache), so image scenes must be detected and kept on the main thread.
  // `fills` is not a `makeShapeNode` opt, so we assign it the way the importer
  // does: directly on the node (see importImageAsFile).
  function shapeWithFills(id: string, fills: unknown[]) {
    const node = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 120, h: 120 }, { name: id });
    return { ...node, fills } as typeof node;
  }

  it('returns false when no node has an image fill', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      shapeWithFills('r1', [solidFill({ space: 'rgb', r: 1, g: 2, b: 3, a: 255 })]),
    );
    expect(sceneHasImageFills(doc)).toBe(false);
  });

  it('returns true when a shape carries an image fill', () => {
    let doc = createDocument('test');
    doc = addNode(doc, shapeWithFills('img1', [imageFill('data:image/png;base64,AAAA')]));
    expect(sceneHasImageFills(doc)).toBe(true);
  });

  it('ignores hidden image fills', () => {
    let doc = createDocument('test');
    const hidden = { ...imageFill('data:image/png;base64,AAAA'), visible: false };
    doc = addNode(doc, shapeWithFills('img1', [hidden]));
    expect(sceneHasImageFills(doc)).toBe(false);
  });
});

describe('sceneCanUseWorkerRenderer', () => {
  function shapeWithFills(id: string, fills: unknown[]) {
    const node = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 120, h: 120 }, { name: id });
    return { ...node, fills } as typeof node;
  }

  it('allows worker for scenes without image fills', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      shapeWithFills('r1', [solidFill({ space: 'rgb', r: 1, g: 2, b: 3, a: 255 })]),
    );
    expect(sceneCanUseWorkerRenderer(doc, () => true)).toBe(true);
  });

  it('blocks worker until image src is loaded', () => {
    let doc = createDocument('test');
    doc = addNode(doc, shapeWithFills('img1', [imageFill('test.png')]));
    expect(sceneCanUseWorkerRenderer(doc, () => false)).toBe(false);
    expect(sceneCanUseWorkerRenderer(doc, () => true)).toBe(true);
  });

  it('rejects a visible pattern fill because worker pattern resources are not transferred', () => {
    let doc = createDocument('test');
    doc = addNode(doc, shapeWithFills('pattern1', [patternFill('tile.png')]));

    expect(sceneCanUseWorkerRenderer(doc, () => true)).toBe(false);
  });

  it('allows a hidden pattern fill', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      shapeWithFills('pattern1', [{ ...patternFill('tile.png'), visible: false }]),
    );

    expect(sceneCanUseWorkerRenderer(doc, () => true)).toBe(true);
  });

  it('rejects a background-removal alpha mask that worker replay cannot composite', () => {
    let doc = createDocument('test');
    const node = shapeWithFills('img1', [imageFill('image.png')]);
    doc = addNode(doc, {
      ...node,
      backgroundRemoval: {
        maskDataUrl: 'data:image/png;base64,MASK',
        method: 'quick',
        confidence: 1,
        appliedAt: 1,
      },
    });

    expect(sceneCanUseWorkerRenderer(doc, () => true)).toBe(false);
  });
});
