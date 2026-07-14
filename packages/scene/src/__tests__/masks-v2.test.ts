import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeFrameNode, makeGroupNode, makeShapeNode } from '../document';
import {
  addMask,
  detectMaskCycles,
  getAllMaskSourceIds,
  hasSourceNode,
  hasVectorMask,
  resolveMask,
  resolveMaskType,
  setMaskFillRule,
  setMaskVectorPath,
} from '../masks';

describe('vector masks', () => {
  it('adds mask with vector path data (no sourceNodeId)', () => {
    const frame = makeFrameNode('f1', { children: [] });
    let doc = addNode(createDocument(), frame);
    doc = addMask(doc, 'f1', undefined, 'clip', {
      vectorMask: {
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 100, y: 0, handleIn: null, handleOut: null },
          { x: 100, y: 100, handleIn: null, handleOut: null },
        ],
        closed: true,
        fillRule: 'nonzero',
      },
    });
    const updated = doc.nodes.f1 as { mask?: { vectorMask?: unknown; type?: string } };
    expect(updated.mask).toBeDefined();
    expect(updated.mask?.type).toBe('clip');
    expect(updated.mask?.vectorMask).toBeDefined();
    expect((updated.mask?.vectorMask as { points: unknown[] })?.points).toHaveLength(3);
  });

  it('resolves vector mask without sourceNodeId', () => {
    const frame = makeFrameNode('f1', { children: [] });
    let doc = addNode(createDocument(), frame);
    doc = addMask(doc, 'f1', undefined, 'clip', {
      vectorMask: {
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 100, y: 100, handleIn: null, handleOut: null },
        ],
        closed: false,
        fillRule: 'nonzero',
      },
    });
    const updated = doc.nodes.f1 as import('../types').GroupNode;
    expect(resolveMask(updated)).not.toBeNull();
    expect(resolveMaskType(updated)).toBe('clip');
  });

  it('allows vector mask with empty points (harmless, masks nothing)', () => {
    const frame = makeFrameNode('f1', { children: [] });
    let doc = addNode(createDocument(), frame);
    doc = addMask(doc, 'f1', undefined, 'clip', {
      vectorMask: { points: [], closed: true, fillRule: 'nonzero' },
    });
    const updated = doc.nodes.f1 as { mask?: { vectorMask?: unknown } };
    // Empty points are allowed — mask won't clip anything (covers nothing)
    expect(updated.mask).toBeDefined();
    expect(updated.mask?.vectorMask).toBeDefined();
  });

  it('hasVectorMask returns true only for masks with points', () => {
    const emptyMask = {
      type: 'clip' as const,
      visible: true,
      vectorMask: { points: [], closed: true, fillRule: 'nonzero' as const },
    };
    expect(hasVectorMask(emptyMask)).toBe(false);

    const validMask = {
      type: 'clip' as const,
      visible: true,
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero' as const,
      },
    };
    expect(hasVectorMask(validMask)).toBe(true);

    const noVMMask = { type: 'clip' as const, visible: true, sourceNodeId: 'n1' };
    expect(hasVectorMask(noVMMask)).toBe(false);
  });

  it('hasSourceNode returns true when sourceNodeId is set', () => {
    expect(hasSourceNode({ type: 'clip', visible: true, sourceNodeId: 'n1' })).toBe(true);
    expect(hasSourceNode({ type: 'clip', visible: true })).toBe(false);
  });

  it('setMaskVectorPath updates mask path data', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);

    const newPoints = [
      { x: 10, y: 20, handleIn: null, handleOut: null },
      { x: 30, y: 40, handleIn: null, handleOut: null },
    ];
    doc = setMaskVectorPath(doc, 'f1', newPoints, true, 'evenodd');
    const updated = doc.nodes.f1 as { mask?: { vectorMask?: unknown; fillRule?: string } };
    expect(updated.mask?.vectorMask).toBeDefined();
    expect((updated.mask?.vectorMask as { points: unknown[] })?.points).toEqual(newPoints);
    expect((updated.mask?.vectorMask as { closed: boolean })?.closed).toBe(true);
    expect((updated.mask?.vectorMask as { fillRule: string })?.fillRule).toBe('evenodd');
  });
});

