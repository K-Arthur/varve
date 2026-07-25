import type { Document as SceneDocument, SceneNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { adjustmentStackTargetGaps } from '../shared';
import { exportNodeToSvg, svgTargetGaps } from '../svg';

function makeAdjustmentNode(
  id: string,
  adjustments: Array<{ kind: string; visible?: boolean; opacity?: number }>,
  overrides: Record<string, unknown> = {},
): SceneNode {
  return {
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
    adjustments: adjustments as unknown as import('@strata/engine').Adjustment[],
    ...overrides,
  } as unknown as SceneNode;
}

function makeDoc(nodes: SceneNode[]): SceneDocument {
  const nodeMap: Record<string, SceneNode> = {};
  for (const n of nodes) nodeMap[n.id] = n;
  return {
    id: 'test-doc',
    nodes: nodeMap,
    rootChildren: nodes.map((n) => n.id),
  } as unknown as SceneDocument;
}

describe('adjustmentStackTargetGaps', () => {
  it('reports warning when no raster asset is provided', () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'curves', visible: true, opacity: 1 }]);
    const gaps = adjustmentStackTargetGaps(adj);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.severity).toBe('warning');
    expect(gaps[0]?.feature).toContain('curves');
  });

  it('reports info when raster asset is provided', () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'curves', visible: true, opacity: 1 }]);
    const gaps = adjustmentStackTargetGaps(adj, undefined, true);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.severity).toBe('info');
    expect(gaps[0]?.feature).toContain('curves');
    expect(gaps[0]?.fallback).toContain('pixel-accurate');
  });

  it('returns empty for non-adjustment nodes', () => {
    const shape = {
      id: 's1',
      kind: 'shape',
      name: 'Shape',
      transform: [1, 0, 0, 1, 0, 0] as const,
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    } as unknown as SceneNode;
    const gaps = adjustmentStackTargetGaps(shape);
    expect(gaps).toHaveLength(0);
  });

  it('returns empty when all adjustments are invisible', () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'curves', visible: false, opacity: 1 }]);
    const gaps = adjustmentStackTargetGaps(adj);
    expect(gaps).toHaveLength(0);
  });
});

describe('svgTargetGaps', () => {
  it('reports info when flattenedNodes contains the adjustment node', () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'curves', visible: true, opacity: 1 }]);
    const gaps = svgTargetGaps(adj, makeDoc([adj]), new Set(['adj1']));
    expect(gaps.some((g) => g.severity === 'info')).toBe(true);
  });

  it('reports warning when flattenedNodes does not contain the node', () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'curves', visible: true, opacity: 1 }]);
    const gaps = svgTargetGaps(adj, makeDoc([adj]));
    expect(gaps.some((g) => g.severity === 'warning')).toBe(true);
  });
});

describe('exportNodeToSvg with rasterAssets', () => {
  it('embeds a raster image when asset is provided for adjustment node', () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'curves', visible: true, opacity: 1 }]);
    const doc = makeDoc([adj]);
    const svg = exportNodeToSvg(adj, doc, {
      rasterAssets: {
        adj1: {
          nodeId: 'adj1',
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          pixelWidth: 200,
          pixelHeight: 160,
          cssWidth: 200,
          cssHeight: 160,
        },
      },
    });
    expect(svg).toContain('<image');
    expect(svg).toContain('href="data:image/png;base64');
    expect(svg).not.toContain('warning');
  });

  it('returns empty SVG when no asset is provided for adjustment node', () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'curves', visible: true, opacity: 1 }]);
    const doc = makeDoc([adj]);
    const svg = exportNodeToSvg(adj, doc);
    expect(svg).toContain('<svg');
    // The adjustment node itself is empty but the svg container still renders the white rect
    expect(svg).toContain('</svg>');
  });

  it('embeds raster image at correct dimensions', () => {
    const adj = makeAdjustmentNode('adj1', [{ kind: 'posterize', visible: true, opacity: 1 }]);
    const doc = makeDoc([adj]);
    const svg = exportNodeToSvg(adj, doc, {
      rasterAssets: {
        adj1: {
          nodeId: 'adj1',
          dataUrl: 'data:image/png;base64,abc123',
          pixelWidth: 400,
          pixelHeight: 300,
          cssWidth: 200,
          cssHeight: 150,
        },
      },
    });
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="150"');
    expect(svg).toContain('href="data:image/png;base64,abc123');
  });
});
