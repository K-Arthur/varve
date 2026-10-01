import { describe, expect, it } from 'vitest';
import { canonicalHistoryHash, canonicalizeDocument } from '../canonical';
import { createDocument } from '../document';
import { DocumentCodec } from '../documentCodec';
import { migrateDocument } from '../version';

describe('presentation persistence and migration', () => {
  it('migrates v2.30 presentation metadata without losing order or recovery notes', () => {
    const migrated = migrateDocument({
      id: 'deck-doc',
      name: 'Old deck',
      formatVersion: '2.30',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
      presentation: {
        schemaVersion: 1 as const,
        decks: [
          {
            id: 'deck',
            name: 'Recovered',
            width: 1920,
            height: 1080,
            slides: [
              {
                id: 'one',
                frameId: 'missing-frame',
                title: 'First',
                notes: 'Keep presenter notes',
              },
              { id: 'two', frameId: 'frame-2', title: 'Second' },
            ],
            sections: [],
          },
        ],
      },
    });

    expect(migrated?.formatVersion).toBe('2.33');
    expect(migrated?.presentation).toMatchObject({
      schemaVersion: 1,
      decks: [
        {
          id: 'deck',
          slides: [
            { id: 'one', frameId: 'missing-frame', notes: 'Keep presenter notes' },
            { id: 'two', frameId: 'frame-2' },
          ],
        },
      ],
    });
  });

  it('round-trips deck metadata through the document codec', () => {
    const document = {
      ...createDocument('Pitch', true),
      presentation: {
        schemaVersion: 1 as const,
        layouts: [],
        themes: [],
        decks: [
          {
            id: 'deck',
            name: 'Client pitch',
            width: 1920,
            height: 1080,
            slides: [
              { id: 'one', frameId: 'frame-a', title: 'Opening', notes: 'Only for presenter' },
            ],
            sections: [],
          },
        ],
      },
    };
    const result = DocumentCodec.decode(DocumentCodec.encode(document));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.presentation?.decks[0]?.slides[0]).toMatchObject({
        frameId: 'frame-a',
        title: 'Opening',
        notes: 'Only for presenter',
      });
    }
  });

  it('includes titles, order and private notes in the canonical document history hash', () => {
    const document = {
      ...createDocument('Pitch', true),
      presentation: {
        schemaVersion: 1 as const,
        layouts: [],
        themes: [],
        decks: [
          {
            id: 'deck',
            name: 'Pitch',
            width: 1920,
            height: 1080,
            slides: [
              { id: 'slide-a', frameId: 'frame-a', title: 'Opening', notes: 'Private notes' },
              { id: 'slide-b', frameId: 'frame-b', title: 'Evidence' },
            ],
            sections: [],
          },
        ],
      },
    };
    const withOtherNotes = {
      ...document,
      presentation: {
        ...document.presentation,
        decks: document.presentation.decks.map((deck) => ({
          ...deck,
          slides: deck.slides.map((slide) =>
            slide.id === 'slide-a' ? { ...slide, notes: 'Updated private notes' } : slide,
          ),
        })),
      },
    };

    expect(canonicalizeDocument(document)).toContain('Private notes');
    expect(canonicalizeDocument(document)).toBe(canonicalizeDocument(document));
    expect(canonicalHistoryHash(document)).not.toBe(canonicalHistoryHash(withOtherNotes));
  });
});
