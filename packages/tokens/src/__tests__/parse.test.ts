/**
 * DTCG 2025.10 structural parser tests: tokens, groups, $root, type
 * inheritance, $extends, references, diagnostics, name validation.
 */
import { describe, expect, it } from 'vitest';

import { parseFormatDocument } from '../parse';

function parse(text: string, options: Record<string, unknown> = {}) {
  return parseFormatDocument(text, { sourceFileId: 'test.tokens', ...options });
}

describe('basic structure', () => {
  it('parses a minimal token', () => {
    const doc = parse(
      '{"primary": {"$type": "color", "$value": {"colorSpace": "srgb", "components": [1, 0, 0]}}}',
    );
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const token = doc.tokens['primary'];
    expect(token?.type).toBe('color');
    expect(token?.path).toEqual(['primary']);
    expect(token?.value).toEqual({ colorSpace: 'srgb', components: [1, 0, 0] });
  });

  it('builds nested paths with groups', () => {
    const doc = parse('{"color": {"brand": {"primary": {"$type": "color", "$value": "#fff"}}}}');
    expect(doc.tokens['color.brand.primary']).toBeDefined();
    expect(doc.groups[0]?.children[0]?.kind).toBe('group');
  });

  it('infers type from the closest typed parent group', () => {
    const doc = parse(
      '{"color": {"$type": "color", "brand": {"primary": {"$value": {"colorSpace": "srgb", "components": [1, 0, 0]}}}}}',
    );
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.tokens['color.brand.primary']?.type).toBe('color');
  });

  it('reports undeterminable types as errors', () => {
    const doc = parse('{"primary": {"$value": 42}}');
    expect(doc.diagnostics.some((d) => d.code === 'dtcg.undeterminable-type')).toBe(true);
  });

  it('rejects tokens that also contain children', () => {
    const doc = parse('{"bad": {"$value": 1, "child": {"$value": 2}}}');
    expect(doc.diagnostics.some((d) => d.code === 'dtcg.token-with-children')).toBe(true);
  });

  it('warns on unknown $ properties including $root at document root', () => {
    const doc = parse('{"$root": {"$value": 1}}');
    expect(doc.diagnostics.some((d) => d.code === 'dtcg.unknown-property')).toBe(true);
    const doc2 = parse('{"g": {"$bad": {"$value": 1}}}');
    expect(doc2.diagnostics.some((d) => d.code === 'dtcg.unknown-property')).toBe(true);
  });
});

describe('root tokens', () => {
  it('parses $root tokens with $root in the path', () => {
    const doc = parse(
      '{"spacing": {"$type": "dimension", "$root": {"$value": {"value": 16, "unit": "px"}}, "small": {"$value": {"value": 8, "unit": "px"}}}}',
    );
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.tokens['spacing.$root']).toBeDefined();
    expect(doc.tokens['spacing.small']).toBeDefined();
  });
});

describe('name validation', () => {
  it('rejects names containing forbidden characters', () => {
    const doc = parse('{"a.b": {"$value": 1}}');
    expect(doc.diagnostics.some((d) => d.code === 'dtcg.forbidden-characters')).toBe(true);
    const doc2 = parse('{"a{b}": {"$value": 1}}');
    expect(doc2.diagnostics.some((d) => d.code === 'dtcg.forbidden-characters')).toBe(true);
  });

  it('allows names with spaces, unicode, and case differences', () => {
    const doc = parse(
      '{"Hot pink": {"$value": {"colorSpace": "srgb", "components": [1, 0, 1]}, "$type": "color"}}',
    );
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.tokens['Hot pink']).toBeDefined();
  });
});

