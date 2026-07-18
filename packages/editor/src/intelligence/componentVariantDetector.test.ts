import type { Document, Fill, FrameNode, ShapeNode, TextNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { detectVariantCandidates } from './componentVariantDetector';

function makeShapeNode(
  id: string,
  name: string,
  shapeKind: string,
  w: number,
  h: number,
  fill?: Fill,
): ShapeNode {
  const baseFill: Fill = fill ?? {
    type: 'solid',
    color: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
  return {
    id,
    name,
    kind: 'shape',
    shape: { kind: shapeKind, x: 0, y: 0, w, h } as any,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
    fills: [baseFill],
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
  };
}

function makeTextNode(id: string, name: string, text: string, fontSize: number): TextNode {
  return {
    id,
    name,
    kind: 'text',
    text,
    transform: [1, 0, 0, 1, 0, 0],
    fontSize,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
  };
}

function makeFrameNode(
  id: string,
  name: string,
  w: number,
  h: number,
  children: string[],
): FrameNode {
  return {
    id,
    name,
    kind: 'frame',
    transform: [1, 0, 0, 1, 0, 0],
    w,
    h,
    children,
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
  };
}

describe('detectVariantCandidates', () => {
  it('detects variant candidates from fill-differing rects', () => {
    const doc: Document = {
      id: 'doc',
      name: 'test',
      formatVersion: '2.0',
      rootChildren: ['a', 'b', 'c'],
      nodes: {
        a: makeShapeNode('a', 'Button 1', 'rect', 100, 40, {
          type: 'solid',
          color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        }),
        b: makeShapeNode('b', 'Button 2', 'rect', 100, 40, {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 60, b: 60, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        }),
        c: makeShapeNode('c', 'Button 3', 'rect', 100, 40, {
          type: 'solid',
          color: { space: 'rgb', r: 60, g: 120, b: 255, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        }),
      },
      components: {},
      nextId: 4,
    };

    const result = detectVariantCandidates(doc);
    expect(result).toHaveLength(1);
    expect(result[0].nodeIds).toEqual(['a', 'b', 'c']);
    expect(result[0].differingProperties).toHaveLength(1);
    expect(result[0].differingProperties[0].property).toBe('fill');
    expect(result[0].differingProperties[0].values).toHaveLength(3);
    expect(result[0].suggestedVariantName).toBe('state');
    expect(result[0].score).toBeGreaterThan(50);
  });

  it('detects size variants in text nodes', () => {
    const doc: Document = {
      id: 'doc',
      name: 'test',
      formatVersion: '2.0',
      rootChildren: ['a', 'b'],
      nodes: {
        a: makeTextNode('a', 'Heading 1', 'Hello', 24),
        b: makeTextNode('b', 'Heading 2', 'Hello', 32),
      },
      components: {},
      nextId: 3,
    };

    const result = detectVariantCandidates(doc);
    expect(result).toHaveLength(1);
    expect(result[0].differingProperties[0].property).toBe('fontSize');
    expect(result[0].suggestedVariantName).toBe('size');
  });

  it('detects text content variants via differing fill values', () => {
    const doc: Document = {
      id: 'doc',
      name: 'test',
      formatVersion: '2.0',
      rootChildren: ['a', 'b'],
      nodes: {
        a: makeShapeNode('a', 'Label 1', 'rect', 200, 48, {
          type: 'solid',
          color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        }),
        b: makeShapeNode('b', 'Label 2', 'rect', 200, 48, {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 60, b: 60, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        }),
      },
      components: {},
      nextId: 3,
    };

    const result = detectVariantCandidates(doc);
    expect(result).toHaveLength(1);
    expect(result[0].differingProperties[0].property).toBe('fill');
  });

  it('returns empty for empty document', () => {
    const doc: Document = {
      id: 'doc',
      name: 'empty',
      formatVersion: '2.0',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };
    expect(detectVariantCandidates(doc)).toEqual([]);
  });

  it('returns empty for single node', () => {
    const doc: Document = {
      id: 'doc',
      name: 'single',
      formatVersion: '2.0',
      rootChildren: ['a'],
      nodes: {
        a: makeShapeNode('a', 'Solo', 'rect', 100, 100),
      },
      components: {},
      nextId: 2,
    };
    expect(detectVariantCandidates(doc)).toEqual([]);
  });

  it('ignores structurally different nodes', () => {
    const doc: Document = {
      id: 'doc',
      name: 'mixed',
      formatVersion: '2.0',
      rootChildren: ['a', 'b', 'c'],
      nodes: {
        a: makeShapeNode('a', 'Rect 1', 'rect', 100, 100),
        b: makeTextNode('b', 'Text 1', 'Hi', 16),
        c: makeFrameNode('c', 'Frame 1', 300, 200, []),
      },
      components: {},
      nextId: 4,
    };
    const result = detectVariantCandidates(doc);
    // No two nodes share the same structural signature → no candidates
    expect(result).toEqual([]);
  });

  it('detects variants in frames with same children but differing size', () => {
    const inner: ShapeNode = {
      id: 'inner',
      name: 'Inner',
      kind: 'shape',
      shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 } as any,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 100, g: 100, b: 100, a: 255 },
      strokes: [],
      effects: [],
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      order: 'b0',
    };

    const doc: Document = {
      id: 'doc',
      name: 'frames',
      formatVersion: '2.0',
      rootChildren: ['f1', 'f2'],
      nodes: {
        inner,
        f1: makeFrameNode('f1', 'Card 1', 200, 300, ['inner']),
        f2: makeFrameNode('f2', 'Card 2', 200, 150, ['inner']),
      },
      components: {},
      nextId: 3,
    };
    const result = detectVariantCandidates(doc);
    expect(result).toHaveLength(1);
    expect(result[0].nodeIds).toContain('f1');
    expect(result[0].nodeIds).toContain('f2');
    expect(result[0].differingProperties[0].property).toBe('height');
  });

  it('returns deterministic results', () => {
    const doc: Document = {
      id: 'doc',
      name: 'deterministic',
      formatVersion: '2.0',
      rootChildren: ['a', 'b', 'c'],
      nodes: {
        a: makeShapeNode('a', 'A', 'rect', 50, 50),
        b: makeShapeNode('b', 'B', 'rect', 50, 50),
        c: makeShapeNode('c', 'C', 'rect', 100, 50),
      },
      components: {},
      nextId: 4,
    };

    const r1 = detectVariantCandidates(doc);
    const r2 = detectVariantCandidates(doc);
    expect(r1).toEqual(r2);
  });
});
