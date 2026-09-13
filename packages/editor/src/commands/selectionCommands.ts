/**
 * Selection commands — pure functions for hierarchy navigation and
 * select-similar operations.
 *
 * Each function takes the document and current selection, returns the next
 * selection (ordered array of node IDs) and the primary ID. Side-effect free
 * so they can be unit-tested and composed into context methods, action
 * handlers, and keyboard shortcuts.
 *
 * Research basis: Figma selection model, Illustrator "Select Similar",
 * Sketch hierarchy navigation.
 */

import type { Document, NodeId, SceneNode, ShapeNode } from '@varve/scene';
import { getChildren, getParent } from '@varve/scene';

export interface SelectionResult {
  selection: NodeId[];
  primaryId: NodeId | null;
}

function empty(): SelectionResult {
  return { selection: [], primaryId: null };
}

function result(ids: NodeId[]): SelectionResult {
  return { selection: ids, primaryId: ids[0] ?? null };
}

function isSelectable(n: SceneNode | undefined): n is SceneNode {
  return !!n && !n.locked && n.visible !== false;
}

type FontReferenceLike = {
  artifactHash: string;
  collectionIndex?: number;
  postScriptName?: string;
};

function fontKey(family: string | undefined, reference?: FontReferenceLike): string | undefined {
  if (!family) return undefined;
  const normalized = family.trim().toLocaleLowerCase();
  if (!reference) return `family:${normalized}`;
  return `face:${normalized}:${reference.artifactHash.toLocaleLowerCase()}:${reference.collectionIndex ?? 'single'}:${reference.postScriptName?.toLocaleLowerCase() ?? ''}`;
}

function effectivelySelectable(doc: Document, id: NodeId): boolean {
  let current: NodeId | undefined = id;
  const visited = new Set<NodeId>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (!isSelectable(doc.nodes[current])) return false;
    current = getParent(doc, current) ?? undefined;
  }
  return true;
}

function textFontKeys(doc: Document, node: Extract<SceneNode, { kind: 'text' }>): string[] {
  const style = node.styleId ? doc.styles?.[node.styleId] : undefined;
  const styleFont = style?.type === 'text' ? style : undefined;
  const baseFamily = node.fontFamily ?? styleFont?.fontFamily;
  const baseReference = node.fontReference ?? styleFont?.fontReference;
  const keys = new Set<string>();
  const add = (family: string | undefined, reference?: FontReferenceLike) => {
    const key = fontKey(family, reference);
    if (key) keys.add(key);
  };

  add(baseFamily, baseReference);
  for (const paragraph of node.richText?.paragraphs ?? []) {
    for (const run of paragraph.runs) {
      add(run.format?.fontFamily ?? baseFamily, run.format?.fontReference ?? baseReference);
    }
  }

  const story = node.storyBinding ? doc.stories?.[node.storyBinding.storyId] : undefined;
  for (const paragraph of story?.content.paragraphs ?? []) {
    for (const run of paragraph.runs) {
      add(run.format?.fontFamily ?? baseFamily, run.format?.fontReference ?? baseReference);
    }
  }
  return [...keys];
}

function sameFontKey(target: string, candidate: string): boolean {
  // A family-only request intentionally matches every exact face in that
  // family. An exact request only matches the same artifact/member identity.
  if (target.startsWith('family:')) {
    const family = target.slice('family:'.length);
    return candidate === target || candidate.startsWith(`face:${family}:`);
  }
  return target === candidate;
}

/**
 * Select None — clear the entire selection.
 */
export function selectNone(): SelectionResult {
  return empty();
}

/**
 * Invert Selection — select all visible unlocked nodes that are not
 * currently selected, scoped to the active page's top level.
 */
export function invertSelectionCmd(doc: Document, current: NodeId[]): SelectionResult {
  const currentSet = new Set(current);
  const inverted: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (isSelectable(node) && !currentSet.has(id as NodeId)) {
      inverted.push(id as NodeId);
    }
  }
  return result(inverted);
}

/**
 * Select Parent — replace selection with the parent of the primary node.
 * No-op when the primary node is at the document root.
 */
