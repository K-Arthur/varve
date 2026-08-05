/**
 * Resolver module tests: parsing, input validation, ordering last-wins,
 * defaults, set references, alias resolution after flattening, cycles,
 * lazy permutation counting.
 */
import { describe, expect, it } from 'vitest';

import {
  parseResolverDocument,
  permutationCount,
  resolvePermutation,
  validateResolverInput,
} from '../resolver';

const RESOLVER = `{
  "name": "Theme resolver",
  "version": "2025.10",
  "description": "Light/dark theming",
  "sets": {
    "foundation": {
      "sources": [{ "$ref": "foundation.json" }]
    },
    "components": {
      "sources": [{ "$ref": "components.json" }]
    }
  },
  "modifiers": {
    "theme": {
      "description": "Color theme",
      "contexts": {
        "light": [{ "$ref": "themes/light.json" }],
        "dark": [{ "$ref": "themes/dark.json" }]
      },
      "default": "light"
    },
    "density": {
      "contexts": {
        "compact": [],
        "comfortable": [{ "$ref": "density/comfortable.json" }]
      }
    }
  },
  "resolutionOrder": [
    { "$ref": "#/sets/foundation" },
    { "$ref": "#/sets/components" },
    { "$ref": "#/modifiers/theme" },
    { "$ref": "#/modifiers/density" }
  ]
}`;

function loadFixture(ref: string): Record<string, unknown> | undefined {
  const files: Record<string, Record<string, unknown>> = {
    'foundation.json': {
      color: {
        brand: {
          primary: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0.4, 0.8] } },
        },
      },
    },
    'components.json': {
      button: { background: { $type: 'color', $value: '{color.brand.primary}' } },
    },
    'themes/light.json': {
      theme: { accent: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 0, 0] } } },
    },
    'themes/dark.json': {
      theme: { accent: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 1] } } },
    },
    'density/comfortable.json': {
      spacing: { gap: { $type: 'dimension', $value: { value: 16, unit: 'px' } } },
    },
  };
  return files[ref];
}

describe('parseResolverDocument', () => {
  it('parses a valid resolver document', () => {
    const doc = parseResolverDocument(RESOLVER, 'resolver.json');
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.version).toBe('2025.10');
    expect(Object.keys(doc.sets)).toEqual(['foundation', 'components']);
    expect(doc.modifiers['theme']?.default).toBe('light');
    expect(doc.modifiers['density']?.contexts['compact']).toEqual([]);
    expect(doc.resolutionOrder.map((i) => `${i.kind}:${i.name}`)).toEqual([
      'set:foundation',
      'set:components',
      'modifier:theme',
      'modifier:density',
    ]);
  });

  it('rejects wrong or missing versions', () => {
    const doc = parseResolverDocument(
      RESOLVER.replace('"version": "2025.10"', '"version": "2026.01"'),
    );
    expect(doc.diagnostics.some((d) => d.code === 'resolver.version')).toBe(true);
    const missing = parseResolverDocument(RESOLVER.replace('"version": "2025.10",\n', ''));
    expect(missing.diagnostics.some((d) => d.code === 'resolver.version')).toBe(true);
  });

  it('rejects empty contexts maps', () => {
    const doc = parseResolverDocument(
      '{"version": "2025.10", "modifiers": {"x": {"contexts": {}}}, "resolutionOrder": []}',
    );
    expect(doc.diagnostics.some((d) => d.code === 'resolver.contexts-empty')).toBe(true);
  });

  it('warns on single-context modifiers', () => {
    const doc = parseResolverDocument(
      '{"version": "2025.10", "modifiers": {"x": {"contexts": {"a": []}}}, "resolutionOrder": []}',
    );
    expect(doc.diagnostics.some((d) => d.code === 'resolver.contexts-single')).toBe(true);
  });

  it('rejects defaults that do not match a context key', () => {
    const doc = parseResolverDocument(
      '{"version": "2025.10", "modifiers": {"x": {"contexts": {"a": []}, "default": "nope"}}, "resolutionOrder": []}',
    );
    expect(doc.diagnostics.some((d) => d.code === 'resolver.default-mismatch')).toBe(true);
  });

  it('rejects references into resolutionOrder', () => {
    const doc = parseResolverDocument(
      '{"version": "2025.10", "resolutionOrder": [{"$ref": "#/resolutionOrder/0"}]}',
    );
    expect(doc.diagnostics.some((d) => d.code === 'resolver.order-ref-resolution-order')).toBe(
      true,
    );
  });

  it('rejects duplicate names in resolutionOrder', () => {
    const doc = parseResolverDocument(
      '{"version": "2025.10", "resolutionOrder": [{"$ref": "#/modifiers/theme"}, {"$ref": "#/modifiers/theme"}], "modifiers": {"theme": {"contexts": {"a": [], "b": []}}}}',
    );
    expect(doc.diagnostics.some((d) => d.code === 'resolver.order-duplicate-name')).toBe(true);
  });

  it('supports inline sets and modifiers with name+type', () => {
    const doc = parseResolverDocument(
      '{"version": "2025.10", "resolutionOrder": [{"type": "set", "name": "Size", "sources": [{"x": {"$value": 1, "$type": "number"}}]}, {"type": "modifier", "name": "Theme", "contexts": {"light": [], "dark": []}}]}',
    );
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.resolutionOrder[0]?.kind).toBe('set');
    expect(doc.resolutionOrder[1]?.kind).toBe('modifier');
  });

  it('rejects inline items without name/type', () => {
    const doc = parseResolverDocument(
      '{"version": "2025.10", "resolutionOrder": [{"sources": []}]}',
    );
    expect(doc.diagnostics.some((d) => d.code === 'resolver.order-inline-shape')).toBe(true);
  });

  it('preserves $extensions on sets and modifiers', () => {
    const doc = parseResolverDocument(
      '{"version": "2025.10", "sets": {"s": {"sources": [], "$extensions": {"org.example": {"x": 1}}}}, "resolutionOrder": []}',
    );
    expect(doc.sets['s']?.extensions).toEqual({ 'org.example': { x: 1 } });
  });
});

