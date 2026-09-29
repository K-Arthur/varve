import type { Document } from '../document';
import type { NodeId } from '../types';
import {
  PRESENTATION_SCHEMA_VERSION,
  type PresentationDeck,
  type PresentationMetadata,
  type PresentationSection,
  type PresentationSlideEntry,
} from './types';

export function getPresentationMetadata(document: Document): PresentationMetadata {
  return (
    document.presentation ?? {
      schemaVersion: PRESENTATION_SCHEMA_VERSION,
      decks: [],
      layouts: [],
      themes: [],
    }
  );
}

export function findPresentationDeck(
  document: Document,
  deckId: string,
): PresentationDeck | undefined {
  return document.presentation?.decks.find((deck) => deck.id === deckId);
}

function updateDeck(
  document: Document,
  deckId: string,
  update: (deck: PresentationDeck) => PresentationDeck,
): Document {
  const metadata = getPresentationMetadata(document);
  const index = metadata.decks.findIndex((deck) => deck.id === deckId);
  if (index < 0) throw new Error(`presentation deck does not exist: ${deckId}`);
  const decks = [...metadata.decks];
  decks[index] = update(decks[index]!);
  return { ...document, presentation: { ...metadata, decks } };
}

export function addPresentationDeck(document: Document, deck: PresentationDeck): Document {
  const metadata = getPresentationMetadata(document);
  if (metadata.decks.some((candidate) => candidate.id === deck.id)) {
    throw new Error(`presentation deck id already exists: ${deck.id}`);
  }
  return {
    ...document,
    presentation: { ...metadata, decks: [...metadata.decks, deck] },
  };
}

export function removePresentationDeck(document: Document, deckId: string): Document {
  const metadata = getPresentationMetadata(document);
  if (!metadata.decks.some((deck) => deck.id === deckId)) {
    throw new Error(`presentation deck does not exist: ${deckId}`);
  }
  return {
    ...document,
    presentation: {
      ...metadata,
      decks: metadata.decks.filter((deck) => deck.id !== deckId),
    },
  };
}

export function renamePresentationDeck(document: Document, deckId: string, name: string): Document {
  return updateDeck(document, deckId, (deck) => ({ ...deck, name }));
}

export function addPresentationSlide(
  document: Document,
  deckId: string,
  entry: PresentationSlideEntry,
  index?: number,
): Document {
  return updateDeck(document, deckId, (deck) => {
    if (deck.slides.some((slide) => slide.frameId === entry.frameId)) {
      throw new Error(`frame already appears in presentation deck: ${entry.frameId}`);
    }
    if (
      document.presentation?.decks.some((candidate) =>
        candidate.slides.some((slide) => slide.id === entry.id),
      )
    ) {
      throw new Error(`presentation slide entry id already exists: ${entry.id}`);
    }
    if (entry.sectionId && !deck.sections.some((section) => section.id === entry.sectionId)) {
      throw new Error(`presentation section does not exist: ${entry.sectionId}`);
    }
    const insertionIndex = index ?? deck.slides.length;
    if (
      !Number.isInteger(insertionIndex) ||
      insertionIndex < 0 ||
      insertionIndex > deck.slides.length
    ) {
      throw new RangeError(`presentation slide insertion index is out of range: ${insertionIndex}`);
    }
    const slides = [...deck.slides];
    slides.splice(insertionIndex, 0, entry);
    return { ...deck, slides };
  });
}

/** Removes only the deck reference. The ordinary frame and its descendants stay untouched. */
export function removePresentationSlide(
  document: Document,
  deckId: string,
  entryId: string,
): Document {
  return updateDeck(document, deckId, (deck) => {
    if (!deck.slides.some((slide) => slide.id === entryId)) {
      throw new Error(`presentation slide entry does not exist: ${entryId}`);
    }
    return { ...deck, slides: deck.slides.filter((slide) => slide.id !== entryId) };
  });
}

export type PresentationSlideUpdate = Omit<
  Partial<
    Pick<
      PresentationSlideEntry,
      | 'title'
      | 'notes'
      | 'skipped'
      | 'sectionId'
      | 'themeId'
      | 'language'
      | 'altText'
      | 'readingOrder'
    >
  >,
  'notes' | 'sectionId' | 'themeId' | 'language' | 'altText' | 'readingOrder'
> & {
  notes?: string | null;
  sectionId?: string | null;
  themeId?: string | null;
  language?: string | null;
  altText?: string | null;
  readingOrder?: NodeId[] | null;
};

export function updatePresentationSlide(
  document: Document,
  deckId: string,
  entryId: string,
  update: PresentationSlideUpdate,
): Document {
  return updateDeck(document, deckId, (deck) => {
    const index = deck.slides.findIndex((slide) => slide.id === entryId);
    if (index < 0) throw new Error(`presentation slide entry does not exist: ${entryId}`);
    if (update.sectionId && !deck.sections.some((section) => section.id === update.sectionId)) {
      throw new Error(`presentation section does not exist: ${update.sectionId}`);
    }
    const slides = [...deck.slides];
    const old = slides[index]!;
    const next = { ...old, ...update } as unknown as PresentationSlideEntry;
    if (update.sectionId === null) delete next.sectionId;
    if (update.themeId === null) delete next.themeId;
    if (update.notes === null) delete next.notes;
    if (update.language === null) delete next.language;
    if (update.altText === null) delete next.altText;
    if (update.readingOrder === null) delete next.readingOrder;
    slides[index] = next;
    return { ...deck, slides };
  });
}

