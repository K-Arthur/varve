import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import type { GroupNode, ShapeNode } from '../types';
import {
  computeFlattenBounds,
  effectPadding,
  findCommonAncestor,
  nodeEffectPadding,
} from './bounds';

function makeShape(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { effects?: ShapeNode['effects'] } = {},
): ShapeNode {
  return {
    id,
    kind: 'shape',
    name: `Shape ${id}`,
    layerColor: null,
    fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, x, y],
    fills: [],
    strokes: [],
    effects: opts.effects ?? [],
    shape: { kind: 'rect', x: 0, y: 0, w, h },
  };
}

function makeGroup(id: string, children: string[]): GroupNode {
  return {
    id,
    kind: 'group',
    name: `Group ${id}`,
    layerColor: null,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    children,
    effects: [],
  };
}

function makeDoc(nodes: ShapeNode[], group?: GroupNode): Document {
  const nodeMap: Document['nodes'] = {};
  for (const n of nodes) {
    nodeMap[n.id] = n;
  }
  if (group) {
    nodeMap[group.id] = group;
  }
  return {
    id: 'test-doc',
    name: 'Test',
    formatVersion: '2.6',
    nodes: nodeMap,
    rootChildren: group ? [group.id] : nodes.map((n) => n.id),
    nextId: 100,
    components: {},
  };
}

