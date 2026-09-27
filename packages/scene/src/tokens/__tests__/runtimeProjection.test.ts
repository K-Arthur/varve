import { parseFormatDocument, snapshotFromTokens, threeWayMerge } from '@varve/tokens';
import { describe, expect, it } from 'vitest';
import { applyBindingsToNode } from '../../bindings';
import { createDocument, updateVariableInDocument } from '../../document';
import type { SceneNode } from '../../types';
import {
  buildVariableDependencyMap,
  getChangedVariableIds,
  resolve,
  setCollectionMode,
} from '../../variables';
import { dtcgColorToManagedColor } from '../colorBridge';
import { formatDocumentFromTokenRecords } from '../runtimeProjection';
import {
  applyImportToSync,
  applyMergePlanToSync,
  ensureImportSource,
  previewImport,
} from '../syncApply';
import { planSourceUpdate } from '../updatePlan';

const fixture = {
  color: {
    primary: {
      $type: 'color',
      $value: { colorSpace: 'srgb', components: [0.123456789, 0.4, 0.8], alpha: 0.25 },
    },
    alias: { $type: 'color', $value: '{color.primary}' },
    pointer: { $ref: '#/color/primary' },
  },
  spacing: {
    $type: 'dimension',
    gap: { $value: { value: 8, unit: 'px' } },
    rem: { $value: { value: 1, unit: 'rem' } },
  },
};

function imported() {
  const document = parseFormatDocument(JSON.stringify(fixture), {
    sourceFileId: 'brand.tokens.json',
  });
  const destination = ensureImportSource(undefined, 'brand.tokens.json');
  const variables = {
    variables: {},
    collections: {},
    activeCollectionId: '',
    modes: ['default'],
    activeMode: 'default',
  };
  const result = applyImportToSync(
    destination.sync,
    variables,
    previewImport(destination.sync.store, document),
    destination.sourceId,
    '2025.10',
    'dtcg-2025.10',
  );
  return {
    ...createDocument('Token card'),
    variableStore: { ...result.variables!, tokenSync: result.sync },
  };
}

function variableId(doc: ReturnType<typeof imported>, name: string) {
  return Object.values(doc.variableStore.variables).find((variable) => variable.name === name)!.id;
}

