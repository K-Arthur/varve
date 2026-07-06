/**
 * Reusable style system operations (Color, Text, Effect, Layout styles).
 *
 * Styles are named, reusable configurations stored on the Document via the
 * `styles` field. Nodes reference styles via `styleId` and can override
 * specific properties via `styleOverrides`.
 *
 * When a style definition is updated, all nodes referencing it automatically
 * reflect the change (when resolved at render time).
 *
 * Operations: create, update, delete, apply, unlink, resolve, duplicate.
 *
 * Research basis: Figma local styles (color/text/effect), Penpot typography
 * styles, industry-standard DTCG design token patterns.
 */

import type { Document } from './document';
import type { Effect, Fill, LayoutStyle, NodeId, SceneNode, Style, StyleType } from './types';

// ── CRUD operations ─────────────────────────────────────────────────────────

export function createColorStyle(
  doc: Document,
  name: string,
  fill: Fill,
  description?: string,
): { style: import('./types').ColorStyle; doc: Document } {
  const id = nextStyleId(doc);
  const style: import('./types').ColorStyle = {
    id,
    type: 'color',
    name,
    fill,
    description,
  };
  return {
    style,
    doc: { ...doc, nextId: doc.nextId + 1, styles: { ...doc.styles, [id]: style } },
  };
}

export function createTextStyle(
  doc: Document,
  name: string,
  props: Omit<import('./types').TextStyle, 'id' | 'type' | 'name'>,
): { style: import('./types').TextStyle; doc: Document } {
  const id = nextStyleId(doc);
  const style: import('./types').TextStyle = { id, type: 'text', name, ...props };
  return {
    style,
    doc: { ...doc, nextId: doc.nextId + 1, styles: { ...doc.styles, [id]: style } },
  };
}

export function createEffectStyle(
  doc: Document,
  name: string,
  effects: Effect[],
  description?: string,
): { style: import('./types').EffectStyle; doc: Document } {
  const id = nextStyleId(doc);
  const style: import('./types').EffectStyle = {
    id,
    type: 'effect',
    name,
    effects,
    description,
  };
  return {
    style,
    doc: { ...doc, nextId: doc.nextId + 1, styles: { ...doc.styles, [id]: style } },
  };
}

export function createLayoutStyle(
  doc: Document,
  name: string,
  layout: LayoutStyle,
  description?: string,
): { style: import('./types').LayoutStyleDef; doc: Document } {
  const id = nextStyleId(doc);
  const style: import('./types').LayoutStyleDef = {
    id,
    type: 'layout',
    name,
    layout,
    description,
  };
  return {
    style,
    doc: { ...doc, nextId: doc.nextId + 1, styles: { ...doc.styles, [id]: style } },
  };
}

/**
 * Update a style's properties. Merges the patch into the existing style.
 */
export function updateStyle(doc: Document, styleId: NodeId, patch: Partial<Style>): Document {
  const existing = doc.styles?.[styleId];
  if (!existing) return doc;
  const updated = { ...existing, ...patch, id: styleId } as Style;
  return { ...doc, styles: { ...doc.styles, [styleId]: updated } };
}

/**
 * Delete a style from the document.
 */
export function deleteStyle(doc: Document, styleId: NodeId): Document {
  if (!doc.styles?.[styleId]) return doc;
  const styles = { ...doc.styles };
  delete styles[styleId];

  const nodes = { ...doc.nodes };
  for (const [nodeId, node] of Object.entries(nodes)) {
    if ('styleId' in node && node.styleId === styleId) {
      const { styleId: _removed, ...rest } = node as unknown as Record<string, unknown>;
      nodes[nodeId] = rest as SceneNode;
    }
  }

  return { ...doc, styles, nodes };
}

/**
 * Apply a style to a node by setting its `styleId`.
 */
export function applyStyleToNode(doc: Document, nodeId: NodeId, styleId: NodeId): Document {
  const node = doc.nodes[nodeId];
  if (!node) return doc;
  if (!doc.styles?.[styleId]) return doc;
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: { ...node, styleId } } };
}

/**
 * Remove a style reference from a node, keeping current values as inline overrides.
 */
export function unlinkStyleFromNode(doc: Document, nodeId: NodeId): Document {
  const node = doc.nodes[nodeId];
  if (!node) return doc;
  const styleId = (node as { styleId?: NodeId }).styleId;
  if (!styleId) return doc;

  const resolved = doc.styles
    ? resolveNodeStyles(node, styleId, doc.styles)
    : undefined;

  const { styleId: _removed, styleOverrides: _overrides, ...rest } = node as unknown as Record<
    string,
    unknown
  >;

  const baked: Record<string, unknown> = resolved ? { ...rest, ...resolved } : { ...rest };
  const styleDef = styleId && doc.styles ? doc.styles[styleId] : undefined;
  if (styleDef?.type === 'color' && styleDef.fill?.type === 'solid' && styleDef.fill.color) {
    baked.fill = styleDef.fill.color;
  }

  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: baked as SceneNode },
  };
}

/**
 * Resolve a style by ID. Returns undefined if not found.
 */
export function resolveStyle(doc: Document, styleId: NodeId): Style | undefined {
  return doc.styles?.[styleId];
}

/**
 * Get all styles of a specific type from the document.
 */
export function getStylesByType(doc: Document, type: StyleType): Style[] {
  if (!doc.styles) return [];
  return Object.values(doc.styles).filter((s) => s.type === type);
}

