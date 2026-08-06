/**
 * Baseline capture of the existing variable system — recorded BEFORE the
 * design-token synchronization work begins (Milestone 1).
 *
 * These tests pin the current behavior so that any change introduced by the
 * token-sync architecture (stable identities, provenance, three-way merge,
 * collections UI) is a deliberate, reviewed change — not a silent drift.
 *
 * Known limitations deliberately pinned here (each is a documented migration
 * risk, not a defect to fix silently):
 *
 * - Variable IDs were process-local counters (`v1`, `col-1`, `grp-1`) at
 *   audit time; a concurrent session replaced them with random hex ids
 *   (`v-<hex>`) while this program was in flight — collision resistance
 *   improved, but ids are still not canonical token identities and are not
 *   derived from the synchronized source. The id-format pins below record
 *   the current behavior.
 * - Aliases resolve by NAME (or id), so renaming a variable breaks every
 *   `{name}` alias that targeted it.
 * - `mergeVariableStores` is a two-way "source wins" overwrite, not a
 *   three-way merge.
 * - Store-level `deleteVariable` does not strip node bindings (document-level
 *   `deleteVariableFromDocument` does).
 * - `resolve` mixes id lookup and first-match-by-name lookup, so duplicate
 *   names produce non-deterministic resolution order.
 */
import { describe, expect, it } from 'vitest';

import { createDocument, deleteVariableFromDocument } from '../document';
import { DocumentCodec } from '../documentCodec';
import { serializeDocument } from '../index';
import {
  addModeToCollection,
  addVariable,
  addVariableToCollection,
  buildVariableDependencyMap,
  createCollection,
  createVariableStore,
  deleteVariable,
  getChangedVariableIds,
  mergeVariableStores,
  resolve,
  resolveBinding,
  setCollectionMode,
  updateVariable,
} from '../variables';

