import { type Document, resolvePresentationSlides } from '@varve/scene';
import { getActionRegistry } from '../../actions/ActionRegistry';
import type { EditorContextValue } from '../../context';
import {
  documentHasPrototypeContent,
  findPresentableDeck,
  hasPresentationDeck,
  resolvePresentationModeRoute,
} from './presentationMode';

export const CREATE_PRESENTATION_FROM_SELECTION_EVENT = 'varve:presentation:create-from-selection';
export const PRESENTATION_PREVIEW_EVENT = 'varve:presentation:preview';
export const PRESENTATION_PREVIEW_CLOSE_EVENT = 'varve:presentation:preview-close';
export const PRESENTATION_EXPORT_EVENT = 'varve:presentation:export';

/**
 * Presentation playback state owned by the delivery layer.
 *
 * The "Present" action has to know whether deck playback is already running so
 * the same command is a truthful toggle, the way the prototype presenter works.
 * The delivery layer is the only component that owns that state, so it reports
 * it here instead of the command layer trying to reconstruct it from markup.
 */
let previewOpenDeckId: string | null = null;

export function setPresentationPreviewOpen(deckId: string | null): void {
  previewOpenDeckId = deckId;
}

export function presentationPreviewDeckId(): string | null {
  return previewOpenDeckId;
}

/**
 * Slide the user last focused, so "Present" starts where they are looking
 * instead of always at slide 1. Purely a convenience pointer: it never
 * participates in sequence or inclusion decisions.
 */
let focusedSlide: { deckId: string; entryId: string } | null = null;

export function setPresentationFocus(focus: { deckId: string; entryId: string } | null): void {
  focusedSlide = focus;
}

export function presentationFocus(): { deckId: string; entryId: string } | null {
  return focusedSlide;
}

function requestOrderReview(): void {
  window.dispatchEvent(new Event(CREATE_PRESENTATION_FROM_SELECTION_EVENT));
}

function revealDesignSlides(editor: EditorContextValue): void {
  editor.setPanelVisible('layers', true);
  window.setTimeout(requestOrderReview, 0);
}

function startDeckPreview(deckId: string, startEntryId?: string): void {
  window.dispatchEvent(
    new CustomEvent(PRESENTATION_PREVIEW_EVENT, {
      detail: { deckId, ...(startEntryId ? { entryId: startEntryId } : {}) },
    }),
  );
}

function startDeckExport(deckId: string): void {
  window.dispatchEvent(new CustomEvent(PRESENTATION_EXPORT_EVENT, { detail: { deckId } }));
}

/** The deck a deck-scoped action should act on: the presentable one, else the first. */
function activeDeck(document: Document): string | null {
  return findPresentableDeck(document)?.deckId ?? document.presentation?.decks[0]?.id ?? null;
}

function openSlidesPanel(editor: EditorContextValue): void {
  if (editor.state.workspaceMode === 'design') {
    editor.setPanelVisible('layers', true);
    return;
  }
  void editor.requestWorkspaceSwitch('design').then((switched) => {
    if (switched) editor.setPanelVisible('layers', true);
  });
}

/**
 * Register presentation commands without adding presentation imports to editor
 * hubs. Called from `registerEditorActions` so handlers close over a fresh
 * context on every state update.
 */
export function registerPresentationActions(editor: EditorContextValue): void {
  const registry = getActionRegistry();

  const reg = (
    id: string,
    label: string,
    category: 'file' | 'view',
    keywords: string[],
    handler: () => void,
    context?: 'selection',
  ) => {
    if (!registry.updateHandler(id, handler, { placeholder: false })) {
      registry.register(
        { id, label, category, keywords, placeholder: false, ...(context ? { context } : {}) },
        handler,
      );
    } else {
      const action = registry.get(id);
      if (action) {
        action.label = label;
        action.keywords = [...keywords];
        if (context) action.context = context;
      }
    }
  };

  reg(
    'createPresentationFromSelection',
    'Create Presentation from Selected Frames…',
    'file',
    ['slides', 'deck', 'presentation', 'frames', 'sequence', 'storyboard'],
    () => {
      if (editor.state.workspaceMode === 'design') {
        revealDesignSlides(editor);
        return;
      }
      void editor.requestWorkspaceSwitch('design').then((switched) => {
        if (switched) revealDesignSlides(editor);
      });
    },
    'selection',
  );

  reg(
    'presentDeck',
    'Present Deck from Current Slide',
    'view',
    ['slideshow', 'presentation', 'deck', 'play', 'audience', 'slides'],
    () => {
      const deckId = activeDeck(editor.state.document);
      if (!deckId) {
        editor.announce('This document has no presentation deck yet');
        return;
      }
      const focus = presentationFocus();
      startDeckPreview(deckId, focus?.deckId === deckId ? focus.entryId : undefined);
    },
  );

  reg(
    'exportDeck',
    'Export Presentation Deck…',
    'file',
    ['slides', 'deck', 'pdf', 'png', 'handout', 'export', 'presentation'],
    () => {
      const deckId = activeDeck(editor.state.document);
      if (!deckId) {
        editor.announce('This document has no presentation deck yet');
        return;
      }
      startDeckExport(deckId);
    },
  );

  reg(
    'addSelectedFramesToDeck',
    'Add Selected Frames to Presentation Deck',
    'file',
    ['slides', 'deck', 'presentation', 'append', 'frames'],
    () => {
      const remaining = resolvePresentationSlides(
        editor.state.document,
        activeDeck(editor.state.document) ?? '',
      );
      const frameIds = new Set(remaining.deck?.slides.map((slide) => slide.frameId) ?? []);
      const eligible = editor.state.selection.filter((id) => {
        const node = editor.state.document.nodes[id];
        return node?.kind === 'frame' && node.frameRole !== 'exportRegion' && !frameIds.has(id);
      });
      if (eligible.length === 0) {
        editor.announce('Select frames that are not already in this deck');
        return;
      }
      openSlidesPanel(editor);
      window.setTimeout(requestOrderReview, 0);
    },
  );

  // Override, don't duplicate: the generic "Present" command already exists in
  // the menubar, the command palette and the keyboard bindings. Routing it
  // through the deck/prototype decision keeps one entry point with one meaning
  // per document instead of two competing presenters.
  registry.updateHandler(
    'present',
    () => {
      const route = resolvePresentationModeRoute({
        deckPreviewOpen: previewOpenDeckId !== null,
        prototypeRunning: editor.state.isPresenting || editor.state.prototypeMode,
        target: findPresentableDeck(editor.state.document),
        hasAnyDeck: hasPresentationDeck(editor.state.document),
        hasPrototypeContent: documentHasPrototypeContent(editor.state.document),
      });
      switch (route.kind) {
        case 'close-deck-preview':
          window.dispatchEvent(new Event(PRESENTATION_PREVIEW_CLOSE_EVENT));
          return;
        case 'stop-prototype':
          editor.stopPresentation();
          return;
        case 'present-deck': {
          const focus = presentationFocus();
          const startEntryId =
            focus?.deckId === route.target.deckId ? focus.entryId : route.target.startEntryId;
          startDeckPreview(route.target.deckId, startEntryId ?? undefined);
          return;
        }
        case 'present-prototype':
          editor.startPresentation();
          return;
        case 'unavailable':
          editor.announce(route.message);
          return;
      }
    },
    { placeholder: false },
  );

  const present = registry.get('present');
  if (present) {
    present.keywords = [
      ...(present.keywords ?? []),
      'slideshow',
      'deck',
      'audience',
      'play',
      'presentation',
    ];
  }
}