describe('effectPadding', () => {
  it('computes drop shadow padding with offset', () => {
    const padding = effectPadding({
      type: 'dropShadow',
      x: 5,
      y: 3,
      blur: 10,
      spread: 2,
    });
    // Kernel = blur*3 + spread/2 = 30 + 1 = 31 per side, plus directional offset.
    expect(padding.left).toBe(31);
    expect(padding.right).toBe(36);
    expect(padding.top).toBe(31);
    expect(padding.bottom).toBe(34);
  });

  it('computes drop shadow padding without spread', () => {
    const padding = effectPadding({ type: 'dropShadow', x: 0, y: 0, blur: 10, spread: 0 });
    expect(padding).toEqual({ left: 30, top: 30, right: 30, bottom: 30 });
  });

  it('computes glow padding symmetrically', () => {
    const padding = effectPadding({
      type: 'outerGlow',
      blur: 20,
      spread: 5,
    });
    // Kernel = 20*3 + 2.5 = 62.5
    expect(padding.left).toBe(62.5);
    expect(padding.top).toBe(62.5);
    expect(padding.right).toBe(62.5);
    expect(padding.bottom).toBe(62.5);
  });

  it('computes layer blur padding from radius', () => {
    const padding = effectPadding({
      type: 'layerBlur',
      radius: 15,
    });
    expect(padding.left).toBe(45);
    expect(padding.right).toBe(45);
  });

  it('inset effects never expand bounds', () => {
    const shadow = effectPadding({
      type: 'innerShadow',
      x: 10,
      y: 10,
      blur: 50,
      spread: 20,
    });
    const glow = effectPadding({ type: 'innerGlow', blur: 50, spread: 20 });
    expect(shadow).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(glow).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it('returns zero for unknown effect types with no expansion fields', () => {
    const padding = effectPadding({ type: 'unknown' });
    expect(padding).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe('nodeEffectPadding', () => {
  it('returns zero padding for nodes without effects', () => {
    const padding = nodeEffectPadding({ effects: [] });
    expect(padding).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it('uses max padding across multiple visible effects', () => {
    const padding = nodeEffectPadding({
      effects: [
        { type: 'dropShadow', x: 0, y: 0, blur: 10, spread: 0, visible: true } as any,
        { type: 'outerGlow', blur: 20, spread: 0, visible: true } as any,
      ],
    });
    // outerGlow blur 20 → kernel 60; dropShadow blur 10 → 30.
    expect(padding.left).toBe(60);
  });

  it('ignores invisible effects', () => {
    const padding = nodeEffectPadding({
      effects: [
        { type: 'dropShadow', x: 0, y: 0, blur: 50, spread: 0, visible: false } as any,
        { type: 'layerBlur', radius: 5, visible: true } as any,
      ],
    });
    expect(padding.left).toBe(15);
  });
});

describe('computeFlattenBounds', () => {
  it('computes world bounds for a single node', () => {
    const shape = makeShape('s1', 10, 20, 100, 50);
    const doc = makeDoc([shape]);
    const bounds = computeFlattenBounds(doc, ['s1']);
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(10);
    expect(bounds!.y).toBe(20);
    expect(bounds!.w).toBe(100);
    expect(bounds!.h).toBe(50);
  });

  it('computes union bounds for multiple nodes', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const s2 = makeShape('s2', 100, 100, 50, 50);
    const doc = makeDoc([s1, s2]);
    const bounds = computeFlattenBounds(doc, ['s1', 's2']);
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(0);
    expect(bounds!.y).toBe(0);
    expect(bounds!.w).toBe(150);
    expect(bounds!.h).toBe(150);
  });

  it('includes effect overflow when enabled', () => {
    const shape = makeShape('s1', 0, 0, 50, 50, {
      effects: [
        {
          type: 'dropShadow',
          x: 0,
          y: 0,
          blur: 20,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 0.5,
          blendMode: 'multiply',
          visible: true,
        },
      ],
    });
    const doc = makeDoc([shape]);
    const bounds = computeFlattenBounds(doc, ['s1'], true);
    expect(bounds).not.toBeNull();
    // blur 20 → kernel 60 (blur*3), x/y 0 → no directional offset.
    expect(bounds!.x).toBe(-60);
    expect(bounds!.y).toBe(-60);
    expect(bounds!.w).toBe(170);
    expect(bounds!.h).toBe(170);
  });

  it('excludes effect overflow when disabled', () => {
    const shape = makeShape('s1', 0, 0, 50, 50, {
      effects: [
        {
          type: 'dropShadow',
          x: 0,
          y: 0,
          blur: 20,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 0.5,
          blendMode: 'multiply',
          visible: true,
        },
      ],
    });
    const doc = makeDoc([shape]);
    const bounds = computeFlattenBounds(doc, ['s1'], false);
    expect(bounds).not.toBeNull();
    expect(bounds!.w).toBe(50);
    expect(bounds!.h).toBe(50);
  });

  it('returns null for empty node set', () => {
    const doc = makeDoc([]);
    const bounds = computeFlattenBounds(doc, []);
    expect(bounds).toBeNull();
  });

  it('skips invisible nodes', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const s2 = { ...makeShape('s2', 200, 200, 50, 50), visible: false };
    const doc = makeDoc([s1, s2]);
    const bounds = computeFlattenBounds(doc, ['s1', 's2']);
    expect(bounds).not.toBeNull();
    expect(bounds!.w).toBe(50);
    expect(bounds!.h).toBe(50);
  });
});

describe('findCommonAncestor', () => {
  it('returns null for single root-level node', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const doc = makeDoc([s1]);
    const ancestor = findCommonAncestor(doc, ['s1']);
    expect(ancestor).toBeNull();
  });

  it('returns null for root-level nodes', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const s2 = makeShape('s2', 100, 100, 50, 50);
    const doc = makeDoc([s1, s2]);
    const ancestor = findCommonAncestor(doc, ['s1', 's2']);
    expect(ancestor).toBeNull();
  });

  it('returns the group for nodes in the same group', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const s2 = makeShape('s2', 10, 10, 50, 50);
    const group = makeGroup('g1', ['s1', 's2']);
    const doc = makeDoc([s1, s2], group);
    const ancestor = findCommonAncestor(doc, ['s1', 's2']);
    expect(ancestor).toBe('g1');
  });

  it('returns the deeper common ancestor for nested groups', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const s2 = makeShape('s2', 10, 10, 50, 50);
    const innerGroup = makeGroup('g2', ['s1', 's2']);
    const outerGroup = makeGroup('g1', ['g2']);
    const nodeMap: Document['nodes'] = { s1, s2, g2: innerGroup, g1: outerGroup };
    const doc: Document = {
      id: 'test-doc',
      name: 'Test',
      formatVersion: '2.6',
      nodes: nodeMap,
      rootChildren: ['g1'],
      nextId: 100,
      components: {},
    };
    const ancestor = findCommonAncestor(doc, ['s1', 's2']);
    expect(ancestor).toBe('g2');
  });
});
