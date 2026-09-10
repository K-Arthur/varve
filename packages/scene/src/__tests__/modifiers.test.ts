/**
 * Typed variable modifier resolution tests.
 *
 * Semantics under test:
 * - multiply: effective = tokenAlpha × factor (relative opacity)
 * - set: effective = absolute alpha (RGB stays linked)
 * - offset: effective = clamp(tokenAlpha + delta, 0, 1)
 * - deterministic order, existing token alpha, aliases, mode switching,
 *   missing variables, type changes, serialization, migration, validation.
 */
import { describe, expect, it } from 'vitest';
import { applyBindingsToNode, resolveBoundFill } from '../bindings';
import type { ManagedColor } from '../colorManagement';
import {
  alphaModifierLabel,
  applyAlphaModifiers,
  effectiveAlpha,
  MAX_MODIFIERS_PER_BINDING,
  normalizedAlpha,
  validateVariableModifiers,
} from '../modifiers';
import { migrateV214ToV215 } from '../modifiersMigration';
import type { PropertyBinding, SceneNode } from '../types';
import { resolveBinding, type VariableStore } from '../variables';

const opaque = (r = 0, g = 0, b = 0, a = 255): ManagedColor => ({ space: 'rgb', r, g, b, a });

function storeWith(colorVariableValue: string | object): VariableStore {
  return {
    variables: {
      v1: {
        id: 'v1',
        name: 'brand.primary',
        type: 'color',
        valuesByMode: { default: colorVariableValue as string, dark: '#123456aa' },
      },
    },
    collections: {
      col1: {
        id: 'col1',
        name: 'Brand',
        modes: ['default', 'dark'],
        activeMode: 'default',
        variableIds: ['v1'],
      },
    },
    activeCollectionId: 'col1',
    modes: ['default', 'dark'],
    activeMode: 'default',
  };
}

function rgbManaged(value: unknown): ManagedColor {
  const fill = resolveBoundFill({ variableId: 'v1' }, value);
  if (!fill) throw new Error('expected a color fill');
  return fill;
}

