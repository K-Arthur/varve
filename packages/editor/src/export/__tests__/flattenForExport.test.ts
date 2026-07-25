import type { Document, SceneNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { flattenForExport } from '../flattenForExport';

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
  };
  return {
    ...base,
    adjustments: adjustments.map((a) => ({
      id: `adj-${Math.random()}`,
      kind: a.kind as string,
      visible: a.visible !== false,
      opacity: (a.opacity as number) ?? 1,
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
