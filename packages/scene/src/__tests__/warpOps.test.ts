/**
 * Geometry-modifier (warp) document-op tests.
 */

import { makeWarpPreset } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { addNode, createDocument, type Document } from '../document';
import type { ShapeNode } from '../types';
import {
  addWarp,
  canNodeHaveWarps,
  clearWarps,
  duplicateWarp,
  removeWarp,
  renameWarp,
  reorderWarps,
  resetWarp,
  setWarpEnabled,
  setWarpSettings,
  updateWarp,
  warpSelectionAsGroup,
  warpsOnNode,
} from '../warpOps';

function makeShapeDoc(): { doc: Document; nodeId: string } {
  const node: ShapeNode = {
    id: 'n1',
    name: 'Rect',
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
  return { doc: addNode(createDocument(), node), nodeId: 'n1' };
}

describe('warpOps', () => {
  it('adds a validated modifier to the stack', () => {
    const { doc, nodeId } = makeShapeDoc();
    const next = addWarp(doc, nodeId, makeWarpPreset('arch'));
    const warps = warpsOnNode(next.nodes[nodeId]);
    expect(warps).toHaveLength(1);
    expect(warps[0]!.kind).toBe('bend');
    expect(warps[0]!.id.length).toBeGreaterThan(0);
  });

  it('rejects structurally invalid modifiers', () => {
    const { doc, nodeId } = makeShapeDoc();
    const next = addWarp(doc, nodeId, {
      id: 'x',
      kind: 'skew',
      skewX: NaN,
      skewY: 0,
      origin: { x: 0.5, y: 0.5 },
    });
    expect(warpsOnNode(next.nodes[nodeId]!)).toHaveLength(0);
  });

  it('does not attach warps to unsupported node kinds', () => {
    const node: ShapeNode = {
      id: 'n2',
      name: 'Raster',
      kind: 'shape',
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
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
    // Simulate an ineligible node by stripping eligibility via a frame-less kind:
    // rasterLayer nodes cannot hold warps in this version.
    const raster = {
      ...node,
      id: 'r1',
      kind: 'rasterLayer',
      width: 10,
      height: 10,
      tiles: new Map(),
    };
    const doc = addNode(createDocument(), raster as unknown as ShapeNode);
    const next = addWarp(doc, 'r1', makeWarpPreset('arch'));
    expect(warpsOnNode(next.nodes.r1)).toHaveLength(0);
  });

  it('update/rename/enable/disable modify in place with stable id', () => {
    const { doc, nodeId } = makeShapeDoc();
    const withWarp = addWarp(doc, nodeId, makeWarpPreset('arch'));
    const id = warpsOnNode(withWarp.nodes[nodeId])[0]!.id;
    const renamed = renameWarp(withWarp, nodeId, id, 'Bend 1');
    expect(warpsOnNode(renamed.nodes[nodeId])[0]!.name).toBe('Bend 1');
    const disabled = setWarpEnabled(renamed, nodeId, id, false);
    expect(warpsOnNode(disabled.nodes[nodeId])[0]!.enabled).toBe(false);
    const reEnabled = setWarpEnabled(disabled, nodeId, id, true);
    // enabled:true is the default and normalizes away on validation
    expect(warpsOnNode(reEnabled.nodes[nodeId])[0]!.enabled).not.toBe(false);
    const updated = updateWarp(reEnabled, nodeId, id, { amount: 0.9 });
    expect((warpsOnNode(updated.nodes[nodeId])[0]! as { amount: number }).amount).toBe(0.9);
  });

  it('rejects invalid parameter patches', () => {
    const { doc, nodeId } = makeShapeDoc();
    const withWarp = addWarp(doc, nodeId, makeWarpPreset('arch'));
    const id = warpsOnNode(withWarp.nodes[nodeId])[0]!.id;
    const bad = updateWarp(withWarp, nodeId, id, { amount: 99 });
    // out-of-range values are clamped, never stored unbounded
    expect((warpsOnNode(bad.nodes[nodeId])[0]! as { amount: number }).amount).toBe(1);
  });

  it('reorders, duplicates, resets, removes, and clears', () => {
    const { doc, nodeId } = makeShapeDoc();
    const a = addWarp(doc, nodeId, makeWarpPreset('arch'));
    const b = addWarp(a, nodeId, makeWarpPreset('flag'));
    const c = addWarp(b, nodeId, makeWarpPreset('four-edge'));
    const warps = warpsOnNode(c.nodes[nodeId]);
    const ids = warps.map((w) => w.id);
    const reordered = reorderWarps(c, nodeId, ids[2]!, 0);
    expect(warpsOnNode(reordered.nodes[nodeId]).map((w) => w.kind)).toEqual([
      'envelope',
      'bend',
      'bend',
    ]);
    const duplicated = duplicateWarp(
      reordered,
      nodeId,
      warpsOnNode(reordered.nodes[nodeId])[0]!.id,
    );
    expect(warpsOnNode(duplicated.nodes[nodeId])).toHaveLength(4);
    expect(warpsOnNode(duplicated.nodes[nodeId])[0]!.id).not.toBe(
      warpsOnNode(duplicated.nodes[nodeId])[1]!.id,
    );
    const bendId = warpsOnNode(duplicated.nodes[nodeId]).find((w) => w.kind === 'bend')!.id;
    const reset = resetWarp(duplicated, nodeId, bendId);
    expect(
      (warpsOnNode(reset.nodes[nodeId]).find((w) => w.id === bendId)! as { amount: number }).amount,
    ).toBe(0);
    const removed = removeWarp(reset, nodeId, warpsOnNode(reset.nodes[nodeId])[0]!.id);
    expect(warpsOnNode(removed.nodes[nodeId])).toHaveLength(3);
    const cleared = clearWarps(removed, nodeId);
    expect(warpsOnNode(cleared.nodes[nodeId])).toHaveLength(0);
  });

  it('caps the stack at MAX_WARPS_PER_NODE', () => {
    const { doc, nodeId } = makeShapeDoc();
    let next = doc;
    for (let i = 0; i < 12; i++) {
      next = addWarp(next, nodeId, makeWarpPreset('arch'));
    }
    expect(warpsOnNode(next.nodes[nodeId])).toHaveLength(8);
  });

  it('sets warp settings on eligible nodes', () => {
    const { doc, nodeId } = makeShapeDoc();
    const next = setWarpSettings(doc, nodeId, { strokeBehavior: 'warp-appearance' });
    expect((next.nodes[nodeId] as ShapeNode).warpSettings?.strokeBehavior).toBe('warp-appearance');
  });

  it('warps a multi-selection by grouping then attaching the modifier', () => {
    const { doc, nodeId } = makeShapeDoc();
    const second: ShapeNode = {
      ...(doc.nodes[nodeId] as ShapeNode),
      id: 'n2',
      name: 'Rect 2',
      transform: [1, 0, 0, 1, 40, 0],
    };
    const doc2 = addNode(doc, second);
    const next = warpSelectionAsGroup(doc2, ['n1', 'n2'], makeWarpPreset('arch'));
    // group node created
    const group = Object.values(next.nodes).find((n) => n.id.startsWith('warp-group-'))!;
    expect(group).toBeTruthy();
    expect(warpsOnNode(group)).toHaveLength(1);
    expect((group as { children: string[] }).children).toContain('n1');
    expect((group as { children: string[] }).children).toContain('n2');
  });

  it('eligibility gate', () => {
    const { doc, nodeId } = makeShapeDoc();
    expect(canNodeHaveWarps(doc.nodes[nodeId])).toBe(true);
  });
});
