import { describe, expect, it } from 'vitest';
import {
  buildVariableDependencyMap,
  createVariableStore,
  getChangedVariableIds,
  resolve,
  type VariableStore,
} from './variables';

function storeWith(opts?: Partial<VariableStore>): VariableStore {
  return { ...createVariableStore(), ...opts };
}

describe('resolve', () => {
  it('returns a literal numeric value', () => {
    const store = storeWith({
      variables: {
        v1: { id: 'v1', name: 'base', type: 'number', valuesByMode: { default: 8 } },
      },
    });
    expect(resolve(store, 'base')).toBe(8);
  });

  it('returns a literal string value', () => {
    const store = storeWith({
      variables: {
        v1: { id: 'v1', name: 'title', type: 'string', valuesByMode: { default: 'Hello' } },
      },
    });
    expect(resolve(store, 'title')).toBe('Hello');
  });

  it('returns per-mode value when active mode differs', () => {
    const store = storeWith({
      modes: ['default', 'dense'],
      activeMode: 'dense',
      variables: {
        v1: { id: 'v1', name: 'space', type: 'number', valuesByMode: { default: 8, dense: 4 } },
      },
    });
    expect(resolve(store, 'space')).toBe(4);
  });

  it('evaluates math expression with alias', () => {
    const store = storeWith({
      variables: {
        v1: { id: 'v1', name: 'base', type: 'number', valuesByMode: { default: 10 } },
        v2: {
          id: 'v2',
          name: 'scaled',
          type: 'number',
          valuesByMode: { default: '{base} * 1.5' },
        },
      },
    });
    expect(resolve(store, 'scaled')).toBe(15);
  });

  it('evaluates chained alias expression', () => {
    const store = storeWith({
      variables: {
        a: { id: 'a', name: 'space-2', type: 'number', valuesByMode: { default: 8 } },
        b: {
          id: 'b',
          name: 'computed',
          type: 'number',
          valuesByMode: { default: '{space-2} + 4' },
        },
      },
    });
    expect(resolve(store, 'computed')).toBe(12);
  });

  it('evaluates nested alias references', () => {
    const store = storeWith({
      variables: {
        a: { id: 'a', name: 'base', type: 'number', valuesByMode: { default: 2 } },
        b: {
          id: 'b',
          name: 'doubled',
          type: 'number',
          valuesByMode: { default: '{base} * 2' },
        },
        c: {
          id: 'c',
          name: 'quadrupled',
          type: 'number',
          valuesByMode: { default: '{doubled} * 2' },
        },
      },
    });
    expect(resolve(store, 'quadrupled')).toBe(8);
  });

  it('throws on alias cycle', () => {
    const store = storeWith({
      variables: {
        a: {
          id: 'a',
          name: 'a',
          type: 'number',
          valuesByMode: { default: '{b}' },
        },
        b: {
          id: 'b',
          name: 'b',
          type: 'number',
          valuesByMode: { default: '{a}' },
        },
      },
    });
    expect(() => resolve(store, 'a')).toThrow();
  });

  it('throws when alias in math is non-numeric', () => {
    const store = storeWith({
      variables: {
        a: { id: 'a', name: 'title', type: 'string', valuesByMode: { default: 'Hello' } },
        b: {
          id: 'b',
          name: 'expr',
          type: 'number',
          valuesByMode: { default: '{title} * 2' },
        },
      },
    });
    expect(() => resolve(store, 'expr')).toThrow('must be numeric');
  });

  it('throws on unknown alias in expression', () => {
    const store = storeWith({
      variables: {
        v: {
          id: 'v',
          name: 'expr',
          type: 'number',
          valuesByMode: { default: '{unknown} + 1' },
        },
      },
    });
    expect(() => resolve(store, 'expr')).toThrow('unknown variable');
  });

  it('resolves by id when name is not found', () => {
    const store = storeWith({
      variables: {
        'abc-123': { id: 'abc-123', name: 'myVar', type: 'number', valuesByMode: { default: 42 } },
      },
    });
    expect(resolve(store, 'abc-123')).toBe(42);
  });
});