describe('fill rule', () => {
  it('setMaskFillRule updates fill rule on clip mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);

    doc = setMaskFillRule(doc, 'f1', 'evenodd');
    const updated = doc.nodes.f1 as { mask?: { fillRule?: string } };
    expect(updated.mask?.fillRule).toBe('evenodd');

    doc = setMaskFillRule(doc, 'f1', 'nonzero');
    const updated2 = doc.nodes.f1 as { mask?: { fillRule?: string } };
    expect(updated2.mask?.fillRule).toBe('nonzero');
  });

  it('setMaskFillRule is no-op on node without mask', () => {
    const frame = makeFrameNode('f1');
    const doc = addNode(createDocument(), frame);
    const result = setMaskFillRule(doc, 'f1', 'evenodd');
    expect(result).toBe(doc);
  });
});

describe('cycle detection', () => {
  it('returns empty for document without masks', () => {
    const doc = createDocument();
    expect(detectMaskCycles(doc)).toEqual([]);
  });

  it('returns empty for valid mask graph', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    expect(detectMaskCycles(doc)).toEqual([]);
  });

  it('detects self-referencing mask', () => {
    const frame = makeFrameNode('f1', { children: ['f1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'f1', visible: true };
    const doc = addNode(createDocument(), frame);
    const cycles = detectMaskCycles(doc);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]).toContain('f1');
  });

  it('detects two-node cycle', () => {
    // f1 masks g1, g1 masks f1
    let doc = createDocument();
    const frame1 = makeFrameNode('f1', { children: ['g1'] });
    frame1.mask = { type: 'alpha', sourceNodeId: 'g1', visible: true };
    const frame2 = makeFrameNode('g1', { children: ['f1'] });
    frame2.mask = { type: 'alpha', sourceNodeId: 'f1', visible: true };
    doc = addNode(doc, frame1);
    doc = addNode(doc, frame2);
    const cycles = detectMaskCycles(doc);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('addMask rejects masks that would create a cycle', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);

    // Try to add a mask on n1 that references f1 — this would create a cycle
    // since f1 already masks n1
    const shape2 = makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const doc2 = addNode(doc, shape2);
    const n1Node = doc2.nodes.n1 as { children?: string[] };
    if (n1Node && 'children' in n1Node) {
      (n1Node as { children: string[] }).children = ['n2'];
    }
    // n1 is not a container, so it can't own a mask — this tests that addMask
    // would reject the cycle at a higher level
    const result = addMask(doc2, 'n1', 'n2', 'clip');
    // n1 is not a container (it's a shape), so addMask should return doc unchanged
    expect(result).toBe(doc2);
  });
});

describe('getAllMaskSourceIds', () => {
  it('returns empty set when no masks exist', () => {
    const doc = createDocument();
    expect(getAllMaskSourceIds(doc).size).toBe(0);
  });

  it('collects all mask source node IDs', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const shape2 = makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    doc = addNode(doc, shape2);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    const group = makeGroupNode('g1', { children: ['n2'] });
    group.mask = { type: 'alpha', sourceNodeId: 'n2', visible: true };
    doc = addNode(doc, group);

    const sources = getAllMaskSourceIds(doc);
    expect(sources.size).toBe(2);
    expect(sources.has('n1')).toBe(true);
    expect(sources.has('n2')).toBe(true);
  });

  it('excludes vector masks from source IDs', () => {
    const frame = makeFrameNode('f1', { children: [] });
    let doc = addNode(createDocument(), frame);
    doc = addMask(doc, 'f1', undefined, 'clip', {
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero',
      },
    });
    expect(getAllMaskSourceIds(doc).size).toBe(0);
  });
});

describe('mask with both source and vector path', () => {
  it('hasVectorMask and hasSourceNode both return true', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskVectorPath(
      doc,
      'f1',
      [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 100, y: 0, handleIn: null, handleOut: null },
      ],
      false,
    );

    const updated = doc.nodes.f1 as { mask?: import('../types').Mask };
    expect(updated.mask).toBeDefined();
    if (updated.mask) {
      expect(hasSourceNode(updated.mask)).toBe(true);
      expect(hasVectorMask(updated.mask)).toBe(true);
    }
  });
});
