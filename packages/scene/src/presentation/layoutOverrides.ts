import type { Document } from '../document';
import type { NodeId, SceneNode } from '../types';
import { presentationShapeGeometry } from './layouts';
import { findPresentationDeck } from './model';
import type { PresentationSlideLayoutBinding } from './types';

/**
 * Inherited versus locally overridden layout state.
 *
 * A layout application *materializes* geometry onto the slide and records the
 * applied values as a baseline. Nothing stays live between the source frame
 * and the slide, so the two questions a user actually has are: "is this object
 * still where the layout put it?", and "if not, how do I put it back?"
 *
 * Answering them must never require guessing: every managed key is compared
 * against its recorded baseline with the same projection the apply path used,
 * and every reset is a value restore rather than a rebuild.
 */

export type PresentationOverrideStatus = 'inherited' | 'overridden' | 'missing';

export interface PresentationOverrideProperty {
  key: string;
  status: 'inherited' | 'overridden';
  current: unknown;
  baseline: unknown;
}

export interface PresentationOverrideNode {
  nodeId: NodeId;
  nodeName: string;
  role: string;
  status: PresentationOverrideStatus;
  properties: PresentationOverrideProperty[];
}

export interface PresentationLayoutOverrideReport {
  deckId: string;
  entryId: string;
  sourceId: string;
  sourceName: string;
  appliedRevision: number;
  sourceRevision: number;
  /** True when the source moved on since this slide last received it. */
  sourceOutdated: boolean;
  nodes: PresentationOverrideNode[];
  overriddenPropertyCount: number;
}

