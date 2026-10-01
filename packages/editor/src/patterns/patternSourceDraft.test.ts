import {
  addNode,
  createDocument,
  createPatternDefinitionFromSelection,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { setPatternSourceRootRotation, translatePatternSourceRoot } from './patternSourceDraft';

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
});
