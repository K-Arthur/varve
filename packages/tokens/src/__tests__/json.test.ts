/**
 * Source-aware JSON parser tests: locations, diagnostics, limits, security.
 */
import { describe, expect, it } from 'vitest';

import { JsonSyntaxError, parseJsonSource } from '../json';
import { buildJsonPointer, parseJsonPointer, resolveJsonPointer } from '../jsonPointer';

describe('parseJsonSource', () => {
  it('parses a document and maps pointer locations', () => {
    const text = '{\n  "a": { "b": 1 },\n  "c": [true, null]\n}';
    const { value, keyLocations } = parseJsonSource(text);
    expect(value).toEqual({ a: { b: 1 }, c: [true, null] });
    expect(keyLocations.get('/a')?.keyStart).toBe(4);
    expect(keyLocations.get('/a/b')?.valueStart).toBeGreaterThan(
      keyLocations.get('/a/b')?.keyEnd ?? 0,
    );
    expect(keyLocations.get('/c/1')?.valueEnd).toBeGreaterThan(
      keyLocations.get('/c/1')?.valueStart ?? 0,
    );
  });

  it('rejects trailing content', () => {
    expect(() => parseJsonSource('{} extra')).toThrow(JsonSyntaxError);
  });

  it('rejects unterminated strings and escapes', () => {
    expect(() => parseJsonSource('{"a": "unterminated}')).toThrow(/Unterminated string/);
    expect(() => parseJsonSource('{"a": "\\x"}')).toThrow(/Invalid escape/);
  });

  it('rejects numbers that overflow to Infinity', () => {
    expect(() => parseJsonSource('{"a": 1e999}')).toThrow(/overflows/);
  });

  it('reports duplicate keys as diagnostics with the later location', () => {
    const { diagnostics } = parseJsonSource('{"a": 1, "a": 2}');
    expect(diagnostics.some((d) => d.code === 'duplicate-key')).toBe(true);
  });

  it('parses objects with null prototypes (no __proto__ pollution)', () => {
    const { value } = parseJsonSource('{"__proto__": {"polluted": true}}');
    const record = value as Record<string, unknown>;
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('enforces the byte limit', () => {
    expect(() => parseJsonSource('[1,2,3]', { maxBytes: 4 })).toThrow(/exceeds/);
  });

  it('enforces the depth limit', () => {
    expect(() => parseJsonSource('[[[[[1]]]]]', { maxDepth: 3 })).toThrow(/nesting depth/);
  });

  it('handles escapes and unicode', () => {
    const { value } = parseJsonSource('{"key\\u0000": "a\\nb\\u00e9"}');
    const record = value as Record<string, unknown>;
    expect(record['key\u0000']).toBe('a\nb\u00e9');
  });

  it('records line and column for keys', () => {
    const text = '{\n  "x": 1\n}';
    const { keyLocations } = parseJsonSource(text);
    const loc = keyLocations.get('/x');
    expect(loc?.line).toBe(2);
    expect(loc?.column).toBe(3);
  });
});

describe('json pointer (RFC 6901)', () => {
  it('parses and resolves simple pointers', () => {
    const doc = { color: { brand: { primary: { $value: '#000' } } } };
    expect(resolveJsonPointer(doc, '#/color/brand/primary/$value')).toBe('#000');
  });

  it('resolves array indices', () => {
    const doc = { components: [0.1, 0.2, 0.3] };
    expect(resolveJsonPointer(doc, '#/components/1')).toBe(0.2);
  });

  it('handles ~0 and ~1 escapes', () => {
    const doc = { 'a/b': { 'c~d': 42 } };
    expect(resolveJsonPointer(doc, '#/a~1b/c~0d')).toBe(42);
  });

  it('throws with stable codes on failures', () => {
    expect(() => resolveJsonPointer({ a: 1 }, '#/a/b')).toThrow(/cannot traverse/);
    expect(() => resolveJsonPointer({}, '#/missing')).toThrow(/not found/);
    expect(() => resolveJsonPointer([1], '#/1')).toThrow(/out of range/);
    expect(() => resolveJsonPointer([1], '#/x')).toThrow(/not an array index/);
  });

  it('rejects invalid escapes and fragments', () => {
    expect(() => parseJsonPointer('#/a~2b')).toThrow(/escape/);
    expect(() => parseJsonPointer('a/b')).toThrow(/must start/);
  });

  it('round-trips segments through buildJsonPointer', () => {
    const doc = { 'x y': { z: true } };
    const pointer = buildJsonPointer(['x y', 'z']);
    expect(resolveJsonPointer(doc, pointer)).toBe(true);
  });
});
