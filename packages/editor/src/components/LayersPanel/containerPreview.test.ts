import { createDocument, type Document, type SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  collectContainerPreview,
  containerHasContent,
  containerPreviewSignature,
  MAX_CONTAINER_PREVIEW_NODES,
} from './containerPreview';

function rect(
  id: string,
  transform: [number, number, number, number, number, number],
  w = 100,
  h = 50,
): SceneNode {
  return {
    id,
    name: id,
    kind: 'shape',
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    index: 0,
    order: 'a0',
    rotation: 0,
    transform,
    fill: { space: 'rgb', r: 200, g: 30, b: 30, a: 255 },
    shape: { kind: 'rect', x: 0, y: 0, w, h },
  } as unknown as SceneNode;
}

function frame(id: string, children: string[]): SceneNode {
  return {
    id,
    name: id,
    kind: 'frame',
    visible: true,
    locked: false,
    blendMode: 'normal',
    opacity: 1,
    bindings: {},
    index: 0,
    order: 'a0',
    rotation: 0,
    w: 400,
    h: 300,
    children,
  } as unknown as SceneNode;
}

/** Plain-object view of a node for spread-based test overrides. */
function asRecord(node: SceneNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function group(id: string, children: string[]): SceneNode {
  return { ...asRecord(frame(id, children)), kind: 'group' } as unknown as SceneNode;
}

function docOf(nodes: Record<string, SceneNode>, rootChildren: string[]): Document {
  return { ...createDocument('container-preview-test'), rootChildren, nodes } as Document;
}

describe('collectContainerPreview', () => {
  it('collects leaf bounds into a normalized, aspect-preserving unit box', () => {
    const nodes = {
      f1: frame('f1', ['r1', 'r2']),
      r1: rect('r1', [1, 0, 0, 1, 0, 0]),
      r2: rect('r2', [1, 0, 0, 1, 100, 0]),
    };
    const preview = collectContainerPreview(docOf(nodes, ['f1']), 'f1');
    expect(preview).not.toBeNull();
    expect(preview!.truncated).toBe(false);
    expect(preview!.primitives).toHaveLength(2);
    // Union is 200x50; the larger side fills the unit box, the smaller
    // centers: r1 at (0, 0.375) size 0.5x0.25, r2 shifted by 0.5.
    const [a, b] = preview!.primitives;
    expect(a!.x).toBeCloseTo(0, 5);
    expect(a!.y).toBeCloseTo(0.375, 5);
    expect(a!.w).toBeCloseTo(0.5, 5);
    expect(a!.h).toBeCloseTo(0.25, 5);
    expect(b!.x).toBeCloseTo(0.5, 5);
  });

  it('descends into nested containers in paint order', () => {
    const nodes = {
      f1: frame('f1', ['g1']),
      g1: group('g1', ['r1']),
      r1: rect('r1', [1, 0, 0, 1, 10, 10]),
    };
    const preview = collectContainerPreview(docOf(nodes, ['f1']), 'f1');
    expect(preview!.primitives).toHaveLength(1);
  });

  it('skips hidden nodes and whole hidden subtrees', () => {
    const nodes = {
      f1: frame('f1', ['r1', 'g1', 'r2']),
      r1: rect('r1', [1, 0, 0, 1, 0, 0]),
      g1: { ...asRecord(group('g1', ['r3'])), visible: false } as unknown as SceneNode,
      r2: {
        ...asRecord(rect('r2', [1, 0, 0, 1, 200, 0])),
        visible: false,
      } as unknown as SceneNode,
      r3: rect('r3', [1, 0, 0, 1, 100, 0]),
    };
    const preview = collectContainerPreview(docOf(nodes, ['f1']), 'f1');
    expect(preview!.primitives).toHaveLength(1);
  });

  it('caps collection at the node budget and reports truncation', () => {
    const children = ['r1', 'r2', 'r3'];
    const nodes: Record<string, SceneNode> = { f1: frame('f1', children) };
    for (let i = 0; i < children.length; i += 1) {
      const id = children[i]!;
      nodes[id] = rect(id, [1, 0, 0, 1, i * 100, 0]);
    }
    const preview = collectContainerPreview(docOf(nodes, ['f1']), 'f1', { maxNodes: 2 });
    expect(preview!.primitives).toHaveLength(2);
    expect(preview!.truncated).toBe(true);
    expect(MAX_CONTAINER_PREVIEW_NODES).toBeGreaterThan(2);
  });

  it('uses the transformed AABB for rotated children', () => {
    const nodes = {
      f1: frame('f1', ['r1']),
      // 90° rotation [0,1,-1,0,0,0]: a 100x20 rect becomes 20x100.
      r1: rect('r1', [0, 1, -1, 0, 0, 0], 100, 20),
    };
    const preview = collectContainerPreview(docOf(nodes, ['f1']), 'f1');
    const p = preview!.primitives[0]!;
    // The union is the rotated AABB (20x100): the taller side fills the unit
    // box, so w=0.2 and h=1 — the aspect is swapped, not the original 5:1.
    expect(p.w).toBeCloseTo(0.2, 5);
    expect(p.h).toBeCloseTo(1, 5);
  });

  it('falls back to the supplied ink when a node has no solid fill', () => {
    const bare = {
      ...asRecord(rect('r1', [1, 0, 0, 1, 0, 0])),
      fill: undefined,
    } as unknown as SceneNode;
    const nodes = { f1: frame('f1', ['r1']), r1: bare };
    const preview = collectContainerPreview(docOf(nodes, ['f1']), 'f1', {
      fallbackFill: 'rgba(1, 2, 3, 0.5)',
    });
    expect(preview!.primitives[0]!.fill).toBe('rgba(1, 2, 3, 0.5)');
  });

  it('returns null for empty containers and non-containers', () => {
    const nodes = { f1: frame('f1', []), r1: rect('r1', [1, 0, 0, 1, 0, 0]) };
    const doc = docOf(nodes, ['f1', 'r1']);
    expect(collectContainerPreview(doc, 'f1')).toBeNull();
    expect(collectContainerPreview(doc, 'r1')).toBeNull();
  });
});

describe('containerHasContent', () => {
  it('is true when a drawable leaf exists anywhere in the subtree', () => {
    const nodes = {
      f1: frame('f1', ['g1']),
      g1: group('g1', ['r1']),
      r1: rect('r1', [1, 0, 0, 1, 0, 0]),
    };
    expect(containerHasContent(docOf(nodes, ['f1']), nodes.f1!)).toBe(true);
  });

  it('is false when every descendant is hidden or empty', () => {
    const nodes = {
      f1: frame('f1', ['g1', 'r1']),
      g1: group('g1', []),
      r1: {
        ...asRecord(rect('r1', [1, 0, 0, 1, 0, 0])),
        visible: false,
      } as unknown as SceneNode,
    };
    expect(containerHasContent(docOf(nodes, ['f1']), nodes.f1!)).toBe(false);
  });
});

describe('containerPreviewSignature', () => {
  it('is stable for identical layouts and changes with content', () => {
    const nodes = { f1: frame('f1', ['r1']), r1: rect('r1', [1, 0, 0, 1, 0, 0]) };
    const first = collectContainerPreview(docOf(nodes, ['f1']), 'f1')!;
    const second = collectContainerPreview(docOf(nodes, ['f1']), 'f1')!;
    expect(containerPreviewSignature(first)).toBe(containerPreviewSignature(second));

    // Moving one of two children changes their relative layout; a single
    // primitive normalizes to the same box wherever it sits (correct — the
    // absolute position inside the container is not part of the preview).
    const moved = {
      f1: frame('f1', ['r1', 'r2']),
      r1: rect('r1', [1, 0, 0, 1, 0, 0]),
      r2: rect('r2', [1, 0, 0, 1, 20, 0]),
    };
    const third = collectContainerPreview(docOf(moved, ['f1']), 'f1')!;
    expect(containerPreviewSignature(third)).not.toBe(containerPreviewSignature(first));
  });
});
