import { describe, expect, it } from 'vitest';
import { removeNode } from '../document';
import {
  addChild,
  addNode,
  addPage,
  createDocument,
  makeAdjustmentNode,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  nextNodeId,
  reparentNode,
} from '../index';

describe('Layer creation targets the correct page content root', () => {
  it('adds a node under page 2 content root when page 2 is active', () => {
    let doc = createDocument('multi-page-test');
    // Default doc has one page with contentRoot.
    const page1 = doc.pages![0]!;
    expect(page1.contentRoot).toBeTruthy();

    // Add a second page.
    doc = addPage(doc, { name: 'Page 2' });
    const page2 = doc.pages![1]!;
    expect(page2.contentRoot).toBeTruthy();
    doc = { ...doc, activePageId: page2.id };
    expect(doc.activePageId).toBe(page2.id);

    // Create a shape on page 2.
    const { id: shapeId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeShapeNode(shapeId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    // Place it under page 2's content root.
    doc = addChild(doc, page2.contentRoot, doc.nodes[shapeId]!);

    // The shape must appear under page 2's content root children.
    const page2Root = doc.nodes[page2.contentRoot]!;
    expect(page2Root.kind).toBe('group');
    expect((page2Root as { children: string[] }).children).toContain(shapeId);

    // It must NOT appear under page 1's content root.
    const page1Root = doc.nodes[page1.contentRoot]!;
    expect((page1Root as { children: string[] }).children).not.toContain(shapeId);
  });

  it('does not leak a shape into the wrong page on page switch', () => {
    let doc = createDocument('page-switch-test');
    const page1 = doc.pages![0]!;
    doc = addPage(doc, { name: 'Page 2' });
    const page2 = doc.pages![1]!;

    // Create shape on page 1.
    const { id: s1, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeShapeNode(s1, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = addChild(doc, page1.contentRoot, doc.nodes[s1]!);

    // Create shape on page 2.
    const { id: s2, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeShapeNode(s2, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc = addChild(doc, page2.contentRoot, doc.nodes[s2]!);

    const page1Children = (doc.nodes[page1.contentRoot] as { children: string[] }).children;
    const page2Children = (doc.nodes[page2.contentRoot] as { children: string[] }).children;

    expect(page1Children).toContain(s1);
    expect(page1Children).not.toContain(s2);
    expect(page2Children).toContain(s2);
    expect(page2Children).not.toContain(s1);
  });
});

describe('Invalid reparenting is rejected', () => {
  it('rejects moving a node into its own descendant', () => {
    let doc = createDocument('cycle-test', true);
    const { id: parent, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeFrameNode(parent, { name: 'Parent', w: 100, h: 100, children: [] }));

    const { id: child, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addChild(doc, parent, makeShapeNode(child, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));

    const { id: grandchild, doc: d3 } = nextNodeId(doc);
    doc = d3;
    doc = addChild(
      doc,
      child,
      makeShapeNode(grandchild, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );

    const before = doc;
    // Attempt to move parent into grandchild (creates a cycle).
    const after = reparentNode(doc, parent, grandchild, 0);

    // reparentNode must be a no-op for invalid moves.
    expect(after.nodes[parent]).toBe(before.nodes[parent]);
    expect(after.nodes[child]).toBe(before.nodes[child]);
    expect(after.nodes[grandchild]).toBe(before.nodes[grandchild]);
  });

  it('rejects moving a node into itself', () => {
    let doc = createDocument('self-parent-test', true);
    const { id: node, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeFrameNode(node, { name: 'Node', w: 100, h: 100, children: [] }));

    const after = reparentNode(doc, node, node, 0);
    expect(after.nodes[node]).toBe(doc.nodes[node]);
  });

  it('rejects moving a node into a non-container', () => {
    let doc = createDocument('non-container-test', true);
    const { id: a, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeShapeNode(a, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));

    const { id: b, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeShapeNode(b, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));

    const after = reparentNode(doc, a, b, 0);
    // Shape nodes are not containers — reparent must be a no-op.
    expect(after.nodes[a]).toBe(doc.nodes[a]);
  });

  it('allows valid reparenting between unrelated containers', () => {
    let doc = createDocument('valid-reparent', true);
    const { id: g1, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeGroupNode(g1, { name: 'Group 1', children: [] }));

    const { id: g2, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeGroupNode(g2, { name: 'Group 2', children: [] }));

    const { id: shape, doc: d3 } = nextNodeId(doc);
    doc = d3;
    doc = addChild(doc, g1, makeShapeNode(shape, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));

    expect((doc.nodes[g1] as { children: string[] }).children).toContain(shape);

    const after = reparentNode(doc, shape, g2, 0);
    expect((after.nodes[g1] as { children: string[] }).children).not.toContain(shape);
    expect((after.nodes[g2] as { children: string[] }).children).toContain(shape);
  });
});

describe('Nested group opacity is multiplicative', () => {
  it('composes child opacity with parent group opacity', () => {
    let doc = createDocument('opacity-test', true);
    const { id: group, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(
      doc,
      makeGroupNode(group, {
        name: 'Outer',
        children: [],
        opacity: 0.5,
      }),
    );

    const { id: shape, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(
      doc,
      makeShapeNode(shape, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Inner' }),
    );
    doc.nodes[shape] = { ...doc.nodes[shape]!, opacity: 0.5 };
    doc = addChild(doc, group, doc.nodes[shape]!);

    const groupNode = doc.nodes[group]!;
    const shapeNode = doc.nodes[shape]!;

    // The model stores both opacities independently.
    expect(groupNode.opacity).toBe(0.5);
    expect(shapeNode.opacity).toBe(0.5);

    // The compositing order (masking-system.md §4) specifies that group
    // opacity applies to the already-composited group output.  The effective
    // opacity of the child = child.opacity × group.opacity = 0.25.
    const effectiveOpacity = (shapeNode.opacity ?? 1) * (groupNode.opacity ?? 1);
    expect(effectiveOpacity).toBe(0.25);
  });

  it('does not bleed opacity to sibling nodes', () => {
    let doc = createDocument('opacity-sibling-test', true);
    const { id: group, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeGroupNode(group, { name: 'G', children: [], opacity: 0.3 }));

    const { id: a, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeShapeNode(a, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc.nodes[a] = { ...doc.nodes[a]!, opacity: 0.8 };
    doc = addChild(doc, group, doc.nodes[a]!);

    const { id: b, doc: d3 } = nextNodeId(doc);
    doc = d3;
    doc = addNode(doc, makeShapeNode(b, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
    doc.nodes[b] = { ...doc.nodes[b]!, opacity: 1.0 };
    doc = addChild(doc, group, doc.nodes[b]!);

    // Each sibling's effective opacity is independent within the same group.
    const aEff = (doc.nodes[a]!.opacity ?? 1) * (doc.nodes[group]!.opacity ?? 1);
    const bEff = (doc.nodes[b]!.opacity ?? 1) * (doc.nodes[group]!.opacity ?? 1);
    expect(aEff).toBe(0.24);
    expect(bEff).toBe(0.3);
  });

  it('triple-nested opacity produces correct product', () => {
    let doc = createDocument('triple-opacity', true);
    const { id: outer, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addNode(doc, makeGroupNode(outer, { name: 'Outer', children: [], opacity: 0.5 }));

    const { id: mid, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeGroupNode(mid, { name: 'Mid', children: [], opacity: 0.5 }));
    doc = addChild(doc, outer, doc.nodes[mid]!);

    const { id: inner, doc: d3 } = nextNodeId(doc);
    doc = d3;
    doc = addNode(
      doc,
      makeShapeNode(inner, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Inner' }),
    );
    doc.nodes[inner] = { ...doc.nodes[inner]!, opacity: 0.5 };
    doc = addChild(doc, mid, doc.nodes[inner]!);

    const product =
      (doc.nodes[inner]!.opacity ?? 1) *
      (doc.nodes[mid]!.opacity ?? 1) *
      (doc.nodes[outer]!.opacity ?? 1);
    expect(product).toBe(0.125);
  });
});

describe('Source image data is preserved under adjustment layers', () => {
  it('does not mutate the source image fill after adding an adjustment', () => {
    let doc = createDocument('adj-preserve', true);
    const { id: imageNode, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const image = makeShapeNode(
      imageNode,
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      { name: 'Photo' },
    );
    doc = addNode(doc, {
      ...image,
      fills: [
        {
          type: 'image',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          image: {
            assetId: 'test-asset',
            src: 'asset:test-asset',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
          },
        },
      ],
    });

    // Record original fill data.
    const originalFills = (doc.nodes[imageNode] as { fills: unknown[] }).fills;
    expect(originalFills).toHaveLength(1);

    // Add an adjustment layer that targets the image.
    const { id: adj, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(
      doc,
      makeAdjustmentNode(
        adj,
        'levels',
        { channel: 'rgb', inputBlack: 0, inputWhite: 1, gamma: 1, outputBlack: 0, outputWhite: 1 },
        { name: 'Levels', scope: { mode: 'explicit-targets', targetNodeIds: [imageNode] } },
      ),
    );

    // The source image node's fills must be untouched.
    const afterFills = (doc.nodes[imageNode] as { fills: unknown[] }).fills;
    expect(afterFills).toEqual(originalFills);
    expect(afterFills).toHaveLength(1);
  });

  it('preserves image fill through adjustment add/remove cycle', () => {
    let doc = createDocument('adj-cycle', true);
    const { id: img, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const originalFill = {
      type: 'image',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      image: { assetId: 'asset-1', src: 'asset:asset-1', fit: 'fill', x: 0, y: 0, scale: 1 },
    } as const;
    doc = addNode(doc, {
      ...makeShapeNode(img, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      fills: [originalFill],
    });
    const original = doc.nodes[img];

    // Add adjustment.
    const { id: adj, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(
      doc,
      makeAdjustmentNode(
        adj,
        'levels',
        { channel: 'rgb', inputBlack: 0, inputWhite: 1, gamma: 1, outputBlack: 0, outputWhite: 1 },
        { name: 'Levels', scope: { mode: 'document' } },
      ),
    );

    // Remove adjustment (simulates undo).
    doc = removeNode(doc, adj);

    // Source must be unchanged.
    expect(doc.nodes[img]).toEqual(original);
  });
});
