import { describe, expect, it } from 'vitest';
import { applyBindingsToNode } from '../bindings';
import type { ManagedColor } from '../colorManagement';
import {
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  updateVariableInDocument,
} from '../document';
import { DocumentCodec } from '../documentCodec';
import {
  applyOperation,
  preconditionFailure,
  registerBuiltinOperations,
  validatePayload,
} from '../operations';
import { normalizePresentationMetadata } from './normalize';
import {
  applyPresentationTheme,
  createPresentationTheme,
  DEFAULT_THEME_COLORS,
  describePresentationTheme,
  PRESENTATION_THEME_ROLES,
  removePresentationTheme,
  sampleThemeColors,
  unlinkPresentationTheme,
} from './themes';

registerBuiltinOperations();

const TEAL: ManagedColor = { space: 'rgb', r: 30, g: 122, b: 138, a: 255 };
const INK: ManagedColor = { space: 'rgb', r: 28, g: 28, b: 28, a: 255 };
const MUTED: ManagedColor = { space: 'rgb', r: 90, g: 90, b: 90, a: 255 };

function makeSlideDocument() {
  const title = makeTextNode('title-node', 'A better story', {
    name: 'Headline',
    transform: [1, 0, 0, 1, 88, 174],
    fill: INK,
    fontSize: 78,
  });
  const body = makeTextNode('body-node', 'Supporting copy', {
    name: 'Supporting copy',
    transform: [1, 0, 0, 1, 92, 492],
    fill: MUTED,
    fontSize: 26,
  });
  const accent = makeShapeNode(
    'accent-node',
    { kind: 'rect', x: 88, y: 76, w: 6, h: 40 },
    { name: 'Stratum 1', transform: [1, 0, 0, 1, 88, 76], fill: TEAL },
  );
  const frame = makeFrameNode('slide-frame', {
    name: 'Title slide',
    w: 1280,
    h: 720,
    transform: [1, 0, 0, 1, 0, 0],
    children: [title.id, body.id, accent.id],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
  });
  let document: Document = {
    ...createDocument('Theme test', true),
    nodes: Object.fromEntries([title, body, accent, frame].map((node) => [node.id, node])),
    rootChildren: [frame.id],
  };
  document = applyOperation(document, 'presentation.deck.create', {
    id: 'deck',
    name: 'Deck',
    width: 1280,
    height: 720,
  });
  document = applyOperation(document, 'presentation.slide.add', {
    deckId: 'deck',
    entry: { id: 'entry', frameId: frame.id, title: 'Opening' },
  });
  return document;
}

const ROLE_MAP = { title: 'title-node', body: 'body-node', accent: 'accent-node' } as const;

function themedDocument(colors?: Record<string, string>) {
  const document = withLayoutBinding(makeSlideDocument());
  const withTheme = createPresentationTheme(document, {
    id: 'theme-brand',
    name: 'Brand',
    ...(colors ? { colors } : {}),
  });
  return applyPresentationTheme(withTheme, 'deck', 'entry', 'theme-brand', ROLE_MAP);
}

/** Give the slide a layout binding so role mapping comes from real metadata. */
function withLayoutBinding(document: Document): Document {
  const metadata = document.presentation!;
  const decks = metadata.decks.map((deck) =>
    deck.id !== 'deck'
      ? deck
      : {
          ...deck,
          slides: deck.slides.map((slide) =>
            slide.id !== 'entry'
              ? slide
              : {
                  ...slide,
                  layoutBinding: {
                    sourceId: 'layout-x',
                    sourceFrameId: 'source-frame',
                    appliedRevision: 1,
                    roleNodes: { ...ROLE_MAP },
                    managedBaseline: {},
                  },
                },
          ),
        },
  );
  return { ...document, presentation: { ...metadata, decks, layouts: [] } };
}

