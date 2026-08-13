import type { Affine } from '@varve/engine';
import type { Document, FrameNode, SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { reflowLayoutChildren } from './reflow';

function makeFrame(over: Partial<FrameNode> = {}): FrameNode {
  return {
    kind: 'frame',
    id: 'f1',
    name: 'Frame',
    transform: [1, 0, 0, 1, 0, 0] as Affine,
    w: 400,
    h: 300,
    children: [],
    layoutStyle: {
      mode: 'flex',
      direction: 'row',
      wrap: false,
      gap: 0,
      padding: [0, 0, 0, 0] as [number, number, number, number],
      align: 'start',
      justify: 'start',
    },
    ...over,
  };
}

function makeChild(id: string, x: number, y: number, w: number, h: number): SceneNode {
  return {
    kind: 'shape',
    id,
    name: id,
    transform: [1, 0, 0, 1, x, y] as Affine,
    shape: { kind: 'rect', x: 0, y: 0, w, h },
    fills: [],
  } as SceneNode;
}

function makeDoc(frame: FrameNode, children: SceneNode[]): Document {
  const nodes: Record<string, SceneNode> = { [frame.id]: frame as SceneNode };
  for (const c of children) nodes[c.id] = c;
  return {
    id: 'doc1',
    version: '2.20',
    nodes,
    rootChildren: [frame.id],
    pages: [],
    guides: [],
  } as unknown as Document;
}

function childTransform(doc: Document, id: string): number[] {
  return doc.nodes[id]?.transform ?? [];
}

describe('reflowLayoutChildren', () => {
  it('repositions flex children when the frame is resized', () => {
    const frame = makeFrame({ w: 200, h: 300 });
    const a = makeChild('a', 10, 10, 50, 50);
    const b = makeChild('b', 60, 10, 50, 50);
    frame.children = ['a', 'b'];
    const doc = makeDoc(frame, [a, b]);

    // 2×50px children + 0 gap in a 200px row: a at 0, b at 50 (layout owns
    // positions — x/y fields on the child shape are ignored).
    const reflowed = reflowLayoutChildren(doc, 'f1');
    expect(childTransform(reflowed, 'a')[4]).toBeCloseTo(0);
    expect(childTransform(reflowed, 'b')[4]).toBeCloseTo(50);
  });

  it('grows fill children to use the resized frame', () => {
    const frame = makeFrame({ w: 400, h: 300 });
    const a = makeChild('a', 0, 0, 100, 50);
    a.layoutSizing = 'fill';
    frame.children = ['a'];
    const doc = makeDoc(frame, [a]);

    // One fill child in a 400px frame → full width.
    const reflowed = reflowLayoutChildren(doc, 'f1');
    const child = reflowed.nodes['a'];
    expect(childTransform(reflowed, 'a')[4]).toBeCloseTo(0);
    if (child?.kind === 'shape' && child.shape.kind === 'rect') {
      expect(child.shape.w).toBeCloseTo(400);
    }
  });

  it('keeps fixed (hug) children at their natural size', () => {
    const frame = makeFrame({ w: 400, h: 300 });
    const a = makeChild('a', 0, 0, 100, 50);
    frame.children = ['a'];
    const doc = makeDoc(frame, [a]);

    const reflowed = reflowLayoutChildren(doc, 'f1');
    const child = reflowed.nodes['a'];
    if (child?.kind === 'shape' && child.shape.kind === 'rect') {
      expect(child.shape.w).toBeCloseTo(100);
    }
  });

  it('is a no-op for frames without layout style', () => {
    const frame = makeFrame({ layoutStyle: undefined });
    const a = makeChild('a', 10, 10, 50, 50);
    frame.children = ['a'];
    const doc = makeDoc(frame, [a]);

    const reflowed = reflowLayoutChildren(doc, 'f1');
    expect(childTransform(reflowed, 'a')[4]).toBeCloseTo(10);
  });

  it('respects padding when repositioning children', () => {
    const frame = makeFrame({
      w: 400,
      h: 300,
      layoutStyle: {
        mode: 'flex',
        direction: 'row',
        wrap: false,
        gap: 0,
        padding: [10, 20, 0, 20] as [number, number, number, number],
        align: 'start',
        justify: 'start',
      },
    });
    const a = makeChild('a', 0, 0, 50, 50);
    frame.children = ['a'];
    const doc = makeDoc(frame, [a]);

    const reflowed = reflowLayoutChildren(doc, 'f1');
    // padding top=10, left=20 → first child starts at (20, 10).
    expect(childTransform(reflowed, 'a')[4]).toBeCloseTo(20);
    expect(childTransform(reflowed, 'a')[5]).toBeCloseTo(10);
  });

  it('reflows a resized grid frame', () => {
    const frame = makeFrame({
      w: 400,
      h: 300,
      layoutStyle: {
        mode: 'grid',
        direction: 'row',
        wrap: false,
        gap: 0,
        padding: [0, 0, 0, 0] as [number, number, number, number],
        align: 'start',
        justify: 'start',
        gridTemplateColumns: '1fr 1fr',
      },
    });
    const a = makeChild('a', 5, 5, 50, 50);
    const b = makeChild('b', 60, 5, 50, 50);
    frame.children = ['a', 'b'];
    const doc = makeDoc(frame, [a, b]);

    const reflowed = reflowLayoutChildren(doc, 'f1');
    // Two 1fr tracks in a 400px frame: a in cell 0, b in cell 1.
    expect(childTransform(reflowed, 'a')[4]).toBeCloseTo(0);
    expect(childTransform(reflowed, 'a')[5]).toBeCloseTo(0);
    expect(childTransform(reflowed, 'b')[4]).toBeCloseTo(200);
    expect(childTransform(reflowed, 'b')[5]).toBeCloseTo(0);
  });
});
