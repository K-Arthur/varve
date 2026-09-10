import { describe, expect, test } from 'vitest';
import {
  addToSelectionSet,
  createEmptySelectionSetsData,
  createSelectionSet,
  deleteSelectionSet,
  duplicateSelectionSet,
  getAvailableMembers,
  migrateSelectionSets,
  removeFromSelectionSet,
  removeMissingMembers,
  renameSelectionSet,
  reorderSelectionSets,
  type SelectionSetsData,
  updateSelectionSetNodes,
} from '../selectionSet';

describe('SelectionSet', () => {
  test('createSelectionSet creates a set with stable node IDs', () => {
    const set = createSelectionSet('My Set', ['node1', 'node2', 'node3']);
    expect(set.name).toBe('My Set');
    expect(set.nodeIds).toEqual(['node1', 'node2', 'node3']);
    expect(set.id).toBeTruthy();
    expect(set.createdAt).toBeTruthy();
    expect(set.updatedAt).toBeTruthy();
    expect(set.scope.type).toBe('document');
  });

  test('createSelectionSet with page scope', () => {
    const set = createSelectionSet('Page Set', ['n1'], { type: 'page', id: 'page1' });
    expect(set.scope.type).toBe('page');
    expect(set.scope.id).toBe('page1');
  });

  test('renameSelectionSet updates name and updatedAt', async () => {
    const data = createEmptySelectionSetsData();
    const set = createSelectionSet('Original', ['n1']);
    const dataWithSet = { ...data, sets: [set] };

    // Wait to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    const renamed = renameSelectionSet(dataWithSet, set.id, 'Renamed');
    expect(renamed.sets[0]?.name).toBe('Renamed');
    expect(renamed.sets[0]?.updatedAt).not.toBe(set.updatedAt);
  });

  test('deleteSelectionSet removes the set', () => {
    const set1 = createSelectionSet('Set 1', ['n1']);
    const set2 = createSelectionSet('Set 2', ['n2']);
    let data: SelectionSetsData = { version: 1, sets: [set1, set2] };

    data = deleteSelectionSet(data, set1.id);
    expect(data.sets.length).toBe(1);
    expect(data.sets[0]?.id).toBe(set2.id);
  });

  test('duplicateSelectionSet creates a copy with new ID', () => {
    const set = createSelectionSet('Original', ['n1', 'n2']);
    let data: SelectionSetsData = { version: 1, sets: [set] };

    data = duplicateSelectionSet(data, set.id);
    expect(data.sets.length).toBe(2);
    expect(data.sets[1]?.name).toBe('Original Copy');
    expect(data.sets[1]?.id).not.toBe(set.id);
    expect(data.sets[1]?.nodeIds).toEqual(['n1', 'n2']);
  });

  test('updateSelectionSetNodes replaces node IDs', () => {
    const set = createSelectionSet('Set', ['n1', 'n2']);
    let data: SelectionSetsData = { version: 1, sets: [set] };

    data = updateSelectionSetNodes(data, set.id, ['n3', 'n4', 'n5']);
    expect(data.sets[0]?.nodeIds).toEqual(['n3', 'n4', 'n5']);
  });

  test('addToSelectionSet adds new IDs without duplicates', () => {
    const set = createSelectionSet('Set', ['n1', 'n2']);
    let data: SelectionSetsData = { version: 1, sets: [set] };

    data = addToSelectionSet(data, set.id, ['n2', 'n3']);
    expect(data.sets[0]?.nodeIds).toEqual(['n1', 'n2', 'n3']);
  });

  test('removeFromSelectionSet removes specified IDs', () => {
    const set = createSelectionSet('Set', ['n1', 'n2', 'n3']);
    let data: SelectionSetsData = { version: 1, sets: [set] };

    data = removeFromSelectionSet(data, set.id, ['n2']);
    expect(data.sets[0]?.nodeIds).toEqual(['n1', 'n3']);
  });

  test('reorderSelectionSets moves set up and down', () => {
    const set1 = createSelectionSet('Set 1', ['n1']);
    const set2 = createSelectionSet('Set 2', ['n2']);
    const set3 = createSelectionSet('Set 3', ['n3']);
    let data: SelectionSetsData = { version: 1, sets: [set1, set2, set3] };

    // Move set 0 down
    data = reorderSelectionSets(data, 0, 1);
    expect(data.sets.map((s) => s.id)).toEqual([set2.id, set1.id, set3.id]);

    // Move set 1 back up
    data = reorderSelectionSets(data, 1, 0);
    expect(data.sets.map((s) => s.id)).toEqual([set1.id, set2.id, set3.id]);
  });

  test('getAvailableMembers separates available and missing', () => {
    const availableNodes = new Set(['n1', 'n3']);
    const result = getAvailableMembers(['n1', 'n2', 'n3', 'n4'], availableNodes);
    expect(result.available).toEqual(['n1', 'n3']);
    expect(result.missing).toEqual(['n2', 'n4']);
  });

  test('removeMissingMembers removes deleted nodes from sets', () => {
    const set1 = createSelectionSet('Set 1', ['n1', 'n2']);
    const set2 = createSelectionSet('Set 2', ['n3', 'n4']);
    let data: SelectionSetsData = { version: 1, sets: [set1, set2] };

    const availableNodes = new Set(['n1', 'n4']);
    data = removeMissingMembers(data, availableNodes);
    expect(data.sets[0]?.nodeIds).toEqual(['n1']);
    expect(data.sets[1]?.nodeIds).toEqual(['n4']);
  });

  test('migrateSelectionSets handles missing data', () => {
    const result = migrateSelectionSets(undefined);
    expect(result.version).toBe(1);
    expect(result.sets).toEqual([]);
  });

  test('migrateSelectionSets handles invalid data', () => {
    const result = migrateSelectionSets({ version: 0, sets: 'invalid' });
    expect(result.version).toBe(1);
    expect(result.sets).toEqual([]);
  });

  test('migrateSelectionSets preserves valid sets', () => {
    const set = createSelectionSet('Valid', ['n1']);
    const raw = { version: 1, sets: [set] };
    const result = migrateSelectionSets(raw);
    expect(result.sets.length).toBe(1);
    expect(result.sets[0]?.name).toBe('Valid');
  });

  test('duplicateSelectionSet returns unchanged when ID not found', () => {
    const data = createEmptySelectionSetsData();
    const result = duplicateSelectionSet(data, 'nonexistent');
    expect(result).toEqual(data);
  });

  test('renameSelectionSet returns unchanged when ID not found', () => {
    const data = createEmptySelectionSetsData();
    const result = renameSelectionSet(data, 'nonexistent', 'New Name');
    expect(result).toEqual(data);
  });
});