describe('variable-system baseline', () => {
  it('createVariableStore defaults to a single "default" mode', () => {
    const store = createVariableStore();
    expect(store.modes).toEqual(['default']);
    expect(store.activeMode).toBe('default');
    expect(store.activeCollectionId).toBe('');
    expect(store.variables).toEqual({});
    expect(store.collections).toEqual({});
  });

  it('addVariable assigns collision-resistant random ids and stores valuesByMode', () => {
    const store = createVariableStore();
    const { variable } = addVariable(store, {
      name: 'brand.primary',
      type: 'color',
      valuesByMode: { default: '#0066cc' },
    });
    expect(variable.id).toMatch(/^v-[0-9a-f]{16}$/);
    expect(variable.name).toBe('brand.primary');
    expect(variable.valuesByMode).toEqual({ default: '#0066cc' });
  });

  it('consecutive adds produce unique ids', () => {
    const store = createVariableStore();
    const { variable: a } = addVariable(store, {
      name: 'a',
      type: 'number',
      valuesByMode: { default: 1 },
    });
    const { variable: b } = addVariable(store, {
      name: 'b',
      type: 'number',
      valuesByMode: { default: 2 },
    });
    expect(a.id).not.toBe(b.id);
  });

  it('collection and group ids are random (col-<hex> / grp-<hex>)', () => {
    const { collection, store } = createCollection(createVariableStore(), 'Semantic', [
      'light',
      'dark',
    ]);
    expect(collection.id).toMatch(/^col-[0-9a-f]{16}$/);
    expect(collection.modes).toEqual(['light', 'dark']);
    expect(collection.activeMode).toBe('light');

    const { variable } = addVariableToCollection(store, collection.id, {
      name: 'primary',
      type: 'color',
      valuesByMode: { light: '#ffffff', dark: '#000000' },
    });
    expect(variable.id).toMatch(/^v-[0-9a-f]{16}$/);
  });

  it('resolution honors the collection active mode', () => {
    const { collection, store } = createCollection(createVariableStore(), 'Theme', [
      'light',
      'dark',
    ]);
    const { variable, store: s2 } = addVariableToCollection(store, collection.id, {
      name: 'bg',
      type: 'color',
      valuesByMode: { light: '#ffffff', dark: '#000000' },
    });
    let s = setCollectionMode(s2, collection.id, 'dark');
    expect(resolve(s, variable.id)).toBe('#000000');
    s = setCollectionMode(s, collection.id, 'light');
    expect(resolve(s, variable.id)).toBe('#ffffff');
  });

  it('addModeToCollection appends a mode and keeps existing values', () => {
    const { collection, store } = createCollection(createVariableStore(), 'Theme', ['light']);
    const s = addModeToCollection(store, collection.id, 'dark');
    expect(s.collections[collection.id]?.modes).toEqual(['light', 'dark']);
  });

  it('pure aliases resolve by name and by id', () => {
    const store = createVariableStore();
    const a = addVariable(store, { name: 'base', type: 'number', valuesByMode: { default: 10 } });
    const b = addVariable(a.store, {
      name: 'alias',
      type: 'number',
      valuesByMode: { default: '{base}' },
    });
    expect(resolve(b.store, b.variable.id)).toBe(10);
    expect(resolve(b.store, 'base')).toBe(10);
  });

  it('math expressions evaluate through the Pratt parser with aliases', () => {
    const store = createVariableStore();
    const a = addVariable(store, { name: 'base', type: 'number', valuesByMode: { default: 4 } });
    const b = addVariable(a.store, {
      name: 'doubled',
      type: 'number',
      valuesByMode: { default: '{base} * 2 + 1' },
    });
    expect(resolve(b.store, b.variable.id)).toBe(9);
  });

  it('circular alias chains throw during resolution', () => {
    const store = createVariableStore();
    const a = addVariable(store, { name: 'a', type: 'number', valuesByMode: { default: '{b}' } });
    const b = addVariable(a.store, { name: 'b', type: 'number', valuesByMode: { default: '{a}' } });
    expect(() => resolve(b.store, a.variable.id)).toThrow(/circular|unknown/i);
  });

  it('resolving an unknown variable throws', () => {
    expect(() => resolve(createVariableStore(), 'missing')).toThrow(/unknown variable/);
  });

  it('PINNED LIMITATION: renaming a variable breaks name-based aliases', () => {
    const store = createVariableStore();
    const a = addVariable(store, { name: 'base', type: 'number', valuesByMode: { default: 10 } });
    const b = addVariable(a.store, {
      name: 'alias',
      type: 'number',
      valuesByMode: { default: '{base}' },
    });
    const renamed = updateVariable(b.store, a.variable.id, { name: 'renamed' });
    expect(() => resolve(renamed, b.variable.id)).toThrow(/unknown variable: base/);
  });

  it('PINNED LIMITATION: resolve mixes id lookup with first-match name lookup', () => {
    const store = createVariableStore();
    const a = addVariable(store, { name: 'dup', type: 'number', valuesByMode: { default: 1 } });
    const b = addVariable(a.store, { name: 'dup', type: 'number', valuesByMode: { default: 2 } });
    expect(resolve(b.store, 'dup')).toBe(1);
  });

  it('PINNED LIMITATION: mergeVariableStores is two-way source-wins', () => {
    const base = createVariableStore(['default']);
    base.variables = {
      v1: { id: 'v1', name: 'base-var', type: 'number', valuesByMode: { default: 10 } },
    };
    const source = createVariableStore(['default']);
    source.variables = {
      v1: { id: 'v1', name: 'source-var', type: 'number', valuesByMode: { default: 99 } },
    };
    const merged = mergeVariableStores(base, source);
    expect(merged.variables.v1?.valuesByMode.default).toBe(99);
    expect(merged.variables.v1?.name).toBe('source-var');
  });

  it('PINNED LIMITATION: colliding ids from independent stores merge silently (source wins)', () => {
    const base = createVariableStore(['default']);
    base.variables = {
      v1: { id: 'v1', name: 'left', type: 'number', valuesByMode: { default: 1 } },
    };
    const source = createVariableStore(['default']);
    source.variables = {
      v1: { id: 'v1', name: 'right', type: 'number', valuesByMode: { default: 2 } },
    };
    const merged = mergeVariableStores(base, source);
    expect(Object.keys(merged.variables)).toEqual(['v1']);
    expect(merged.variables.v1?.name).toBe('right');
  });

  it('store-level deleteVariable removes from collections and groups but leaves node bindings', () => {
    const { collection, store } = createCollection(createVariableStore(), 'Semantic');
    const { variable, store: s2 } = addVariableToCollection(store, collection.id, {
      name: 'gone',
      type: 'number',
      valuesByMode: { default: 1 },
    });
    const s3 = deleteVariable(s2, variable.id);
    expect(s3.variables[variable.id]).toBeUndefined();
    expect(s3.collections[collection.id]?.variableIds).not.toContain(variable.id);
    expect(() => resolve(s3, variable.id)).toThrow();
  });

  it('document-level deleteVariableFromDocument strips node bindings', () => {
    const doc = createDocument();
    const store = createVariableStore();
    const { variable, store: s2 } = addVariable(store, {
      name: 'fill',
      type: 'color',
      valuesByMode: { default: '#ff0000' },
    });
    const withNode = {
      ...doc,
      variableStore: s2,
      nodes: {
        ...doc.nodes,
        n1: {
          ...(doc.nodes.n1 as import('../types').ShapeNode),
          name: 'Box',
          bindings: { fill: { variableId: variable.id } },
        },
      },
    };
    const cleaned = deleteVariableFromDocument(withNode, variable.id);
    expect(cleaned.variableStore?.variables[variable.id]).toBeUndefined();
    expect(cleaned.nodes.n1?.bindings).toBeUndefined();
  });

  it('getChangedVariableIds detects added, removed, and value-changed variables', () => {
    const store = createVariableStore();
    const a = addVariable(store, { name: 'a', type: 'number', valuesByMode: { default: 1 } });
    const b = addVariable(a.store, { name: 'b', type: 'number', valuesByMode: { default: 2 } });
    const changed = getChangedVariableIds(a.store, b.store);
    expect([...changed]).toEqual([b.variable.id]);
    const updated = updateVariable(b.store, a.variable.id, {
      valuesByMode: { default: 5 },
    });
    const changed2 = getChangedVariableIds(b.store, updated);
    expect([...changed2]).toEqual([a.variable.id]);
  });

  it('buildVariableDependencyMap follows alias chains from bound nodes', () => {
    const store = createVariableStore();
    const a = addVariable(store, { name: 'base', type: 'number', valuesByMode: { default: 1 } });
    const b = addVariable(a.store, {
      name: 'alias',
      type: 'number',
      valuesByMode: { default: '{base}' },
    });
    const nodes = { n1: { bindings: { x: { variableId: b.variable.id } } } };
    const map = buildVariableDependencyMap(nodes, b.store);
    expect(map.get(b.variable.id)).toEqual(new Set(['n1']));
    expect(map.get(a.variable.id)).toEqual(new Set(['n1']));
  });

  it('PINNED LIMITATION: broken aliases produce no dependency map entries', () => {
    const store = createVariableStore();
    const a = addVariable(store, { name: 'base', type: 'number', valuesByMode: { default: 1 } });
    const b = addVariable(a.store, {
      name: 'alias',
      type: 'number',
      valuesByMode: { default: '{nonexistent.token}' },
    });
    const nodes = { n1: { bindings: { x: { variableId: b.variable.id } } } };
    const map = buildVariableDependencyMap(nodes, b.store);
    expect(map.get(b.variable.id)).toEqual(new Set(['n1']));
    expect(map.get(a.variable.id)).toBeUndefined();
  });

  it('variable ids survive a serialize → decode round trip (identity is persisted, not regenerated)', () => {
    const doc = createDocument();
    const { collection, store } = createCollection(
      createVariableStore(['light', 'dark']),
      'Theme',
      ['light', 'dark'],
    );
    const { variable, store: s2 } = addVariableToCollection(store, collection.id, {
      name: 'brand.primary',
      type: 'color',
      valuesByMode: { light: '#0066cc', dark: '#99ccff' },
    });
    const withStore = { ...doc, variableStore: s2 };
    const json = serializeDocument(withStore);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
    const roundTripped = (decoded as { document: { variableStore: unknown } }).document
      .variableStore;
    expect(roundTripped).toEqual(s2);
    expect(variable.id).toMatch(/^v-[0-9a-f]{16}$/);
  });

  it('resolveBinding applies binding expressions on numeric variables', () => {
    const store = createVariableStore();
    const a = addVariable(store, { name: 'base', type: 'number', valuesByMode: { default: 8 } });
    expect(resolveBinding(a.store, { variableId: a.variable.id })).toBe(8);
    expect(resolveBinding(a.store, { variableId: a.variable.id, expression: '{base} / 2' })).toBe(
      4,
    );
  });
});
