import { describe, expect, it } from 'vitest';
import { buildDTCGExport, dtcgExport, dtcgFlatExport, tokensStudioExport } from './dtcg';

describe('DTCG Export — Structure', () => {
  it('exports all 3 themes', () => {
    const result = buildDTCGExport();
    expect(result['theme-light']).toBeDefined();
    expect(result['theme-dark']).toBeDefined();
    expect(result['theme-high-contrast']).toBeDefined();
  });

  it('exports tokens as color type with nested CTI path', () => {
    const result = buildDTCGExport(['light']);
    const light = result['theme-light']!;
    const color = light.color as Record<string, unknown>;
    const surface = color.surface as Record<string, unknown>;
    const app = surface.app as Record<string, unknown>;
    expect(app).toHaveProperty('$type', 'color');
    expect(app).toHaveProperty('$value');
    expect(typeof (app as { $value: unknown }).$value).toBe('object');
  });

  it('uses DTCG 2025.10 structured OKLCH color values', () => {
    const result = buildDTCGExport(['light']);
    const light = result['theme-light']!;
    const color = light.color as Record<string, unknown>;
    const surface = color.surface as Record<string, unknown>;
    const app = surface.app as Record<string, unknown>;
    expect((app as { $value: { colorSpace: string; components: number[] } }).$value).toMatchObject({
      colorSpace: 'oklch',
      components: expect.arrayContaining([expect.any(Number)]),
    });
  });

  it('includes a vendor-namespaced extension', () => {
    const result = buildDTCGExport(['light']);
    const light = result['theme-light']!;
    const color = light.color as Record<string, unknown>;
    const text = color.text as Record<string, unknown>;
    const primary = text.primary as Record<string, unknown>;
    const extensions = (primary as Record<string, unknown>).$extensions as Record<string, unknown>;
    expect(Object.keys(extensions)).toEqual(['org.varve']);
    expect(extensions['org.varve']).toMatchObject({ token: 'text-primary', theme: 'light' });
  });
});

describe('DTCG Export — CTI Hierarchy', () => {
  it('maps surface tokens to color/surface/', () => {
    const result = buildDTCGExport(['light']);
    const light = result['theme-light']!;
    const color = light.color as Record<string, unknown>;
    const surface = color.surface as Record<string, unknown>;
    expect(surface.app).toBeDefined();
    expect(surface.base).toBeDefined();
    expect(surface.raised).toBeDefined();
  });

  it('maps text tokens to color/text/', () => {
    const result = buildDTCGExport(['light']);
    const light = result['theme-light']!;
    const color = light.color as Record<string, unknown>;
    const text = color.text as Record<string, unknown>;
    expect(text.primary).toBeDefined();
    expect(text.secondary).toBeDefined();
  });

  it('maps layer tokens with multi-segment paths', () => {
    const result = buildDTCGExport(['light']);
    const light = result['theme-light']!;
    const color = light.color as Record<string, unknown>;
    const layer = color.layer as Record<string, unknown>;
    expect(layer).toBeDefined();
    const accent = layer.accent as Record<string, unknown>;
    expect(accent.frame).toBeDefined();
  });
});

describe('DTCG Export — Full Document', () => {
  it('omits $version, which is not part of DTCG 2025.10', () => {
    const doc = dtcgExport() as Record<string, unknown>;
    expect(doc.$version).toBeUndefined();
    expect(Object.keys(doc).filter((key) => key.startsWith('$'))).toEqual([
      '$description',
      '$extensions',
    ]);
    expect(doc.$description).toContain('Varve');
    expect(doc['theme-light']).toBeDefined();
  });

  it('is deterministic across calls', () => {
    expect(JSON.stringify(dtcgExport())).toBe(JSON.stringify(dtcgExport()));
  });

  it('namespaces root metadata under org.varve', () => {
    const doc = dtcgExport() as Record<string, unknown>;
    const extensions = doc.$extensions as Record<string, unknown>;
    expect(Object.keys(extensions)).toEqual(['org.varve']);
    expect(extensions['org.varve']).toMatchObject({ specification: 'dtcg-2025.10' });
  });

  it('emits full authored precision for oklch components', () => {
    const doc = dtcgExport() as Record<string, unknown>;
    const theme = doc['theme-light'] as Record<string, unknown>;
    const color = theme.color as Record<string, unknown>;
    const surface = color.surface as Record<string, unknown>;
    const app = surface.app as Record<string, unknown>;
    const value = (app as { $value: { components: number[] } }).$value;
    expect(value.components).toEqual([0.97, 0.008, 260]);
  });
});

describe('DTCG Export — Flat Format', () => {
  it('returns entries array', () => {
    const entries = dtcgFlatExport();
    expect(entries.length).toBeGreaterThan(0);
  });

  it('each entry has required fields', () => {
    const entries = dtcgFlatExport();
    const entry = entries[0]!;
    expect(entry).toHaveProperty('name');
    expect(entry).toHaveProperty('theme');
    expect(entry).toHaveProperty('path');
    expect(entry).toHaveProperty('$type', 'color');
    expect(entry).toHaveProperty('$value');
  });

  it('includes all themes', () => {
    const entries = dtcgFlatExport();
    const themes = new Set(entries.map((e) => e.theme));
    expect(themes.has('light')).toBe(true);
    expect(themes.has('dark')).toBe(true);
    expect(themes.has('high-contrast')).toBe(true);
  });
});

describe('Tokens Studio Export', () => {
  it('exports in Tokens Studio format', () => {
    const result = tokensStudioExport();
    expect(result.global).toBeDefined();
    expect(result.dark).toBeDefined();
    expect(result['high-contrast']).toBeDefined();
  });

  it('uses {value, type} format with CTI nesting', () => {
    const result = tokensStudioExport();
    const global = result.global as Record<string, unknown>;
    const color = global.color as Record<string, unknown>;
    const surface = color.surface as Record<string, unknown>;
    const app = surface.app as Record<string, unknown>;
    expect(app).toHaveProperty('value');
    expect(app).toHaveProperty('type', 'color');
  });
});
