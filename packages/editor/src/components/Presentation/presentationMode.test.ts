import type { Document } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  documentHasPrototypeContent,
  findPresentableDeck,
  hasPresentationDeck,
  resolvePresentationModeRoute,
} from './presentationMode';

function documentWithDeck(options: {
  frameIds: string[];
  skip?: string[];
  missing?: boolean;
  deckName?: string;
  prototypes?: boolean;
}): Document {
  const nodes: Document['nodes'] = {};
  for (const id of options.frameIds) {
    if (options.missing && id === options.frameIds[0]) continue;
    nodes[id] = {
      id,
      kind: 'frame',
      name: id,
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
      transform: [1, 0, 0, 1, 0, 0],
      rotation: 0,
      children: [],
      visible: true,
    } as unknown as Document['nodes'][string];
  }
  return {
    id: 'doc-1',
    nodes,
    rootChildren: Object.keys(nodes),
    presentation: {
      schemaVersion: 1,
      layouts: [],
      themes: [],
      decks: [
        {
          id: 'deck-1',
          name: options.deckName ?? 'Deck',
          width: 1920,
          height: 1080,
          sections: [],
          slides: options.frameIds.map((frameId, index) => ({
            id: `entry-${index}`,
            frameId,
            title: `Slide ${index + 1}`,
            ...(options.skip?.includes(`entry-${index}`) ? { skipped: true } : {}),
          })),
        },
      ],
    },
    ...(options.prototypes
      ? { interactions: { 'frame-a': [{ id: 'i1', trigger: 'click', action: 'navigate' }] } }
      : {}),
  } as unknown as Document;
}

describe('findPresentableDeck', () => {
  it('returns the first deck with an includable slide and its first entry', () => {
    const document = documentWithDeck({ frameIds: ['frame-a', 'frame-b'] });
    expect(findPresentableDeck(document)).toMatchObject({
      deckId: 'deck-1',
      startEntryId: 'entry-0',
      includedCount: 2,
      brokenCount: 0,
    });
  });

  it('skips the leading skipped slides when choosing the opening slide', () => {
    const document = documentWithDeck({
      frameIds: ['frame-a', 'frame-b', 'frame-c'],
      skip: ['entry-0', 'entry-1'],
    });
    expect(findPresentableDeck(document)?.startEntryId).toBe('entry-2');
    expect(findPresentableDeck(document)?.includedCount).toBe(1);
  });

  it('returns null when every slide is skipped', () => {
    const document = documentWithDeck({
      frameIds: ['frame-a', 'frame-b'],
      skip: ['entry-0', 'entry-1'],
    });
    expect(findPresentableDeck(document)).toBeNull();
  });

  it('reports unresolved included references as broken without dropping them', () => {
    const document = documentWithDeck({ frameIds: ['frame-a', 'frame-b'], missing: true });
    const found = findPresentableDeck(document);
    expect(found?.includedCount).toBe(1);
    expect(found?.brokenCount).toBe(1);
  });

  it('returns null for a document with no presentation metadata', () => {
    expect(findPresentableDeck({ id: 'd', nodes: {} } as unknown as Document)).toBeNull();
    expect(hasPresentationDeck({ id: 'd', nodes: {} } as unknown as Document)).toBe(false);
  });
});

describe('resolvePresentationModeRoute', () => {
  const target = {
    deckId: 'deck-1',
    deckName: 'Deck',
    startEntryId: 'entry-0',
    includedCount: 2,
    brokenCount: 0,
  };

  const base = {
    deckPreviewOpen: false,
    prototypeRunning: false,
    target: null as typeof target | null,
    hasAnyDeck: false,
    hasPrototypeContent: false,
  };

  it('turns deck playback off before anything else', () => {
    expect(
      resolvePresentationModeRoute({
        ...base,
        deckPreviewOpen: true,
        prototypeRunning: true,
        target,
      }),
    ).toEqual({ kind: 'close-deck-preview' });
  });

  it('stops a running prototype presenter', () => {
    expect(
      resolvePresentationModeRoute({ ...base, prototypeRunning: true, hasPrototypeContent: true }),
    ).toEqual({ kind: 'stop-prototype' });
  });

  it('prefers deck playback when the document is a deck', () => {
    expect(resolvePresentationModeRoute({ ...base, target, hasAnyDeck: true })).toEqual({
      kind: 'present-deck',
      target,
    });
  });

  it('explains an empty or all-skipped deck instead of falling through to the prototype', () => {
    const route = resolvePresentationModeRoute({
      ...base,
      hasAnyDeck: true,
      hasPrototypeContent: true,
    });
    expect(route.kind).toBe('unavailable');
    if (route.kind === 'unavailable') {
      expect(route.message).toMatch(/no includable slides/i);
    }
  });

  it('preserves prototype playback for documents without presentation metadata', () => {
    expect(resolvePresentationModeRoute({ ...base, hasPrototypeContent: true })).toEqual({
      kind: 'present-prototype',
    });
  });

  it('reports nothing to present for an empty document', () => {
    const route = resolvePresentationModeRoute(base);
    expect(route.kind).toBe('unavailable');
  });
});

describe('documentHasPrototypeContent', () => {
  it('detects interactions and state machines', () => {
    expect(documentHasPrototypeContent(documentWithDeck({ frameIds: ['a'] }))).toBe(false);
    expect(
      documentHasPrototypeContent(documentWithDeck({ frameIds: ['a'], prototypes: true })),
    ).toBe(true);
    expect(
      documentHasPrototypeContent({
        id: 'd',
        nodes: {},
        stateMachines: { sm1: {} },
      } as unknown as Document),
    ).toBe(true);
  });
});