export function selectParentCmd(doc: Document, primaryId: NodeId | null): SelectionResult {
  if (!primaryId) return empty();
  const parent = getParent(doc, primaryId);
  if (!parent) return empty();
  return result([parent]);
}

/**
 * Select Children — replace selection with the direct children of the
 * primary container. No-op when the primary node is not a container.
 */
export function selectChildrenCmd(doc: Document, primaryId: NodeId | null): SelectionResult {
  if (!primaryId) return empty();
  const children = getChildren(doc, primaryId);
  if (!children || children.length === 0) return empty();
  const selectable = children.filter((id) => isSelectable(doc.nodes[id]));
  return result(selectable);
}

/**
 * Select Siblings — replace selection with all siblings of the primary node
 * (excluding the primary itself). No-op at document root.
 */
export function selectSiblingsCmd(doc: Document, primaryId: NodeId | null): SelectionResult {
  if (!primaryId) return empty();
  const parent = getParent(doc, primaryId);
  if (!parent) {
    // Top-level: siblings are all root-level nodes except primary
    const siblings = doc.rootChildren.filter(
      (id) => id !== primaryId && isSelectable(doc.nodes[id]),
    );
    return result(siblings);
  }
  const siblings = (getChildren(doc, parent) ?? []).filter(
    (id) => id !== primaryId && isSelectable(doc.nodes[id]),
  );
  return result(siblings);
}

/**
 * Select Next Sibling — select the next selectable sibling after the primary
 * node in paint order. Wraps to the first sibling.
 */
export function selectNextSiblingCmd(doc: Document, primaryId: NodeId | null): SelectionResult {
  if (!primaryId) return empty();
  const parent = getParent(doc, primaryId);
  const siblings = parent ? (getChildren(doc, parent) ?? []) : doc.rootChildren;
  const selectable = siblings.filter((id) => isSelectable(doc.nodes[id]));
  const idx = selectable.indexOf(primaryId);
  if (idx < 0) return result(selectable[0] ? [selectable[0]] : []);
  const next = selectable[(idx + 1) % selectable.length];
  return result(next ? [next] : []);
}

/**
 * Select Previous Sibling — select the previous selectable sibling before the
 * primary node in paint order. Wraps to the last sibling.
 */
export function selectPreviousSiblingCmd(doc: Document, primaryId: NodeId | null): SelectionResult {
  if (!primaryId) return empty();
  const parent = getParent(doc, primaryId);
  const siblings = parent ? (getChildren(doc, parent) ?? []) : doc.rootChildren;
  const selectable = siblings.filter((id) => isSelectable(doc.nodes[id]));
  const idx = selectable.indexOf(primaryId);
  if (idx < 0) {
    const last = selectable[selectable.length - 1];
    return result(last ? [last] : []);
  }
  const prev = selectable[(idx - 1 + selectable.length) % selectable.length];
  return result(prev ? [prev] : []);
}

/**
 * Select All Children (recursive) — select all descendants of the primary
 * container, including nested children.
 */
export function selectAllChildrenCmd(doc: Document, primaryId: NodeId | null): SelectionResult {
  if (!primaryId) return empty();
  const collected: NodeId[] = [];
  const stack = [primaryId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const children = getChildren(doc, current) ?? [];
    for (const childId of children) {
      if (!isSelectable(doc.nodes[childId])) continue;
      collected.push(childId);
      stack.push(childId);
    }
  }
  return result(collected);
}

// ── Select Similar ──────────────────────────────────────────────────────────

/** Extract strokes from node types that have them (shape/text/frame). */
function getStrokes(node: SceneNode): NonNullable<ShapeNode['strokes']> | null {
  if (node.kind === 'shape' || node.kind === 'text' || node.kind === 'frame') {
    return node.strokes;
  }
  return null;
}