export interface PresentationOverrideSelector {
  /** Restrict the reset to one mapped object. */
  nodeId?: NodeId;
  /** Restrict the reset to one managed property (requires `nodeId`). */
  property?: string;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function currentManagedValue(node: SceneNode, key: string): unknown {
  if (key === 'shape' && node.kind === 'shape') {
    return presentationShapeGeometry(node.shape);
  }
  return (node as unknown as Record<string, unknown>)[key];
}

function bindingNodes(
  binding: PresentationSlideLayoutBinding,
): Array<{ nodeId: NodeId; role: string }> {
  const targets = new Map<NodeId, string>();
  for (const [role, nodeId] of Object.entries(binding.roleNodes ?? {})) {
    targets.set(nodeId, role);
  }
  // Include every baseline key too, so an object whose role mapping was
  // dropped is still reported instead of silently disappearing.
  for (const nodeId of Object.keys(binding.managedBaseline ?? {})) {
    if (!targets.has(nodeId as NodeId)) targets.set(nodeId as NodeId, '');
  }
  return [...targets].map(([nodeId, role]) => ({ nodeId, role }));
}

/**
 * Report, for one slide, which layout-managed values still match the layout
 * and which the author has changed locally.
 */
export function describePresentationLayoutOverrides(
  document: Document,
  deckId: string,
  entryId: string,
): PresentationLayoutOverrideReport | null {
  const deck = findPresentationDeck(document, deckId);
  const entry = deck?.slides.find((slide) => slide.id === entryId);
  const binding = entry?.layoutBinding;
  if (!deck || !entry || !binding) return null;
  const source = document.presentation?.layouts.find((layout) => layout.id === binding.sourceId);
  const baseline = binding.managedBaseline ?? {};

  const nodes: PresentationOverrideNode[] = [];
  let overriddenPropertyCount = 0;

  for (const { nodeId, role } of bindingNodes(binding)) {
    const node = document.nodes[nodeId];
    const values = baseline[nodeId];
    if (!node) {
      nodes.push({
        nodeId,
        nodeName: '(removed)',
        role,
        status: 'missing',
        properties: [],
      });
      continue;
    }
    const properties: PresentationOverrideProperty[] = [];
    for (const [key, baselineValue] of Object.entries(values ?? {})) {
      const current = currentManagedValue(node, key);
      const inherited = sameValue(current, baselineValue);
      if (!inherited) overriddenPropertyCount += 1;
      properties.push({
        key,
        status: inherited ? 'inherited' : 'overridden',
        current,
        baseline: baselineValue,
      });
    }
    const overridden = properties.some((property) => property.status === 'overridden');
    nodes.push({
      nodeId,
      nodeName: node.name || node.kind,
      role,
      status: overridden ? 'overridden' : values ? 'inherited' : 'missing',
      properties,
    });
  }

  return {
    deckId,
    entryId,
    sourceId: binding.sourceId,
    sourceName: source?.name ?? '(removed layout)',
    appliedRevision: binding.appliedRevision,
    sourceRevision: source?.revision ?? binding.appliedRevision,
    sourceOutdated: source ? source.revision !== binding.appliedRevision : false,
    nodes,
    overriddenPropertyCount,
  };
}

function writeManagedValue(node: SceneNode, key: string, value: unknown): SceneNode {
  if (key === 'shape' && node.kind === 'shape' && value && typeof value === 'object') {
    // Merge rather than replace: a slide rectangle keeps its corner radius,
    // gradient stops, and every other field a layout does not manage.
    return {
      ...node,
      shape: { ...node.shape, ...value },
    } as SceneNode;
  }
  if ((key === 'w' || key === 'h') && !(key in (node as unknown as Record<string, unknown>))) {
    // The node never carried that dimension; don't invent one from the source.
    return node;
  }
  return { ...node, [key]: value } as SceneNode;
}

/**
 * Restore layout-managed values to the recorded baseline.
 *
 * This only rewrites values the layout already owns: text content, fills,
 * effects, and objects the layout never mapped are untouched. Returns the
 * document unchanged when there is nothing to restore.
 */
export function resetPresentationLayoutOverrides(
  document: Document,
  deckId: string,
  entryId: string,
  selector: PresentationOverrideSelector = {},
): Document {
  const deck = findPresentationDeck(document, deckId);
  const entry = deck?.slides.find((slide) => slide.id === entryId);
  const binding = entry?.layoutBinding;
  if (!deck || !entry || !binding) {
    throw new Error('This slide has no layout to reset.');
  }
  if (selector.property && !selector.nodeId) {
    throw new Error('Choose an object before resetting a single property.');
  }

  const baseline = binding.managedBaseline ?? {};
  const nodes = { ...document.nodes };
  let changed = false;

  for (const [nodeId, values] of Object.entries(baseline)) {
    if (selector.nodeId && nodeId !== selector.nodeId) continue;
    const node = nodes[nodeId];
    if (!node) continue;
    let next = node;
    for (const [key, baselineValue] of Object.entries(values)) {
      if (selector.property && key !== selector.property) continue;
      if (sameValue(currentManagedValue(next, key), baselineValue)) continue;
      next = writeManagedValue(next, key, baselineValue);
      changed = true;
    }
    if (next !== node) nodes[nodeId] = next;
  }

  if (!changed) return document;
  return { ...document, nodes };
}

/**
 * Stop tracking a layout on a slide.
 *
 * The layout never held a live link, so detaching removes only the metadata;
 * every slide object keeps exactly the value it has on screen. This is what
 * makes "detach and keep appearance" truthful here rather than a claim.
 */
export function detachPresentationLayout(
  document: Document,
  deckId: string,
  entryId: string,
): Document {
  const metadata = document.presentation;
  const deck = findPresentationDeck(document, deckId);
  const entry = deck?.slides.find((slide) => slide.id === entryId);
  if (!deck || !entry?.layoutBinding) {
    throw new Error('This slide has no layout to detach.');
  }
  return {
    ...document,
    presentation: {
      ...metadata!,
      decks: metadata!.decks.map((candidate) =>
        candidate.id !== deckId
          ? candidate
          : {
              ...candidate,
              slides: candidate.slides.map((slide) => {
                if (slide.id !== entryId) return slide;
                const { layoutBinding: _detached, ...rest } = slide;
                return rest;
              }),
            },
      ),
    },
  };
}
