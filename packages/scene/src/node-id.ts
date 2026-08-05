import type { NodeId } from './types';

/** Allocate the next stable node id from a document-shaped counter. */
export function nextNodeId<T extends { nextId: number }>(doc: T): { id: NodeId; doc: T } {
  const id = `n${doc.nextId}`;
  return { id, doc: { ...doc, nextId: doc.nextId + 1 } };
}
