/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  applyOperation,
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  registerBuiltinOperations,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { PresentationNavigator } from './PresentationNavigator';
import { CREATE_PRESENTATION_FROM_SELECTION_EVENT } from './presentationCommands';

vi.mock('../../context', () => ({ useEditor: vi.fn() }));
vi.mock('./PresentationThumbnail', () => ({
  PresentationThumbnail: () => <span aria-hidden="true">Slide thumbnail</span>,
}));

registerBuiltinOperations();
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeDocument(): Document {
  const frameA = makeFrameNode('frame-a', { name: 'Alpha', w: 1920, h: 1080 });
  const frameB = makeFrameNode('frame-b', { name: 'Beta', w: 1920, h: 1080 });
  return {
    ...createDocument('Presentation navigator test', true),
    nodes: { [frameA.id]: frameA, [frameB.id]: frameB },
  };
}

function addDeck(document: Document): Document {
  let next = applyOperation(document, 'presentation.deck.create', {
    id: 'deck-a',
    name: 'Research update',
    width: 1920,
    height: 1080,
  });
  next = applyOperation(next, 'presentation.slide.add', {
    deckId: 'deck-a',
    entry: { id: 'slide-b', frameId: 'frame-b', title: 'Beta' },
  });
  return applyOperation(next, 'presentation.slide.add', {
    deckId: 'deck-a',
    entry: { id: 'slide-a', frameId: 'frame-a', title: 'Alpha' },
  });
}

function mockEditor(document: Document, selection: string[] = []) {
  let currentDocument = document;
  const editorState = { document, selection, workspaceMode: 'design' };
  const updateDoc = vi.fn((update: (value: Document) => Document) => {
    currentDocument = update(currentDocument);
    editorState.document = currentDocument;
  });
  const groupCompoundOperation = vi.fn((_label: string, action: () => void) => action());
  const value = {
    state: editorState,
    updateDoc,
    groupCompoundOperation,
    setSelection: vi.fn(),
    setSelectionRefs: vi.fn(),
    revealSelection: vi.fn(),
    enterIsolation: vi.fn(),
    exitIsolation: vi.fn(),
    announce: vi.fn(),
  };
  vi.mocked(useEditor).mockReturnValue(value as unknown as ReturnType<typeof useEditor>);
  return {
    value,
    updateDoc,
    groupCompoundOperation,
    get document() {
      return currentDocument;
    },
  };
}

/** Create a brand theme and apply it, the way the UI does. */
function withTheme(document: Document): Document {
  const themed = applyOperation(document, 'presentation.theme.create', {
    id: 'theme-brand',
    name: 'Brand',
  });
  return applyOperation(themed, 'presentation.theme.apply', {
    deckId: 'deck-a',
    entryId: 'entry-a',
    themeId: 'theme-brand',
  });
}

/** Slide with a layout binding so theme roles resolve to real slide objects. */
function themedSlideDocument(): Document {
  const title = makeTextNode('title-node', 'Headline', {
    name: 'Headline',
    transform: [1, 0, 0, 1, 88, 174],
    fill: { space: 'rgb', r: 28, g: 28, b: 28, a: 255 },
    fontSize: 78,
  });
  const accent = makeShapeNode(
    'accent-node',
    { kind: 'rect', x: 88, y: 76, w: 6, h: 40 },
    { name: 'Stratum 1', transform: [1, 0, 0, 1, 88, 76] },
  );
  const frame = makeFrameNode('slide-frame', {
    name: 'Title slide',
    w: 1280,
    h: 720,
    transform: [1, 0, 0, 1, 0, 0],
    children: [title.id, accent.id],
  });
  let next: Document = {
    ...createDocument('Theme navigator test', true),
    nodes: Object.fromEntries([title, accent, frame].map((node) => [node.id, node])),
    rootChildren: [frame.id],
  };
  next = applyOperation(next, 'presentation.deck.create', {
    id: 'deck-a',
    name: 'Research update',
    width: 1280,
    height: 720,
  });
  next = applyOperation(next, 'presentation.slide.add', {
    deckId: 'deck-a',
    entry: { id: 'entry-a', frameId: frame.id, title: 'Opening' },
  });
  const decks = next.presentation!.decks.map((deck) => ({
    ...deck,
    slides: deck.slides.map((slide) => ({
      ...slide,
      layoutBinding: {
        sourceId: 'layout-x',
        sourceFrameId: 'source-frame',
        appliedRevision: 1,
        roleNodes: { title: title.id, accent: accent.id },
        managedBaseline: {},
      },
    })),
  }));
  return { ...next, presentation: { ...next.presentation!, decks } };
}

