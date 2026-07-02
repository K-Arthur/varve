/**
 * TDD tests for variable collections and groups system.
 *
 * Collections group related variables (like Figma's variable collections).
 * Groups provide nested folder organization within collections.
 */
import { describe, expect, it } from 'vitest';
import {
  addVariableToCollection,
  createCollection,
  createGroup,
  createVariableStore,
  getCollectionVariables,
  resolve,
  resolveVariableInCollection,
  setActiveCollection,
  setCollectionMode,
  type VariableStore,
} from './variables';

function emptyStore(): VariableStore {
  return createVariableStore(['default']);
}

describe('Collections', () => {
  it('creates a collection', () => {
    const store = emptyStore();
    const result = createCollection(store, 'Spacing');
    expect(result.collection.name).toBe('Spacing');
    expect(result.collection.modes).toEqual(['default']);
    expect(result.collection.variableIds).toEqual([]);
    expect(result.store.collections[result.collection.id]).toBeDefined();
  });

  it('creates a collection with custom modes', () => {
    const store = emptyStore();
    const result = createCollection(store, 'Colors', ['light', 'dark', 'contrast']);
    expect(result.collection.modes).toEqual(['light', 'dark', 'contrast']);
  });

  it('adds a variable to a collection', () => {
    const store = emptyStore();
    const { store: s1, collection } = createCollection(store, 'Spacing');
    const { store: s2, variable } = addVariableToCollection(s1, collection.id, {
      id: '',
      name: 'space-xs',
      type: 'number',
      valuesByMode: { default: 4 },
    });
    expect(s2.variables[variable.id]).toBeDefined();
    expect(s2.collections[collection.id].variableIds).toContain(variable.id);
  });

  it('sets active collection', () => {
    const store = emptyStore();
    const { store: s1, collection } = createCollection(store, 'Colors', ['light', 'dark']);
    const s2 = setActiveCollection(s1, collection.id);
    expect(s2.activeCollectionId).toBe(collection.id);
  });

  it('gets variables in a collection', () => {
    let store = emptyStore();
    const { store: s1, collection } = createCollection(store, 'Spacing');
    store = s1;
    const { store: s2 } = addVariableToCollection(store, collection.id, {
      id: '',
      name: 'xs',
      type: 'number',
      valuesByMode: { default: 4 },
    });
    store = s2;
    const { store: s3 } = addVariableToCollection(store, collection.id, {
      id: '',
      name: 'sm',
      type: 'number',
      valuesByMode: { default: 8 },
    });
    store = s3;
    const vars = getCollectionVariables(store, collection.id);
    expect(vars).toHaveLength(2);
    expect(vars[0].name).toBe('xs');
    expect(vars[1].name).toBe('sm');
  });

  it('resolves a variable within its collection context', () => {
    let store = emptyStore();
    const { store: s1, collection } = createCollection(store, 'Spacing', ['default', 'dense']);
    store = s1;

    const { store: s2, variable } = addVariableToCollection(store, collection.id, {
      id: '',
      name: 'gap',
      type: 'number',
      valuesByMode: { default: 16, dense: 8 },
    });
    store = s2;
    store = setCollectionMode(store, collection.id, 'dense');

    const val = resolveVariableInCollection(store, collection.id, variable.name);
    expect(val).toBe(8);
  });
});

describe('Groups', () => {
  it('creates a group within a collection', () => {
    const store = emptyStore();
    const { store: s1, collection } = createCollection(store, 'Colors');
    const s2 = createGroup(s1, collection.id, 'Neutrals');
    const groups = s2.collections[collection.id].groups;
    expect(groups).toHaveLength(1);
    expect(groups?.[0].name).toBe('Neutrals');
  });

  it('creates nested groups', () => {
    const store = emptyStore();
    const { store: s1, collection } = createCollection(store, 'Colors');
    const s2 = createGroup(s1, collection.id, 'Semantic');
    const s3 = createGroup(s2, collection.id, 'Semantic/Text'); // dot-notation nesting

    const groups = s3.collections[collection.id].groups;
    const semanticGroup = groups?.find((g) => g.name === 'Semantic');
    expect(semanticGroup).toBeDefined();
    expect(semanticGroup?.groups).toHaveLength(1);
    expect(semanticGroup?.groups?.[0].name).toBe('Text');
  });

  it('adds variable to a group', () => {
    let store = emptyStore();
    const { store: s1, collection } = createCollection(store, 'Colors');
    store = s1;
    const s2 = createGroup(store, collection.id, 'Semantic');
    store = s2;

    const { store: s3, variable } = addVariableToCollection(
      store,
      collection.id,
      {
        id: '',
        name: 'primary',
        type: 'color',
        valuesByMode: { default: '#39d0c6' },
      },
      'Semantic',
    );
    store = s3;

    // Variable should be in the collection
    expect(store.collections[collection.id].variableIds).toContain(variable.id);

    // Group should reference it too
    const group = store.collections[collection.id].groups?.[0];
    expect(group?.variableIds).toContain(variable.id);
  });
});
