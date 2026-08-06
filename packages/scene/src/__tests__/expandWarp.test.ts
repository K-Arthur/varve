/**
 * Expand Appearance (warp bake) tests.
 */

import { makeWarpPreset, type WarpModifier } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { addNode, createDocument } from '../document';
import { bakeNodeWarp, bakeWarpsInDocument } from '../expandWarp';
import type { ShapeNode, TextNode } from '../types';
import { addWarp } from '../warpOps';

function rectNode(id: string): ShapeNode {
  return {
    id,
    name: id,
    kind: 'shape',
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: '1',
  };
}

function textNode(id: string, text = 'Hello'): TextNode {
  return {
    id,
    name: id,
    kind: 'text',
    text,
    fontSize: 40,
    fontFamily: 'sans-serif',
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: '1',
  };
}

describe('bakeNodeWarp', () => {
  it('bakes a warped shape into an exact path and clears the stack', () => {
    const doc = createDocument();
    const withWarp = addWarp(addNode(doc, rectNode('n1')), 'n1', makeWarpPreset('arch'));
    const result = bakeNodeWarp(withWarp.nodes.n1!, withWarp);
    expect(result.kind).toBe('baked');
    if (result.kind !== 'baked') return;
    const baked = result.node as ShapeNode;
    expect(baked.shape.kind).toBe('path');
    expect((baked.shape as { points: unknown[] }).points.length).toBeGreaterThan(3);
    expect('warps' in baked).toBe(false);
    // fills/strokes/transform survive the bake
    expect(baked.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(baked.strokes).toEqual([]);
  });

  it('is a no-op without live warps', () => {
    const doc = createDocument();
    const node = addNode(doc, rectNode('n1'));
    const result = bakeNodeWarp(node.nodes.n1!, node);
    expect(result.kind).toBe('noop');
  });

  it('bakes text by keeping the text and persisting cluster adjustments', () => {
    const doc = createDocument();
    const withWarp = addWarp(addNode(doc, textNode('t1')), 't1', makeWarpPreset('arch'));
    const result = bakeNodeWarp(withWarp.nodes.t1!, withWarp);
    expect(result.kind).toBe('baked');
    if (result.kind !== 'baked') return;
    const baked = result.node as TextNode;
    expect(baked.kind).toBe('text');
    expect(baked.text).toBe('Hello');
    expect(Object.keys(baked.glyphAdjustments ?? {}).length).toBeGreaterThan(0);
    expect('warps' in baked).toBe(false);
  });

  it('reports unsupported for warped groups', () => {
    const doc = createDocument();
    const node = rectNode('n1');
    const group = {
      id: 'g1',
      name: 'g',
      kind: 'group' as const,
      transform: [1, 0, 0, 1, 0, 0] as const,
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
      strokes: [] as never[],
      effects: [] as never[],
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      order: '1',
      children: ['n1'],
    };
    let d = addNode(doc, node);
    d = addNode(d, group as never);
    const withWarp = addWarp(d, 'g1', makeWarpPreset('arch') as WarpModifier);
    const result = bakeNodeWarp(withWarp.nodes.g1!, withWarp);
    expect(result.kind).toBe('unsupported');
  });

  it('bakeWarpsInDocument bakes only the requested ids', () => {
    const doc = createDocument();
    let d = addWarp(addNode(doc, rectNode('n1')), 'n1', makeWarpPreset('arch'));
    d = addNode(d, rectNode('n2'));
    const { document, baked, skipped } = bakeWarpsInDocument(d, ['n1', 'n2']);
    expect(baked).toEqual(['n1']);
    expect(skipped).toEqual([]);
    expect((document.nodes.n1! as ShapeNode).shape.kind).toBe('path');
    expect((document.nodes.n2! as ShapeNode).shape.kind).toBe('rect');
  });
});
