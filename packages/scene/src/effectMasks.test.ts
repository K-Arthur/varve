import { describe, expect, it } from 'vitest';
import { createDocument, makeGroupNode, makeShapeNode } from './document';
import {
  buildCompositingDependencyGraph,
  detectCompositingCycles,
  findCompositingDependents,
  setEffectMask,
} from './effectMasks';
import type { EffectMaskBinding } from './types';

const shadow = (id: string) => ({
  id,
  type: 'dropShadow' as const,
  x: 2,
  y: 2,
  blur: 4,
  spread: 0,
  color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
  opacity: 0.5,
  blendMode: 'normal' as const,
  visible: true,
});

const source = (nodeId: string): EffectMaskBinding => ({
  source: { kind: 'scene-node', nodeId },
  type: 'alpha',
  coordinateSpace: 'world',
});

function baseDocument() {
  const target = makeShapeNode(
    'target',
    { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    { effects: [shadow('effect-target')] },
  );
  const matte = makeShapeNode('matte', { kind: 'circle', cx: 50, cy: 50, r: 50 });
  return {
    ...createDocument('effect masks'),
    rootChildren: ['target', 'matte'],
    nodes: { target, matte },
  };
}

describe('effect-local compositing dependencies', () => {
  it('stores an external scene matte edge and exposes dependents', () => {
    const doc = baseDocument();
    const updated = setEffectMask(doc, 'target', 'effect-target', source('matte'));
    expect(updated).not.toBe(doc);
    expect(buildCompositingDependencyGraph(updated)).toEqual([
      {
        sourceNodeId: 'matte',
        targetNodeId: 'target',
        kind: 'effect-mask',
        effectId: 'effect-target',
      },
    ]);
    expect(findCompositingDependents(updated, 'matte')).toEqual(['target']);
  });

  it('rejects direct and structural cycles without mutating the document', () => {
    const first = setEffectMask(baseDocument(), 'target', 'effect-target', source('matte'));
    const matteWithEffect = makeShapeNode(
      'matte',
      { kind: 'circle', cx: 50, cy: 50, r: 50 },
      { effects: [shadow('effect-matte')] },
    );
    const cycleCandidate = { ...first, nodes: { ...first.nodes, matte: matteWithEffect } };
    const rejected = setEffectMask(cycleCandidate, 'matte', 'effect-matte', source('target'));
    expect(rejected).toBe(cycleCandidate);
    expect(detectCompositingCycles(cycleCandidate)).toHaveLength(0);

    const group = makeGroupNode('group', { children: ['target'] });
    const nested = {
      ...baseDocument(),
      rootChildren: ['group', 'matte'],
      nodes: { ...baseDocument().nodes, group },
    };
    const nestedRejected = setEffectMask(nested, 'target', 'effect-target', source('group'));
    expect(nestedRejected).toBe(nested);
  });
});
