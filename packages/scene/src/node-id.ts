import type { IdRng } from './identity';
import { mintId } from './identity';
import type { NodeId } from './types';

/**
 * Allocate the next stable node id from a document-shaped counter.
 *
 * Since ADR-0025 the id is collision-resistant across independently edited
 * copies of the same document: the counter provides per-document ordering,
 * the random component prevents branch collisions. Legacy `n<counter>` ids
 * remain readable; only new allocations are minted.
 */
export function nextNodeId<T extends { nextId: number }>(
  doc: T,
  rng?: IdRng,
): { id: NodeId; doc: T } {
  const id = mintId('n', doc.nextId, rng);
  return { id, doc: { ...doc, nextId: doc.nextId + 1 } };
}