describe('presentation themes', () => {
  it('creates one document colour variable per role, not a parallel colour system', () => {
    const document = createPresentationTheme(withLayoutBinding(makeSlideDocument()), {
      id: 'theme-brand',
      name: 'Brand',
      colors: { accent: '#00ff00' },
    });
    const theme = document.presentation!.themes[0]!;
    expect(theme.name).toBe('Brand');
    expect(Object.keys(theme.colorVariables).sort()).toEqual([...PRESENTATION_THEME_ROLES].sort());

    const store = document.variableStore!;
    for (const [role, variableId] of Object.entries(theme.colorVariables)) {
      const variable = store.variables[variableId];
      expect(variable, `missing variable for ${role}`).toBeDefined();
      expect(variable?.type).toBe('color');
      expect(variable?.valuesByMode.default).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(store.variables[theme.colorVariables.accent!]?.valuesByMode.default).toBe('#00ff00');
    expect(store.variables[theme.colorVariables.title!]?.valuesByMode.default).toBe(
      DEFAULT_THEME_COLORS.title,
    );
  });

  it('rejects duplicate ids and empty names', () => {
    const document = withLayoutBinding(makeSlideDocument());
    const theme = createPresentationTheme(document, { id: 't1', name: 'One' });
    expect(() => createPresentationTheme(theme, { id: 't1', name: 'Two' })).toThrow(
      /already exists/,
    );
    expect(() => createPresentationTheme(theme, { id: 't2', name: '   ' })).toThrow(/name/);
    expect(() => removePresentationTheme(theme, 'missing')).toThrow(/does not exist/);
    expect(removePresentationTheme(theme, 't1').presentation!.themes).toHaveLength(0);
  });

  it('samples the slide it is looking at instead of inventing a palette', () => {
    const document = makeSlideDocument();
    const colors = sampleThemeColors(document, 'slide-frame');
    expect(colors.title).toBe('#1c1c1c');
    expect(colors.body).toBe('#5a5a5a');
    expect(colors.accent).toBe('#1e7a8a');
    expect(colors.background).toBe('#ffffff');
    expect(sampleThemeColors(document, 'missing-frame')).toEqual({});
  });

  it('binds mapped objects on the first apply and records the slide theme', () => {
    const document = themedDocument();
    const slide = document.presentation!.decks[0]!.slides[0]!;
    expect(slide.themeId).toBe('theme-brand');
    expect(document.presentation!.decks[0]!.themeId).toBe('theme-brand');
    expect(document.nodes['title-node']?.bindings?.fill?.variableId).toBe(
      document.presentation!.themes[0]!.colorVariables.title,
    );
    expect(document.nodes['accent-node']?.bindings?.fill?.variableId).toBe(
      document.presentation!.themes[0]!.colorVariables.accent,
    );
    const state = describePresentationTheme(document, 'deck', 'entry', 'theme-brand', ROLE_MAP);
    expect(state.linkedCount).toBe(3);
    expect(state.localCount).toBe(0);
    expect(state.roles.map((role) => role.status)).toEqual([
      'linked',
      'unmapped',
      'linked',
      'unmapped',
      'linked',
      'unmapped',
    ]);
  });

  it('changes the brand globally through the existing variable pipeline', () => {
    let document = themedDocument();
    const store = document.variableStore!;
    const accentVariableId = document.presentation!.themes[0]!.colorVariables.accent!;

    // First resolution follows the theme colour.
    const before = applyBindingsToNode(document.nodes['accent-node']!, store);
    const beforeFill = (before as { fill?: { r: number; g: number; b: number } }).fill;
    expect(beforeFill).toMatchObject({ r: 30, g: 122, b: 138 });

    // Editing the document variable is the whole brand change.
    document = updateVariableInDocument(document, accentVariableId, {
      valuesByMode: { default: '#ff6600' },
    });
    const after = applyBindingsToNode(document.nodes['accent-node']!, document.variableStore);
    const afterFill = (after as { fill?: { r: number; g: number; b: number } }).fill;
    expect(afterFill).toMatchObject({ r: 255, g: 102, b: 0 });

    // The slide itself still references the theme; nothing was flattened.
    expect(document.presentation!.decks[0]!.slides[0]!.themeId).toBe('theme-brand');
    expect(document.nodes['accent-node']?.bindings?.fill?.variableId).toBe(accentVariableId);
  });

  it('keeps deliberate local colour when a second theme is applied', () => {
    let document = createPresentationTheme(themedDocument(), {
      id: 'theme-alt',
      name: 'Alt',
      colors: { title: '#123456', accent: '#654321', body: '#222222' },
    });

    // The author unbinds the accent so it stops following the brand.
    const accentNode = document.nodes['accent-node']!;
    const unbound = accentNode as unknown as Record<string, unknown> & { bindings?: unknown };
    const { fill: _fill, ...rest } = unbound.bindings as Record<string, unknown>;
    document = {
      ...document,
      nodes: { ...document.nodes, 'accent-node': rest as unknown as Document['nodes'][string] },
    };

    const applied = applyPresentationTheme(document, 'deck', 'entry', 'theme-alt', ROLE_MAP);
    const theme = applied.presentation!.themes.find((entry) => entry.id === 'theme-alt')!;

    // Title and body follow the new brand...
    expect(applied.nodes['title-node']?.bindings?.fill?.variableId).toBe(
      theme.colorVariables.title,
    );
    expect(applied.nodes['body-node']?.bindings?.fill?.variableId).toBe(theme.colorVariables.body);
    // ...the unlinked accent keeps its deliberate colour.
    expect(applied.nodes['accent-node']?.bindings?.fill).toBeUndefined();

    const state = describePresentationTheme(applied, 'deck', 'entry', 'theme-alt', ROLE_MAP);
    expect(state.themed).toBe(true);
    expect(state.localCount).toBe(1);
    expect(state.roles.find((role) => role.role === 'accent')?.status).toBe('local');
  });

  it('reports unmapped, missing, and unlinked roles honestly', () => {
    const document = themedDocument();
    const partial = describePresentationTheme(document, 'deck', 'entry', 'theme-brand', {
      title: 'title-node',
      body: 'missing-node',
      accent: 'accent-node',
    });
    expect(partial.roles.find((role) => role.role === 'body')?.status).toBe('missing');
    expect(partial.roles.find((role) => role.role === 'subtitle')?.status).toBe('unmapped');

    const unlinked = unlinkPresentationTheme(document, 'deck', 'entry');
    expect(unlinked.presentation!.decks[0]!.slides[0]!.themeId).toBeUndefined();
    // Detaching bakes what is on screen: no binding, same colour.
    const accent = unlinked.nodes['accent-node'] as { fill?: { r: number; g: number; b: number } };
    expect(accent.fill).toMatchObject({ r: 30, g: 122, b: 138 });
    expect(unlinked.nodes['accent-node']?.bindings?.fill).toBeUndefined();

    // Applying again is an explicit choice, so it re-links every mapped object
    // — the "first apply" path a detached slide is back on.
    const recoloured = applyPresentationTheme(unlinked, 'deck', 'entry', 'theme-brand', ROLE_MAP);
    expect(recoloured.nodes['accent-node']?.bindings?.fill?.variableId).toBe(
      document.presentation!.themes[0]!.colorVariables.accent,
    );
    expect(recoloured.presentation!.decks[0]!.slides[0]!.themeId).toBe('theme-brand');
    expect(() => unlinkPresentationTheme(unlinked, 'deck', 'entry')).toThrow(/not using/);
    expect(() => applyPresentationTheme(document, 'deck', 'missing', 'theme-brand')).toThrow(
      /does not exist/,
    );
  });

  it('is reachable as a registered, precondition-checked operation', () => {
    const document = withLayoutBinding(
      createPresentationTheme(makeSlideDocument(), { id: 'theme-brand', name: 'Brand' }),
    );
    const payload = { preview: { deckId: 'deck' } };
    expect(
      validatePayload('presentation.theme.apply', {
        deckId: 'deck',
        entryId: 'entry',
        themeId: 'theme-brand',
      }),
    ).toMatchObject({ ok: true });
    expect(validatePayload('presentation.theme.apply', { deckId: 'deck' })).toMatchObject({
      ok: false,
    });
    expect(
      preconditionFailure(document, 'presentation.theme.apply', {
        deckId: 'deck',
        entryId: 'missing',
        themeId: 'theme-brand',
      }),
    ).toMatch(/slide does not exist/);
    void payload;
  });

  it('round-trips the slide theme binding through save and reopen', () => {
    const document = themedDocument();
    const slide = document.presentation!.decks[0]!.slides[0]!;
    expect(slide.themeBinding).toMatchObject({
      themeId: 'theme-brand',
      roleNodes: { ...ROLE_MAP },
    });

    const reopened = DocumentCodec.decode(DocumentCodec.encode(document));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const restored = reopened.document.presentation!.decks[0]!.slides[0]!;
    expect(restored.themeId).toBe('theme-brand');
    expect(restored.themeBinding).toEqual(slide.themeBinding);
    expect(normalizePresentationMetadata(reopened.document.presentation)).toEqual(
      reopened.document.presentation,
    );
    // Detach and re-apply still find the same objects after a reload.
    const detached = unlinkPresentationTheme(reopened.document, 'deck', 'entry');
    expect(detached.nodes['accent-node']?.bindings?.fill).toBeUndefined();
    const reapplied = applyPresentationTheme(detached, 'deck', 'entry', 'theme-brand');
    expect(reapplied.nodes['accent-node']?.bindings?.fill?.variableId).toBe(
      document.presentation!.themes[0]!.colorVariables.accent,
    );
  });
});
