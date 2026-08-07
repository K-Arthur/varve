/**
 * Integration tests for AdjustmentScope: save/reopen, copy/paste,
 * migration, and edge cases.
 */
import { describe, expect, it } from 'vitest';
import {
  collectAllEligibleNodes,
  resolveAdjustmentScope,
  scopeForTargets,
  validateScope,
} from './adjustmentScope';
import type { Document } from './document';
import { createDocument, makeAdjustmentNode } from './document';
import type { NodeId } from './types';
import { migrateDocument } from './version';

function makeTestDoc(): Document {
  return createDocument('scope-test', true) as Document;
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

describe('AdjustmentScope - Save/Reopen', () => {
  it('serializes and deserializes scope field', () => {
    const doc = makeTestDoc();
    const shapeId = 'shape1';
    let d = addNode(doc, {
      id: shapeId,
      kind: 'shape',
      name: 'Shape',
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

    const adjId = 'adj1';
    d = addNode(d, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'image-local', targetNodeId: shapeId },
      adjustments: [],
    } as import('./types').AdjustmentNode);

    // Serialize and deserialize
    const json = JSON.stringify(d);
    const restored = JSON.parse(json) as Document;

    const restoredAdj = restored.nodes[adjId] as import('./types').AdjustmentNode;
    expect(restoredAdj.scope).toBeDefined();
    expect(restoredAdj.scope!.mode).toBe('image-local');
    if (restoredAdj.scope!.mode === 'image-local') {
      expect(restoredAdj.scope!.targetNodeId).toBe(shapeId);
    }
  });

  it('serializes explicit-targets scope', () => {
    const doc = makeTestDoc();
    const adjId = 'adj1';
    const d = addNode(doc, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'explicit-targets', targetNodeIds: ['t1', 't2'] },
      adjustments: [],
    } as import('./types').AdjustmentNode);

    const json = JSON.stringify(d);
    const restored = JSON.parse(json) as Document;
    const restoredAdj = restored.nodes[adjId] as import('./types').AdjustmentNode;
    expect(restoredAdj.scope!.mode).toBe('explicit-targets');
    if (restoredAdj.scope!.mode === 'explicit-targets') {
      expect(restoredAdj.scope!.targetNodeIds).toEqual(['t1', 't2']);
    }
  });

  it('serializes container-descendant scope', () => {
    const doc = makeTestDoc();
    const adjId = 'adj1';
    const d = addNode(doc, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'container-descendant', containerId: 'frame1', includeNested: true },
      adjustments: [],
    } as import('./types').AdjustmentNode);

    const json = JSON.stringify(d);
    const restored = JSON.parse(json) as Document;
    const restoredAdj = restored.nodes[adjId] as import('./types').AdjustmentNode;
    expect(restoredAdj.scope!.mode).toBe('container-descendant');
    if (restoredAdj.scope!.mode === 'container-descendant') {
      expect(restoredAdj.scope!.containerId).toBe('frame1');
      expect(restoredAdj.scope!.includeNested).toBe(true);
    }
  });

  it('serializes document scope', () => {
    const doc = makeTestDoc();
    const adjId = 'adj1';
    const d = addNode(doc, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      scope: { mode: 'document' },
      adjustments: [],
    } as import('./types').AdjustmentNode);

    const json = JSON.stringify(d);
    const restored = JSON.parse(json) as Document;
    const restoredAdj = restored.nodes[adjId] as import('./types').AdjustmentNode;
    expect(restoredAdj.scope!.mode).toBe('document');
  });
});

