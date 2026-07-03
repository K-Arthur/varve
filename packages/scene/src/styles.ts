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
import type { Effect, Fill, LayoutStyle, NodeId, SceneNode, Style, StyleType } from './types';
import type { Document } from './document';

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
  return { ...doc, styles };
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
  const { styleId: _removed, ...rest } = node as unknown as Record<string, unknown>;
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: rest as unknown as SceneNode } };
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function nextStyleId(doc: Document): NodeId {
  return `s${doc.nextId}`;
}