describe('validateResolverInput', () => {
  const doc = parseResolverDocument(RESOLVER);

  it('accepts valid inputs', () => {
    expect(validateResolverInput(doc, { theme: 'dark', density: 'compact' })).toEqual([]);
  });

  it('rejects unknown modifiers, invalid contexts, non-string values', () => {
    const diagnostics = validateResolverInput(doc, { theme: 'blue', foo: 'bar' });
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain('resolver.input-invalid-context');
    expect(codes).toContain('resolver.input-unknown-modifier');
    expect(codes).toContain('resolver.input-missing-modifier'); // density has no default
  });

  it('accepts omitted modifiers that declare defaults', () => {
    expect(validateResolverInput(doc, { density: 'compact' })).toEqual([]);
  });

  it('rejects non-string input values', () => {
    const diagnostics = validateResolverInput(doc, { density: 'compact', theme: 42 } as never);
    expect(diagnostics.some((d) => d.code === 'resolver.input-type')).toBe(true);
  });
});

describe('resolvePermutation', () => {
  const doc = parseResolverDocument(RESOLVER);

  it('resolves sets + modifier contexts in order with last-wins merge', () => {
    const permutation = resolvePermutation(
      doc,
      { theme: 'dark', density: 'comfortable' },
      { loadExternal: loadFixture },
    );
    expect(permutation.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const tokens = permutation.document.tokens;
    expect(tokens['color.brand.primary']).toBeDefined();
    expect(tokens['button.background']).toBeDefined();
    expect(tokens['theme.accent']?.value).toEqual({ colorSpace: 'srgb', components: [0, 0, 1] });
    expect(tokens['spacing.gap']?.value).toEqual({ value: 16, unit: 'px' });
  });

  it('resolves aliases only after flattening', () => {
    const permutation = resolvePermutation(
      doc,
      { theme: 'light', density: 'compact' },
      { loadExternal: loadFixture },
    );
    expect(permutation.resolved['button.background']).toEqual({
      colorSpace: 'srgb',
      components: [0, 0.4, 0.8],
    });
    expect(permutation.document.tokens['button.background']?.isReference).toBe(true);
  });

  it('applies modifier defaults when input omits them', () => {
    const permutation = resolvePermutation(
      doc,
      { density: 'compact' },
      { loadExternal: loadFixture },
    );
    expect(permutation.resolved['theme.accent']).toEqual({
      colorSpace: 'srgb',
      components: [1, 0, 0],
    });
  });

  it('supports empty context arrays', () => {
    const permutation = resolvePermutation(
      doc,
      { theme: 'light', density: 'compact' },
      { loadExternal: loadFixture },
    );
    expect(permutation.document.tokens['spacing.gap']).toBeUndefined();
  });

  it('reports unresolvable external references', () => {
    const permutation = resolvePermutation(
      doc,
      { theme: 'light', density: 'compact' },
      { loadExternal: () => undefined },
    );
    expect(permutation.diagnostics.some((d) => d.code === 'resolver.ref-unresolvable')).toBe(true);
  });

  it('detects circular set references', () => {
    const circular = parseResolverDocument(
      '{"version": "2025.10", "sets": {"a": {"sources": [{"$ref": "#/sets/b"}]}, "b": {"sources": [{"$ref": "#/sets/a"}]}}, "resolutionOrder": [{"$ref": "#/sets/a"}]}',
    );
    const permutation = resolvePermutation(circular, {}, { loadExternal: () => undefined });
    expect(permutation.diagnostics.some((d) => d.code === 'resolver.ref-cycle')).toBe(true);
  });

  it('rejects modifier references from sets and modifiers', () => {
    const doc2 = parseResolverDocument(
      '{"version": "2025.10", "modifiers": {"m": {"contexts": {"a": [{"$ref": "#/modifiers/m"}]}}}, "resolutionOrder": [{"$ref": "#/modifiers/m"}]}',
    );
    const permutation = resolvePermutation(doc2, { m: 'a' }, { loadExternal: () => undefined });
    expect(permutation.diagnostics.some((d) => d.code === 'resolver.ref-modifier-in-set')).toBe(
      true,
    );
  });

  it('reports alias cycles in the flattened result', () => {
    const doc2 = parseResolverDocument(
      '{"version": "2025.10", "resolutionOrder": [{"type": "set", "name": "S", "sources": [{"a": {"$type": "number", "$value": "{b}"}, "b": {"$type": "number", "$value": "{a}"}}]}]}',
    );
    const permutation = resolvePermutation(doc2, {}, { loadExternal: () => undefined });
    expect(permutation.diagnostics.some((d) => d.code === 'ref.cycle')).toBe(true);
    expect(permutation.resolved['a']).toBeUndefined();
  });

  it('counts permutations lazily without materializing them', () => {
    expect(permutationCount(doc)).toBe(4); // theme × density = 2 × 2
  });
});