describe('applyAlphaModifiers', () => {
  it('multiply: token alpha 0.8 × 0.5 = 0.4', () => {
    const result = applyAlphaModifiers({ space: 'rgb', r: 10, g: 20, b: 30, a: 204 }, [
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
    ]);
    expect(result.valid).toBe(true);
    expect(normalizedAlpha(result.color)).toBeCloseTo(0.4, 2);
  });

  it('multiply keeps RGB channels untouched', () => {
    const result = applyAlphaModifiers({ space: 'rgb', r: 10, g: 20, b: 30, a: 255 }, [
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
    ]);
    expect(result.color).toMatchObject({ r: 10, g: 20, b: 30 });
  });

  it('multiply: token alpha 1.0 × 0.5 = 0.5 (opaque token)', () => {
    const result = applyAlphaModifiers(opaque(0, 0, 0, 255), [
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
    ]);
    expect(normalizedAlpha(result.color)).toBeCloseTo(0.5, 2);
  });

  it('set: token alpha 0.8 set to 0.5 = 0.5 (RGB still linked)', () => {
    const result = applyAlphaModifiers({ space: 'rgb', r: 10, g: 20, b: 30, a: 204 }, [
      { kind: 'alpha', operation: 'set', value: 0.5 },
    ]);
    expect(normalizedAlpha(result.color)).toBeCloseTo(0.5, 2);
    expect(result.color).toMatchObject({ r: 10, g: 20, b: 30 });
  });

  it('offset: token alpha 0.8 − 0.2 = 0.6', () => {
    const result = applyAlphaModifiers({ space: 'rgb', r: 10, g: 20, b: 30, a: 204 }, [
      { kind: 'alpha', operation: 'offset', value: -0.2 },
    ]);
    expect(normalizedAlpha(result.color)).toBeCloseTo(0.6, 2);
  });

  it('offset: positive delta raises alpha', () => {
    const result = applyAlphaModifiers({ space: 'rgb', r: 10, g: 20, b: 30, a: 128 }, [
      { kind: 'alpha', operation: 'offset', value: 0.25 },
    ]);
    expect(normalizedAlpha(result.color)).toBeCloseTo(0.75, 2);
  });

  it('clamps to [0, 1]', () => {
    const low = applyAlphaModifiers({ space: 'rgb', r: 0, g: 0, b: 0, a: 128 }, [
      { kind: 'alpha', operation: 'offset', value: -1 },
    ]);
    expect(normalizedAlpha(low.color)).toBe(0);
    const high = applyAlphaModifiers({ space: 'rgb', r: 0, g: 0, b: 0, a: 200 }, [
      { kind: 'alpha', operation: 'offset', value: 1 },
    ]);
    expect(normalizedAlpha(high.color)).toBe(1);
  });

  it('multiply clamps factors above 1', () => {
    const result = applyAlphaModifiers({ space: 'rgb', r: 0, g: 0, b: 0, a: 128 }, [
      { kind: 'alpha', operation: 'multiply', value: 2 },
    ]);
    expect(normalizedAlpha(result.color)).toBe(1);
  });

  it('multiply by zero yields alpha zero', () => {
    const result = applyAlphaModifiers({ space: 'rgb', r: 0, g: 0, b: 0, a: 255 }, [
      { kind: 'alpha', operation: 'multiply', value: 0 },
    ]);
    expect(normalizedAlpha(result.color)).toBe(0);
  });

  it('set zero and set one', () => {
    expect(
      normalizedAlpha(
        applyAlphaModifiers(opaque(), [{ kind: 'alpha', operation: 'set', value: 0 }]).color,
      ),
    ).toBe(0);
    expect(
      normalizedAlpha(
        applyAlphaModifiers(opaque(), [{ kind: 'alpha', operation: 'set', value: 1 }]).color,
      ),
    ).toBe(1);
  });

  it('applies modifiers in deterministic array order', () => {
    const multiplyThenSet = applyAlphaModifiers({ space: 'rgb', r: 0, g: 0, b: 0, a: 255 }, [
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
      { kind: 'alpha', operation: 'set', value: 0.8 },
    ]);
    expect(normalizedAlpha(multiplyThenSet.color)).toBeCloseTo(0.8, 5);
    const setThenMultiply = applyAlphaModifiers({ space: 'rgb', r: 0, g: 0, b: 0, a: 255 }, [
      { kind: 'alpha', operation: 'set', value: 0.8 },
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
    ]);
    expect(normalizedAlpha(setThenMultiply.color)).toBeCloseTo(0.4, 2);
  });

  it('preserves uint16 bit depth scaling', () => {
    const result = applyAlphaModifiers(
      { space: 'rgb', r: 0, g: 0, b: 0, a: 52428, bitDepth: 'uint16' },
      [{ kind: 'alpha', operation: 'multiply', value: 0.5 }],
    );
    expect(result.color.a).toBe(26214);
    expect(normalizedAlpha(result.color)).toBeCloseTo(0.4, 2);
  });

  it('handles float bit depth', () => {
    const result = applyAlphaModifiers(
      { space: 'rgb', r: 0, g: 0, b: 0, a: 0.8, bitDepth: 'float32' },
      [{ kind: 'alpha', operation: 'offset', value: -0.2 }],
    );
    expect(result.color.a).toBeCloseTo(0.6, 2);
  });

  it('NaN and Infinity values mark the stack invalid and preserve the color', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const result = applyAlphaModifiers(opaque(), [
        { kind: 'alpha', operation: 'multiply', value: bad },
      ]);
      expect(result.valid).toBe(false);
      expect(result.color).toEqual(opaque());
    }
  });

  it('non-finite color alpha is normalized to a safe value', () => {
    const result = applyAlphaModifiers({ space: 'rgb', r: 0, g: 0, b: 0, a: NaN }, [
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
    ]);
    expect(result.valid).toBe(true);
    expect(Number.isFinite(result.color.a)).toBe(true);
  });
});

describe('validateVariableModifiers', () => {
  it('accepts well-typed alpha modifiers', () => {
    const out = validateVariableModifiers([
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
      { kind: 'alpha', operation: 'set', value: 0.4 },
      { kind: 'alpha', operation: 'offset', value: -0.1 },
    ]);
    expect(out).toHaveLength(3);
  });

  it('drops malformed entries (corrupt serialized data)', () => {
    const out = validateVariableModifiers([
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
      { kind: 'alpha', operation: 'wobble', value: 2 },
      { kind: 'unknown', value: 1 },
      'not-an-object',
      { kind: 'alpha', operation: 'offset', value: NaN },
      { kind: 'alpha', operation: 'offset', value: Infinity },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0]).toEqual({ kind: 'alpha', operation: 'multiply', value: 0.5 });
  });

  it('returns undefined for empty input', () => {
    expect(validateVariableModifiers([])).toBeUndefined();
    expect(validateVariableModifiers(undefined)).toBeUndefined();
    expect(validateVariableModifiers('nope')).toBeUndefined();
  });

  it('caps the stack at the serialization bound', () => {
    const many = Array.from({ length: 20 }, () => ({
      kind: 'alpha' as const,
      operation: 'multiply' as const,
      value: 0.5,
    }));
    expect(validateVariableModifiers(many)).toHaveLength(MAX_MODIFIERS_PER_BINDING);
  });
});