/**
 * List all style IDs referenced by document nodes.
 * Useful for detecting orphaned styles.
 */
export function getUsedStyleIds(doc: Document): Set<NodeId> {
  const used = new Set<NodeId>();
  for (const node of Object.values(doc.nodes)) {
    if ('styleId' in node && node.styleId) used.add(node.styleId);
  }
  return used;
}

/**
 * Find all node IDs that reference a given style.
 */
export function getNodesUsingStyle(doc: Document, styleId: NodeId): NodeId[] {
  const result: NodeId[] = [];
  for (const node of Object.values(doc.nodes)) {
    if ('styleId' in node && node.styleId === styleId) result.push(node.id);
  }
  return result;
}

/**
 * Resolve a style with applied overrides.
 * Merges the style definition with any property overrides on the node.
 */
export function resolveStyleWithOverrides(
  doc: Document,
  styleId: NodeId,
  overrides?: Record<string, unknown>,
): Style | undefined {
  const style = doc.styles?.[styleId];
  if (!style) return undefined;
  if (!overrides || Object.keys(overrides).length === 0) return style;
  return { ...style, ...overrides } as Style;
}

/**
 * Duplicate a style with a new unique ID.
 */
export function duplicateStyle(
  doc: Document,
  styleId: NodeId,
): { style: Style; doc: Document } | undefined {
  const existing = doc.styles?.[styleId];
  if (!existing) return undefined;
  const id = nextStyleId(doc);
  const style = { ...existing, id, name: `${existing.name} Copy` } as Style;
  return {
    style,
    doc: { ...doc, nextId: doc.nextId + 1, styles: { ...doc.styles, [id]: style } },
  };
}

// ── Style Resolution (render-time inlining) ─────────────────────────────────

/**
 * Resolve a single node's styles.
 * Returns a record with style properties inlined.
 * Applies node-level styleOverrides on top of the style definition.
 * If no styleId or style not found, returns undefined.
 */
export function resolveNodeStyles(
  node: SceneNode,
  styleId: string,
  styles: Record<string, Style>,
): Record<string, unknown> | undefined {
  const styleDef = styles[styleId];
  if (!styleDef) return undefined;

  const resolved: Record<string, unknown> = {};

  switch (styleDef.type) {
    case 'color': {
      if (styleDef.fill) resolved.fill = styleDef.fill;
      break;
    }
    case 'text': {
      if (styleDef.fontFamily) resolved.fontFamily = styleDef.fontFamily;
      if (styleDef.fontWeight) resolved.fontWeight = styleDef.fontWeight;
      if (styleDef.fontStyle) resolved.fontStyle = styleDef.fontStyle;
      if (styleDef.fontSize) resolved.fontSize = styleDef.fontSize;
      if (styleDef.lineHeight) resolved.lineHeight = styleDef.lineHeight;
      if (styleDef.letterSpacing) resolved.letterSpacing = styleDef.letterSpacing;
      if (styleDef.textAlign) resolved.textAlign = styleDef.textAlign;
      if (styleDef.textCase) resolved.textCase = styleDef.textCase;
      if (styleDef.textDecoration) resolved.textDecoration = styleDef.textDecoration;
      if (styleDef.listStyle) resolved.listStyle = styleDef.listStyle;
      break;
    }
    case 'effect': {
      if (styleDef.effects) resolved.effects = styleDef.effects;
      break;
    }
    case 'layout': {
      break;
    }
  }

  // Apply node-level styleOverrides on top of the resolved style properties
  const styleOverrides = (node as { styleOverrides?: Record<string, unknown> }).styleOverrides;
  if (styleOverrides) {
    Object.assign(resolved, styleOverrides);
  }

  return resolved;
}

/**
 * Resolve all styles in a document.
 * Returns a Map<NodeId, Record<string, unknown>> with resolved style properties
 * for every node that has a `styleId` referencing an existing style.
 */
export function resolveAllStyles(doc: Document): Map<NodeId, Record<string, unknown>> {
  if (!doc.styles) return new Map();
  const result = new Map<NodeId, Record<string, unknown>>();

  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    const styleId = (node as { styleId?: string }).styleId;
    if (!styleId) continue;

    const resolved = resolveNodeStyles(node, styleId, doc.styles);
    if (resolved) {
      result.set(nodeId as NodeId, resolved);
    }
  }

  return result;
}

/**
 * Check if a node has an applied style.
 */
export function nodeHasStyle(node: SceneNode): boolean {
  const styleId = (node as { styleId?: string }).styleId;
  return !!styleId;
}

/**
 * Get the effective style chain: style definition + node-level overrides.
 * Returns undefined if the node does not exist.
 */
export function getEffectiveStyle(
  doc: Document,
  nodeId: NodeId,
): { style: Style | undefined; overrides: Record<string, unknown> } | undefined {
  const node = doc.nodes[nodeId];
  if (!node) return undefined;
  const styleId = (node as { styleId?: string }).styleId;
  if (!styleId || !doc.styles) return { style: undefined, overrides: {} };
  const styleDef = doc.styles[styleId];
  return {
    style: styleDef,
    overrides: (node as { styleOverrides?: Record<string, unknown> }).styleOverrides ?? {},
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function nextStyleId(doc: Document): NodeId {
  return `s${doc.nextId}`;
}
