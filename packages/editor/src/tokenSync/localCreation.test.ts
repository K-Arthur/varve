import { createVariableStore, resolve } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportTokensToDtcg } from './exportWorkflow';
import { createLocalToken } from './localCreation';

describe('local authored token creation', () => {
  it('creates a color and compatible alias in the canonical store, without a source file', () => {
    const empty = createVariableStore();
    const first = createLocalToken(empty, {
      path: 'brand.primary',
      type: 'color',
      value: '#3366cc',
    });
    const next = createLocalToken(first, {
      path: 'semantic.action',
      type: 'color',
      value: '',
      reference: 'brand.primary',
    });
    const alias = Object.values(next.variables).find(
      (variable) => variable.name === 'semantic.action',
    )!;
    expect(resolve(next, alias.id)).toMatchObject({ r: 0.2, g: 0.4, b: 0.8 });
    expect(empty.tokenSync).toBeUndefined();
    expect(Object.keys(next.tokenSync!.store.sources)).toHaveLength(0);
    const exported = JSON.parse(exportTokensToDtcg(next.tokenSync).text);
    expect(exported.semantic.action.$value).toBe('{brand.primary}');
  });

  it('preserves explicit dimension units, including zero', () => {
    const next = createLocalToken(createVariableStore(), {
      path: 'gap.zero',
      type: 'dimension',
      unit: 'px',
      value: '0',
    });
    const variable = Object.values(next.variables)[0]!;
    expect(resolve(next, variable.id)).toBe(0);
    expect(Object.values(next.tokenSync!.store.tokens)[0]?.value).toEqual({ value: 0, unit: 'px' });
  });

  it('rejects a token path that would replace a group containing an existing token', () => {
    const before = createLocalToken(createVariableStore(), {
      path: 'brand.primary',
      type: 'number',
      value: '1',
    });
    expect(() => createLocalToken(before, { path: 'brand', type: 'number', value: '2' })).toThrow(
      'ancestor path',
    );
    expect(Object.keys(before.tokenSync!.store.tokens)).toHaveLength(1);
  });

  it.each([
    { path: 'bad..name', type: 'number', value: '1' },
    { path: 'bad.$name', type: 'number', value: '1' },
    { path: 'weight', type: 'fontWeight', value: '1001' },
    { path: 'gap', type: 'dimension', value: '2' },
    { path: 'alias', type: 'number', value: '', reference: 'missing' },
  ] as const)('rejects invalid authoring atomically: $path', (draft) => {
    const before = createVariableStore();
    expect(() => createLocalToken(before, draft)).toThrow();
    expect(before.tokenSync).toBeUndefined();
    expect(before.variables).toEqual({});
  });
});
