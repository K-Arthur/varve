import {
  createDocument,
  type Document,
  makeFrameNode,
  type PresentationSlideEntry,
  resolvePresentationSlides,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { resolvePresentationDeliveryScope } from './presentationDeliveryScope';

function entry(id: string, frameId: string, skipped = false): PresentationSlideEntry {
  return { id, frameId, title: id, ...(skipped ? { skipped: true } : {}) };
}

describe('resolvePresentationDeliveryScope', () => {
  it('keeps selected output in deck order, excludes skipped frames, and blocks selected missing refs', () => {
    const first = makeFrameNode('first');
    const second = makeFrameNode('second');
    const third = makeFrameNode('third');
    const omitted = makeFrameNode('omitted', { visible: false });
    const document: Document = {
      ...createDocument('presentation export scope', true),
      nodes: { first, second, third, omitted },
      presentation: {
        schemaVersion: 1,
        layouts: [],
        themes: [],
        decks: [
          {
            id: 'deck',
            name: 'Deck',
            width: 1920,
            height: 1080,
            sections: [],
            slides: [
              entry('first-entry', 'first'),
              entry('missing-entry', 'deleted'),
              entry('skipped-entry', 'second', true),
              entry('second-entry', 'third'),
              entry('hidden-entry', 'omitted'),
            ],
          },
        ],
      },
    };
    const resolution = resolvePresentationSlides(document, 'deck');

    expect(resolvePresentationDeliveryScope(resolution)).toMatchObject({
      selectedScope: false,
      slides: [{ entry: { id: 'first-entry' } }, { entry: { id: 'second-entry' } }],
      deliveryErrors: [{ entry: { id: 'missing-entry' } }],
    });
    expect(
      resolvePresentationDeliveryScope(resolution, [
        'second-entry',
        'missing-entry',
        'skipped-entry',
        'first-entry',
      ]),
    ).toMatchObject({
      selectedScope: true,
      slides: [{ entry: { id: 'first-entry' } }, { entry: { id: 'second-entry' } }],
      deliveryErrors: [{ entry: { id: 'missing-entry' } }],
    });
  });
});
