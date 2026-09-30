import { describe, expect, it } from 'vitest';
import { createDocument, type Document, makeFrameNode, makeShapeNode } from '../document';
import {
  applyOperation,
  preconditionFailure,
  registerBuiltinOperations,
  validatePayload,
} from '../operations';
import { describePresentationLayoutOverrides, detachPresentationLayout } from './layoutOverrides';
import { previewPresentationLayout } from './layouts';

registerBuiltinOperations();

function makeBoundLayoutDocument() {
  const sourceShape = makeShapeNode(
    'source-title',
    { kind: 'rect', x: 20, y: 30, w: 400, h: 100 },
    {
      name: 'Title',
      transform: [1, 0, 0, 1, 60, 80],
      fill: { space: 'rgb', r: 12, g: 90, b: 120, a: 255 },
    },
  );
  const targetShape = makeShapeNode(
    'target-title',
    { kind: 'rect', x: 5, y: 6, w: 70, h: 35 },
    {
      name: 'Slide title',
      transform: [1, 0, 0, 1, 10, 15],
      cornerRadius: 9,
      fill: { space: 'rgb', r: 220, g: 10, b: 40, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 2,
          y: 3,
          blur: 4,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 80 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
    },
  );
  const sourceFrame = makeFrameNode('source-frame', {
    name: 'Layout master',
    w: 1920,
    h: 1080,
    children: [sourceShape.id],
  });
  const targetFrame = makeFrameNode('target-frame', {
    name: 'Opening',
    w: 1280,
    h: 720,
    children: [targetShape.id],
  });
  let document: Document = {
    ...createDocument('Layout override test', true),
    nodes: Object.fromEntries(
      [sourceShape, targetShape, sourceFrame, targetFrame].map((node) => [node.id, node]),
    ),
  };
  document = applyOperation(document, 'presentation.deck.create', {
    id: 'deck',
    name: 'Deck',
    width: 1280,
    height: 720,
  });
  document = applyOperation(document, 'presentation.slide.add', {
    deckId: 'deck',
    entry: { id: 'entry', frameId: targetFrame.id, title: 'Opening' },
  });
  document = applyOperation(document, 'presentation.layout.register', {
    source: {
      id: 'layout',
      name: 'Title layout',
      frameId: sourceFrame.id,
      revision: 1,
      roleNodes: { title: sourceShape.id },
    },
  });
  const preview = previewPresentationLayout(document, 'deck', 'entry', 'layout', {
    title: targetShape.id,
  });
  return applyOperation(document, 'presentation.layout.apply', { preview });
}

/** Simulates a local edit to the slide rectangle a layout manages. */
function nudgeSlideRect(
  document: Document,
  patch: (rect: { kind: 'rect'; x: number; y: number; w: number; h: number }) => {
    kind: 'rect';
    x: number;
    y: number;
    w: number;
    h: number;
  },
): Document {
  const node = document.nodes['target-title'];
  if (node?.kind !== 'shape' || node.shape.kind !== 'rect') return document;
  return {
    ...document,
    nodes: {
      ...document.nodes,
      'target-title': { ...node, shape: patch(node.shape) },
    },
  };
}

describe('presentation layout overrides', () => {
  it('reports nothing while the slide has no applied layout', () => {
    const document = makeBoundLayoutDocument();
    expect(describePresentationLayoutOverrides(document, 'deck', 'entry')).not.toBeNull();
    expect(describePresentationLayoutOverrides(document, 'deck', 'unknown')).toBeNull();
    const detached = detachPresentationLayout(document, 'deck', 'entry');
    expect(describePresentationLayoutOverrides(detached, 'deck', 'entry')).toBeNull();
  });

  it('reports every mapped object as inherited straight after application', () => {
    const document = makeBoundLayoutDocument();
    const report = describePresentationLayoutOverrides(document, 'deck', 'entry');
    expect(report).toMatchObject({
      deckId: 'deck',
      entryId: 'entry',
      sourceId: 'layout',
      sourceName: 'Title layout',
      appliedRevision: 1,
      sourceRevision: 1,
      sourceOutdated: false,
      overriddenPropertyCount: 0,
    });
    expect(report?.nodes).toHaveLength(1);
    expect(report?.nodes[0]).toMatchObject({
      nodeId: 'target-title',
      role: 'title',
      status: 'inherited',
    });
    expect(report?.nodes[0]?.properties.map((property) => property.key)).toEqual(
      expect.arrayContaining(['transform', 'rotation', 'shape']),
    );
    expect(report?.nodes[0]?.properties.every((property) => property.status === 'inherited')).toBe(
      true,
    );
  });

  it('names the exact property a local edit changed', () => {
    const moved = nudgeSlideRect(makeBoundLayoutDocument(), (rect) => ({ ...rect, x: 999 }));
    const report = describePresentationLayoutOverrides(moved, 'deck', 'entry');
    const property = report?.nodes[0]?.properties.find((entry) => entry.key === 'shape');
    expect(property?.status).toBe('overridden');
    expect(property?.baseline).toMatchObject({ kind: 'rect' });
    expect(report?.overriddenPropertyCount).toBe(1);
    expect(report?.nodes[0]?.status).toBe('overridden');
  });

  it('restores the recorded geometry while leaving appearance and identity alone', () => {
    const applied = makeBoundLayoutDocument();
    const baselineNode = applied.nodes['target-title']!;
    const moved = nudgeSlideRect(applied, (rect) => ({ ...rect, x: 999, w: 12 }));
    expect(moved).not.toBe(applied);
    expect(
      describePresentationLayoutOverrides(moved, 'deck', 'entry')?.overriddenPropertyCount,
    ).toBe(1);

    const reset = applyOperation(moved, 'presentation.layout.overrides.reset', {
      deckId: 'deck',
      entryId: 'entry',
      nodeId: 'target-title',
      property: 'shape',
    });
    expect(reset.nodes['target-title']).toEqual(baselineNode);
    expect(reset.nodes['target-title']?.id).toBe('target-title');
    expect(reset.nodes['target-title']?.name).toBe('Slide title');
    expect(
      describePresentationLayoutOverrides(reset, 'deck', 'entry')?.overriddenPropertyCount,
    ).toBe(0);
  });

  it('keeps node fields a layout does not manage when writing geometry back', () => {
    const applied = makeBoundLayoutDocument();
    const node = applied.nodes['target-title'];
    expect(node?.kind === 'shape' ? node.cornerRadius : undefined).toBe(9);

    const moved = nudgeSlideRect(applied, (rect) => ({ ...rect, x: 500 }));
    const reset = applyOperation(moved, 'presentation.layout.overrides.reset', {
      deckId: 'deck',
      entryId: 'entry',
      nodeId: 'target-title',
    });
    const restored = reset.nodes['target-title'];
    const appliedNode = applied.nodes['target-title'];
    // Corner radius, fill, effects and name are outside the managed baseline.
    expect(restored?.kind === 'shape' ? restored.cornerRadius : undefined).toBe(9);
    expect(restored?.name).toBe('Slide title');
    expect(restored?.effects).toEqual(appliedNode?.effects);
    expect(
      restored?.kind === 'shape' && appliedNode?.kind === 'shape' ? restored.shape : null,
    ).toEqual(appliedNode?.kind === 'shape' ? appliedNode.shape : null);
    expect(
      describePresentationLayoutOverrides(reset, 'deck', 'entry')?.overriddenPropertyCount,
    ).toBe(0);
  });

  it('detaching removes only metadata: the resolved appearance is unchanged', () => {
    const applied = makeBoundLayoutDocument();
    const detached = detachPresentationLayout(applied, 'deck', 'entry');
    expect(detached.nodes).toEqual(applied.nodes);
    const slide = detached.presentation!.decks[0]!.slides[0]!;
    expect(slide.layoutBinding).toBeUndefined();
    // Sequence, title and frame reference all survive a detach.
    expect(slide).toMatchObject({ id: 'entry', frameId: 'target-frame', title: 'Opening' });
    expect(detached.presentation!.layouts).toHaveLength(1);
  });

  it('refuses writes the layout does not own, with an actionable message', () => {
    const document = makeBoundLayoutDocument();

    // The guard lives in the operation precondition: the transaction path is
    // what rejects a write, while the pure helper simply has nothing to restore
    // for a property it never managed.
    expect(
      preconditionFailure(document, 'presentation.layout.overrides.reset', {
        deckId: 'deck',
        entryId: 'entry',
        nodeId: 'target-title',
        property: 'opacity',
      }),
    ).toMatch(/does not manage/i);

    expect(
      preconditionFailure(document, 'presentation.layout.detach', {
        deckId: 'deck',
        entryId: 'entry',
      }),
    ).toBeNull();
    const detached = applyOperation(document, 'presentation.layout.detach', {
      deckId: 'deck',
      entryId: 'entry',
    });
    expect(
      preconditionFailure(detached, 'presentation.layout.overrides.reset', {
        deckId: 'deck',
        entryId: 'entry',
      }),
    ).toMatch(/no layout to reset/i);
    expect(() => detachPresentationLayout(detached, 'deck', 'entry')).toThrowError(
      /no layout to detach/i,
    );
  });

  it('rejects malformed payloads before they reach the document', () => {
    expect(
      validatePayload('presentation.layout.overrides.reset', { deckId: 'deck' }),
    ).toMatchObject({ ok: false });
    expect(
      validatePayload('presentation.layout.overrides.reset', {
        deckId: 'deck',
        entryId: 'entry',
        property: 'shape',
      }),
    ).toMatchObject({ ok: false });
    expect(
      validatePayload('presentation.layout.overrides.reset', {
        deckId: 'deck',
        entryId: 'entry',
        nodeId: 'target-title',
        property: 'shape',
      }),
    ).toMatchObject({ ok: true });
    expect(validatePayload('presentation.layout.detach', {})).toMatchObject({ ok: false });
  });
});