describe('alphaModifierLabel', () => {
  it('is unambiguous about multiply vs set vs offset', () => {
    expect(alphaModifierLabel({ kind: 'alpha', operation: 'multiply', value: 0.5 })).toBe('× 50%');
    expect(alphaModifierLabel({ kind: 'alpha', operation: 'set', value: 0.5 })).toBe('Set 50%');
    expect(alphaModifierLabel({ kind: 'alpha', operation: 'offset', value: -0.2 })).toBe('-20 pt');
    expect(alphaModifierLabel({ kind: 'alpha', operation: 'offset', value: 0.2 })).toBe('+20 pt');
  });
});

describe('binding resolution with modifiers', () => {
  it('multiply: token alpha 0.8 × 0.5 = 0.4 through resolveBoundFill', () => {
    const store = storeWith('#336699cc');
    const resolved = resolveBinding(store, { variableId: 'v1' });
    const fill = resolveBoundFill(
      { variableId: 'v1', modifiers: [{ kind: 'alpha', operation: 'multiply', value: 0.5 }] },
      resolved,
    );
    expect(fill).toBeDefined();
    expect(normalizedAlpha(fill!)).toBeCloseTo(0.4, 2);
  });

  it('offset: token alpha 0.8 − 0.2 = 0.6 through resolveBoundFill', () => {
    const store = storeWith('#336699cc');
    const resolved = resolveBinding(store, { variableId: 'v1' });
    const fill = resolveBoundFill(
      { variableId: 'v1', modifiers: [{ kind: 'alpha', operation: 'offset', value: -0.2 }] },
      resolved,
    );
    expect(normalizedAlpha(fill!)).toBeCloseTo(0.6, 2);
  });

  it('set: token alpha 0.8 set to 0.5 = 0.5 through resolveBoundFill', () => {
    const store = storeWith('#336699cc');
    const resolved = resolveBinding(store, { variableId: 'v1' });
    const fill = resolveBoundFill(
      { variableId: 'v1', modifiers: [{ kind: 'alpha', operation: 'set', value: 0.5 }] },
      resolved,
    );
    expect(normalizedAlpha(fill!)).toBeCloseTo(0.5, 2);
  });

  it('applyBindingsToNode applies the modifier to the node fill', () => {
    const store = storeWith('#336699cc');
    const node: SceneNode = {
      id: 'n1',
      kind: 'shape',
      name: 'N',
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      bindings: {
        fill: {
          variableId: 'v1',
          modifiers: [{ kind: 'alpha', operation: 'multiply', value: 0.5 }],
        },
      },
    };
    const next = applyBindingsToNode(node, store);
    expect(next.fill).toBeDefined();
    expect(normalizedAlpha(next.fill)).toBeCloseTo(0.4, 2);
    // The binding itself is preserved — never collapsed to a literal.
    expect(next.bindings?.fill).toEqual(node.bindings?.fill);
  });

  it('missing variable keeps the original fill and preserves the binding + modifiers', () => {
    const store: VariableStore = {
      variables: {},
      collections: {},
      activeCollectionId: '',
      modes: ['default'],
      activeMode: 'default',
    };
    const node: SceneNode = {
      id: 'n1',
      kind: 'shape',
      name: 'N',
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      bindings: {
        fill: {
          variableId: 'deleted-var',
          modifiers: [{ kind: 'alpha', operation: 'multiply', value: 0.5 }],
        },
      },
    };
    const next = applyBindingsToNode(node, store);
    expect(next.fill).toEqual(node.fill);
    expect(next.bindings).toEqual(node.bindings);
  });

  it('invalid-type variable (number bound to fill) keeps the original fill and binding', () => {
    const store: VariableStore = {
      variables: { v2: { id: 'v2', name: 'size', type: 'number', valuesByMode: { default: 42 } } },
      collections: {},
      activeCollectionId: '',
      modes: ['default'],
      activeMode: 'default',
    };
    const node: SceneNode = {
      id: 'n1',
      kind: 'shape',
      name: 'N',
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      bindings: {
        fill: { variableId: 'v2', modifiers: [{ kind: 'alpha', operation: 'set', value: 0.5 }] },
      },
    };
    const next = applyBindingsToNode(node, store);
    expect(next.fill).toEqual(node.fill);
    expect(next.bindings).toEqual(node.bindings);
  });

  it('mode switching re-resolves through the modifier (multiply stays relative)', () => {
    const store = storeWith('#336699cc'); // default alpha 0.8
    const defaultFill = rgbManaged(resolveBinding(store, { variableId: 'v1' }));
    const effectiveDefault = applyAlphaModifiers(defaultFill, [
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
    ]).color;
    expect(normalizedAlpha(effectiveDefault)).toBeCloseTo(0.4, 2);

    // Switch collection mode to dark (alpha 0x56 = 86/255 ≈ 0.337)
    store.collections.col1!.activeMode = 'dark';
    const darkFill = rgbManaged(resolveBinding(store, { variableId: 'v1' }));
    const effectiveDark = applyAlphaModifiers(darkFill, [
      { kind: 'alpha', operation: 'multiply', value: 0.5 },
    ]).color;
    expect(normalizedAlpha(darkFill)).toBeCloseTo(170 / 255, 2);
    expect(normalizedAlpha(effectiveDark)).toBeCloseTo((170 / 255) * 0.5, 2);
  });

  it('alias resolution applies the modifier after the complete alias chain', () => {
    const store: VariableStore = {
      variables: {
        base: {
          id: 'base',
          name: 'color.base',
          type: 'color',
          valuesByMode: { default: '#336699cc' },
        },
        aliased: {
          id: 'aliased',
          name: 'button.background',
          type: 'color',
          valuesByMode: { default: '{base}' },
        },
      },
      collections: {},
      activeCollectionId: '',
      modes: ['default'],
      activeMode: 'default',
    };
    const resolved = resolveBinding(store, { variableId: 'aliased' });
    const fill = resolveBoundFill(
      { variableId: 'aliased', modifiers: [{ kind: 'alpha', operation: 'multiply', value: 0.5 }] },
      resolved,
    );
    expect(fill).toBeDefined();
    expect(normalizedAlpha(fill!)).toBeCloseTo(0.4, 2);

    // Changing the alias target preserves the modifier.
    store.variables.base!.valuesByMode.default = '#336699ff';
    const resolved2 = resolveBinding(store, { variableId: 'aliased' });
    const fill2 = resolveBoundFill(
      { variableId: 'aliased', modifiers: [{ kind: 'alpha', operation: 'multiply', value: 0.5 }] },
      resolved2,
    );
    expect(normalizedAlpha(fill2!)).toBeCloseTo(0.5, 2);
  });

  it('existing token alpha is handled correctly (opaque and partial)', () => {
    expect(
      effectiveAlpha(opaque(0, 0, 0, 255), [{ kind: 'alpha', operation: 'multiply', value: 0.5 }]),
    ).toBeCloseTo(0.5, 2);
    expect(
      effectiveAlpha({ space: 'rgb', r: 0, g: 0, b: 0, a: 128 }, [
        { kind: 'alpha', operation: 'multiply', value: 0.5 },
      ]),
    ).toBeCloseTo(0.25, 2);
    expect(
      effectiveAlpha({ space: 'rgb', r: 0, g: 0, b: 0, a: 255 }, [
        { kind: 'alpha', operation: 'offset', value: -0.5 },
      ]),
    ).toBeCloseTo(0.5, 2);
  });
});

