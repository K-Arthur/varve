import { addVariableToDocument, type Document } from '../document';
import { randomHex } from '../identity';
import type { NodeId, SceneNode } from '../types';
import type { Variable } from '../variables';
import { findPresentationDeck, updatePresentationSlide } from './model';
import type { PresentationTheme } from './types';

/**
 * Linked presentation themes.
 *
 * A theme is not a snapshot of colours: each theme role points at a real
 * document colour variable, and slide objects are *bound* to those variables.
 * The renderer already resolves `bindings` on every frame, so editing one
 * variable recolours every bound slide object at once — that is the whole point
 * of a brand change, and it needs no rebuild, no flattening, and no walk over
 * the deck.
 *
 * Local overrides are preserved by rule rather than by memory: once a deck has
 * been themed, an object whose fill is no longer bound to a theme variable is
 * treated as an intentional local colour and is skipped on later applies, so
 * switching the brand palette never repaints work the author deliberately did.
 * Before the first apply there is nothing to preserve, so every mapped object
 * is bound.
 *
 * Typography is deliberately out of scope here: `PresentationTheme.textStyles`
 * is schema-ready, but a per-role text style changes font metrics and therefore
 * reflow, so it needs its own review rather than riding along.
 */

export const PRESENTATION_THEME_ROLES = [
  'title',
  'subtitle',
  'body',
  'caption',
  'accent',
  'background',
] as const;

export type PresentationThemeRole = (typeof PRESENTATION_THEME_ROLES)[number];

export type PresentationThemeRoleStatus = 'linked' | 'local' | 'missing' | 'unmapped';

export interface PresentationThemeRoleState {
  role: PresentationThemeRole;
  /** Human label used by the UI and by commands. */
  label: string;
  nodeId?: NodeId;
  variableId?: string;
  status: PresentationThemeRoleStatus;
}

export interface PresentationThemeState {
  deckId: string;
  entryId: string;
  themeId: string;
  themeName: string;
  /** True once this slide has been themed; controls what counts as local. */
  themed: boolean;
  roles: PresentationThemeRoleState[];
  linkedCount: number;
  localCount: number;
}

export interface PresentationThemeInput {
  id: string;
  name: string;
  /** Role to initial colour. Roles without a colour keep {@link DEFAULT_THEME_COLORS}. */
  colors?: Partial<Record<PresentationThemeRole, string>>;
}

export const DEFAULT_THEME_COLORS: Record<PresentationThemeRole, string> = {
  title: '#1c1c1c',
  subtitle: '#4a4a4a',
  body: '#333333',
  caption: '#6b6b6b',
  accent: '#1e7a8a',
  background: '#ffffff',
};

const ROLE_LABELS: Record<PresentationThemeRole, string> = {
  title: 'Title',
  subtitle: 'Subtitle',
  body: 'Body',
  caption: 'Caption',
  accent: 'Accent',
  background: 'Background',
};

const HEX_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Document colour variables created for presentation themes live in this collection. */
const THEME_COLLECTION_NAME = 'Presentation themes';

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_PATTERN.test(value);
}

