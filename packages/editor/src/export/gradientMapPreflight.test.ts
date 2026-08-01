/**
 * Gradient-map export preflight tests.
 */
import { createDocument, makeAdjustment, makeAdjustmentNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { collectGradientMapFlattenWarnings, subtreeHasGradientMap } from './gradientMapPreflight';

function docWithGradientMap() {
  const doc = createDocument('gm', true);
  const adjNode = {
    ...makeAdjustmentNode('adj-1', 'levels', {
      channel: 'rgb',
      inputBlack: 0,
      inputWhite: 255,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 255,
    }),
    adjustments: [makeAdjustment('a1', 'gradientMap')],
  };
  return { ...doc, nodes: { ...doc.nodes, 'adj-1': adjNode } };
}

describe('subtreeHasGradientMap', () => {
  it('detects gradient-map adjustments on adjustment nodes', () => {
    const doc = docWithGradientMap();
    const adj = doc.nodes['adj-1']!;
    expect(subtreeHasGradientMap(adj, doc)).toBe(true);
  });

  it('is false for documents without gradient maps', () => {
    const doc = createDocument('plain');
    const node = doc.nodes[doc.rootChildren[0]!]!;
    expect(subtreeHasGradientMap(node, doc)).toBe(false);
  });
});

describe('collectGradientMapFlattenWarnings', () => {
  it('warns for SVG and PDF, not raster', () => {
    const doc = docWithGradientMap();
    const adj = doc.nodes['adj-1']!;
    expect(collectGradientMapFlattenWarnings(adj, doc, 'svg').length).toBe(1);
    expect(collectGradientMapFlattenWarnings(adj, doc, 'pdf').length).toBe(1);
    expect(collectGradientMapFlattenWarnings(adj, doc, 'raster')).toEqual([]);
  });

  it('is empty when no gradient map is present', () => {
    const doc = createDocument('plain');
    const node = doc.nodes[doc.rootChildren[0]!]!;
    expect(collectGradientMapFlattenWarnings(node, doc, 'svg')).toEqual([]);
  });
});
