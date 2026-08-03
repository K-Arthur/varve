/**
 * Unit tests for the logo package export — deterministic naming, palette
 * serialization, and README content. (Rendering paths are covered by the
 * existing export pipeline tests; this suite tests the pure composition.)
 */

import { addLogoVariant, createDocument, createLogoProject } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { buildReadme, collectPalette, managedColorToHex } from './logoPackageExport';

describe('managedColorToHex', () => {
  it('serializes RGB colors to hex', () => {
    expect(managedColorToHex({ space: 'rgb', r: 1, g: 0, b: 0, a: 1 })).toBe('#ff0000');
    expect(managedColorToHex({ space: 'rgb', r: 0.1, g: 0.5, b: 1, a: 1 })).toBe('#1a80ff');
  });

  it('serializes gray colors', () => {
    expect(managedColorToHex({ space: 'gray', v: 0.5, a: 1 })).toBe('#808080');
  });
});

describe('collectPalette', () => {
  it('falls back to document swatches when no project palette exists', () => {
    let doc = createDocument('Brand', true);
    doc = {
      ...doc,
      swatches: [
        {
          id: 's1',
          name: 'Brand Teal',
          color: { space: 'rgb', r: 0.05, g: 0.6, b: 0.55, a: 1 },
        },
      ],
    };
    const palette = collectPalette(doc);
    expect(palette['Brand Teal']).toBe('#0d998c');
  });

  it('prefers the project palette', () => {
    let doc = createDocument('Brand', true);
    doc = { ...doc, logoProject: createLogoProject('Brand') };
    doc = {
      ...doc,
      logoProject: {
        ...doc.logoProject!,
        palette: {
          colors: [{ id: 'c1', name: 'Ink', color: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 } }],
          updatedAt: 0,
        },
      },
    };
    const palette = collectPalette(doc);
    expect(palette['Ink']).toBe('#000000');
  });
});

describe('buildReadme', () => {
  it('documents concepts, variants, palette, and licensing notes', () => {
    const readme = buildReadme(
      'Acme',
      [{ name: 'Primary', folders: ['Primary.png', 'Primary@2x.png', 'Primary.svg'] }],
      [{ name: 'Mono', kind: 'monochrome', folders: ['Mono.png'] }],
      2,
    );
    expect(readme).toContain('# Acme — Logo Package');
    expect(readme).toContain('- Primary: Primary.png, Primary@2x.png, Primary.svg');
    expect(readme).toContain('- Mono (monochrome): Mono.png');
    expect(readme).toContain('2 brand color(s)');
    expect(readme).toContain('monochrome or reversed variant');
    expect(readme).toContain('does not grant or assert trademark rights');
  });
});

describe('variant helpers', () => {
  it('addLogoVariant registers against a logo project', () => {
    let doc = createDocument('Brand', true);
    doc = { ...doc, logoProject: createLogoProject('Brand') };
    doc = addLogoVariant(doc, {
      name: 'Icon',
      kind: 'icon',
      artboardId: null,
      sourceConceptId: null,
    });
    expect(doc.logoProject?.variants).toHaveLength(1);
    expect(doc.logoProject?.variants[0]?.kind).toBe('icon');
  });
});