describe('getChangedVariableIds', () => {
  it('returns empty set when both stores are undefined', () => {
    expect([...getChangedVariableIds(undefined, undefined)]).toEqual([]);
  });

  it('returns empty set when stores are identical', () => {
    const store = storeWith({
      variables: {
        v1: { id: 'v1', name: 'a', type: 'number', valuesByMode: { default: 8 } },
      },
    });
    expect([...getChangedVariableIds(store, store)]).toEqual([]);
  });

  it('returns empty set when stores have identical values', () => {
    const a = storeWith({
      variables: {
        v1: { id: 'v1', name: 'a', type: 'number', valuesByMode: { default: 8 } },
      },
    });
    const b = storeWith({
      variables: {
        v1: { id: 'v1', name: 'a', type: 'number', valuesByMode: { default: 8 } },
      },
    });
    expect([...getChangedVariableIds(a, b)]).toEqual([]);
  });

  it('returns changed variable ID when a single value changes', () => {
    const a = storeWith({
      variables: {
        v1: { id: 'v1', name: 'a', type: 'number', valuesByMode: { default: 8 } },
      },
    });
    const b = storeWith({
      variables: {
        v1: { id: 'v1', name: 'a', type: 'number', valuesByMode: { default: 16 } },
      },
    });
    expect([...getChangedVariableIds(a, b)]).toEqual(['v1']);
  });

  it('detects mode-specific value changes', () => {
    const a = storeWith({
      modes: ['default', 'dark'],
      variables: {
        v1: { id: 'v1', name: 'a', type: 'number', valuesByMode: { default: 8, dark: 4 } },
      },
    });
    const b = storeWith({
      modes: ['default', 'dark'],
      variables: {
        v1: { id: 'v1', name: 'a', type: 'number', valuesByMode: { default: 8, dark: 6 } },
      },
    });
    expect([...getChangedVariableIds(a, b)]).toEqual(['v1']);
  });

  it('detects when a variable is added', () => {
    const a = storeWith({ variables: {} });
    const b = storeWith({
      variables: {
        v1: { id: 'v1', name: 'new', type: 'number', valuesByMode: { default: 42 } },
      },
    });
    expect([...getChangedVariableIds(a, b)]).toEqual(['v1']);
  });

  it('detects when a variable is removed', () => {
    const a = storeWith({
      variables: {
        v1: { id: 'v1', name: 'old', type: 'number', valuesByMode: { default: 42 } },
      },
    });
    const b = storeWith({ variables: {} });
    expect([...getChangedVariableIds(a, b)]).toEqual(['v1']);
  });
});

describe('buildVariableDependencyMap', () => {
  it('returns empty map when no bindings exist', () => {
    const nodes = {
      n1: {},
      n2: {},
    };
    const map = buildVariableDependencyMap(nodes, undefined);
    expect(map.size).toBe(0);
  });

  it('maps a variable ID to the node bound to it', () => {
    const nodes = {
      n1: { bindings: { fill: { variableId: 'v1' } } },
      n2: {},
    };
    const map = buildVariableDependencyMap(nodes);
    expect([...map.get('v1')!]).toEqual(['n1']);
  });

  it('maps multiple nodes bound to the same variable', () => {
    const nodes = {
      n1: { bindings: { fill: { variableId: 'v1' } } },
      n2: { bindings: { opacity: { variableId: 'v1' } } },
    };
    const map = buildVariableDependencyMap(nodes);
    expect([...map.get('v1')!]).toEqual(['n1', 'n2']);
  });

  it('follows alias chains', () => {
    const nodes = {
      n1: { bindings: { fill: { variableId: 'vA' } } },
    };
    const store = storeWith({
      variables: {
        vA: {
          id: 'vA',
          name: 'a',
          type: 'number',
          valuesByMode: { default: '{vB}' },
        },
        vB: {
          id: 'vB',
          name: 'b',
          type: 'number',
          valuesByMode: { default: 8 },
        },
      },
    });
    const map = buildVariableDependencyMap(nodes, store);
    // n1 should depend on both vA and vB (since vA = "{vB}")
    expect([...map.get('vA')!]).toEqual(['n1']);
    expect([...map.get('vB')!]).toEqual(['n1']);
  });

  it('follows transitive alias chains (A -> B -> C)', () => {
    const nodes = {
      n1: { bindings: { fill: { variableId: 'vA' } } },
    };
    const store = storeWith({
      variables: {
        vA: {
          id: 'vA',
          name: 'a',
          type: 'number',
          valuesByMode: { default: '{vB}' },
        },
        vB: {
          id: 'vB',
          name: 'b',
          type: 'number',
          valuesByMode: { default: '{vC}' },
        },
        vC: {
          id: 'vC',
          name: 'c',
          type: 'number',
          valuesByMode: { default: 4 },
        },
      },
    });
    const map = buildVariableDependencyMap(nodes, store);
    expect([...map.get('vA')!]).toEqual(['n1']);
    expect([...map.get('vB')!]).toEqual(['n1']);
    expect([...map.get('vC')!]).toEqual(['n1']);
  });

  it('follows alias chains by variable name (not just id)', () => {
    const nodes = {
      n1: { bindings: { fill: { variableId: 'v1' } } },
    };
    const store = storeWith({
      variables: {
        v1: {
          id: 'v1',
          name: 'base',
          type: 'number',
          valuesByMode: { default: '{secondary}' },
        },
        v2: {
          id: 'v2',
          name: 'secondary',
          type: 'number',
          valuesByMode: { default: 12 },
        },
      },
    });
    const map = buildVariableDependencyMap(nodes, store);
    expect([...map.get('v2')!]).toEqual(['n1']);
  });
});