describe('DTCG runtime binding and authored-value ownership', () => {
  it('materializes all deleted aliases against the same pre-removal snapshot', () => {
    const before = imported();
    const plan = planSourceUpdate(
      before.variableStore.tokenSync,
      parseFormatDocument('{}'),
      Object.keys(before.variableStore.tokenSync.store.sources)[0]! as `src_${string}`,
    );
    expect(plan.valid).toBe(true);
    const result = applyMergePlanToSync(
      before.variableStore.tokenSync,
      before.variableStore,
      plan.plan,
    );
    const after = { ...result.variables!, tokenSync: result.sync };
    for (const path of ['color.primary', 'color.alias', 'color.pointer']) {
      const id = variableId(before, path);
      expect(after.tokenSync.store.variableLinks[id]).toBeUndefined();
      expect(resolve(after, id)).toEqual(resolve(before.variableStore, id));
    }
  });

  it('includes JSON Pointer and chained aliases in canvas invalidation dependencies', () => {
    const doc = imported();
    const base = variableId(doc, 'color.primary');
    const pointer = variableId(doc, 'color.pointer');
    const map = buildVariableDependencyMap(
      { node: { bindings: { fill: { variableId: pointer } } } },
      doc.variableStore,
    );
    expect(map.get(base)).toEqual(new Set(['node']));
  });

  it('invalidates bindings when a collection changes its active mode', () => {
    const doc = imported();
    const id = variableId(doc, 'spacing.gap');
    const before = {
      ...doc.variableStore,
      collections: {
        compact: {
          id: 'compact',
          name: 'Density',
          modes: ['default', 'compact'],
          activeMode: 'default',
          variableIds: [id],
          groups: [],
        },
      },
      variables: {
        ...doc.variableStore.variables,
        [id]: {
          ...doc.variableStore.variables[id]!,
          valuesByMode: { default: { value: 8, unit: 'px' }, compact: { value: 4, unit: 'px' } },
        },
      },
    };
    const after = setCollectionMode(before, 'compact', 'compact');
    expect(resolve(before, id)).toBe(8);
    expect(resolve(after, id)).toBe(4);
    expect(getChangedVariableIds(before, after)).toContain(id);
  });
  it('blocks deleting a foundation while linked aliases would be left dangling', () => {
    const before = imported();
    const id = variableId(before, 'color.primary');
    const token = Object.values(before.variableStore.tokenSync.store.tokens).find(
      (entry) => entry.path.join('.') === 'color.primary',
    )!;
    const base = snapshotFromTokens(
      parseFormatDocument(
        JSON.stringify({
          primary: {
            $type: 'color',
            $value: token.value,
          },
        }),
      ).tokens,
    );
    const snapshot = base.get('primary')!;
    snapshot.id = token.id;
    snapshot.path = [...token.path];
    const plan = threeWayMerge({ base, local: base, remote: new Map() });
    expect(() =>
      applyMergePlanToSync(before.variableStore.tokenSync, before.variableStore, plan),
    ).toThrow('token.runtime-projection-change-unsupported');
    expect(before.variableStore.tokenSync.store.variableLinks[id]).toBe(token.id);
    expect(before.variableStore.tokenSync.store.variableLinks[id]).toBe(token.id);
  });
  it('materializes every stored mode in that collection context for simultaneous token deletions', () => {
    const before = imported();
    const primary = variableId(before, 'color.primary');
    const alias = variableId(before, 'color.alias');
    const pointer = variableId(before, 'color.pointer');
    const gap = variableId(before, 'spacing.gap');
    const red = { colorSpace: 'srgb', components: [1, 0, 0] };
    const blue = { colorSpace: 'srgb', components: [0, 0, 1] };
    const beforeStore = before.variableStore;
    const variableStore = {
      ...beforeStore,
      modes: ['default', 'compact'],
      activeMode: 'default',
      variables: {
        ...beforeStore.variables,
        [primary]: {
          ...beforeStore.variables[primary]!,
          valuesByMode: { default: red, compact: blue },
        },
        [alias]: {
          ...beforeStore.variables[alias]!,
          valuesByMode: { default: '{color.primary}', compact: '{color.primary}' },
        },
        [pointer]: {
          ...beforeStore.variables[pointer]!,
          valuesByMode: {
            default: { $ref: '#/color/primary' },
            compact: { $ref: '#/color/primary' },
          },
        },
        [gap]: {
          ...beforeStore.variables[gap]!,
          valuesByMode: {
            default: { value: 8, unit: 'px' },
            compact: { value: 4, unit: 'px' },
          },
        },
      },
      collections: {
        palette: {
          id: 'palette',
          name: 'Palette',
          modes: ['default', 'compact'],
          activeMode: 'compact',
          variableIds: [primary, alias],
        },
        references: {
          id: 'references',
          name: 'References',
          modes: ['default', 'compact'],
          activeMode: 'default',
          variableIds: [pointer],
        },
        density: {
          id: 'density',
          name: 'Density',
          modes: ['default', 'compact'],
          activeMode: 'compact',
          variableIds: [gap],
        },
      },
    };
    const sourceId = Object.keys(beforeStore.tokenSync!.store.sources)[0]! as `src_${string}`;
    const plan = planSourceUpdate(beforeStore.tokenSync!, parseFormatDocument('{}'), sourceId);
    expect(plan.valid).toBe(true);

    const result = applyMergePlanToSync(
      beforeStore.tokenSync!,
      variableStore,
      plan.plan,
      'default',
    );
    const after = { ...result.variables!, tokenSync: result.sync };
    const materializedRed = {
      space: 'rgb',
      bitDepth: 'float32',
      profile: 'srgb',
      r: 1,
      g: 0,
      b: 0,
      a: 1,
    };
    const materializedBlue = { ...materializedRed, r: 0, b: 1 };

    expect(after.variables[primary]?.valuesByMode).toEqual({
      default: materializedRed,
      compact: materializedBlue,
    });
    expect(after.variables[alias]?.valuesByMode).toEqual({
      default: materializedRed,
      compact: materializedBlue,
    });
    // The pointer is in an independent collection. Its own modes change, but
    // the palette collection remains on compact while references resolve.
    expect(after.variables[pointer]?.valuesByMode).toEqual({
      default: materializedBlue,
      compact: materializedBlue,
    });
    expect(after.variables[gap]?.valuesByMode).toEqual({ default: 8, compact: 4 });
    expect(resolve(after, primary)).toEqual(materializedBlue);
    expect(resolve(after, alias)).toEqual(materializedBlue);
    expect(resolve(after, pointer)).toEqual(materializedBlue);
    expect(resolve(after, gap)).toBe(4);

    const defaultPalette = setCollectionMode(after, 'palette', 'default');
    const defaultDensity = setCollectionMode(after, 'density', 'default');
    expect(resolve(defaultPalette, primary)).toEqual(materializedRed);
    expect(resolve(defaultPalette, alias)).toEqual(materializedRed);
    expect(resolve(defaultDensity, gap)).toBe(8);
    expect(after.tokenSync?.store.variableLinks[primary]).toBeUndefined();
    expect(after.tokenSync?.store.variableLinks[alias]).toBeUndefined();
    expect(after.tokenSync?.store.variableLinks[pointer]).toBeUndefined();
    expect(variableStore.variables[primary]?.valuesByMode.default).toEqual(red);
    expect(variableStore.variables[primary]?.valuesByMode.compact).toEqual(blue);
  });
  it('preflights linked token type changes before applying any plan mutation', () => {
    const before = imported();
    const variableStore = before.variableStore;
    const sync = variableStore.tokenSync!;
    const id = variableId(before, 'spacing.gap');
    const sourceId = Object.keys(sync.store.sources)[0]! as `src_${string}`;
    const remote = parseFormatDocument(
      JSON.stringify({
        color: fixture.color,
        spacing: {
          $type: 'dimension',
          gap: { $type: 'number', $value: 12 },
          rem: { $value: { value: 1, unit: 'rem' } },
        },
      }),
    );
    const plan = planSourceUpdate(sync, remote, sourceId);
    expect(plan.valid).toBe(false);
    expect(plan.plan.merges.find((merge) => merge.path === 'spacing.gap')?.result?.type).toBe(
      'number',
    );

    const originalSync = sync.store;
    const originalVariable = variableStore.variables[id];
    expect(() => applyMergePlanToSync(sync, variableStore, plan.plan)).toThrow(
      /sync\.linked-type-change-unsupported/,
    );
    expect(sync.store).toBe(originalSync);
    expect(variableStore.variables[id]).toBe(originalVariable);
    expect(variableStore.variables[id]?.type).toBe('number');
    expect(variableStore.variables[id]?.valuesByMode.default).toEqual({ value: 8, unit: 'px' });
  });
  it('makes imported colors discoverable and resolves both alias forms without flattening', () => {
    const doc = imported();
    const primary = variableId(doc, 'color.primary');
    expect(doc.variableStore.variables[primary]?.type).toBe('color');
    const expected = {
      space: 'rgb',
      bitDepth: 'float32',
      profile: 'srgb',
      r: 0.123456789,
      g: 0.4,
      b: 0.8,
      a: 0.25,
    };
    expect(resolve(doc.variableStore, primary)).toEqual(expected);
    expect(resolve(doc.variableStore, variableId(doc, 'color.alias'))).toEqual(expected);
    expect(resolve(doc.variableStore, variableId(doc, 'color.pointer'))).toEqual(expected);
    const token = Object.values(doc.variableStore.tokenSync.store.tokens).find(
      (entry) => entry.path.join('.') === 'color.alias',
    );
    expect(token?.value).toBe('{color.primary}');
  });

  it('projects px dimensions while retaining rem values with an explicit context error', () => {
    const doc = imported();
    expect(resolve(doc.variableStore, variableId(doc, 'spacing.gap'))).toBe(8);
    expect(() => resolve(doc.variableStore, variableId(doc, 'spacing.rem'))).toThrow(
      'root-font size',
    );
  });

  it('applies an edited px dimension token to a bound corner radius', () => {
    const before = imported();
    const radiusId = variableId(before, 'spacing.gap');
    const shape = {
      id: 'radius-shape',
      kind: 'shape',
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      cornerRadius: 0,
      bindings: { cornerRadius: { variableId: radiusId } },
    } as unknown as SceneNode;

    expect(
      (applyBindingsToNode(shape, before.variableStore) as SceneNode & { cornerRadius: number })
        .cornerRadius,
    ).toBe(8);

    const after = updateVariableInDocument(before, radiusId, {
      valuesByMode: { default: { value: 32, unit: 'px' } },
    });
    expect(
      (applyBindingsToNode(shape, after.variableStore) as SceneNode & { cornerRadius: number })
        .cornerRadius,
    ).toBe(32);
  });

  it('propagates a foundation edit, preserves the old document for undo, and survives JSON reopen', () => {
    const before = imported();
    const primary = variableId(before, 'color.primary');
    const alias = variableId(before, 'color.alias');
    const value = { colorSpace: 'srgb', components: [0.8, 0.2, 0.1], alpha: 0.5 };
    const after = updateVariableInDocument(before, primary, { valuesByMode: { default: value } });
    expect(resolve(before.variableStore, alias)).toMatchObject({ r: 0.123456789 });
    expect(resolve(after.variableStore!, alias)).toMatchObject({ r: 0.8, a: 0.5 });
    const token = Object.values(after.variableStore!.tokenSync!.store.tokens).find(
      (entry) => entry.path.join('.') === 'color.primary',
    );
    expect(token?.value).toEqual(value);
    expect(token?.localState.locallyModified).toBe(true);
    const reopened = JSON.parse(JSON.stringify(after));
    const node = {
      id: 'shape',
      kind: 'shape',
      bindings: { fill: { variableId: alias } },
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    } as unknown as SceneNode;
    expect(applyBindingsToNode(node, reopened.variableStore).fill).toMatchObject({
      r: 0.8,
      g: 0.2,
      b: 0.1,
      a: 0.5,
      bitDepth: 'float32',
    });
  });

  it('rejects an edit with a property reference that resolves to a nonnumeric color component', () => {
    const doc = imported();
    const primary = variableId(doc, 'color.primary');
    const value = { colorSpace: 'srgb', components: [{ $ref: '#/spacing/gap/$value' }, 0.4, 0.8] };
    expect(() =>
      updateVariableInDocument(doc, primary, {
        valuesByMode: { default: value },
      }),
    ).toThrow('ref.resolved-value-invalid');
    expect(resolve(doc.variableStore, primary)).toMatchObject({ r: 0.123456789 });
  });

  it('rejects an invalid edit atomically instead of turning a dimension into zero', () => {
    const doc = imported();
    expect(() =>
      updateVariableInDocument(doc, variableId(doc, 'spacing.gap'), {
        valuesByMode: { default: 'invalid' },
      }),
    ).toThrow();
    expect(resolve(doc.variableStore, variableId(doc, 'spacing.gap'))).toBe(8);
  });

  it('rejects a linked scalar edit that would remove its runtime projection', () => {
    const doc = imported();
    const id = variableId(doc, 'spacing.gap');
    expect(() =>
      updateVariableInDocument(doc, id, {
        valuesByMode: { default: { value: 1, unit: 'rem' } },
      }),
    ).toThrow('token.runtime-projection-change-unsupported');
    expect(resolve(doc.variableStore, id)).toBe(8);
    expect(
      Object.values(doc.variableStore.tokenSync!.store.tokens).find(
        (token) => token.path.join('.') === 'spacing.gap',
      )?.value,
    ).toEqual({ value: 8, unit: 'px' });
  });
});

