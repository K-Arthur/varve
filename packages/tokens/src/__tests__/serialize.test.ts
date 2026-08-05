/**
 * Serialization tests: canonical rendering and source-preserving patches.
 */
import { describe, expect, it } from 'vitest';

import { parseJsonSource } from '../json';
import { parseFormatDocument } from '../parse';
import { patchSerialize, renderCanonical } from '../serialize';

const SOURCE = [
  '{',
  '  "color": {',
  '    "$type": "color",',
  '    "brand": {',
  '      "primary": {',
  '        "$value": {',
  '          "colorSpace": "srgb",',
  '          "components": [0, 0.4, 0.8],',
  '          "hex": "#0066cc"',
  '        }',
  '      }',
  '    }',
  '  },',
  '  "spacing": {',
  '    "small": {',
  '      "$type": "dimension",',
  '      "$value": { "value": 8, "unit": "px" }',
  '    }',
  '  }',
  '}',
].join('\n');

describe('canonical serialization', () => {
  it('renders values with canonical key order', () => {
    const rendered = renderCanonical({
      $extensions: { 'org.varve': { id: 'tok_x' } },
      $type: 'number',
      $value: 4,
      $description: 'd',
    });
    expect(rendered.indexOf('$value')).toBeLessThan(rendered.indexOf('$type'));
    expect(rendered.indexOf('$type')).toBeLessThan(rendered.indexOf('$description'));
    expect(rendered.indexOf('$description')).toBeLessThan(rendered.indexOf('$extensions'));
  });

  it('renders nested objects and arrays', () => {
    const rendered = renderCanonical({ color: { colorSpace: 'srgb', components: [0, 1, 0] } });
    expect(rendered).toContain('"components": [');
  });
});

describe('source-preserving patch serialization', () => {
  it('returns the original text when nothing changes', () => {
    const source = parseJsonSource(SOURCE);
    expect(patchSerialize(SOURCE, source, [])).toBe(SOURCE);
  });

  it('splices only the changed value', () => {
    const source = parseJsonSource(SOURCE);
    const out = patchSerialize(SOURCE, source, [
      {
        pointer: '/color/brand/primary/$value',
        value: { colorSpace: 'srgb', components: [0.8, 0, 0.4], hex: '#cc0066' },
      },
    ]);
    expect(out).toContain('"hex":"#cc0066"');
    expect(out).not.toContain('"components": [0, 0.4, 0.8],');
    // untouched regions byte-identical
    expect(out).toContain('"spacing": {\n    "small": {');
    expect(out.split('\n')[0]).toBe('{');
  });

  it('re-parses to a document with the new value', () => {
    const source = parseJsonSource(SOURCE);
    const out = patchSerialize(SOURCE, source, [
      {
        pointer: '/color/brand/primary/$value',
        value: { colorSpace: 'srgb', components: [0.8, 0, 0.4] },
      },
    ]);
    const doc = parseFormatDocument(out, { sourceFileId: 'x' });
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.tokens['color.brand.primary']?.value).toEqual({
      colorSpace: 'srgb',
      components: [0.8, 0, 0.4],
    });
  });

  it('preserves CRLF newlines and BOM', () => {
    const crlfSource = SOURCE.replace(/\n/g, '\r\n');
    const bomSource = `\uFEFF${SOURCE}`;
    for (const text of [crlfSource, bomSource]) {
      const source = parseJsonSource(text);
      const out = patchSerialize(text, source, [
        { pointer: '/spacing/small/$value', value: { value: 12, unit: 'px' } },
      ]);
      expect(out).toContain('{"value":12,"unit":"px"}');
      if (text.includes('\r\n')) expect(out).not.toContain('\n{');
    }
  });

  it('inserts keys into an existing object before its closing brace', () => {
    const text =
      '{\n  "color": {\n    "primary": {\n      "$type": "color",\n      "$value": "#000"\n    }\n  }\n}';
    const source = parseJsonSource(text);
    const out = patchSerialize(
      text,
      source,
      [],
      [{ pointer: '/color/primary', key: '$extensions', value: { 'org.varve': { id: 'tok_x' } } }],
    );
    expect(out).toContain('"$extensions": {');
    expect(out).toContain('"org.varve":{"id":"tok_x"}');
    const doc = parseFormatDocument(out, { sourceFileId: 'x' });
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.tokens['color.primary']?.extensions).toEqual({ 'org.varve': { id: 'tok_x' } });
  });

  it('inserts into an empty object', () => {
    const text = '{\n  "a": {}\n}';
    const source = parseJsonSource(text);
    const out = patchSerialize(text, source, [], [{ pointer: '/a', key: 'k', value: 1 }]);
    expect(parseFormatDocument(out, { sourceFileId: 'x' }).tokens).toBeDefined();
    expect(out).toContain('"k": 1');
  });

  it('applies value change and insertion together', () => {
    const source = parseJsonSource(SOURCE);
    const out = patchSerialize(
      SOURCE,
      source,
      [{ pointer: '/color/brand/primary/$value', value: '#fff' }],
      [{ pointer: '/color/brand/primary', key: '$description', value: 'Primary brand color' }],
    );
    const doc = parseFormatDocument(out, { sourceFileId: 'x' });
    expect(doc.tokens['color.brand.primary']?.value).toBe('#fff');
    expect(doc.tokens['color.brand.primary']?.description).toBe('Primary brand color');
  });
});