export function reorderPresentationSlide(
  document: Document,
  deckId: string,
  entryId: string,
  toIndex: number,
): Document {
  return updateDeck(document, deckId, (deck) => {
    const fromIndex = deck.slides.findIndex((slide) => slide.id === entryId);
    if (fromIndex < 0) throw new Error(`presentation slide entry does not exist: ${entryId}`);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= deck.slides.length) {
      throw new RangeError(`presentation slide destination is out of range: ${toIndex}`);
    }
    if (fromIndex === toIndex) return deck;
    const slides = [...deck.slides];
    const [entry] = slides.splice(fromIndex, 1);
    slides.splice(toIndex, 0, entry!);
    return { ...deck, slides };
  });
}

export function addPresentationSection(
  document: Document,
  deckId: string,
  section: PresentationSection,
): Document {
  return updateDeck(document, deckId, (deck) => {
    if (deck.sections.some((candidate) => candidate.id === section.id)) {
      throw new Error(`presentation section id already exists: ${section.id}`);
    }
    return { ...deck, sections: [...deck.sections, section] };
  });
}

export function renamePresentationSection(
  document: Document,
  deckId: string,
  sectionId: string,
  title: string,
): Document {
  return updateDeck(document, deckId, (deck) => {
    if (!deck.sections.some((section) => section.id === sectionId)) {
      throw new Error(`presentation section does not exist: ${sectionId}`);
    }
    return {
      ...deck,
      sections: deck.sections.map((section) =>
        section.id === sectionId ? { ...section, title } : section,
      ),
    };
  });
}

/** Removing a section clears its grouping reference while retaining every slide and its notes. */
export function removePresentationSection(
  document: Document,
  deckId: string,
  sectionId: string,
): Document {
  return updateDeck(document, deckId, (deck) => {
    if (!deck.sections.some((section) => section.id === sectionId)) {
      throw new Error(`presentation section does not exist: ${sectionId}`);
    }
    return {
      ...deck,
      sections: deck.sections.filter((section) => section.id !== sectionId),
      slides: deck.slides.map((slide) => {
        if (slide.sectionId !== sectionId) return slide;
        const { sectionId: _sectionId, ...unsectioned } = slide;
        return unsectioned;
      }),
    };
  });
}

export interface ResolvedPresentationSlide {
  entry: PresentationSlideEntry;
  /** Zero-based index in the explicit deck sequence, including skipped entries. */
  index: number;
  frame: Extract<Document['nodes'][string], { kind: 'frame' }> | null;
  status: 'ready' | 'missing' | 'invalid-frame' | 'duplicate-reference';
  visible: boolean;
  included: boolean;
  /** Other decks that reference the same artwork; sharing never changes order. */
  sharedWithDeckIds: string[];
}

export interface PresentationDeckResolution {
  deck: PresentationDeck | null;
  /** All references in explicit sequence, including skipped and unresolved entries. */
  slides: ResolvedPresentationSlide[];
  /** Valid, visible, non-skipped slides in output and audience order. */
  includedSlides: ResolvedPresentationSlide[];
  /** Included references without renderable frame artwork block delivery. */
  deliveryErrors: ResolvedPresentationSlide[];
}

/**
 * Canonical ordering and inclusion contract for navigation, preflight,
 * audience preview and deck export. Canvas coordinates and paint order are
 * deliberately not inputs to this resolver.
 */
export function resolvePresentationSlides(
  document: Document,
  deckId: string,
): PresentationDeckResolution {
  const deck = findPresentationDeck(document, deckId) ?? null;
  if (!deck) return { deck: null, slides: [], includedSlides: [], deliveryErrors: [] };
  const seenFrames = new Set<NodeId>();
  const slides = deck.slides.map((entry, index): ResolvedPresentationSlide => {
    const node = document.nodes[entry.frameId];
    const isFrame = node?.kind === 'frame' && node.frameRole !== 'exportRegion';
    const duplicate = seenFrames.has(entry.frameId);
    seenFrames.add(entry.frameId);
    const status = duplicate
      ? 'duplicate-reference'
      : !node
        ? 'missing'
        : !isFrame
          ? 'invalid-frame'
          : 'ready';
    const visible = isFrame ? node.visible !== false : false;
    const sharedWithDeckIds = (document.presentation?.decks ?? [])
      .filter(
        (candidate) =>
          candidate.id !== deckId &&
          candidate.slides.some((slide) => slide.frameId === entry.frameId),
      )
      .map((candidate) => candidate.id);
    const frame = isFrame ? node : null;
    return {
      entry,
      index,
      frame,
      status,
      visible,
      included: status === 'ready' && visible && entry.skipped !== true,
      sharedWithDeckIds,
    };
  });
  const includedSlides = slides.filter((slide) => slide.included);
  const deliveryErrors = slides.filter(
    (slide) =>
      slide.status !== 'ready' &&
      slide.entry.skipped !== true &&
      (slide.status === 'missing' || slide.visible),
  );
  return { deck, slides, includedSlides, deliveryErrors };
}
