import type { Document } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { findContainingFrameInDoc } from '../../context';

function makeDoc(overrides?: Partial<Document>): Document {
  return {
    id: 'doc1',
    name: 'Test',
    formatVersion: '1.6',
    activePageId: 'p1',
    pages: [
      { id: 'p1', name: 'Page 1', width: 10000, height: 10000, backgrounds: [], contentRoot: 'r1' },
    ],
    pageOrder: ['p1'],
    rootChildren: [],
    nodes: {
      p1: {
        id: 'p1',
        kind: 'page',
        name: 'Page 1',
        index: 0,
        order: 'a0',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        transform: [1, 0, 0, 1, 0, 0],
        fill: [0, 0, 0, 0],
        strokes: [],
        effects: [],
        contentRoot: 'r1',
      },
      r1: {
        id: 'r1',
        kind: 'frame',
        name: 'Root',
        index: 0,
        order: 'a0',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        transform: [1, 0, 0, 1, 0, 0],
        fill: [0, 0, 0, 0],
        strokes: [],
        effects: [],
        w: 10000,
        h: 10000,
        children: [],
      },
    },
    variables: { collections: [], activeCollection: null },
    ...overrides,
  };
}

function addNode(
  doc: Document,
  id: string,
  overrides: Partial<import('@strata/scene').SceneNode> & {
    kind: 'frame' | 'group' | 'shape';
    w?: number;
    h?: number;
    children?: string[];
  },
): Document {
  const defaultChildren = overrides.kind === 'frame' || overrides.kind === 'group' ? [] : undefined;
  const defaultNode: Record<string, unknown> = {
    id,
    name: id,
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: [0, 0, 0, 0],
    strokes: [],
    effects: [],
    children: defaultChildren,
  };
  const node = { ...defaultNode, ...overrides };
  const nodes = { ...doc.nodes, [id]: node };
  const rootChildren = doc.rootChildren.includes('r1')
    ? doc.rootChildren
    : ['r1', ...doc.rootChildren];
  const r1 = nodes['r1'];
  if (r1 && r1.kind === 'frame') {
    nodes['r1'] = { ...r1, children: [...(r1.children ?? []), id] };
  }
  return { ...doc, nodes, rootChildren };
}

describe('findContainingFrameInDoc', () => {
  it('returns null when no user frames exist at point', () => {
    const doc = makeDoc();
    // activePageNodes returns contentRoot (r1) children; r1 itself is excluded.
    // With no user frames, walkNodes visits nothing and the function returns null.
    const result = findContainingFrameInDoc(doc, { x: 5000, y: 5000 });
    expect(result).toBeNull();
  });

  it('finds frame containing a point inside it', () => {
    let doc = makeDoc();
    doc = addNode(doc, 'f1', { kind: 'frame', w: 200, h: 160, transform: [1, 0, 0, 1, 100, 100] });
    // Point at center of f1 (200, 180)
    const result = findContainingFrameInDoc(doc, { x: 200, y: 180 });
    expect(result).toBe('f1');
  });

  it('returns null for point outside any user frame', () => {
    let doc = makeDoc();
    doc = addNode(doc, 'f1', { kind: 'frame', w: 200, h: 160, transform: [1, 0, 0, 1, 100, 100] });
    // Point (500, 500) is outside f1 (100-300 x, 100-260 y) and no other frame
    const result = findContainingFrameInDoc(doc, { x: 500, y: 500 });
    expect(result).toBeNull();
  });

  it('finds innermost frame for nested frames', () => {
    let doc = makeDoc();
    // Outer frame at (0,0) 400x300
    // Inner frame at (50,50) 200x150
    doc = addNode(doc, 'outer', { kind: 'frame', w: 400, h: 300, transform: [1, 0, 0, 1, 0, 0] });
    // Move inner to be a child of outer, not root
    const innerNode = {
      id: 'inner',
      name: 'inner',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      transform: [1, 0, 0, 1, 50, 50] as [number, number, number, number, number, number],
      fill: [0, 0, 0, 0] as [number, number, number, number],
      strokes: [],
      effects: [],
      kind: 'frame' as const,
      w: 200,
      h: 150,
      children: [],
    };
    // Restructure: outer has inner as child
    const outerNode = doc.nodes['outer'];
    if (outerNode) {
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          outer: { ...outerNode, children: ['inner'] },
          inner: innerNode,
        },
        rootChildren: ['r1', 'outer'],
      };
    }
    // Point at center of inner (150, 125 in world = center of inner frame at 50+100, 50+75)
    const result = findContainingFrameInDoc(doc, { x: 150, y: 125 });
    expect(result).toBe('inner');
  });

  it('handles rotated frame containment', () => {
    let doc = makeDoc();
    // Frame at (100, 100) 200x160, rotated 45 degrees.
    // The transform is already a 45-degree rotation + translation.
    // Using transform directly (no separate rotation field) for a single rotation.
    const cos45 = Math.SQRT1_2;
    const sin45 = Math.SQRT1_2;
    doc = addNode(doc, 'rot', {
      kind: 'frame',
      w: 200,
      h: 160,
      rotation: 0,
      transform: [cos45, sin45, -sin45, cos45, 100, 100],
    });
    // The local center (100, 80) transformed:
    //   x = 100*cos45 - 80*sin45 + 100 ≈ 114.14
    //   y = 100*sin45 + 80*cos45 + 100 ≈ 227.28
    const resultCenter = findContainingFrameInDoc(doc, { x: 114, y: 227 });
    expect(resultCenter).toBe('rot');
  });

  it('skips locked frames', () => {
    let doc = makeDoc();
    doc = addNode(doc, 'f1', {
      kind: 'frame',
      w: 200,
      h: 160,
      transform: [1, 0, 0, 1, 0, 0],
      locked: true,
    });
    // f1 is locked so it must be skipped. No other user frame at point.
    const result = findContainingFrameInDoc(doc, { x: 100, y: 80 });
    expect(result).toBeNull();
  });

  it('skips hidden frames', () => {
    let doc = makeDoc();
    doc = addNode(doc, 'f1', {
      kind: 'frame',
      w: 200,
      h: 160,
      transform: [1, 0, 0, 1, 0, 0],
      visible: false,
    });
    const result = findContainingFrameInDoc(doc, { x: 100, y: 80 });
    expect(result).toBeNull();
  });

  it('returns deepest matching frame', () => {
    let doc = makeDoc();
    doc = addNode(doc, 'f1', { kind: 'frame', w: 400, h: 300, transform: [1, 0, 0, 1, 0, 0] });
    const f1 = doc.nodes['f1'] as import('@strata/scene').FrameNode;
    if (f1) {
      doc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          f1: { ...f1, children: ['f2'] },
          f2: {
            id: 'f2',
            name: 'f2',
            index: 0,
            order: 'a0',
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal' as const,
            rotation: 0,
            transform: [1, 0, 0, 1, 50, 50] as [number, number, number, number, number, number],
            fill: [0, 0, 0, 0] as [number, number, number, number],
            strokes: [],
            effects: [],
            kind: 'frame' as const,
            w: 200,
            h: 150,
            children: [],
          },
        },
      };
    }
    // Point inside both frames should return innermost (f2)
    const result = findContainingFrameInDoc(doc, { x: 150, y: 125 });
    expect(result).toBe('f2');
  });
});