describe('PresentationNavigator', () => {
  it('uses explicit deck sequence and exposes editable notes and skip state', async () => {
    const user = userEvent.setup();
    const editor = mockEditor(addDeck(makeDocument()));
    render(<PresentationNavigator />);

    const rows = screen.getByRole('list', { name: 'Slides in presentation order' });
    expect(
      within(rows)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining('Beta'), expect.stringContaining('Alpha')]);
    const firstSlide = within(rows).getAllByRole('listitem')[0]!;
    await user.click(within(firstSlide).getByRole('button', { name: 'Skip' }));
    expect(editor.document.presentation?.decks[0]?.slides[0]?.skipped).toBe(true);

    const notes = screen.getAllByLabelText('Speaker notes (private)')[0]!;
    fireEvent.change(notes, { target: { value: 'Presenter only' } });
    fireEvent.blur(notes);
    expect(editor.document.presentation?.decks[0]?.slides[0]?.notes).toBe('Presenter only');
  });

  it('reviews selected-frame order before creating a typed deck transaction', async () => {
    const user = userEvent.setup();
    const editor = mockEditor(makeDocument(), ['frame-b', 'frame-a']);
    render(<PresentationNavigator />);

    await user.click(
      screen.getByRole('button', { name: 'Create presentation from selected frames' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Review presentation order' });
    expect(within(dialog).getByRole('textbox', { name: 'Slide 1 title' })).toHaveValue('Beta');
    expect(within(dialog).getByRole('textbox', { name: 'Slide 2 title' })).toHaveValue('Alpha');
    await user.click(within(dialog).getByRole('button', { name: 'Move slide 2 earlier' }));
    expect(within(dialog).getByRole('textbox', { name: 'Slide 1 title' })).toHaveValue('Alpha');
    await user.click(within(dialog).getByRole('button', { name: 'Create presentation' }));

    const deck = editor.document.presentation?.decks[0];
    expect(deck?.name).toBe('New presentation');
    expect(deck?.slides.map((slide) => slide.frameId)).toEqual(['frame-a', 'frame-b']);
    expect(editor.groupCompoundOperation).toHaveBeenCalledTimes(1);
    expect(editor.groupCompoundOperation).toHaveBeenCalledWith(
      'Create presentation from frames',
      expect.any(Function),
    );
  });

  it('opens order review from the registered presentation command event', async () => {
    mockEditor(makeDocument(), ['frame-a', 'frame-b']);
    render(<PresentationNavigator />);

    window.dispatchEvent(new Event(CREATE_PRESENTATION_FROM_SELECTION_EVENT));

    expect(await screen.findByRole('dialog', { name: 'Review presentation order' })).toBeVisible();
  });

  it('adds reviewed selected frames to an existing deck without repeating references', async () => {
    const user = userEvent.setup();
    const document = makeDocument();
    const frameC = makeFrameNode('frame-c', { name: 'Gamma', w: 1920, h: 1080 });
    const withThirdFrame = {
      ...document,
      nodes: { ...document.nodes, [frameC.id]: frameC },
    };
    const editor = mockEditor(addDeck(withThirdFrame), ['frame-c']);
    render(<PresentationNavigator />);

    await user.click(screen.getByRole('button', { name: 'Add selected frames' }));
    const dialog = screen.getByRole('dialog', { name: 'Review added slide order' });
    expect(within(dialog).getByRole('textbox', { name: 'Slide 1 title' })).toHaveValue('Gamma');
    await user.click(within(dialog).getByRole('button', { name: 'Add slides' }));

    expect(editor.document.presentation?.decks[0]?.slides.map((slide) => slide.frameId)).toEqual([
      'frame-b',
      'frame-a',
      'frame-c',
    ]);
    expect(editor.groupCompoundOperation).toHaveBeenCalledWith(
      'Add frames to presentation',
      expect.any(Function),
    );
  });

  it('removes only a slide reference and leaves its frame artwork in the document', async () => {
    const user = userEvent.setup();
    const editor = mockEditor(addDeck(makeDocument()));
    render(<PresentationNavigator />);

    await user.click(screen.getByRole('button', { name: 'Remove Beta from deck' }));
    expect(editor.document.presentation?.decks[0]?.slides.map((slide) => slide.frameId)).toEqual([
      'frame-a',
    ]);
    expect(editor.document.nodes['frame-b']).toMatchObject({ kind: 'frame', name: 'Beta' });
  });

  it('duplicates a slide by deep-cloning its frame instead of sharing the original frame', async () => {
    const user = userEvent.setup();
    const editor = mockEditor(addDeck(makeDocument()));
    render(<PresentationNavigator />);

    const betaRow = within(
      screen.getByRole('list', { name: 'Slides in presentation order' }),
    ).getAllByRole('listitem')[0]!;
    await user.click(within(betaRow).getByRole('button', { name: 'Duplicate' }));

    const deck = editor.document.presentation?.decks[0];
    expect(deck?.slides).toHaveLength(3);
    expect(deck?.slides[1]).toMatchObject({ title: 'Beta copy' });
    const duplicateFrameId = deck?.slides[1]?.frameId;
    expect(duplicateFrameId).not.toBe('frame-b');
    expect(editor.document.nodes[duplicateFrameId ?? '']).toMatchObject({
      kind: 'frame',
      name: 'Beta copy',
    });
    expect(editor.document.nodes['frame-b']).toMatchObject({ kind: 'frame', name: 'Beta' });
    expect(editor.groupCompoundOperation).toHaveBeenCalledWith(
      'Duplicate presentation slide',
      expect.any(Function),
    );
  });

  it('applies multi-slide skip and remove actions as grouped operations', async () => {
    const user = userEvent.setup();
    const editor = mockEditor(addDeck(makeDocument()));
    render(<PresentationNavigator />);

    await user.click(screen.getByRole('checkbox', { name: 'Select Beta for multi-slide actions' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Select Alpha for multi-slide actions' }),
    );
    await user.click(screen.getByRole('button', { name: 'Skip selected' }));
    expect(editor.document.presentation?.decks[0]?.slides.every((slide) => slide.skipped)).toBe(
      true,
    );
    expect(editor.groupCompoundOperation).toHaveBeenCalledWith(
      'Skip selected presentation slides',
      expect.any(Function),
    );

    await user.click(screen.getByRole('button', { name: 'Remove selected' }));
    expect(editor.document.presentation?.decks[0]?.slides).toHaveLength(0);
    expect(Object.keys(editor.document.nodes)).toEqual(['frame-a', 'frame-b']);
  });

  it('keeps Present and Export reachable when every slide is skipped', () => {
    const document = applyOperation(addDeck(makeDocument()), 'presentation.slide.update', {
      deckId: 'deck-a',
      entryId: 'slide-b',
      update: { skipped: true },
    });
    const allSkipped = applyOperation(document, 'presentation.slide.update', {
      deckId: 'deck-a',
      entryId: 'slide-a',
      update: { skipped: true },
    });
    mockEditor(allSkipped);
    render(<PresentationNavigator />);

    expect(screen.getByRole('button', { name: 'Present' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export deck…' })).toBeEnabled();
  });

  it('creates and renames sections without changing slide artwork', async () => {
    const user = userEvent.setup();
    const editor = mockEditor(addDeck(makeDocument()));
    const view = render(<PresentationNavigator />);

    await user.click(screen.getByText('Sections'));
    await user.type(screen.getByRole('textbox', { name: 'New section' }), 'Opening');
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    expect(editor.document.presentation?.decks[0]?.sections).toEqual([
      expect.objectContaining({ title: 'Opening' }),
    ]);

    view.rerender(<PresentationNavigator />);
    const rename = screen.getByRole('textbox', { name: 'Rename section Opening' });
    fireEvent.change(rename, { target: { value: 'Introduction' } });
    fireEvent.blur(rename);
    expect(editor.document.presentation?.decks[0]?.sections[0]?.title).toBe('Introduction');
    expect(Object.keys(editor.document.nodes)).toEqual(['frame-a', 'frame-b']);
  });

  it('converts the deck slide size only after an explicit preview', async () => {
    const user = userEvent.setup();
    const editor = mockEditor(addDeck(makeDocument()));
    render(<PresentationNavigator showDetach />);

    await user.click(screen.getByText(/Slide size/));
    const preset = screen.getByRole('combobox', { name: 'Slide size preset' });
    await user.selectOptions(preset, 'classic');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Slide size mode' }), 'fit');

    await user.click(screen.getByRole('button', { name: 'Review slide size change…' }));
    const dialog = screen.getByRole('dialog', { name: 'Review slide size change' });
    expect(dialog.textContent).toContain('1920 x 1080');
    expect(dialog.textContent).toContain('1440 x 1080');
    expect(dialog.textContent).toMatch(/one undo step/);
    expect(dialog.textContent).toMatch(/Frames keep their position on the canvas/);

    // Nothing has changed yet: preview is side-effect free.
    expect(editor.document.presentation!.decks[0]).toMatchObject({ width: 1920, height: 1080 });
    expect(editor.value.announce).not.toHaveBeenCalledWith(
      expect.stringContaining('Slide size changed'),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Change slide size' }));
    expect(editor.value.groupCompoundOperation).toHaveBeenCalledWith(
      'Change slide size',
      expect.any(Function),
    );
    expect(editor.document.presentation!.decks[0]).toMatchObject({ width: 1440, height: 1080 });
    const frame = editor.document.nodes['frame-a'];
    expect(frame?.kind === 'frame' ? { w: frame.w, h: frame.h } : null).toEqual({
      w: 1440,
      h: 1080,
    });
    expect(editor.value.announce).toHaveBeenCalledWith(expect.stringContaining('1440 x 1080'));
    expect(screen.queryByRole('dialog', { name: 'Review slide size change' })).toBeNull();
  });

  it('creates a theme from the slide with ordinary document variables', async () => {
    const user = userEvent.setup();
    const editor = mockEditor(themedSlideDocument());
    render(<PresentationNavigator showDetach />);

    await user.click(screen.getByText(/Theme/));
    await user.click(screen.getByRole('button', { name: 'Create theme from this slide' }));

    expect(editor.value.groupCompoundOperation).toHaveBeenCalledTimes(1);
    const presentation = editor.document.presentation!;
    expect(presentation.themes).toHaveLength(1);
    expect(Object.keys(presentation.themes[0]!.colorVariables)).toHaveLength(6);

    // The colours live in the document variable store, not in a parallel system.
    const accentVariableId = presentation.themes[0]!.colorVariables.accent!;
    expect(editor.document.variableStore!.variables[accentVariableId]).toBeDefined();
    expect(presentation.decks[0]!.slides[0]!.themeId).toBe(presentation.themes[0]!.id);
    expect(editor.document.nodes['accent-node']?.bindings?.fill?.variableId).toBe(accentVariableId);
  });

  it('shows linked versus not-used roles for a themed slide', () => {
    mockEditor(withTheme(themedSlideDocument()));
    render(<PresentationNavigator showDetach />);

    // title and accent follow the theme; the other four roles are unused.
    const roleStatus = screen.getByRole('list', { name: 'Theme role status' });
    expect(within(roleStatus).getAllByText('Linked to theme')).toHaveLength(2);
    expect(within(roleStatus).getAllByText('Not used')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Detach theme' })).toBeEnabled();

    const summary = screen.getByText('Theme').closest('summary') as HTMLElement;
    expect(summary.textContent).toContain('Brand');
  });
});
