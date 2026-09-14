import { FontCatalog, FontResolver } from '@varve/engine/font';
import { addChild, createDocument, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { toFontResolverDocument } from './MissingFontController';

describe('toFontResolverDocument', () => {
  it('keeps authoritative linked stories in missing-font detection input', () => {
    let doc = createDocument('missing-font-story-projection');
    const rootId = doc.pages?.[0]?.contentRoot;
    if (!rootId) throw new Error('fixture page root missing');
    doc = addChild(
      addChild(
        doc,
        rootId,
        makeTextNode('story-frame-a', 'Frame A', { fontFamily: 'Story Missing' }),
      ),
      rootId,
      makeTextNode('story-frame-b', 'Frame B', { fontFamily: 'Story Missing' }),
    );
    const frameA = doc.nodes['story-frame-a'];
    const frameB = doc.nodes['story-frame-b'];
    if (frameA?.kind !== 'text' || frameB?.kind !== 'text') {
      throw new Error('story frame nodes missing');
    }
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        'story-frame-a': {
          ...frameA,
          storyBinding: { storyId: 'story-1', threadIndex: 0 },
        },
        'story-frame-b': {
          ...frameB,
          storyBinding: { storyId: 'story-1', threadIndex: 1 },
        },
      },
      stories: {
        'story-1': {
          id: 'story-1',
          name: 'Linked story',
          thread: ['story-frame-a', 'story-frame-b'],
          content: {
            paragraphs: [
              { runs: [{ text: 'Authoritative copy', format: { fontFamily: 'Story Missing' } }] },
            ],
          },
        },
      },
    };

    const missing = new FontResolver().detectMissing(
      toFontResolverDocument(doc),
      new FontCatalog(),
    );

    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      familyName: 'Story Missing',
      nodeIds: ['story-frame-a', 'story-frame-b'],
    });
  });
});
