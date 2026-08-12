import type { Document, SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { compositeDispatchedEffect, flattenForExport } from '../flattenForExport';

function makeNode(id: string): SceneNode {
  return {
    id,
    name: `Node ${id}`,
    kind: 'shape',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: [1, 0, 0, 1, 0, 0] as const,
    fills: [],
    strokes: [],
    effects: [],
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
  } as unknown as SceneNode;
}

function makeAdjustmentNode(id: string, adjustments: Array<Record<string, unknown>>): SceneNode {
  const base = {
    id,
    name: `Adj ${id}`,
    kind: 'adjustment',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: [1, 0, 0, 1, 0, 0] as const,
    fills: [],
    strokes: [],
    effects: [],
    adjustmentType: 'curves',
    params: {
      channel: 'rgb',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
    clipping: false,
    scope: { mode: 'image-local', targetNodeId: 'n1' },
  };
  return {
    ...base,
    adjustments: adjustments.map((a) => ({
      id: `adj-${Math.random()}`,
      kind: a.kind as string,
      visible: a.visible !== false,
      opacity: (a.opacity as number) ?? 1,
      ...a,
    })),
  } as unknown as SceneNode;
}

function makeDoc(nodes: SceneNode[]): Document {
  const nodeMap: Record<string, SceneNode> = {};
  for (const n of nodes) nodeMap[n.id] = n;
  return {
    id: 'test-doc',
    nodes: nodeMap,
    rootChildren: nodes.map((n) => n.id),
    formatVersion: '2.0',
  } as unknown as Document;
}

describe('flattenForExport', () => {
  it('preserves live-effect opacity and blend mode for accelerated results', () => {
    const source = new ImageData(new Uint8ClampedArray([100, 100, 100, 255]), 1, 1);
    const result = new ImageData(new Uint8ClampedArray([200, 200, 200, 255]), 1, 1);

    const mixed = compositeDispatchedEffect(source, result, 0.5, 'normal');
    expect(Array.from(mixed.data)).toEqual([150, 150, 150, 255]);

    const screened = compositeDispatchedEffect(source, result, 1, 'screen');
    expect(screened.data[0]).toBeGreaterThan(200);
    expect(screened.data[3]).toBe(255);
  });

  it('returns empty assets for documents with no adjustment nodes', async () => {
    const doc = makeDoc([makeNode('n1')]);
    const result = await flattenForExport([doc.nodes.n1!], doc, { scale: 1 });
    expect(result.assets).toEqual({});
  });

  it('returns empty assets for adjustment nodes with no visible filters', async () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'curves', visible: false, opacity: 1 }]);
    const doc = makeDoc([adj]);
    const result = await flattenForExport([adj], doc, { scale: 1 });
    expect(result.assets).toEqual({});
  });

  it('skips adjustment nodes whose filters do not require raster export', async () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'brightness', visible: true, opacity: 1 }]);
    const doc = makeDoc([adj]);
    const result = await flattenForExport([adj], doc, { scale: 1 });
    expect(result.assets).toEqual({});
  });

  it('detects adjustment nodes that need flattening', async () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'posterize', visible: true, opacity: 1 }]);
    const doc = makeDoc([adj]);
    const result = await flattenForExport([adj], doc, { scale: 1 });
    expect(result.assets).toBeDefined();
  });

  it('handles aborted signal gracefully', async () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'posterize', visible: true, opacity: 1 }]);
    const doc = makeDoc([adj]);
    const ac = new AbortController();
    ac.abort();
    const result = await flattenForExport([adj], doc, { scale: 1, signal: ac.signal });
    expect(result.assets).toBeDefined();
  });

  it('collects adjustment nodes inside frames/groups', async () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'posterize', visible: true, opacity: 1 }]);
    const group: SceneNode = {
      id: 'grp1',
      name: 'Group',
      kind: 'group',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'passThrough',
      transform: [1, 0, 0, 1, 0, 0] as const,
      fills: [],
      strokes: [],
      effects: [],
      children: ['adj1'],
    } as unknown as SceneNode;
    const doc = makeDoc([group, adj]);
    const result = await flattenForExport([group], doc, { scale: 1 });
    expect(result.assets).toBeDefined();
  });

  it('does not crash with extremely large dimensions', async () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'posterize', visible: true, opacity: 1 }]);
    const doc = makeDoc([adj]);
    const result = await flattenForExport([adj], doc, { scale: 100 });
    expect(result.assets).toBeDefined();
  });
});

describe('flattenForExport with live effects', () => {
  it('expands the rasterized bounds for bloom and applies export quality', async () => {
    // Bloom with radius 100 must expand the exported asset region by its
    // support radius (100px per side), so the glow is not clipped.
    const adj = makeAdjustmentNode('adj1', [
      {
        kind: 'bloom',
        visible: true,
        opacity: 1,
        threshold: 0.5,
        softKnee: 0.2,
        intensity: 1,
        radius: 100,
        diffusion: 0.5,
        tint: null,
        tintAmount: 0,
        composite: 'screen',
        streakEnabled: false,
        streakAngle: 0,
        streakLength: 64,
        streakIntensity: 0.5,
        streakAspect: 2,
        quality: 'auto',
      },
    ]);
    const doc = makeDoc([makeNode('n1'), adj]);
    const result = await flattenForExport([adj], doc, { scale: 1 });
    const asset = Object.values(result.assets)[0];
    expect(asset).toBeDefined();
    // The surface is expanded by the bloom support radius (100px per side).
    expect(asset!.pixelWidth).toBe(300);
    expect(asset!.pixelHeight).toBe(300);
    expect(asset!.expansion).toEqual({ left: 100, top: 100, right: 100, bottom: 100 });
  });

  it('expands for rgbSplit channel offsets', async () => {
    const adj = makeAdjustmentNode('adj1', [
      {
        kind: 'rgbSplit',
        visible: true,
        opacity: 1,
        mode: 'offset',
        redX: 0,
        redY: 0,
        greenX: 0,
        greenY: 0,
        blueX: -24,
        blueY: 0,
        amount: 24,
        centerX: 0.5,
        centerY: 0.5,
        falloff: 1,
        fringeAngle: 0,
        borderMode: 'transparent',
        intensity: 1,
      },
    ]);
    const doc = makeDoc([makeNode('n1'), adj]);
    const result = await flattenForExport([adj], doc, { scale: 1 });
    const asset = Object.values(result.assets)[0];
    expect(asset).toBeDefined();
    expect(asset!.pixelWidth).toBe(148);
    expect(asset!.expansion?.left).toBe(24);
  });

  it('rasterizes dither at the requested export scale', async () => {
    const adj = makeAdjustmentNode('adj1', [
      {
        kind: 'dither',
        visible: true,
        opacity: 1,
        algorithm: 'bayer',
        paletteMode: 'levels',
        levels: 4,
        colors: [],
        metric: 'rgb',
        serpentine: false,
        strength: 1,
        bayerSize: 8,
        cellSize: 1,
        alphaCutoff: 0,
        seed: 0,
      },
    ]);
    const doc = makeDoc([makeNode('n1'), adj]);
    const result = await flattenForExport([adj], doc, { scale: 2 });
    const asset = Object.values(result.assets)[0];
    expect(asset).toBeDefined();
    // Dither expands by its cell size (1px per side) at export too.
    expect(asset!.pixelWidth).toBe(204);
    expect(asset!.pixelHeight).toBe(204);
    expect(asset!.expansion).toEqual({ left: 1, top: 1, right: 1, bottom: 1 });
  });
});