function colorToHex(fill: unknown): string | null {
  if (!fill || typeof fill !== 'object') return null;
  const color = fill as { r?: number; g?: number; b?: number; space?: string };
  if (color.space && color.space !== 'rgb') return null;
  if (typeof color.r !== 'number' || typeof color.g !== 'number' || typeof color.b !== 'number') {
    return null;
  }
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function nodeFillHex(node: SceneNode): string | null {
  const fill = (node as { fill?: unknown }).fill;
  return colorToHex(fill);
}

function isShapeNode(node: SceneNode): boolean {
  return node.kind === 'shape' || node.kind === 'frame';
}

function frequency(values: Array<string | null>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    if (!value) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** Most-used value, ties broken by first appearance (stable across runs). */
function mostFrequent(values: Array<string | null>, exclude?: Set<string>): string | null {
  const counts = frequency(values);
  let best: string | null = null;
  let bestCount = 0;
  for (const value of values) {
    if (!value || exclude?.has(value)) continue;
    const count = counts[value] ?? 0;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Read the palette a slide already uses, so creating a theme starts from the
 * document instead of from a preset nobody asked for.
 */
export function sampleThemeColors(
  document: Document,
  frameId: NodeId,
): Partial<Record<PresentationThemeRole, string>> {
  const frame = document.nodes[frameId];
  if (frame?.kind !== 'frame') return {};
  const children = frame.children
    .map((id) => document.nodes[id])
    .filter((node): node is SceneNode => Boolean(node));

  const textColors = children
    .filter((node) => node.kind === 'text')
    .map((node) => nodeFillHex(node));
  const shapeColors = children.filter((node) => isShapeNode(node)).map((node) => nodeFillHex(node));

  const title = mostFrequent(textColors) ?? null;
  const accent = mostFrequent(shapeColors, new Set(title ? [title] : [])) ?? null;
  const body = mostFrequent(textColors, new Set(title ? [title] : [])) ?? title;
  const background =
    colorToHex((frame as { fill?: unknown }).fill) ?? DEFAULT_THEME_COLORS.background;

  const colors: Partial<Record<PresentationThemeRole, string>> = {};
  if (title) colors.title = title;
  if (body) colors.body = body;
  if (accent) colors.accent = accent;
  colors.background = background;
  if (body) colors.subtitle = body;
  if (title) colors.caption = title;
  return colors;
}

function themeVariableIds(document: Document): Set<string> {
  const ids = new Set<string>();
  for (const theme of document.presentation?.themes ?? []) {
    for (const variableId of Object.values(theme.colorVariables)) ids.add(variableId);
  }
  return ids;
}

function fillBinding(node: SceneNode): { variableId?: string } | undefined {
  return (node as { bindings?: Record<string, { variableId: string }> }).bindings?.fill;
}

/**
 * Create a theme and one document colour variable per role.
 *
 * The variables are ordinary document variables, so they appear in the
 * Variables panel and can be edited, aliased, or given modes there — the theme
 * does not own a parallel colour system.
 */
export function createPresentationTheme(
  document: Document,
  input: PresentationThemeInput,
): Document {
  const metadata = document.presentation;
  if (!metadata) throw new Error('A presentation deck is required before creating a theme.');
  if (metadata.themes.some((theme) => theme.id === input.id)) {
    throw new Error(`presentation theme already exists: ${input.id}`);
  }
  const name = input.name.trim();
  if (!name) throw new Error('Give the theme a name before saving it.');

  const colorVariables: Record<string, string> = {};
  let next = document;
  for (const role of PRESENTATION_THEME_ROLES) {
    const color = input.colors?.[role] ?? DEFAULT_THEME_COLORS[role];
    if (!isHexColor(color)) continue;
    const variable: Variable = {
      id: `v-${randomHex(8)}`,
      name: `${THEME_COLLECTION_NAME} / ${name} / ${ROLE_LABELS[role]}`,
      type: 'color',
      valuesByMode: { default: color },
    };
    next = addVariableToDocument(next, variable);
    colorVariables[role] = variable.id;
  }

  const theme: PresentationTheme = {
    id: input.id,
    name,
    colorVariables,
    textStyles: {},
  };
  return {
    ...next,
    presentation: { ...metadata, themes: [...metadata.themes, theme] },
  };
}

export function removePresentationTheme(document: Document, themeId: string): Document {
  const metadata = document.presentation;
  if (!metadata?.themes.some((theme) => theme.id === themeId)) {
    throw new Error(`presentation theme does not exist: ${themeId}`);
  }
  return {
    ...document,
    presentation: {
      ...metadata,
      themes: metadata.themes.filter((theme) => theme.id !== themeId),
    },
  };
}

/**
 * Bind mapped slide objects to the theme's colour variables.
 *
 * `roleNodes` defaults to the slide's layout roles, so a slide laid out with
 * title/subtitle/accent roles is themed without remapping by hand. Returns the
 * document unchanged when nothing new would be bound.
 */
export function applyPresentationTheme(
  document: Document,
  deckId: string,
  entryId: string,
  themeId: string,
  roleNodes?: Partial<Record<PresentationThemeRole, NodeId>>,
): Document {
  const deck = findPresentationDeck(document, deckId);
  const entry = deck?.slides.find((slide) => slide.id === entryId);
  const theme = document.presentation?.themes.find((candidate) => candidate.id === themeId);
  if (!deck || !entry) throw new Error('The selected slide does not exist.');
  if (!theme) throw new Error(`presentation theme does not exist: ${themeId}`);

  const mapping = resolveRoleNodes(document, deckId, entryId, roleNodes);
  const themed = entry.themeId !== undefined;
  const themeVars = themeVariableIds(document);
  const nodes = { ...document.nodes };

  for (const role of PRESENTATION_THEME_ROLES) {
    const variableId = theme.colorVariables[role];
    const nodeId = mapping[role];
    if (!variableId || !nodeId) continue;
    const node = nodes[nodeId];
    if (!node) continue;
    const binding = fillBinding(node);
    if (themed) {
      // Following another theme? Re-theme it. Untouched by any theme? It is a
      // deliberate local colour, and the brand change must not repaint it.
      if (!binding?.variableId || !themeVars.has(binding.variableId)) continue;
    }
    nodes[nodeId] = {
      ...node,
      bindings: { ...(node.bindings ?? {}), fill: { variableId } },
    } as SceneNode;
  }

  const metadata = document.presentation;
  if (!metadata) return document;
  // Record the theme even when every mapped object stayed local: the slide is
  // now themed, which is what makes later applies skip local colour work.
  const updated = updatePresentationSlide({ ...document, nodes }, deckId, entryId, { themeId });
  return {
    ...updated,
    presentation: {
      ...updated.presentation!,
      decks: updated.presentation!.decks.map((candidate) =>
        candidate.id === deckId && !candidate.themeId ? { ...candidate, themeId } : candidate,
      ),
    },
  };
}

/** Drop the theme link from one slide, keeping the colours that are showing. */
export function unlinkPresentationTheme(
  document: Document,
  deckId: string,
  entryId: string,
): Document {
  const deck = findPresentationDeck(document, deckId);
  const entry = deck?.slides.find((slide) => slide.id === entryId);
  if (!deck || !entry) throw new Error('The selected slide does not exist.');
  if (!entry.themeId) throw new Error('This slide is not using a presentation theme.');
  return updatePresentationSlide(document, deckId, entryId, { themeId: null });
}

/**
 * Per-role report of whether a slide follows a theme or has drifted locally.
 * Same shape discipline as {@link describePresentationLayoutOverrides} so the UI
 * can render one consistent list.
 */
export function describePresentationTheme(
  document: Document,
  deckId: string,
  entryId: string,
  themeId: string,
  roleNodes?: Partial<Record<PresentationThemeRole, NodeId>>,
): PresentationThemeState {
  const deck = findPresentationDeck(document, deckId);
  const entry = deck?.slides.find((slide) => slide.id === entryId);
  const theme = document.presentation?.themes.find((candidate) => candidate.id === themeId);
  if (!deck || !entry || !theme) {
    throw new Error('The slide or theme is no longer available.');
  }
  const mapping = resolveRoleNodes(document, deckId, entryId, roleNodes);
  const themed = entry.themeId !== undefined;

  const roles: PresentationThemeRoleState[] = PRESENTATION_THEME_ROLES.map((role) => {
    const nodeId = mapping[role];
    const variableId = theme.colorVariables[role];
    const state: PresentationThemeRoleState = {
      role,
      label: ROLE_LABELS[role],
      status: 'unmapped',
      ...(variableId ? { variableId } : {}),
      ...(nodeId ? { nodeId } : {}),
    };
    if (!variableId || !nodeId) return state;
    const node = document.nodes[nodeId];
    if (!node) return { ...state, status: 'missing' };
    const binding = fillBinding(node);
    if (binding?.variableId === variableId) return { ...state, status: 'linked' };
    // Before a slide is themed an unbound object has no opinion to report;
    // afterwards "not bound to this theme" is what local drift means.
    if (themed) return { ...state, status: 'local' };
    return { ...state, status: 'unmapped' };
  });

  return {
    deckId,
    entryId,
    themeId,
    themeName: theme.name,
    themed,
    roles,
    linkedCount: roles.filter((role) => role.status === 'linked').length,
    localCount: roles.filter((role) => role.status === 'local').length,
  };
}

/** Role mapping resolution shared by apply and describe. */
function resolveRoleNodes(
  document: Document,
  deckId: string,
  entryId: string,
  override?: Partial<Record<PresentationThemeRole, NodeId>>,
): Partial<Record<PresentationThemeRole, NodeId>> {
  if (override) return override;
  const deck = findPresentationDeck(document, deckId);
  const entry = deck?.slides.find((slide) => slide.id === entryId);
  const mapping: Partial<Record<PresentationThemeRole, NodeId>> = {};
  // Only the binding's role map is used: it points at *slide* objects. A
  // layout source's own role map points inside the source frame, and recolouring
  // that would repaint the template instead of the slide.
  for (const role of PRESENTATION_THEME_ROLES) {
    const nodeId = entry?.layoutBinding?.roleNodes?.[role];
    if (nodeId) mapping[role] = nodeId;
  }
  return mapping;
}
