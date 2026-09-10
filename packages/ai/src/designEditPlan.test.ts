import { describe, expect, it } from 'vitest';
import {
  checkDesignPlanFreshness,
  type DesignEditPlan,
  validateDesignEditPlan,
} from './designEditPlan';

const snapshot = {
  documentId: 'doc-1',
  revision: 4,
  nodeIds: new Set(['frame-1', 'text-1']),
};

function plan(overrides: Partial<DesignEditPlan> = {}): DesignEditPlan {
  return {
    planId: 'plan-1',
    requestId: 'request-1',
    documentId: 'doc-1',
    baseRevision: 4,
    mode: 'preview',
    scope: 'frame',
    source: { kind: 'screenshot', id: 'upload-1' },
    confidence: 0.86,
    warnings: [],
    operations: [
      { kind: 'create-node', nodeId: 'button-1', nodeKind: 'frame', parentId: 'frame-1' },
      { kind: 'set-property', nodeId: 'button-1', property: 'layout.gap', value: 8 },
      { kind: 'resize-node', nodeId: 'button-1', width: 240, height: 48 },
    ],
    ...overrides,
  };
}

describe('design edit plans', () => {
  it('accepts a valid preview plan with earlier-created targets', () => {
    const result = validateDesignEditPlan(plan(), snapshot);
    expect(result.valid).toBe(true);
    expect(result.plan?.operations).toHaveLength(3);
  });

  it('rejects unsafe properties, duplicate ids, and negative dimensions', () => {
    const result = validateDesignEditPlan(
      plan({
        operations: [
          { kind: 'create-node', nodeId: 'button-1', nodeKind: 'frame', parentId: 'frame-1' },
          { kind: 'create-node', nodeId: 'button-1', nodeKind: 'frame', parentId: 'frame-1' },
          { kind: 'set-property', nodeId: 'button-1', property: '__proto__.polluted', value: true },
          { kind: 'resize-node', nodeId: 'button-1', width: -1, height: 48 },
        ],
      }),
      snapshot,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nodeId must be unique'),
        expect.stringContaining('property is invalid'),
        expect.stringContaining('width cannot be negative'),
      ]),
    );
  });

  it('rejects stale document revisions before editor application', () => {
    const result = validateDesignEditPlan(plan({ baseRevision: 3 }), snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('document revision changed while the plan was pending');
  });

  it('reports missing targets and document changes without mutating the plan', () => {
    const candidate = plan({
      operations: [{ kind: 'move-node', nodeId: 'missing-node', x: 0, y: 0 }],
    });
    const freshness = checkDesignPlanFreshness(candidate, {
      documentId: 'doc-2',
      revision: 5,
      nodeIds: new Set(['frame-1']),
    });
    expect(freshness.fresh).toBe(false);
    expect(freshness.reasons).toEqual(
      expect.arrayContaining([
        'document changed while the plan was pending',
        'document revision changed while the plan was pending',
        "target node 'missing-node' no longer exists",
      ]),
    );
    expect(candidate.operations[0]).toEqual({
      kind: 'move-node',
      nodeId: 'missing-node',
      x: 0,
      y: 0,
    });
  });
});
