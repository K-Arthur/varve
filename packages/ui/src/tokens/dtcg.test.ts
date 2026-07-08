import { describe, expect, it } from 'vitest';
import { buildDTCGExport, dtcgExport, dtcgFlatExport, figmaTokensExport } from './dtcg';

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

  it('includes strata-token extension', () => {
    const result = buildDTCGExport(['light']);
    const light = result['theme-light']!;
    const color = light.color as Record<string, unknown>;
    const text = color.text as Record<string, unknown>;
    const primary = text.primary as Record<string, unknown>;
    const extensions = (primary as Record<string, unknown>).$extensions as Record<string, unknown>;
    expect(extensions['strata-token']).toBe('text-primary');
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
  it('includes version and description', () => {
    const doc = dtcgExport();
    expect(doc.$version).toBe('1.0');
    expect(doc.$description).toContain('Strata');
    expect(doc.color).toBeDefined();
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

describe('Figma Tokens Studio Export', () => {
  it('exports in Tokens Studio format', () => {
    const result = figmaTokensExport();
    expect(result.global).toBeDefined();
    expect(result.dark).toBeDefined();
    expect(result['high-contrast']).toBeDefined();
  });

  it('uses {value, type} format with CTI nesting', () => {
    const result = figmaTokensExport();
    const global = result.global as Record<string, unknown>;
    const color = global.color as Record<string, unknown>;
    const surface = color.surface as Record<string, unknown>;
    const app = surface.app as Record<string, unknown>;
    expect(app).toHaveProperty('value');
    expect(app).toHaveProperty('type', 'color');
  });
});
