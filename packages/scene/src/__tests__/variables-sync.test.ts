import { describe, expect, it } from 'vitest';
import {
  addNode,
  addVariableToDocument,
  createDocument,
  deleteVariableFromDocument,
  makeShapeNode,
  setVariableModeOnDocument,
  updateVariableInDocument,
} from '../document';
import type { Variable, VariableStore } from '../variables';
import { createVariableStore, mergeVariableStores } from '../variables';

function makeVar(
  id: string,
  name: string,
  type: 'color' | 'number' | 'string' | 'boolean' = 'number',
  value: Variable['valuesByMode'] = { default: 42 },
): Variable {
  return { id, name, type, valuesByMode: value };
}

describe('mergeVariableStores', () => {
  it('merges two stores, source wins on conflict', () => {
    const base: VariableStore = createVariableStore(['default']);
    base.variables = { v1: makeVar('v1', 'base-var', 'number', { default: 10 }) };
    base.activeMode = 'default';

    const source: VariableStore = createVariableStore(['default']);
    source.variables = { v1: makeVar('v1', 'source-var', 'number', { default: 99 }) };
    source.activeMode = 'light';

    const merged = mergeVariableStores(base, source);
    expect(merged.variables.v1?.name).toBe('source-var');
    expect(merged.variables.v1?.valuesByMode.default).toBe(99);
    expect(merged.activeMode).toBe('light');
  });

  it('handles empty base', () => {
    const base: VariableStore = createVariableStore();
    const source: VariableStore = createVariableStore(['default']);
    source.variables = { v1: makeVar('v1', 'only-var') };

    const merged = mergeVariableStores(base, source);
    expect(merged.variables.v1?.name).toBe('only-var');
  });

  it('handles empty source', () => {
    const base: VariableStore = createVariableStore(['default']);
    base.variables = { v1: makeVar('v1', 'base-only') };

    const merged = mergeVariableStores(base, createVariableStore());
    expect(merged.variables.v1?.name).toBe('base-only');
  });

  it('preserves non-conflicting variables from both', () => {
    const base = createVariableStore(['default']);
    base.variables = { v1: makeVar('v1', 'from-base') };

    const source = createVariableStore(['default']);
    source.variables = { v2: makeVar('v2', 'from-source') };

    const merged = mergeVariableStores(base, source);
    expect(Object.keys(merged.variables).sort()).toEqual(['v1', 'v2']);
    expect(merged.variables.v1?.name).toBe('from-base');
    expect(merged.variables.v2?.name).toBe('from-source');
  });
});

describe('Document variable operations', () => {
  it('addVariableToDocument adds variable and returns new document', () => {
    const doc = createDocument('test');
    const v = makeVar('v1', 'my-var', 'number', { default: 100 });
    const doc2 = addVariableToDocument(doc, v);

    expect(doc2).not.toBe(doc);
    expect(doc2.variableStore?.variables.v1?.name).toBe('my-var');
    expect(doc2.variableStore?.variables.v1?.valuesByMode.default).toBe(100);
    expect(doc.variableStore?.variables.v1).toBeUndefined();
  });

  it('updateVariableInDocument patches existing variable', () => {
    const doc = createDocument('test');
    const v = makeVar('v1', 'original', 'number', { default: 10 });
    const doc2 = addVariableToDocument(doc, v);

    const doc3 = updateVariableInDocument(doc2, 'v1', {
      name: 'updated',
      valuesByMode: { default: 99 },
    });
    expect(doc3.variableStore?.variables.v1?.name).toBe('updated');
    expect(doc3.variableStore?.variables.v1?.valuesByMode.default).toBe(99);
    expect(doc3.variableStore?.variables.v1?.type).toBe('number');
  });

  it('deleteVariableFromDocument removes bindings referencing the variable', () => {
    let doc = createDocument('test');
    const v = makeVar('v1', 'primary', 'color', { default: '#39d0c6' });
    doc = addVariableToDocument(doc, v);
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    doc = addNode(doc, shape);
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        n1: {
          ...doc.nodes.n1!,
          bindings: { fill: { variableId: 'v1' } },
        },
      },
    };

    const doc3 = deleteVariableFromDocument(doc, 'v1');
    expect(doc3.variableStore?.variables.v1).toBeUndefined();
    expect(doc3.nodes.n1?.bindings?.fill).toBeUndefined();
  });

  it('deleteVariableFromDocument removes variable', () => {
    const doc = createDocument('test');
    const v = makeVar('v1', 'to-delete');
    const doc2 = addVariableToDocument(doc, v);
    expect(doc2.variableStore?.variables.v1).toBeDefined();

    const doc3 = deleteVariableFromDocument(doc2, 'v1');
    expect(doc3.variableStore?.variables.v1).toBeUndefined();
    expect(doc2.variableStore?.variables.v1).toBeDefined();
  });

  it('setVariableModeOnDocument updates active mode', () => {
    const doc = createDocument('test');
    const doc2 = setVariableModeOnDocument(doc, 'dark');
    expect(doc2.variableStore?.activeMode).toBe('dark');
    expect(doc2.variableStore?.modes).toContain('dark');
  });
});
