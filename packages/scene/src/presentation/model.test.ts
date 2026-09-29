import { describe, expect, it } from 'vitest';
import { createDocument, makeFrameNode } from '../document';
import {
  addPresentationDeck,
  addPresentationSection,
  addPresentationSlide,
  getPresentationMetadata,
  removePresentationDeck,
  removePresentationSection,
  removePresentationSlide,
  reorderPresentationSlide,
  resolvePresentationSlides,
  updatePresentationSlide,
} from './model';
import type { PresentationDeck, PresentationSlideEntry } from './types';

function slide(
  id: string,
  frameId: string,
  patch: Partial<PresentationSlideEntry> = {},
): PresentationSlideEntry {
  return { id, frameId, title: id, ...patch };
}

function deck(id: string, slides: PresentationSlideEntry[] = []): PresentationDeck {
  return { id, name: id, width: 1920, height: 1080, slides, sections: [] };
}

function withFrames(...frames: ReturnType<typeof makeFrameNode>[]) {
  const document = createDocument('Presentation model', true);
  return { ...document, nodes: Object.fromEntries(frames.map((frame) => [frame.id, frame])) };
}

describe('presentation deck model', () => {
  it('uses explicit entry order, excludes hidden and skipped frames, and reports missing refs', () => {
    const document = withFrames(
      makeFrameNode('frame-a', { order: 'z0' }),
      makeFrameNode('frame-b', { order: 'a0' }),
      makeFrameNode('frame-hidden', { visible: false }),
    );
    const withDeck = addPresentationDeck(
      document,
      deck('deck', [
        slide('slide-b', 'frame-b'),
        slide('slide-missing', 'deleted-frame', { notes: 'Keep these notes for recovery.' }),
        slide('slide-hidden', 'frame-hidden'),
        slide('slide-skipped', 'frame-a', { skipped: true }),
      ]),
    );

    const result = resolvePresentationSlides(withDeck, 'deck');

    expect(result.slides.map(({ entry }) => entry.id)).toEqual([
      'slide-b',
      'slide-missing',
      'slide-hidden',
      'slide-skipped',
    ]);
    expect(result.includedSlides.map(({ entry }) => entry.id)).toEqual(['slide-b']);
    expect(result.deliveryErrors.map(({ entry }) => entry.id)).toEqual(['slide-missing']);
    expect(result.slides[1]).toMatchObject({
      status: 'missing',
      entry: { notes: 'Keep these notes for recovery.' },
    });
  });

  it('allows artwork in multiple decks and reports shared use without sharing order', () => {
    const document = withFrames(makeFrameNode('frame-a'), makeFrameNode('frame-b'));
    const first = addPresentationDeck(document, deck('first', [slide('first-a', 'frame-a')]));
    const second = addPresentationDeck(first, deck('second', [slide('second-b', 'frame-b')]));
    const third = addPresentationSlide(second, 'second', slide('second-a', 'frame-a'), 0);

    expect(resolvePresentationSlides(third, 'first').slides[0]?.sharedWithDeckIds).toEqual([
      'second',
    ]);
    expect(
      resolvePresentationSlides(third, 'second').slides.map(({ entry }) => entry.frameId),
    ).toEqual(['frame-a', 'frame-b']);
  });

  it('rejects duplicate artwork references within one deck but allows a broken imported reference', () => {
    const document = addPresentationDeck(withFrames(makeFrameNode('frame-a')), deck('deck'));
    const populated = addPresentationSlide(document, 'deck', slide('one', 'frame-a'));

    expect(() => addPresentationSlide(populated, 'deck', slide('two', 'frame-a'))).toThrow(
      'frame already appears in presentation deck',
    );
    const legacyLike = addPresentationSlide(populated, 'deck', slide('broken', 'missing-frame'));
    expect(resolvePresentationSlides(legacyLike, 'deck').deliveryErrors[0]?.status).toBe('missing');
  });

  it('reorders entries independently from canvas order and updates notes/skip metadata', () => {
    const document = withFrames(
      makeFrameNode('frame-a', { order: 'z0' }),
      makeFrameNode('frame-b', { order: 'a0' }),
    );
    let next = addPresentationDeck(document, deck('deck'));
    next = addPresentationSlide(next, 'deck', slide('one', 'frame-a'));
    next = addPresentationSlide(next, 'deck', slide('two', 'frame-b'));
    next = reorderPresentationSlide(next, 'deck', 'one', 1);
    next = updatePresentationSlide(next, 'deck', 'one', {
      title: 'Opening',
      notes: 'Private presenter notes',
      skipped: true,
    });

    expect(resolvePresentationSlides(next, 'deck').slides.map(({ entry }) => entry.title)).toEqual([
      'two',
      'Opening',
    ]);
    expect(
      resolvePresentationSlides(next, 'deck').includedSlides.map(({ entry }) => entry.id),
    ).toEqual(['two']);
    expect(next.presentation?.decks[0]?.slides[1]).toMatchObject({
      notes: 'Private presenter notes',
      skipped: true,
    });
  });

  it('removes a slide reference and a section without deleting artwork or losing notes', () => {
    const document = withFrames(makeFrameNode('frame-a'));
    let next = addPresentationDeck(
      document,
      deck('deck', [slide('slide', 'frame-a', { notes: 'Notes' })]),
    );
    next = addPresentationSection(next, 'deck', { id: 'section', title: 'Opening' });
    next = updatePresentationSlide(next, 'deck', 'slide', { sectionId: 'section' });
    next = removePresentationSection(next, 'deck', 'section');
    expect(next.presentation?.decks[0]?.slides[0]).toMatchObject({ notes: 'Notes' });
    expect(next.presentation?.decks[0]?.slides[0]?.sectionId).toBeUndefined();

    const withoutReference = removePresentationSlide(next, 'deck', 'slide');
    expect(withoutReference.nodes['frame-a']).toBeDefined();
    expect(resolvePresentationSlides(withoutReference, 'deck').slides).toHaveLength(0);
    expect(getPresentationMetadata(removePresentationDeck(next, 'deck')).decks).toEqual([]);
  });

  it('marks duplicate deck references as a delivery error instead of silently changing order', () => {
    const document = withFrames(makeFrameNode('frame-a'));
    const broken = addPresentationDeck(
      document,
      deck('deck', [slide('first', 'frame-a'), slide('duplicate', 'frame-a')]),
    );

    expect(resolvePresentationSlides(broken, 'deck').slides.map(({ status }) => status)).toEqual([
      'ready',
      'duplicate-reference',
    ]);
    expect(resolvePresentationSlides(broken, 'deck').deliveryErrors).toHaveLength(1);
  });
});
