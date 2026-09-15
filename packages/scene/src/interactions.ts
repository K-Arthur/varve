/**
 * Immutable CRUD operations for Document.interactions.
 */
import type { Document } from './document';
import type { DocumentInteraction } from './interaction-types';
import type { NodeId } from './types';

function interactionId(): string {
  return `ix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Get all interactions for a node. */
export function getInteractionsForNode(doc: Document, nodeId: NodeId): DocumentInteraction[] {
  return doc.interactions?.[nodeId] ?? [];
}

/** Flatten all interactions into a single array (for prototype runtime). */
export function flattenInteractions(doc: Document): DocumentInteraction[] {
  const map = doc.interactions ?? {};
  const result: DocumentInteraction[] = [];
  for (const list of Object.values(map)) {
    result.push(...list);
  }
  return result;
}

/** Add an interaction to a node. */
export function addInteraction(
  doc: Document,
  nodeId: NodeId,
  interaction: Omit<DocumentInteraction, 'id' | 'nodeId'> & { id?: string },
): { doc: Document; id: string } {
  const id = interaction.id ?? interactionId();
  const entry: DocumentInteraction = {
    ...interaction,
    id,
    nodeId,
  };
  const existing = doc.interactions?.[nodeId] ?? [];
  return {
    doc: {
      ...doc,
      interactions: {
        ...(doc.interactions ?? {}),
        [nodeId]: [...existing, entry],
      },
    },
    id,
  };
}

/** Remove an interaction by id from any node. */
export function removeInteraction(doc: Document, interactionId: string): Document {
  const map = doc.interactions;
  if (!map) return doc;

  let changed = false;
  const next: Record<NodeId, DocumentInteraction[]> = {};
  for (const [nodeId, list] of Object.entries(map)) {
    const filtered = list.filter((ix) => ix.id !== interactionId);
    if (filtered.length !== list.length) changed = true;
    if (filtered.length > 0) next[nodeId] = filtered;
  }
  if (!changed) return doc;
  return { ...doc, interactions: Object.keys(next).length > 0 ? next : undefined };
}

/** Update an interaction by id. */
export function updateInteraction(
  doc: Document,
  interactionId: string,
  updates: Partial<Omit<DocumentInteraction, 'id' | 'nodeId'>>,
): Document {
  const map = doc.interactions;
  if (!map) return doc;

  let changed = false;
  const next: Record<NodeId, DocumentInteraction[]> = {};
  for (const [nodeId, list] of Object.entries(map)) {
    next[nodeId] = list.map((ix) => {
      if (ix.id !== interactionId) return ix;
      changed = true;
      return { ...ix, ...updates };
    });
  }
  if (!changed) return doc;
  return { ...doc, interactions: next };
}

/** Remove all interactions targeting a node (call when node is deleted). */
export function clearInteractionsForNode(doc: Document, nodeId: NodeId): Document {
  if (!doc.interactions?.[nodeId]) return doc;
  const next = { ...doc.interactions };
  delete next[nodeId];
  return {
    ...doc,
    interactions: Object.keys(next).length > 0 ? next : undefined,
  };
}
