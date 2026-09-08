import { createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  createEffectPreviewSession,
  matchesEffectPreviewSession,
  reconcileEffectPreviewCancel,
} from './effectPreviewSession';

function fixture() {
  const document = createDocument('preview');
  const node = makeShapeNode('shape-1', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
  document.nodes[node.id] = node;
  document.rootChildren = [node.id];
  return { document, node };
}

function session(document: ReturnType<typeof fixture>['document']) {
  return createEffectPreviewSession({
    sessionId: 'session-1',
    document,
    targetIds: ['shape-1'],
    treatmentId: 'studio-test',
    instanceId: 'instance-1',
    baselineRevision: 3,
    generation: 4,
    ownedFilterIds: ['preview-effect-1'],
  });
}

describe('effect preview session', () => {
  it('matches the complete document, target, treatment, and generation identity', () => {
    const { document } = fixture();
    const current = session(document);
    expect(matchesEffectPreviewSession(current, current)).toBe(true);
    expect(
      matchesEffectPreviewSession(current, { ...current, generation: current.generation + 1 }),
    ).toBe(false);
    expect(matchesEffectPreviewSession(current, { ...current, ownerId: 'different-owner' })).toBe(
      false,
    );
  });

  it('removes preview-owned filters while preserving unrelated edits', () => {
    const { document } = fixture();
    const draft = {
      ...document,
      nodes: {
        ...document.nodes,
        'shape-1': {
          ...document.nodes['shape-1']!,
          name: 'Renamed while previewing',
          smartFiltersEnabled: true,
          smartFilters: [
            { id: 'preview-effect-1', kind: 'grain' } as never,
            { id: 'external-effect-1', kind: 'brightness' } as never,
          ],
        },
      },
    };

    const reconciled = reconcileEffectPreviewCancel(document, draft, session(document));
    expect(reconciled.nodes['shape-1']).toMatchObject({
      name: 'Renamed while previewing',
      smartFilters: [{ id: 'external-effect-1' }],
    });
  });

  it('does not resurrect a deleted owner or cross a document switch', () => {
    const { document } = fixture();
    const current = createDocument('other');
    expect(reconcileEffectPreviewCancel(document, current, session(document))).toBe(current);
    const deleted = {
      ...document,
      nodes: {},
    };
    expect(reconcileEffectPreviewCancel(document, deleted, session(document))).toBe(deleted);
  });
});