describe('document token path collisions', () => {
  it('keeps the first duplicate token and emits a blocking diagnostic', () => {
    const document = formatDocumentFromTokenRecords([
      { path: ['brand', 'color'], type: 'string', value: 'first' },
      { path: ['brand', 'color'], type: 'string', value: 'second' },
    ]);
    expect(document.tokens['brand.color']?.value).toBe('first');
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'document.token-path-collision',
    );
  });

  it('does not let a token overwrite exact group metadata at the same path', () => {
    const document = formatDocumentFromTokenRecords(
      [{ path: ['brand'], type: 'string', value: 'token value' }],
      { brand: { description: 'Stored group description', extensions: {} } },
    );
    expect(document.tokens.brand).toBeUndefined();
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'document.token-path-collision',
    );
  });

  it('blocks a token that would hide descendant group metadata', () => {
    const document = formatDocumentFromTokenRecords(
      [{ path: ['brand'], type: 'string', value: 'token value' }],
      { 'brand.colors': { description: 'Nested group', extensions: {} } },
    );
    expect(document.tokens.brand).toBeUndefined();
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'document.token-path-collision',
    );
  });
});

describe('managed artwork color projections', () => {
  it.each([
    ['hsl', [120, 100, 50], [0, 1, 0]],
    ['hwb', [0, 20, 30], [0.7, 0.2, 0.2]],
    ['hwb', [240, 80, 80], [0.5, 0.5, 0.5]],
    ['srgb-linear', [0.21404114048223255, 0, 1], [0.5, 0, 1]],
  ] as const)('projects %s with the declared channel scale', (space, channels, expected) => {
    const result = dtcgColorToManagedColor({ colorSpace: space, components: [...channels] });
    expect(result.space).toBe('rgb');
    const rgb = result as { r: number; g: number; b: number };
    [rgb.r, rgb.g, rgb.b].forEach((channel, index) => {
      expect(channel).toBeCloseTo(expected[index]!, 7);
    });
  });
  it('keeps wide gamut channels and source profile, without using a stale fallback', () => {
    expect(
      dtcgColorToManagedColor({
        colorSpace: 'display-p3',
        components: [1.1, -0.1, 0.3],
        alpha: 0,
        hex: '#000000',
      }),
    ).toEqual({
      space: 'rgb',
      bitDepth: 'float32',
      profile: 'display-p3',
      r: 1.1,
      g: -0.1,
      b: 0.3,
      a: 0,
    });
  });

  it.each([
    'srgb',
    'srgb-linear',
    'hsl',
    'hwb',
    'lab',
    'lch',
    'oklab',
    'oklch',
    'display-p3',
    'a98-rgb',
    'prophoto-rgb',
    'rec2020',
    'xyz-d65',
    'xyz-d50',
  ])('projects %s through the existing managed-color renderer', (space) => {
    const result = dtcgColorToManagedColor({ colorSpace: space, components: [0, 0, 0] });
    expect(result).toHaveProperty('bitDepth', 'float32');
    expect(result.a).toBe(1);
  });

  it('retains missing components as unsupported context instead of inventing black', () => {
    expect(() =>
      dtcgColorToManagedColor({
        colorSpace: 'oklch',
        components: [0.5, 0.2, 'none'],
        hex: '#000000',
      }),
    ).toThrow('interpolation context');
    expect(() => dtcgColorToManagedColor({ colorSpace: 'unknown', components: [0, 0, 0] })).toThrow(
      'Unsupported',
    );
  });
});
