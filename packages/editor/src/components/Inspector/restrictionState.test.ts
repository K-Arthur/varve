import { createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import type { InspectorRestrictionState } from './inspectorContext';
import { describeSelectionRestrictions } from './restrictionState';

function restrictions(
  overrides: Partial<InspectorRestrictionState> = {},
): InspectorRestrictionState {
  return {
    directLockedNodeIds: [],
    inheritedLockedNodeIds: [],
    effectiveLockedNodeIds: [],
    directHiddenNodeIds: [],
    inheritedHiddenNodeIds: [],
    effectiveHiddenNodeIds: [],
    lockSourceIds: [],
    visibilitySourceIds: [],
    editableNodeIds: [],
    canEditSelection: true,
    canSeeSelectionFeedback: true,
    hasPartialLock: false,
    hasPartialHidden: false,
    ...overrides,
  };
}

describe('describeSelectionRestrictions', () => {
  it('describes a partial lock using the selected count and source name', () => {
    const document = createDocument('Restriction state test');
    const locked = makeShapeNode(
      'locked',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      {
        name: 'Locked shape',
      },
    );
    const nextDocument = { ...document, nodes: { ...document.nodes, [locked.id]: locked } };
    const result = describeSelectionRestrictions(
      restrictions({
        effectiveLockedNodeIds: [locked.id],
        lockSourceIds: [locked.id],
        hasPartialLock: true,
      }),
      nextDocument,
      2,
    );

    expect(result).toMatchObject({
      locked: true,
      lockedCount: 1,
      totalCount: 2,
      lockSourceLabel: 'Locked shape',
      hasPartialLock: true,
    });
  });

  it('keeps direct and ancestor source labels bounded', () => {
    const document = createDocument('Source labels test');
    const nodes = ['one', 'two', 'three'].map((id) =>
      makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: id }),
    );
    const nextDocument = {
      ...document,
      nodes: {
        ...document.nodes,
        ...Object.fromEntries(nodes.map((node) => [node.id, node])),
      },
    };
    const result = describeSelectionRestrictions(
      restrictions({
        effectiveHiddenNodeIds: nodes.map((node) => node.id),
        visibilitySourceIds: nodes.map((node) => node.id),
      }),
      nextDocument,
      3,
    );

    expect(result.visibilitySourceLabel).toBe('one, two, +1 more');
  });
});
