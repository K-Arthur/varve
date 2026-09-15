import { makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { sceneNodeToEngineNode } from './sceneToEngine';

const reference = {
  artifactHash: 'a'.repeat(64),
  collectionIndex: 2,
  postScriptName: 'SharedSans-Medium',
} as const;

describe('scene text font identity', () => {
  it('keeps the exact face reference on the engine node and primitive', () => {
    const node = makeTextNode('text', 'Exact face', {
      fontFamily: 'Shared Sans',
      fontReference: reference,
    });

    const converted = sceneNodeToEngineNode(node);

    expect(converted.fontReference).toEqual(reference);
    expect((converted.shape as { fontReference?: unknown }).fontReference).toEqual(reference);
  });

  it('keeps exact references on rich-text runs', () => {
    const node = makeTextNode('text', 'Legacy', {
      fontFamily: 'Shared Sans',
      richText: {
        paragraphs: [
          {
            runs: [
              {
                text: 'Exact face',
                format: { fontFamily: 'Shared Sans', fontReference: reference },
              },
            ],
          },
        ],
      },
    });

    const converted = sceneNodeToEngineNode(node);
    const richText = converted.richText;

    expect(richText?.paragraphs[0]?.runs[0]?.format?.fontReference).toEqual(reference);
  });
});
