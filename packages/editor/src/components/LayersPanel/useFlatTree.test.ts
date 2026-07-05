import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { flattenTree } from './useFlatTree';
import { DEFAULT_FILTER, type LayerFilterSpec } from './layerFilterTypes';

describe('flattenTree (virtualization stress)', () => {
  it('flattens 5000 nodes quickly', () => {
    let doc = createDocument();
    for (let i = 0; i < 5000; i++) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const node = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: `Node ${i}` },
      );
      doc = addNode(doc, node);
    }

    const expanded = new Set<string>();
    const start = performance.now();
    const flat = flattenTree(doc, expanded);
    const elapsed = performance.now() - start;

    expect(flat.length).toBe(5001);
    expect(elapsed).toBeLessThan(200);
    // First entry (topmost, last created): Node 4999
    expect(flat[0]?.node.name).toBe('Node 4999');
    expect(flat[0]?.depth).toBe(0);
    // Last entry (bottommost, first created): contentRoot from createDocument
    const last = flat[flat.length - 1];
    expect(last?.depth).toBe(0);
  });

  it('hides nested children when expanded set is empty', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(fId, { name: 'Frame', w: 100, h: 100 });
    doc = addNode(doc, frame);
    const { id: cId, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const child = makeShapeNode(cId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Child' });
    doc = addChild(doc, fId, child);

    const empty = new Set<string>();
    const flatCollapsed = flattenTree(doc, empty);
    expect(flatCollapsed.length).toBe(2);
    expect(flatCollapsed[0]?.node.name).toBe('Frame');

    const full = new Set<string>([fId]);
    const flatExpanded = flattenTree(doc, full);
    expect(flatExpanded.length).toBe(3);
    expect(flatExpanded[0]?.node.name).toBe('Frame');
    expect(flatExpanded[1]?.node.name).toBe('Child');
  });

  it('returns all root-level nodes regardless of expanded set', () => {
    let doc = createDocument();
    for (let i = 0; i < 3; i++) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const node = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: `Node ${i}` },
      );
      doc = addNode(doc, node);
    }
    const flat = flattenTree(doc, new Set<string>());
    expect(flat.length).toBe(4);
  });

  it('flattens 1000 nodes with depth', () => {
    let doc = createDocument();
    for (let i = 0; i < 500; i++) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const node = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: `Node ${i}` },
      );
      doc = addNode(doc, node);
    }
    const expanded = new Set<string>();
    const flat = flattenTree(doc, expanded);
    expect(flat.length).toBe(501);
    expect(flat.every((e) => e.depth === 0)).toBe(true);
  });
});

describe('flattenTree with filter spec', () => {
  function makeDoc() {
    let doc = createDocument();
    // Create a shape
    let { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const shape = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Rect 1' });
    doc = addNode(doc, shape);

    // Create a text node (force locked due to makeTextNode ignoring opts.locked)
    let { id: id2, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const tNode = { ...makeTextNode(id2, 'Hello', { name: 'Text 1' }), locked: true };
    doc = addNode(doc, tNode);

    return { doc, shapeId: id, textId: id2 };
  }

  it('filters by kind (text only)', () => {
    const { doc } = makeDoc();
    const expanded = new Set<string>();
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, kinds: ['text'] };
    const flat = flattenTree(doc, expanded, filter);
    expect(flat.length).toBe(1);
    expect(flat[0]?.node.name).toBe('Text 1');
  });

  it('filters by kind (shape only)', () => {
    const { doc } = makeDoc();
    const expanded = new Set<string>();
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, kinds: ['shape'] };
    const flat = flattenTree(doc, expanded, filter);
    expect(flat.length).toBe(1);
    expect(flat[0]?.node.name).toBe('Rect 1');
  });

  it('filters by locked state', () => {
    const { doc } = makeDoc();
    const expanded = new Set<string>();
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, attributes: { locked: true } };
    const flat = flattenTree(doc, expanded, filter);
    expect(flat.length).toBe(1);
    expect(flat[0]?.node.name).toBe('Text 1');
  });

  it('filters by blend mode', () => {
    let doc = createDocument();
    let { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const normal = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Normal', blendMode: 'normal' },
    );
    doc = addNode(doc, normal);

    let { id: id2, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const mult = makeShapeNode(
      id2,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Multiply', blendMode: 'multiply' },
    );
    doc = addNode(doc, mult);

    const expanded = new Set<string>();
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, blendModes: ['multiply'] };
    const flat = flattenTree(doc, expanded, filter);
    expect(flat.length).toBe(1);
    expect(flat[0]?.node.name).toBe('Multiply');
  });

  it('combined filter (search + kind + attribute)', () => {
    let doc = createDocument();
    let { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Target Shape', locked: true },
    );
    doc = addNode(doc, node);

    let { id: id2, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const other = makeShapeNode(
      id2,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Other', locked: false },
    );
    doc = addNode(doc, other);

    const expanded = new Set<string>();
    const filter: LayerFilterSpec = {
      search: 'Target',
      kinds: ['shape'],
      attributes: { locked: true },
      blendModes: [],
    };
    const flat = flattenTree(doc, expanded, filter);
    expect(flat.length).toBe(1);
    expect(flat[0]?.node.name).toBe('Target Shape');
  });

  it('filter with no matches returns empty', () => {
    const { doc } = makeDoc();
    const expanded = new Set<string>();
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, search: 'nonexistent' };
    const flat = flattenTree(doc, expanded, filter);
    expect(flat.length).toBe(0);
  });

  it('ancestors of matching children still visible', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(fId, { name: 'Parent Frame', w: 200, h: 200, children: [] });
    doc = addNode(doc, frame);

    const { id: cId, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const child = makeShapeNode(
      cId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Special Child' },
    );
    doc = addChild(doc, fId, child);

    const expanded = new Set<string>([fId]);
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, search: 'Special' };
    const flat = flattenTree(doc, expanded, filter);
    // contentRoot (non-matching, no matching children) is filtered out; frame (non-matching parent with matching child) shown + child
    expect(flat.length).toBe(2);
    expect(flat[0]?.node.name).toBe('Parent Frame');
    expect(flat[1]?.node.name).toBe('Special Child');
  });
});
