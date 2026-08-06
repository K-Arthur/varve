/**
 * Rebuildable entity-history index (ADR-0020).
 *
 * Maps persistent entity ids to the operations that touched them. The index
 * is derived data: it can always be rebuilt from the log, so backends may
 * cache it and drop it freely.
 */
import type { HistoryStore } from './store';
import type { StoredOperation } from './types';

export interface EntityHistoryIndex {
  /** entityId → operation ids (in logical order). */
  byEntity: Map<string, string[]>;
  operationCount: number;
}

/** Rebuild the entity index from a document's full log. */
export async function buildEntityIndex(
  store: HistoryStore,
  documentId: string,
): Promise<EntityHistoryIndex> {
  const byEntity = new Map<string, string[]>();
  let operationCount = 0;
  const segments = await store.listSegments(documentId);
  for (const segment of segments) {
    for (const op of segment.operations) {
      operationCount += 1;
      for (const entityId of op.affectedEntityIds) {
        const list = byEntity.get(entityId) ?? [];
        list.push(op.operationId);
        byEntity.set(entityId, list);
      }
    }
  }
  return { byEntity, operationCount };
}

/** Operations touching a specific entity, in logical order. */
export async function entityOperations(
  store: HistoryStore,
  documentId: string,
  entityId: string,
): Promise<StoredOperation[]> {
  const out: StoredOperation[] = [];
  const segments = await store.listSegments(documentId);
  for (const segment of segments) {
    for (const op of segment.operations) {
      if (op.affectedEntityIds.includes(entityId)) out.push(op);
    }
  }
  return out;
}
