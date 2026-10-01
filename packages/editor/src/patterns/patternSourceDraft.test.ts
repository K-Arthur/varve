import {
  addNode,
  createDocument,
  createPatternDefinitionFromSelection,
  makeShapeNode,
  type PatternDefinition,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyPatternSourceDraft,
  applyPatternSourceDraftWithPreview,
  getPatternSourceDraftStatus,
  setPatternSourceRootRotation,
  translatePatternSourceRoot,
} from './patternSourceDraft';

describe('pattern source drafts', () => {
  function makeDefinition() {
    const motif = makeShapeNode(
      'motif',
      { kind: 'rect', x: 0, y: 0, w: 18, h: 12 },
      { name: 'Leaf mark', transform: [1, 0, 0, 1, 4, 3] },
    );
    const doc = addNode(createDocument('Pattern draft', true), motif);
    const created = createPatternDefinitionFromSelection(doc, [motif.id], {
      id: 'leaf-draft',
      name: 'Leaf draft',
    });
    return {
      document: created.document,
      definition: created.definition,
      rootId:
        created.definition.source.kind === 'vector' ? created.definition.source.rootIds[0]! : '',
    };
  }

  it('moves only a canonical source motif and leaves the saved definition untouched', () => {
    const { definition, rootId } = makeDefinition();
    if (definition.source.kind !== 'vector') throw new Error('expected vector source');
    const original = definition.source.nodes[rootId]!;
    const draft = translatePatternSourceRoot(definition, rootId, 7, -2);

    if (draft.source.kind !== 'vector') throw new Error('expected vector source');
    const moved = draft.source.nodes[rootId]!;
    expect(moved.transform).toEqual([1, 0, 0, 1, 7, -2]);
    expect(definition.source.nodes[rootId]).toBe(original);
    expect(draft.revision).toBe(definition.revision);
  });

  it('rebases a source draft over unrelated queued document edits', () => {
    const { document, definition, rootId } = makeDefinition();
    const draft = translatePatternSourceRoot(definition, rootId, 7, -2);
    const queuedNode = makeShapeNode(
      'queued-node',
      { kind: 'rect', x: 60, y: 30, w: 8, h: 8 },
      { name: 'Concurrent artwork' },
    );
    const current = addNode(document, queuedNode);

    const result = applyPatternSourceDraft(current, draft, document.id, definition.revision);

    expect(result.status).toBe('ready');
    expect(result.document.nodes[queuedNode.id]?.name).toBe('Concurrent artwork');
    const saved = result.document.patternDefinitions?.[definition.id];
    expect(saved?.revision).toBe(definition.revision + 1);
    if (saved?.source.kind !== 'vector') throw new Error('expected vector pattern source');
    expect(saved.source.nodes[rootId]?.transform).toEqual([1, 0, 0, 1, 7, -2]);
  });

  it('rebuilds the committed preview from the latest rebased document', () => {
    const { document, definition, rootId } = makeDefinition();
    const draft = translatePatternSourceRoot(definition, rootId, 7, -2);
    const queuedNode = makeShapeNode(
      'queued-node',
      { kind: 'rect', x: 60, y: 30, w: 8, h: 8 },
      { name: 'Concurrent artwork' },
    );
    const current = addNode(document, queuedNode);
    const previewCompiler = (latest: typeof current, updated: PatternDefinition) =>
      `${latest.nodes[queuedNode.id]?.name}:${updated.revision}`;

    const result = applyPatternSourceDraftWithPreview(
      current,
      draft,
      document.id,
      definition.revision,
      previewCompiler,
    );

    expect(result.status).toBe('ready');
    const saved = result.document.patternDefinitions?.[definition.id];
    expect(saved?.previewSrc).toBe('Concurrent artwork:2');
    expect(saved?.previewRevision).toBe(saved?.revision);
  });

  it('does not save a source draft if its latest preview cannot be rebuilt', () => {
    const { document, definition, rootId } = makeDefinition();
    const draft = translatePatternSourceRoot(definition, rootId, 7, -2);
    const result = applyPatternSourceDraftWithPreview(
      document,
      draft,
      document.id,
      definition.revision,
      () => {
        throw new Error('missing source dependency');
      },
    );

    expect(result.status).toBe('preview-failed');
    expect(result.error).toEqual(new Error('missing source dependency'));
    expect(result.document).toBe(document);
    expect(result.document.patternDefinitions?.[definition.id]).toBe(definition);
  });

  it('rejects a draft when the definition revision changed before commit', () => {
    const { document, definition, rootId } = makeDefinition();
    const draft = translatePatternSourceRoot(definition, rootId, 7, -2);
    const current = applyPatternSourceDraft(
      document,
      translatePatternSourceRoot(definition, rootId, 1, 0),
      document.id,
      definition.revision,
    ).document;

    const result = applyPatternSourceDraft(current, draft, document.id, definition.revision);

    expect(result.status).toBe('stale');
    expect(result.document).toBe(current);
  });

  it('sets rotation on the requested source root and rejects ghost identities', () => {
    const { definition, rootId } = makeDefinition();
    const draft = setPatternSourceRootRotation(definition, rootId, 37.5);

    if (draft.source.kind !== 'vector') throw new Error('expected vector source');
    expect(draft.source.nodes[rootId]?.rotation).toBe(37.5);
    expect(() => translatePatternSourceRoot(definition, 'ghost-0-1', 1, 0)).toThrow(
      /canonical source root/,
    );
  });

  it('rejects non-finite draft transforms', () => {
    const { definition, rootId } = makeDefinition();
    expect(() => translatePatternSourceRoot(definition, rootId, Number.NaN, 0)).toThrow(
      /finite coordinates/,
    );
    expect(() =>
      setPatternSourceRootRotation(definition, rootId, Number.POSITIVE_INFINITY),
    ).toThrow(/finite/);
  });

  it('rejects finite deltas whose resulting transform overflows', () => {
    const { definition, rootId } = makeDefinition();
    if (definition.source.kind !== 'vector') throw new Error('expected vector source');
    const root = definition.source.nodes[rootId]!;
    const overflowing = {
      ...definition,
      source: {
        ...definition.source,
        nodes: {
          ...definition.source.nodes,
          [rootId]: { ...root, transform: [1, 0, 0, 1, Number.MAX_VALUE, 0] },
        },
      },
    } as PatternDefinition;

    expect(() => translatePatternSourceRoot(overflowing, rootId, Number.MAX_VALUE, 0)).toThrow(
      /exceeds finite coordinates/,
    );
  });

  it('rejects a source draft when another document has the same definition ID', () => {
    const { definition } = makeDefinition();
    const originalDocument = createDocument('Original pattern document', true);
    const currentDocument = {
      ...originalDocument,
      id: 'different-document',
      patternDefinitions: { [definition.id]: definition },
    };

    expect(
      getPatternSourceDraftStatus(
        currentDocument,
        definition.id,
        originalDocument.id,
        definition.revision,
      ),
    ).toBe('document-changed');
  });
});
