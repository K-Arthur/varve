/**
 * Tests for AdjustmentScope type resolution and helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  collectAllEligibleNodes,
  collectContainerDescendants,
  estimateAdjustmentImpact,
  isAdjustmentEligible,
  resolveAdjustmentScope,
  scopeForTargets,
  validateScope,
} from './adjustmentScope';
import type { Document } from './document';
import { createDocument, makeAdjustmentNode } from './document';
import type { NodeId } from './types';

function makeTestDoc(): Document {
  return createDocument('test', true) as Document;
}

function addNode(doc: Document, node: import('./types').SceneNode, parentId?: NodeId): Document {
  if (parentId) {
    const parent = doc.nodes[parentId];
    if (parent && 'children' in parent) {
      return {
        ...doc,
        nodes: {
          ...doc.nodes,
          [node.id]: node as import('./types').SceneNode,
          [parentId]: { ...parent, children: [...parent.children, node.id] },
        },
      } as Document;
    }
  }
  return {
    ...doc,
    nodes: { ...doc.nodes, [node.id]: node as import('./types').SceneNode },
    rootChildren: [...doc.rootChildren, node.id],
  } as Document;
}

describe('isAdjustmentEligible', () => {
  it('returns true for shape nodes', () => {
    expect(isAdjustmentEligible({ kind: 'shape' })).toBe(true);
  });
  it('returns true for text nodes', () => {
    expect(isAdjustmentEligible({ kind: 'text' })).toBe(true);
  });
  it('returns true for rasterLayer nodes', () => {
    expect(isAdjustmentEligible({ kind: 'rasterLayer' })).toBe(true);
  });
  it('returns false for adjustment nodes', () => {
    expect(isAdjustmentEligible({ kind: 'adjustment' })).toBe(false);
  });
  it('returns false for hidden nodes', () => {
    expect(isAdjustmentEligible({ kind: 'shape', visible: false })).toBe(false);
  });
  it('returns true for frames and groups', () => {
    expect(isAdjustmentEligible({ kind: 'frame' })).toBe(true);
    expect(isAdjustmentEligible({ kind: 'group' })).toBe(true);
  });
});

describe('resolveAdjustmentScope', () => {
  it('returns eligible targets for image-local scope', () => {
    const doc = makeTestDoc();
    const adjId = 'adj1';
    const targetId = 'target1';
    const docWithTarget = addNode(doc, {
      id: targetId,
      kind: 'shape',
      name: 'Target',
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      transform: [1, 0, 0, 1, 0, 0] as const,
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      strokes: [],
      effects: [],
    } as import('./types').ShapeNode);
    const docWithAdj = addNode(docWithTarget, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'image-local', targetNodeId: targetId },
    } as import('./types').AdjustmentNode);

    const targets = resolveAdjustmentScope(
      docWithAdj,
      { mode: 'image-local', targetNodeId: targetId },
      adjId,
    );
    expect(targets).toEqual([targetId]);
  });

  it('returns empty array for missing target in image-local', () => {
    const doc = makeTestDoc();
    const targets = resolveAdjustmentScope(
      doc,
      { mode: 'image-local', targetNodeId: 'nonexistent' },
      'adj1',
    );
    expect(targets).toEqual([]);
  });

  it('returns targets for explicit-targets scope', () => {
    const doc = makeTestDoc();
    const t1 = 't1',
      t2 = 't2';
    let d = addNode(doc, {
      id: t1,
      kind: 'shape',
      name: 'T1',
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: { space: 'rgb', r: 1, g: 1, b: 1, a: 255 },
      transform: [1, 0, 0, 1, 0, 0] as const,
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      strokes: [],
      effects: [],
    } as import('./types').ShapeNode);
    d = addNode(d, {
      id: t2,
      kind: 'shape',
      name: 'T2',
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      transform: [1, 0, 0, 1, 0, 0] as const,
      shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      strokes: [],
      effects: [],
    } as import('./types').ShapeNode);
    const targets = resolveAdjustmentScope(
      d,
      { mode: 'explicit-targets', targetNodeIds: [t1, t2] },
      'adj1',
    );
    expect(targets).toEqual([t1, t2]);
  });

  it('filters out ineligible targets in explicit-targets', () => {
    const doc = makeTestDoc();
    const adjId = 'adj1';
    const ineligibleId = 'ineligible1';
    const docWithAdj = addNode(doc, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'explicit-targets', targetNodeIds: ['nonexistent', ineligibleId] },
    } as import('./types').AdjustmentNode);
    const targets = resolveAdjustmentScope(
      docWithAdj,
      { mode: 'explicit-targets', targetNodeIds: ['nonexistent', ineligibleId] },
      adjId,
    );
    expect(targets).toEqual([]);
  });

  it('deduplicates targets and rejects the adjustment itself', () => {
    const target = 'target1';
    const adjustment = 'adj1';
    let doc = addNode(makeTestDoc(), {
      id: target,
      kind: 'shape',
      name: 'Target',
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      transform: [1, 0, 0, 1, 0, 0] as const,
      shape: { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
      strokes: [],
      effects: [],
    } as import('./types').ShapeNode);
    doc = addNode(doc, {
      ...makeAdjustmentNode(adjustment, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
    } as import('./types').AdjustmentNode);

    expect(
      resolveAdjustmentScope(
        doc,
        { mode: 'explicit-targets', targetNodeIds: [target, target, adjustment] },
        adjustment,
      ),
    ).toEqual([target]);
  });

  it('resolves container-descendant scope', () => {
    const doc = makeTestDoc();
    const frameId = 'frame1';
    const childId = 'child1';
    let d: Document = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [frameId]: {
          id: frameId,
          kind: 'frame',
          name: 'Frame',
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
          w: 200,
          h: 200,
          transform: [1, 0, 0, 1, 0, 0] as const,
          children: [],
          strokes: [],
          effects: [],
          clipContent: true,
        } as import('./types').FrameNode,
      },
    };
    d = addNode(
      d,
      {
        id: childId,
        kind: 'shape',
        name: 'Child',
        order: 'a0',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        fill: { space: 'rgb', r: 1, g: 0, b: 0, a: 255 },
        transform: [1, 0, 0, 1, 0, 0] as const,
        shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        strokes: [],
        effects: [],
      } as import('./types').ShapeNode,
      frameId,
    );
    const targets = resolveAdjustmentScope(
      d,
      { mode: 'container-descendant', containerId: frameId, includeNested: true },
      'adj1',
    );
    expect(targets).toContain(childId);
  });

  it('returns document-scope targets', () => {
    const doc = makeTestDoc();
    const t1 = 't1';
    const d = addNode(doc, {
      id: t1,
      kind: 'shape',
      name: 'T1',
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      transform: [1, 0, 0, 1, 0, 0] as const,
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      strokes: [],
      effects: [],
    } as import('./types').ShapeNode);
    const targets = resolveAdjustmentScope(d, { mode: 'document' }, 'adj1');
    expect(targets.length).toBeGreaterThanOrEqual(1);
  });
});

describe('scopeForTargets', () => {
  it('returns image-local for single target', () => {
    const doc = makeTestDoc();
    const scope = scopeForTargets(doc, ['t1']);
    expect(scope.mode).toBe('image-local');
    if (scope.mode === 'image-local') {
      expect(scope.targetNodeId).toBe('t1');
    }
  });

  it('returns explicit-targets for multiple unrelated targets', () => {
    const doc = makeTestDoc();
    const scope = scopeForTargets(doc, ['t1', 't2']);
    expect(scope.mode).toBe('explicit-targets');
  });

  it('returns document for empty targets', () => {
    const doc = makeTestDoc();
    const scope = scopeForTargets(doc, []);
    expect(scope.mode).toBe('document');
  });
});

describe('validateScope', () => {
  it('returns empty for valid scope', () => {
    const doc = makeTestDoc();
    const warnings = validateScope(doc, { mode: 'document' });
    expect(warnings).toEqual([]);
  });

  it('warns about missing container', () => {
    const doc = makeTestDoc();
    const warnings = validateScope(doc, {
      mode: 'container-descendant',
      containerId: 'missing',
      includeNested: false,
    });
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain('no longer exists');
  });

  it('warns about missing targets', () => {
    const doc = makeTestDoc();
    const warnings = validateScope(doc, {
      mode: 'explicit-targets',
      targetNodeIds: ['missing1', 'missing2'],
    });
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe('collectContainerDescendants', () => {
  it('returns empty for non-container', () => {
    const doc = makeTestDoc();
    expect(collectContainerDescendants(doc, 'nonexistent', true)).toEqual([]);
  });
});

describe('collectAllEligibleNodes', () => {
  it('returns only eligible nodes', () => {
    const doc = makeTestDoc();
    const nodes = collectAllEligibleNodes(doc);
    for (const id of nodes) {
      const n = doc.nodes[id]!;
      expect(n).toBeDefined();
      expect(n.kind).not.toBe('adjustment');
    }
  });
});

describe('estimateAdjustmentImpact', () => {
  it('returns impact summary for a given scope', () => {
    const doc = makeTestDoc();
    const impact = estimateAdjustmentImpact(doc, { mode: 'document' }, 'adj1');
    expect(typeof impact.targetCount).toBe('number');
    expect(typeof impact.affectedFrames).toBe('number');
    expect(typeof impact.estimatedPixelArea).toBe('number');
    expect(typeof impact.hasOffscreenTargets).toBe('boolean');
  });
});
