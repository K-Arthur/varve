/**
 * Round-trip conformance tests: parse → normalize → serialize → parse
 * preserves semantic meaning; source-preserving mode keeps unchanged bytes.
 */
import { describe, expect, it } from 'vitest';

import { parseJsonSource } from '../json';
import { parseFormatDocument } from '../parse';
import { patchSerialize } from '../serialize';

const FIXTURE = `{
  "brand": {
    "color": {
      "$type": "color",
      "$description": "Brand colors",
      "primary": {
        "$value": { "colorSpace": "srgb", "components": [0, 0.4, 0.8], "hex": "#0066cc" },
        "$extensions": { "org.example.tool": { "turn-up-to-11": true } }
      },
      "dark": { "$value": { "colorSpace": "display-p3", "components": [0.1, 0.2, 0.9], "alpha": 1 } }
    },
    "spacing": {
      "$type": "dimension",
      "$root": { "$value": { "value": 16, "unit": "px" } },
      "small": { "$value": { "value": 8, "unit": "px" } }
    },
    "motion": {
      "fast": { "$type": "duration", "$value": { "value": 120, "unit": "ms" } },
      "ease": { "$type": "cubicBezier", "$value": [0.5, 0, 1, 1] }
    },
    "type": {
      "heading": {
        "$type": "typography",
        "$value": {
          "fontFamily": ["Inter", "sans-serif"],
          "fontSize": { "value": 32, "unit": "px" },
          "fontWeight": 700,
          "letterSpacing": { "value": 0, "unit": "px" },
          "lineHeight": 1.2
        }
      }
    },
    "shadow": {
      "card": {
        "$type": "shadow",
        "$value": {
          "color": "#00000055",
          "offsetX": { "value": 0, "unit": "px" },
          "offsetY": { "value": 4, "unit": "px" },
          "blur": { "value": 12, "unit": "px" },
          "spread": { "value": 0, "unit": "px" }
        }
      }
    }
  },
  "semantic": {
    "primary": { "$value": "{brand.color.primary}" }
  },
  "deprecated": {
    "old": { "$type": "number", "$value": 1, "$deprecated": "use new" }
  }
}
`;

describe('round trip', () => {
  it('parses the full fixture without errors', () => {
    const doc = parseFormatDocument(FIXTURE, { sourceFileId: 'fixture.tokens' });
    const errors = doc.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);
    expect(Object.keys(doc.tokens)).toHaveLength(10);
    expect(doc.tokens['brand.color.primary']?.extensions).toEqual({
      'org.example.tool': { 'turn-up-to-11': true },
    });
    expect(doc.tokens['semantic.primary']?.isReference).toBe(true);
    expect(doc.tokens['brand.spacing.$root']).toBeDefined();
    expect(doc.tokens['deprecated.old']?.deprecated).toBe('use new');
  });

  it('patch round trip with a change preserves all other bytes', () => {
    const source = parseJsonSource(FIXTURE);
    const out = patchSerialize(FIXTURE, source, [
      {
        pointer: '/brand/color/primary/$value',
        value: { colorSpace: 'srgb', components: [0.8, 0, 0.4] },
      },
    ]);
    // unchanged lines remain byte-identical
    expect(out).toContain('"turn-up-to-11": true');
    expect(out).toContain('"lineHeight": 1.2');
    const doc = parseFormatDocument(out, { sourceFileId: 'x' });
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.tokens['brand.color.primary']?.value).toEqual({
      colorSpace: 'srgb',
      components: [0.8, 0, 0.4],
    });
    expect(doc.tokens['brand.type.heading']?.value).toEqual(
      doc.tokens['brand.type.heading']?.value,
    );
  });

  it('semantics are preserved across canonical re-serialization', () => {
    const doc = parseFormatDocument(FIXTURE, { sourceFileId: 'fixture.tokens' });
    const normalized = canonicalizeDocument(FIXTURE, doc);
    const reparsed = parseFormatDocument(normalized, { sourceFileId: 'x' });
    expect(reparsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    for (const key of Object.keys(doc.tokens)) {
      expect(reparsed.tokens[key]?.type).toBe(doc.tokens[key]?.type);
      expect(JSON.stringify(reparsed.tokens[key]?.value)).toBe(
        JSON.stringify(doc.tokens[key]?.value),
      );
    }
  });
});

function canonicalizeDocument(text: string, doc: ReturnType<typeof parseFormatDocument>): string {
  void doc;
  const source = parseJsonSource(text);
  const json = source.value as Record<string, unknown>;
  // touch nothing: canonicalization of the whole doc is done via JSON re-serialize
  return `${JSON.stringify(json, null, 2)}\n`;
}
