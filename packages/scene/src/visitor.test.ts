import { describe, expect, it } from 'vitest';
import {
  makeAdjustmentNode,
  makeFrameNode,
  makeGroupNode,
  makeImageShapeNode,
  makeShapeNode,
  makeTextNode,
} from './document';
import type { SceneNode } from './types';
import { isKind, mapNode, visitNode, visitNodePartial } from './visitor';

describe('visitNode', () => {
  const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  const text = makeTextNode('t1', 'Hello');
  const group = makeGroupNode('g1');
  const frame = makeFrameNode('f1');
  const image = makeImageShapeNode('i1', { src: 'https://example.com/img.png', w: 50, h: 50 });
  const adj = makeAdjustmentNode('a1', 'curves', {
    channel: 'rgb',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  });

  it.each([
    { kind: 'shape', node: shape, expected: 'shape' },
    { kind: 'text', node: text, expected: 'text' },
    { kind: 'group', node: group, expected: 'group' },
    { kind: 'frame', node: frame, expected: 'frame' },
    { kind: 'adjustment', node: adj, expected: 'adjustment' },
  ] as const)('dispatches $kind to the correct handler', ({ node, expected }) => {
    const result: string = visitNode(node, {
      shape: () => 'shape',
      text: () => 'text',
      group: () => 'group',
      frame: () => 'frame',
      adjustment: () => 'adjustment',
      path: () => 'path',
      rasterLayer: () => 'rasterLayer',
    });
    expect(result).toBe(expected);
  });

  it('returns the handler result for each node kind', () => {
    const node = shape;
    const result = visitNode(node, {
      shape: (n) => n.id,
      text: () => 'nope',
      group: () => 'nope',
      frame: () => 'nope',
      adjustment: () => 'nope',
      path: () => 'nope',
      rasterLayer: () => 'nope',
    });
    expect(result).toBe('s1');
  });

  it('dispatches a shape node with image fill to the shape handler', () => {
    const result = visitNode(image, {
      shape: () => 'shape',
      text: () => 'nope',
      group: () => 'nope',
      frame: () => 'nope',
      adjustment: () => 'nope',
      path: () => 'nope',
      rasterLayer: () => 'nope',
    });
    expect(result).toBe('shape');
  });

  it('throws on unknown kind (exhaustive check)', () => {
    const bad = { kind: 'bogus', id: 'x' } as unknown as SceneNode;
    expect(() =>
      visitNode(bad, {
        shape: () => '',
        text: () => '',
        group: () => '',
        frame: () => '',
        adjustment: () => '',
        path: () => '',
        rasterLayer: () => '',
      }),
    ).toThrow('Unhandled node kind');
  });
});

describe('visitNodePartial', () => {
  const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  const text = makeTextNode('t1', 'Hello');
  const fallback = (n: SceneNode) => `fallback:${n.kind}`;

  it('calls handler when one is provided for the kind', () => {
    const result = visitNodePartial(shape, { shape: (n) => `shape:${n.id}` }, fallback);
    expect(result).toBe('shape:s1');
  });

  it('falls back when no handler matches', () => {
    const result = visitNodePartial(text, { shape: () => 'nope' }, fallback);
    expect(result).toBe('fallback:text');
  });

  it('works with empty visitor', () => {
    const result = visitNodePartial(shape, {}, fallback);
    expect(result).toBe('fallback:shape');
  });
});

describe('isKind', () => {
  const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });

  it('returns true when kind matches', () => {
    expect(isKind(shape, 'shape')).toBe(true);
  });

  it('returns false when kind does not match', () => {
    expect(isKind(shape, 'text')).toBe(false);
    expect(isKind(shape, 'frame')).toBe(false);
  });

  it('narrows the type', () => {
    const nodes: SceneNode[] = [shape, makeTextNode('t1', 'Hello')];
    const shapes = nodes.filter((n) => isKind(n, 'shape'));
    expect(shapes).toHaveLength(1);
    if (shapes.length > 0) {
      expect(shapes[0]?.kind).toBe('shape');
    }
  });
});

describe('mapNode', () => {
  const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  const text = makeTextNode('t1', 'Hello');
  const group = makeGroupNode('g1');

  it('transforms matching node kinds', () => {
    const updated = mapNode(shape, {
      shape: (n) => ({ ...n, name: 'Mapped' }),
    });
    expect(updated.kind).toBe('shape');
    expect((updated as any).name).toBe('Mapped');
  });

  it('returns unmodified node when no handler matches', () => {
    const result = mapNode(text, {
      shape: (n) => ({ ...n, name: 'Mapped' }),
    });
    expect(result).toBe(text);
  });

  it('identity when mapper is empty', () => {
    const result = mapNode(group, {});
    expect(result).toBe(group);
  });
});
