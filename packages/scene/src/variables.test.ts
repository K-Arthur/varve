import { describe, expect, it } from 'vitest';
import { createVariableStore, resolve, type VariableStore } from './variables';

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