describe('2.14 → 2.15 migration', () => {
  it('stamps the version and keeps old documents unchanged', () => {
    const raw = {
      formatVersion: '2.14',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          bindings: { fill: { variableId: 'v1' } },
        },
      },
    };
    const migrated = migrateV214ToV215(raw);
    expect(migrated.formatVersion).toBe('2.15');
    const nodes = migrated.nodes as Record<string, Record<string, unknown>>;
    expect(nodes.n1?.bindings).toEqual({ fill: { variableId: 'v1' } });
  });

  it('validates serialized modifier arrays and drops malformed entries', () => {
    const raw = {
      formatVersion: '2.14',
      nodes: {
        n1: {
          id: 'n1',
          kind: 'shape',
          bindings: {
            fill: {
              variableId: 'v1',
              modifiers: [
                { kind: 'alpha', operation: 'multiply', value: 0.5 },
                { kind: 'alpha', operation: 'bad', value: 1 },
              ],
            },
          },
        },
      },
    };
    const migrated = migrateV214ToV215(raw);
    const nodes = migrated.nodes as Record<string, Record<string, unknown>>;
    const binding = (nodes.n1!.bindings as Record<string, PropertyBinding>).fill;
    expect(binding?.modifiers).toEqual([{ kind: 'alpha', operation: 'multiply', value: 0.5 }]);
  });
});
