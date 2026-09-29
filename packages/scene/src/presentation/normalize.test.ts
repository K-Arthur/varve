import { describe, expect, it } from 'vitest';
import { normalizePresentationMetadata } from './normalize';

describe('normalizePresentationMetadata', () => {
  it('preserves missing frame references, order and notes while normalizing unsafe dimensions', () => {
    expect(
      normalizePresentationMetadata({
        schemaVersion: 1,
        decks: [
          {
            id: 'deck',
            name: 'Review',
            width: Number.NaN,
            height: -1,
            slides: [
              { id: 'first', frameId: 'removed-frame', title: 'First', notes: 'Recovery notes' },
              { id: 'second', frameId: 'frame-2', title: 'Second', skipped: true },
            ],
            sections: [],
          },
        ],
      }),
    ).toEqual({
      schemaVersion: 1,
      decks: [
        {
          id: 'deck',
          name: 'Review',
          width: 1920,
          height: 1080,
          slides: [
            { id: 'first', frameId: 'removed-frame', title: 'First', notes: 'Recovery notes' },
            { id: 'second', frameId: 'frame-2', title: 'Second', skipped: true },
          ],
          sections: [],
        },
      ],
      layouts: [],
      themes: [],
    });
  });

  it('declines to rewrite an unknown metadata schema version', () => {
    expect(normalizePresentationMetadata({ schemaVersion: 2, decks: [] })).toBeUndefined();
  });
});