describe('AdjustmentScope - Migration v2.2 to v2.3', () => {
  it('migrates clipping adjustment to image-local scope', () => {
    const v22Doc = {
      formatVersion: '2.2',
      id: 'd1',
      name: 'legacy',
      rootChildren: ['shape1', 'adj1'],
      nodes: {
        shape1: {
          id: 'shape1',
          kind: 'shape',
          visible: true,
        },
        adj1: {
          id: 'adj1',
          kind: 'adjustment',
          clipping: true,
          adjustmentType: 'curves' as const,
          params: {
            channel: 'rgb',
            points: [
              { x: 0, y: 0 },
              { x: 255, y: 255 },
            ],
          },
        },
      },
      components: {},
      nextId: 2,
    };

    const migrated = migrateDocument(v22Doc) as Record<string, unknown>;
    expect(migrated.formatVersion).toBe('2.18');
    const adj = (migrated.nodes as Record<string, Record<string, unknown>>).adj1!;
    expect(adj.scope).toBeDefined();
    expect((adj.scope as Record<string, unknown>).mode).toBe('image-local');
    expect((adj.scope as Record<string, unknown>).targetNodeId).toBe('shape1');
  });

  it('migrates non-clipping adjustment with content to document scope', () => {
    const v22Doc = {
      formatVersion: '2.2',
      id: 'd1',
      name: 'legacy',
      rootChildren: ['adj1'],
      nodes: {
        adj1: {
          id: 'adj1',
          kind: 'adjustment',
          clipping: false,
          adjustmentType: 'levels' as const,
          params: {
            channel: 'rgb',
            inputBlack: 0,
            inputWhite: 255,
            gamma: 1,
            outputBlack: 0,
            outputWhite: 255,
          },
          adjustments: [
            {
              id: 'a1',
              kind: 'brightness',
              value: 10,
              visible: true,
              opacity: 1,
              blendMode: 'normal',
            },
          ],
        },
      },
      components: {},
      nextId: 2,
    };

    const migrated = migrateDocument(v22Doc) as Record<string, unknown>;
    const adj = (migrated.nodes as Record<string, Record<string, unknown>>).adj1!;
    expect((adj.scope as Record<string, unknown>).mode).toBe('document');
  });

  it('leaves empty/inactive adjustments without scope', () => {
    const v22Doc = {
      formatVersion: '2.2',
      id: 'd1',
      name: 'legacy',
      rootChildren: ['adj1'],
      nodes: {
        adj1: {
          id: 'adj1',
          kind: 'adjustment',
          clipping: false,
          adjustmentType: 'levels' as const,
          params: {
            channel: 'rgb',
            inputBlack: 0,
            inputWhite: 255,
            gamma: 1,
            outputBlack: 0,
            outputWhite: 255,
          },
        },
      },
      components: {},
      nextId: 2,
    };

    const migrated = migrateDocument(v22Doc) as Record<string, unknown>;
    const adj = (migrated.nodes as Record<string, Record<string, unknown>>).adj1!;
    expect(adj.scope).toBeUndefined();
  });
});

describe('AdjustmentScope - Edge Cases', () => {
  it('resolves empty targets after deletion', () => {
    const doc = makeTestDoc();
    const targets = resolveAdjustmentScope(
      doc,
      { mode: 'image-local', targetNodeId: 'deleted-node' },
      'adj1',
    );
    expect(targets).toEqual([]);
  });

  it('resolves empty for invalid container', () => {
    const doc = makeTestDoc();
    const targets = resolveAdjustmentScope(
      doc,
      { mode: 'container-descendant', containerId: 'nonexistent', includeNested: false },
      'adj1',
    );
    expect(targets).toEqual([]);
  });

  it('scopeForTargets returns document for empty array', () => {
    expect(scopeForTargets(makeTestDoc(), []).mode).toBe('document');
  });

  it('validateScope warns about missing container', () => {
    const doc = makeTestDoc();
    const warnings = validateScope(doc, {
      mode: 'container-descendant',
      containerId: 'gone',
      includeNested: false,
    });
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('validateScope passes for document scope', () => {
    const doc = makeTestDoc();
    expect(validateScope(doc, { mode: 'document' })).toEqual([]);
  });

  it('collectAllEligibleNodes excludes adjustment nodes', () => {
    const doc = makeTestDoc();
    const adjId = 'adj1';
    const d = addNode(doc, {
      ...makeAdjustmentNode(adjId, 'levels', {
        channel: 'rgb',
        inputBlack: 0,
        inputWhite: 255,
        gamma: 1,
        outputBlack: 0,
        outputWhite: 255,
      }),
      adjustments: [],
    } as import('./types').AdjustmentNode);
    const eligible = collectAllEligibleNodes(d);
    expect(eligible).not.toContain(adjId);
  });
});
