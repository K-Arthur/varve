import { describe, expect, it } from 'vitest';
import { createDocument, type Document, makeFrameNode, makeShapeNode } from '../document';
import { DocumentCodec } from '../documentCodec';
import { applyOperation, createTransactionSession, registerBuiltinOperations } from '../operations';
import { isPresentationLayoutSourceOutdated, previewPresentationLayout } from './layouts';
import { normalizePresentationMetadata } from './normalize';

registerBuiltinOperations();

function makeLayoutDocument() {
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
    ...createDocument('Layout test', true),
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
    entry: { id: 'entry', frameId: targetFrame.id, title: 'Opening', notes: 'Private notes' },
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
  return document;
}

describe('presentation reusable layout geometry', () => {
  it('persists the source geometry snapshot through presentation normalization', () => {
    const document = makeLayoutDocument();
    expect(normalizePresentationMetadata(document.presentation)).toEqual(document.presentation);
    const reopened = DocumentCodec.decode(DocumentCodec.encode(document));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(reopened.document.presentation).toEqual(document.presentation);
      expect(
        isPresentationLayoutSourceOutdated(
          reopened.document,
          reopened.document.presentation!.layouts[0]!,
        ),
      ).toBe(false);
    }
  });

  it('previews and reapplies geometry while preserving target identity and visual content', () => {
    const document = makeLayoutDocument();
    const target = document.nodes['target-title']!;
    const preview = previewPresentationLayout(document, 'deck', 'entry', 'layout', {
      title: 'target-title',
    });
    expect(document.nodes['target-title']).toBe(target);
    const geometry = preview.changes[0]?.properties;
    const transform = geometry?.transform as number[] | undefined;
    const shape = geometry?.shape as Record<string, unknown> | undefined;
    expect(transform).toEqual([1, 0, 0, 1, 40, expect.any(Number)]);
    expect(transform?.[5]).toBeCloseTo(53.3333333);
    expect(shape).toMatchObject({
      kind: 'rect',
      x: expect.any(Number),
      y: 20,
      w: expect.any(Number),
      h: expect.any(Number),
    });
    expect(shape?.x).toBeCloseTo(13.3333333);
    expect(shape?.w).toBeCloseTo(266.6666667);
    expect(shape?.h).toBeCloseTo(66.6666667);

    const applied = applyOperation(document, 'presentation.layout.apply', { preview });
    const result = applied.nodes['target-title'];
    expect(result).toMatchObject({
      id: 'target-title',
      name: 'Slide title',
      fill: { r: 220, g: 10, b: 40 },
      effects: [{ type: 'dropShadow' }],
    });
    if (result?.kind !== 'shape' || result.shape.kind !== 'rect')
      throw new Error('expected materialized target shape');
    expect(result.shape.w).toBeCloseTo(266.6666667);
    expect(applied.presentation?.decks[0]?.slides[0]).toMatchObject({ notes: 'Private notes' });
  });

  it('preserves locally overridden geometry and exposes source edits until refreshed', () => {
    let document = makeLayoutDocument();
    const firstPreview = previewPresentationLayout(document, 'deck', 'entry', 'layout', {
      title: 'target-title',
    });
    document = applyOperation(document, 'presentation.layout.apply', { preview: firstPreview });
    const target = document.nodes['target-title'];
    if (target?.kind !== 'shape' || target.shape.kind !== 'rect')
      throw new Error('expected target shape');
    document = {
      ...document,
      nodes: { ...document.nodes, [target.id]: { ...target, shape: { ...target.shape, w: 222 } } },
    };

    const source = document.presentation!.layouts[0]!;
    expect(isPresentationLayoutSourceOutdated(document, source)).toBe(false);
    const sourceShape = document.nodes['source-title'];
    if (sourceShape?.kind !== 'shape' || sourceShape.shape.kind !== 'rect')
      throw new Error('expected source shape');
    document = {
      ...document,
      nodes: {
        ...document.nodes,
        [sourceShape.id]: { ...sourceShape, shape: { ...sourceShape.shape, w: 440 } },
      },
    };
    expect(isPresentationLayoutSourceOutdated(document, source)).toBe(true);

    document = applyOperation(document, 'presentation.layout.update', {
      sourceId: 'layout',
      name: 'Title layout',
      frameId: 'source-frame',
      roleNodes: { title: 'source-title' },
    });
    expect(isPresentationLayoutSourceOutdated(document, document.presentation!.layouts[0]!)).toBe(
      false,
    );
    const preview = previewPresentationLayout(document, 'deck', 'entry', 'layout', {
      title: 'target-title',
    });
    expect(preview.changes[0]?.preservedOverrides).toContain('shape');
    expect(preview.changes[0]?.properties).not.toHaveProperty('shape');
    const reapplied = applyOperation(document, 'presentation.layout.apply', { preview });
    expect(reapplied.nodes['target-title']).toMatchObject({ shape: { w: 222 } });
  });

  it('replays the previewed apply as one history operation', () => {
    const document = makeLayoutDocument();
    const preview = previewPresentationLayout(document, 'deck', 'entry', 'layout', {
      title: 'target-title',
    });
    const session = createTransactionSession(document, {
      documentId: document.id,
      actor: { actorId: 'layout-test', kind: 'local-user' },
      source: 'presentation',
      baseRevisionId: 'layout-preview-base',
    });
    const appended = session.append('presentation.layout.apply', { preview });
    expect(appended.ok).toBe(true);
    const committed = session.commit();
    expect(committed?.operations).toHaveLength(1);
    if (!committed) throw new Error('expected layout application transaction');
    const replayed = committed.operations.reduce(
      (current, operation) => applyOperation(current, operation.operationType, operation.payload),
      document,
    );
    expect(replayed.nodes['target-title']).toEqual(committed.document.nodes['target-title']);
    expect(replayed.presentation?.decks[0]?.slides[0]?.layoutBinding).toEqual(
      committed.document.presentation?.decks[0]?.slides[0]?.layoutBinding,
    );
  });

  it('requires a fresh preview after source revision and leaves materialized art when removing the source', () => {
    let document = makeLayoutDocument();
    const stalePreview = previewPresentationLayout(document, 'deck', 'entry', 'layout', {
      title: 'target-title',
    });
    document = applyOperation(document, 'presentation.layout.update', {
      sourceId: 'layout',
      name: 'Updated title',
      frameId: 'source-frame',
      roleNodes: { title: 'source-title' },
    });
    expect(() =>
      applyOperation(document, 'presentation.layout.apply', { preview: stalePreview }),
    ).toThrow(/changed after preview/);
    const preview = previewPresentationLayout(document, 'deck', 'entry', 'layout', {
      title: 'target-title',
    });
    document = applyOperation(document, 'presentation.layout.apply', { preview });
    const materialized = document.nodes['target-title'];
    document = applyOperation(document, 'presentation.layout.delete', { sourceId: 'layout' });
    expect(document.nodes['target-title']).toEqual(materialized);
    expect(document.presentation?.decks[0]?.slides[0]?.layoutBinding?.sourceId).toBe('layout');
  });
});
