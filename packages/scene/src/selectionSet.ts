import { cryptoId } from './document-utils';
import type { NodeId } from './types';

export interface SelectionSetScope {
  type: 'document' | 'page' | 'component';
  id?: NodeId;
}

export interface SelectionSet {
  id: string;
  name: string;
  nodeIds: NodeId[];
  scope: SelectionSetScope;
  createdAt: string;
  updatedAt: string;
}

export interface SelectionSetsData {
  version: number;
  sets: SelectionSet[];
}

export const CURRENT_SELECTION_SETS_VERSION = 1;

export function createEmptySelectionSetsData(): SelectionSetsData {
  return { version: CURRENT_SELECTION_SETS_VERSION, sets: [] };
}

export function createSelectionSet(
  name: string,
  nodeIds: NodeId[],
  scope: SelectionSetScope = { type: 'document' },
): SelectionSet {
  const now = new Date().toISOString();
  return {
    id: cryptoId(),
    name,
    nodeIds: [...nodeIds],
    scope,
    createdAt: now,
    updatedAt: now,
  };
}

export function renameSelectionSet(
  data: SelectionSetsData,
  setId: string,
  newName: string,
): SelectionSetsData {
  return {
    ...data,
    sets: data.sets.map((s) =>
      s.id === setId ? { ...s, name: newName, updatedAt: new Date().toISOString() } : s,
    ),
  };
}

export function deleteSelectionSet(data: SelectionSetsData, setId: string): SelectionSetsData {
  return { ...data, sets: data.sets.filter((s) => s.id !== setId) };
}

export function duplicateSelectionSet(data: SelectionSetsData, setId: string): SelectionSetsData {
  const source = data.sets.find((s) => s.id === setId);
  if (!source) return data;
  const now = new Date().toISOString();
  const dup: SelectionSet = {
    ...source,
    id: cryptoId(),
    name: `${source.name} Copy`,
    createdAt: now,
    updatedAt: now,
  };
  return { ...data, sets: [...data.sets, dup] };
}

export function updateSelectionSetNodes(
  data: SelectionSetsData,
  setId: string,
  nodeIds: NodeId[],
): SelectionSetsData {
  return {
    ...data,
    sets: data.sets.map((s) =>
      s.id === setId ? { ...s, nodeIds: [...nodeIds], updatedAt: new Date().toISOString() } : s,
    ),
  };
}

export function addToSelectionSet(
  data: SelectionSetsData,
  setId: string,
  nodeIds: NodeId[],
): SelectionSetsData {
  return {
    ...data,
    sets: data.sets.map((s) => {
      if (s.id !== setId) return s;
      const existing = new Set(s.nodeIds);
      for (const id of nodeIds) existing.add(id);
      return { ...s, nodeIds: [...existing], updatedAt: new Date().toISOString() };
    }),
  };
}

export function removeFromSelectionSet(
  data: SelectionSetsData,
  setId: string,
  nodeIds: NodeId[],
): SelectionSetsData {
  const removeSet = new Set(nodeIds);
  return {
    ...data,
    sets: data.sets.map((s) =>
      s.id === setId
        ? {
            ...s,
            nodeIds: s.nodeIds.filter((id) => !removeSet.has(id)),
            updatedAt: new Date().toISOString(),
          }
        : s,
    ),
  };
}

export function reorderSelectionSets(
  data: SelectionSetsData,
  fromIndex: number,
  toIndex: number,
): SelectionSetsData {
  const sets = [...data.sets];
  const [moved] = sets.splice(fromIndex, 1);
  if (moved) sets.splice(toIndex, 0, moved);
  return { ...data, sets };
}

export function getAvailableMembers(
  nodeIds: NodeId[],
  availableNodes: Set<NodeId>,
): { available: NodeId[]; missing: NodeId[] } {
  const available: NodeId[] = [];
  const missing: NodeId[] = [];
  for (const id of nodeIds) {
    if (availableNodes.has(id)) available.push(id);
    else missing.push(id);
  }
  return { available, missing };
}

export function removeMissingMembers(
  data: SelectionSetsData,
  availableNodes: Set<NodeId>,
): SelectionSetsData {
  return {
    ...data,
    sets: data.sets.map((s) => {
      const { available, missing } = getAvailableMembers(s.nodeIds, availableNodes);
      if (missing.length === 0) return s;
      return {
        ...s,
        nodeIds: available,
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

export function migrateSelectionSets(data: unknown): SelectionSetsData {
  if (!data || typeof data !== 'object') return createEmptySelectionSetsData();
  const raw = data as Record<string, unknown>;
  const version = typeof raw.version === 'number' ? raw.version : 0;
  let sets: SelectionSet[] = [];
  if (Array.isArray(raw.sets)) {
    sets = raw.sets.filter(
      (s): s is SelectionSet =>
        typeof s === 'object' && s !== null && typeof (s as SelectionSet).id === 'string',
    );
  }
  if (version < 1) {
    // v0→v1: no migrations needed yet
  }
  return { version: CURRENT_SELECTION_SETS_VERSION, sets };
}