describe('references', () => {
  it('extracts pure curly-brace aliases', () => {
    const doc = parse(
      '{"base": {"$value": 1, "$type": "number"}, "alias": {"$value": "{base}", "$type": "number"}}',
    );
    const alias = doc.tokens['alias'];
    expect(alias?.isReference).toBe(true);
    expect(alias?.references[0]).toEqual({ kind: 'curly-brace', raw: '{base}', path: ['base'] });
  });

  it('warns on partial references (non-compliant aliases)', () => {
    const doc = parse(
      '{"base": {"$value": 2, "$type": "number"}, "alias": {"$value": "{base} * 2", "$type": "number"}}',
    );
    expect(doc.diagnostics.some((d) => d.code === 'dtcg.partial-reference')).toBe(true);
  });

  it('extracts $ref JSON Pointer references at token level', () => {
    const doc = parse(
      '{"base": {"$type": "color", "$value": "#000"}, "alias": {"$ref": "#/base"}}',
    );
    const alias = doc.tokens['alias'];
    expect(alias?.isReference).toBe(true);
    expect(alias?.references[0]).toEqual({
      kind: 'json-pointer',
      raw: '#/base',
      pointer: '#/base',
    });
  });

  it('extracts nested $ref objects inside $value (property-level)', () => {
    const doc = parse(
      '{"base": {"$type": "color", "$value": {"colorSpace": "srgb", "components": [0.2, 0.4, 0.9]}}, "hue": {"$type": "number", "$value": {"$ref": "#/base/$value/components/0"}}}',
    );
    const hue = doc.tokens['hue'];
    expect(
      hue?.references.some(
        (r) => r.kind === 'json-pointer' && r.pointer === '#/base/$value/components/0',
      ),
    ).toBe(true);
  });
});

describe('group extension ($extends)', () => {
  it('deep-merges inherited groups with local overrides', () => {
    const doc = parse(
      '{"button": {"$type": "color", "background": {"$value": "#0066cc"}, "text": {"$value": "#fff"}}, "button-primary": {"$extends": "{button}", "background": {"$value": "#cc0066"}}}',
    );
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.tokens['button-primary.background']?.value).toBe('#cc0066');
    expect(doc.tokens['button-primary.text']?.value).toBe('#fff');
  });

  it('rejects circular extends chains', () => {
    const doc = parse('{"a": {"$extends": "{b}"}, "b": {"$extends": "{a}"}}');
    expect(doc.diagnostics.some((d) => d.code === 'dtcg.extends-cycle')).toBe(true);
  });

  it('rejects extends targeting tokens', () => {
    const doc = parse('{"a": {"$value": 1}, "b": {"$extends": "{a}"}}');
    expect(doc.diagnostics.some((d) => d.code === 'dtcg.extends-target-token')).toBe(true);
  });
});

describe('metadata', () => {
  it('preserves $description, $deprecated, and $extensions', () => {
    const doc = parse(
      '{"bg": {"$type": "color", "$value": "#777", "$description": "Background", "$deprecated": "Use border instead", "$extensions": {"org.example": {"x": 1}}}}',
    );
    const token = doc.tokens['bg'];
    expect(token?.description).toBe('Background');
    expect(token?.deprecated).toBe('Use border instead');
    expect(token?.extensions).toEqual({ 'org.example': { x: 1 } });
  });

  it('accepts boolean $deprecated with false override', () => {
    const doc = parse('{"a": {"$value": 1, "$type": "number", "$deprecated": false}}');
    expect(doc.tokens['a']?.deprecated).toBe(false);
  });
});

describe('unknown data preservation', () => {
  it('keeps unknown $ properties as warnings in strict mode', () => {
    const doc = parse('{"a": {"$value": 1, "$type": "number", "$futureThing": true}}');
    expect(
      doc.diagnostics.some((d) => d.code === 'dtcg.unknown-property' && d.severity === 'warning'),
    ).toBe(true);
  });

  it('preserves unknown token types in compatibility mode', () => {
    const doc = parse('{"a": {"$type": "futureType", "$value": "x"}}', { compatibility: true });
    expect(doc.tokens['a']?.type).toBe('futureType');
  });

  it('rejects unknown token types in strict mode', () => {
    const doc = parse('{"a": {"$type": "futureType", "$value": "x"}}');
    expect(doc.diagnostics.some((d) => d.code === 'dtcg.unknown-type')).toBe(true);
  });
});

describe('limits', () => {
  it('enforces the token count limit', () => {
    const many = Array.from(
      { length: 5 },
      (_, i) => `"t${i}": {"$value": ${i}, "$type": "number"}`,
    ).join(',');
    const doc = parse(`{${many}}`, { maxTokens: 3 });
    expect(doc.diagnostics.some((d) => d.code === 'dtcg.max-tokens')).toBe(true);
  });
});

describe('diagnostics carry source locations', () => {
  it('includes pointer, line, and column', () => {
    const doc = parse('{\n  "a.b": {"$value": 1}\n}');
    const diagnostic = doc.diagnostics.find((d) => d.code === 'dtcg.forbidden-characters');
    expect(diagnostic?.pointer).toBe('/a.b');
    expect(diagnostic?.line).toBe(2);
    expect(diagnostic?.column).toBeGreaterThan(0);
  });
});
