/**
 * V2.15→V2.16 warp migration + warp-aware bounds tests.
 */

import { makeWarpPreset, type WarpModifier } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { nodeWorldBounds } from '../coordinateService';
import { addNode, createDocument } from '../document';
import { nodeLocalBounds, nodeLocalBoundsSource } from '../nodeBounds';
import type { ShapeNode } from '../types';
import { migrateV215ToV216 } from '../warpMigration';
import { addWarp } from '../warpOps';

function rectNode(id: string, x: number, y: number, w: number, h: number): ShapeNode {
  return {
    id,
    name: id,
    kind: 'shape',
    shape: { kind: 'rect', x, y, w, h },
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

describe('migrateV215ToV216', () => {
  it('stamps 2.16 and sanitizes the warp stack', () => {
    const raw = {
      formatVersion: '2.15',
      nodes: {
        n1: {
          ...rectNode('n1', 0, 0, 10, 10),
          warps: [
            { id: 'good', kind: 'skew', skewX: 10, skewY: 0, origin: { x: 0.5, y: 0.5 } },
            { id: 'bad', kind: 'skew', skewX: NaN, skewY: 0, origin: { x: 0.5, y: 0.5 } },
          ],
        },
      },
    };
    const out = migrateV215ToV216(raw);
    expect(out.formatVersion).toBe('2.16');
    const warps = (out.nodes as Record<string, { warps?: unknown[] }>).n1?.warps;
    expect(warps).toHaveLength(1);
    expect((warps![0] as { id: string }).id).toBe('good');
  });

  it('removes malformed warpSettings and preserves unknown future kinds', () => {
    const raw = {
      formatVersion: '2.15',
      nodes: {
        n1: {
          ...rectNode('n1', 0, 0, 10, 10),
          warpSettings: { strokeBehavior: 'not-a-behavior' },
          warps: [{ id: 'future', kind: 'warp-v9', foo: 1 }],
        },
      },
    };
    const out = migrateV215ToV216(raw);
    const node = (out.nodes as Record<string, Record<string, unknown>>).n1!;
    expect(node.warpSettings).toBeUndefined();
    expect((node.warps as Array<{ kind: string }>)[0]!.kind).toBe('warp-v9');
  });

  it('drops empty warps arrays entirely', () => {
    const raw = {
      formatVersion: '2.15',
      nodes: { n1: { ...rectNode('n1', 0, 0, 1, 1), warps: [] } },
    };
    const out = migrateV215ToV216(raw);
    expect((out.nodes as Record<string, Record<string, unknown>>).n1?.warps).toBeUndefined();
  });

  it('survives documents with no nodes', () => {
    const out = migrateV215ToV216({ formatVersion: '2.15' });
    expect(out.formatVersion).toBe('2.16');
  });
});

describe('warp-aware bounds', () => {
  it('nodeLocalBounds returns conservative warped bounds for skewed shapes', () => {
    const doc = createDocument();
    const node = rectNode('n1', 0, 0, 200, 100);
    const withWarp = addWarp(addNode(doc, node), 'n1', {
      id: 'w1',
      kind: 'skew',
      skewX: 45,
      skewY: 0,
      origin: { x: 0.5, y: 0.5 },
    } as WarpModifier);
    const warped = nodeLocalBounds(withWarp.nodes.n1!);
    const source = nodeLocalBoundsSource(withWarp.nodes.n1!);
    expect(source).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    // skew 45° pushes top-left to x=-50 and bottom-right to x=250 (plus pad)
    expect(warped!.x).toBeLessThan(-40);
    expect(warped!.x + warped!.w).toBeGreaterThan(240);
  });

  it('disabled warp modifiers leave bounds unchanged', () => {
    const doc = createDocument();
    const node = rectNode('n1', 0, 0, 100, 50);
    const withWarp = addWarp(addNode(doc, node), 'n1', {
      id: 'w1',
      kind: 'skew',
      enabled: false,
      skewX: 45,
      skewY: 0,
      origin: { x: 0.5, y: 0.5 },
    } as WarpModifier);
    expect(nodeLocalBounds(withWarp.nodes.n1!)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it('warped group world bounds contain warped children', () => {
    const doc = createDocument();
    let d = addNode(doc, rectNode('n1', 0, 0, 100, 50));
    d = addNode(d, rectNode('n2', 120, 0, 100, 50));
    const sourceBounds = nodeWorldBounds(d, 'n1');
    const warped = warpSelectionAsGroup(d, ['n1', 'n2'], makeWarpPreset('arch'));
    const groupId = Object.keys(warped.nodes).find((id) => id.startsWith('warp-group-'))!;
    const bounds = nodeWorldBounds(warped, groupId!);
    expect(bounds).toBeTruthy();
    // Arch bends along x and displaces y: the top edge moves upward, so the
    // warped bounds extend at least as far as the source bounds.
    expect(bounds!.y).toBeLessThanOrEqual(sourceBounds!.y);
    expect(bounds!.x).toBeLessThanOrEqual(sourceBounds!.x);
  });

  it('layer panel order and children survive warping', () => {
    const doc = createDocument();
    let d = addNode(doc, rectNode('n1', 0, 0, 10, 10));
    d = addNode(d, rectNode('n2', 20, 0, 10, 10));
    const grouped = warpSelectionAsGroupViaOps(d);
    const group = Object.values(grouped.nodes).find((n) => n.id.startsWith('warp-group-'))!;
    expect((group as { children: string[] }).children).toContain('n1');
  });
});

import { warpSelectionAsGroup } from '../warpOps';

function warpSelectionAsGroupViaOps(
  d: ReturnType<typeof createDocument>,
): ReturnType<typeof createDocument> {
  return warpSelectionAsGroup(d, ['n1', 'n2'], makeWarpPreset('arch'));
}
