import { type Document, resolvePresentationSlides } from '@varve/scene';

/**
 * Presentation mode routing.
 *
 * Varve has two different "present" experiences that must not compete:
 *
 * - **Deck playback**: the ordered slides of `Document.presentation`, shown
 *   through the shared frame-local capture used by thumbnails and export.
 * - **Prototype playback**: an interactive frame graph with triggers, actions,
 *   transitions and state machines (the pre-existing presenter).
 *
 * Which one a generic "Present" command means is a property of the *document*,
 * not of the surface that invoked it. This module is the single decision point
 * so the menubar, command palette, keyboard shortcut and the Slides navigator
 * cannot drift apart. It is pure so the rules are unit-testable without a
 * mounted editor.
 */

export interface PresentableDeck {
  deckId: string;
  deckName: string;
  /** First included slide, or null when the deck is empty or all-skipped. */
  startEntryId: string | null;
  includedCount: number;
  /** Entries that must be repaired before they can be delivered. */
  brokenCount: number;
}

export type PresentationModeRoute =
  | { kind: 'close-deck-preview' }
  | { kind: 'stop-prototype' }
  | { kind: 'present-deck'; target: PresentableDeck }
  | { kind: 'unavailable'; message: string }
  | { kind: 'present-prototype' };

export interface PresentationModeInput {
  /** True while the audience preview for a deck is open. */
  deckPreviewOpen: boolean;
  /** True while the prototype presenter is running. */
  prototypeRunning: boolean;
  /** Result of {@link findPresentableDeck} for the active document. */
  target: PresentableDeck | null;
  /** True when the document declares at least one deck, presentable or not. */
  hasAnyDeck: boolean;
  /** Whether the document carries prototype wiring the presenter can run. */
  hasPrototypeContent: boolean;
}

/** First deck whose sequence contains at least one includable slide. */
export function findPresentableDeck(document: Document): PresentableDeck | null {
  for (const deck of document.presentation?.decks ?? []) {
    const resolution = resolvePresentationSlides(document, deck.id);
    if (resolution.includedSlides.length > 0) {
      return {
        deckId: deck.id,
        deckName: deck.name,
        startEntryId: resolution.includedSlides[0]!.entry.id,
        includedCount: resolution.includedSlides.length,
        brokenCount: resolution.deliveryErrors.length,
      };
    }
  }
  return null;
}

export function hasPresentationDeck(document: Document): boolean {
  return (document.presentation?.decks.length ?? 0) > 0;
}

/**
 * Whether the prototype presenter has anything to run.
 *
 * A prototype with no interactions still "presents" its entry frame, but
 * presenting an empty document is never useful, so this only reports content
 * the author actually wired.
 */
export function documentHasPrototypeContent(document: Document): boolean {
  const interactions = document.interactions;
  if (interactions) {
    for (const list of Object.values(interactions)) {
      if (list && list.length > 0) return true;
    }
  }
  return Object.keys(document.stateMachines ?? {}).length > 0;
}

/**
 * Resolve a "Present" request.
 *
 * Order matters: turning the current presentation *off* always wins, so the
 * same command is a truthful toggle. Deck playback is preferred whenever the
 * document is a deck; prototype playback remains the fallback so documents
 * without presentation metadata behave exactly as before.
 */
export function resolvePresentationModeRoute(input: PresentationModeInput): PresentationModeRoute {
  if (input.deckPreviewOpen) return { kind: 'close-deck-preview' };
  if (input.prototypeRunning) return { kind: 'stop-prototype' };
  if (input.target) return { kind: 'present-deck', target: input.target };
  if (input.hasAnyDeck) {
    return {
      kind: 'unavailable',
      message:
        'This presentation has no includable slides. Add a slide, or unskip one in the Slides panel.',
    };
  }
  if (input.hasPrototypeContent) return { kind: 'present-prototype' };
  return {
    kind: 'unavailable',
    message: 'Nothing to present yet. Create a presentation or add prototype connections.',
  };
}
