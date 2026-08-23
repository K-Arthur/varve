import type { Affine } from '@varve/engine';
import type { Document } from './document';
import { cryptoId } from './document-utils';
import type {
  AppearanceSnapshot,
  BlendMode,
  LayerState,
  LayerStateCapture,
  LayerStateCategory,
  ManagedColor,
  NodeId,
  SceneNode,
} from './types';

// Re-export layer-state types so existing importers don't break.
// The canonical definitions live in types.ts to avoid a document → layerStates
// cycle (document.ts references LayerState via the Document interface).
export type {
  AppearanceSnapshot,
  LayerState,
  LayerStateCapture,
  LayerStateCategory,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyRecord(value: unknown): Record<NodeId, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return { ...value } as Record<NodeId, unknown>;
}

/**
 * Normalize the optional persisted collection at the document boundary.
 * Layer states are user-authored metadata: malformed entries are discarded,
 * while valid states retain stable ids and sparse node maps.
 */
export function normalizeLayerStates(value: unknown): LayerState[] {
  if (!Array.isArray(value)) return [];
  const states: LayerState[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string')
      continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const rawCategories = Array.isArray(entry.categories) ? entry.categories : [];
    const categories = [...new Set(rawCategories)].filter(
      (category): category is LayerStateCategory =>
        category === 'visibility' || category === 'transforms' || category === 'appearance',
    );
    const rawCapture = isRecord(entry.captured) ? entry.captured : {};
    const captured: LayerStateCapture = {};
    const visibility = copyRecord(rawCapture.visibility) as Record<NodeId, boolean> | undefined;
    const transforms = copyRecord(rawCapture.transforms) as Record<NodeId, Affine> | undefined;
    const appearance = copyRecord(rawCapture.appearance) as
      | Record<NodeId, AppearanceSnapshot>
      | undefined;
    if (visibility) captured.visibility = visibility;
    if (transforms) captured.transforms = transforms;
    if (appearance) captured.appearance = appearance;
    states.push({
      id: entry.id,
      name: entry.name,
      categories,
      captured,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
    });
  }
  return states;
}

function nodeIdsOf(capture: LayerStateCapture): NodeId[] {
  const ids = new Set<NodeId>();
  for (const map of [capture.visibility, capture.transforms, capture.appearance]) {
    if (map) for (const id of Object.keys(map)) ids.add(id as NodeId);
  }
  return [...ids];
}

/**
 * Build a sparse state by reading the current document values for `nodeIds`
 * across the chosen `categories`. Missing nodes are silently omitted (a state
 * only stores what it can observe).
 */
export function captureLayerState(
  doc: Document,
  name: string,
  nodeIds: NodeId[],
  categories: LayerStateCategory[],
  opts?: { id?: string },
): LayerState {
  const captured: LayerStateCapture = {};

  if (categories.includes('visibility')) {
    const m: Record<NodeId, boolean> = {};
    for (const id of nodeIds) {
      const n = doc.nodes[id];
      if (n && 'visible' in n) m[id] = n.visible;
    }
    captured.visibility = m;
  }

  if (categories.includes('transforms')) {
    const m: Record<NodeId, Affine> = {};
    for (const id of nodeIds) {
      const n = doc.nodes[id];
      if (n && 'transform' in n && n.transform) m[id] = [...n.transform] as Affine;
    }
    captured.transforms = m;
  }

  if (categories.includes('appearance')) {
    const m: Record<NodeId, AppearanceSnapshot> = {};
    for (const id of nodeIds) {
      const n = doc.nodes[id];
      if (!n) continue;
      const snap: AppearanceSnapshot = {};
      if ('opacity' in n) snap.opacity = n.opacity;
      if ('blendMode' in n) snap.blendMode = n.blendMode;
      if ('fill' in n && n.fill) snap.fill = structuredClone(n.fill);
      m[id] = snap;
    }
    captured.appearance = m;
  }

  return {
    id: opts?.id ?? cryptoId(),
    name,
    categories: [...categories],
    captured,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Apply a state to a document, returning a new document and the list of node ids
 * that were skipped because they no longer exist. The input document is never
 * mutated. Skipped ids satisfy the reference-integrity requirement (§64): a
 * stale state must never crash or corrupt the document.
 */
export function applyLayerState(
  doc: Document,
  state: LayerState,
): { doc: Document; skipped: NodeId[] } {
  const next = structuredClone(doc);
  const skipped: NodeId[] = [];
  const ids = nodeIdsOf(state.captured);

  for (const id of ids) {
    const node = next.nodes[id];
    if (!node) {
      skipped.push(id);
      continue;
    }

    const v = state.captured.visibility?.[id];
    if (v !== undefined && 'visible' in node) {
      (node as SceneNode & { visible: boolean }).visible = v;
    }

    const t = state.captured.transforms?.[id];
    if (t !== undefined && 'transform' in node) {
      (node as SceneNode & { transform?: Affine }).transform = t;
    }

    const a = state.captured.appearance?.[id];
    if (a) {
      if (a.opacity !== undefined && 'opacity' in node) {
        (node as SceneNode & { opacity: number }).opacity = a.opacity;
      }
      if (a.blendMode !== undefined && 'blendMode' in node) {
        (node as SceneNode & { blendMode: BlendMode }).blendMode = a.blendMode;
      }
      if (a.fill !== undefined && 'fill' in node) {
        (node as SceneNode & { fill: ManagedColor }).fill = a.fill;
      }
    }
  }

  return { doc: next, skipped };
}

/** Re-capture a state's values from the current document (keeps its id/name). */
export function recaptureLayerState(
  doc: Document,
  state: LayerState,
  nodeIds?: NodeId[],
): LayerState {
  const ids = nodeIds ?? nodeIdsOf(state.captured);
  return captureLayerState(doc, state.name, ids, state.categories, { id: state.id });
}

/** Re-capture a state's values from the current document and return the updated document. */
export function recaptureLayerStateDoc(
  doc: Document,
  state: LayerState,
  nodeIds?: NodeId[],
): Document {
  const captured = recaptureLayerState(doc, state, nodeIds);
  return {
    ...doc,
    layerStates: (doc.layerStates ?? []).map((s) => (s.id === captured.id ? captured : s)),
  };
}

export function addLayerState(doc: Document, state: LayerState): Document {
  return { ...doc, layerStates: [...(doc.layerStates ?? []), state] };
}

export function removeLayerState(doc: Document, stateId: string): Document {
  return { ...doc, layerStates: (doc.layerStates ?? []).filter((s) => s.id !== stateId) };
}

export function renameLayerState(doc: Document, stateId: string, name: string): Document {
  return {
    ...doc,
    layerStates: (doc.layerStates ?? []).map((s) => (s.id === stateId ? { ...s, name } : s)),
  };
}