function strokesEqual(
  a: Readonly<NonNullable<ShapeNode['strokes']>>,
  b: Readonly<NonNullable<ShapeNode['strokes']>>,
): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  for (let i = 0; i < a.length; i++) {
    const sa = a[i]!;
    const sb = b[i]!;
    if (sa.weight !== sb.weight) return false;
    if (sa.color?.space !== sb.color?.space) return false;
    if (sa.color && sb.color) {
      if (
        (sa.color as { r?: number }).r !== (sb.color as { r?: number }).r ||
        (sa.color as { g?: number }).g !== (sb.color as { g?: number }).g ||
        (sa.color as { b?: number }).b !== (sb.color as { b?: number }).b ||
        (sa.color as { a?: number }).a !== (sb.color as { a?: number }).a
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Select all visible unlocked nodes matching the primary node's stroke
 * weight and color.
 */
export function selectAllWithSameStrokeCmd(
  doc: Document,
  primaryId: NodeId | null,
): SelectionResult {
  if (!primaryId) return empty();
  const first = doc.nodes[primaryId];
  if (!first) return empty();
  const targetStrokes = getStrokes(first);
  if (!targetStrokes) return empty();
  const matching: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (id === primaryId) continue;
    if (!isSelectable(node)) continue;
    const nodeStrokes = getStrokes(node);
    if (nodeStrokes && strokesEqual(nodeStrokes, targetStrokes)) {
      matching.push(id as NodeId);
    }
  }
  return result([primaryId, ...matching]);
}

/**
 * Select all visible unlocked nodes matching the primary node's opacity.
 */
export function selectAllWithSameOpacityCmd(
  doc: Document,
  primaryId: NodeId | null,
): SelectionResult {
  if (!primaryId) return empty();
  const first = doc.nodes[primaryId];
  if (!first) return empty();
  const targetOpacity = first.opacity;
  const matching: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (id === primaryId) continue;
    if (!isSelectable(node)) continue;
    if (node.opacity === targetOpacity) {
      matching.push(id as NodeId);
    }
  }
  return result([primaryId, ...matching]);
}

/**
 * Select all visible unlocked nodes matching the primary node's blend mode.
 */
export function selectAllWithSameBlendModeCmd(
  doc: Document,
  primaryId: NodeId | null,
): SelectionResult {
  if (!primaryId) return empty();
  const first = doc.nodes[primaryId];
  if (!first) return empty();
  const targetBlend = first.blendMode;
  const matching: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (id === primaryId) continue;
    if (!isSelectable(node)) continue;
    if (node.blendMode === targetBlend) {
      matching.push(id as NodeId);
    }
  }
  return result([primaryId, ...matching]);
}

/**
 * Select all visible, effectively unlocked text nodes using the primary text
 * node's effective font. Rich-text runs, linked stories, inherited text
 * styles, and exact artifact/member references are included in the match.
 */
export function selectAllWithSameFontCmd(doc: Document, primaryId: NodeId | null): SelectionResult {
  if (!primaryId) return empty();
  const first = doc.nodes[primaryId];
  if (first?.kind !== 'text') return empty();
  const targetKeys = textFontKeys(doc, first);
  if (targetKeys.length === 0) return empty();
  const matching: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (id === primaryId) continue;
    if (!effectivelySelectable(doc, id as NodeId)) continue;
    if (
      node.kind === 'text' &&
      textFontKeys(doc, node).some((candidate) =>
        targetKeys.some((target) => sameFontKey(target, candidate)),
      )
    ) {
      matching.push(id as NodeId);
    }
  }
  return result([primaryId, ...matching]);
}

/** Extract uniform corner radius from node types that have it. */
function getUniformCornerRadius(node: SceneNode): number | null {
  if (node.kind === 'shape' || node.kind === 'frame') {
    const r = node.cornerRadius;
    if (typeof r === 'number') return r;
    if (Array.isArray(r)) return r[0] ?? 0;
  }
  return null;
}

/**
 * Select all visible unlocked nodes matching the primary node's corner radius.
 */
export function selectAllWithSameCornerRadiusCmd(
  doc: Document,
  primaryId: NodeId | null,
): SelectionResult {
  if (!primaryId) return empty();
  const first = doc.nodes[primaryId];
  if (!first) return empty();
  const targetRadius = getUniformCornerRadius(first);
  if (targetRadius === null) return empty();
  const matching: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (id === primaryId) continue;
    if (!isSelectable(node)) continue;
    if (getUniformCornerRadius(node) === targetRadius) {
      matching.push(id as NodeId);
    }
  }
  return result([primaryId, ...matching]);
}
