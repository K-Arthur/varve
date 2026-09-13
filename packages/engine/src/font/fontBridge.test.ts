import { describe, expect, it } from 'vitest';
import { FontRegistry } from '../fontRegistry';
import { createFontCatalogFromRegistry } from './fontBridge';

const FIRST_HASH = 'a'.repeat(64);
const SECOND_HASH = 'b'.repeat(64);

describe('createFontCatalogFromRegistry', () => {
  it('projects every exact face and preserves parsed registry metadata', () => {
    const registry = new FontRegistry([]);
    registry.registerMetadata({
      family: 'Atlas Variable',
      vendor: 'Varve Foundry',
      version: 'Version 2.1',
      unitsPerEm: 2048,
      ascender: 1900,
      descender: -500,
      lineGap: 100,
      glyphCount: 1200,
      embeddingRights: 'editable',
      openTypeFeatures: ['kern', 'liga'],
      namedInstances: [{ name: 'Text', coordinates: { wght: 400 } }],
    });
    registry.register({
      family: 'Atlas Variable',
      weight: 400,
      style: 'normal',
      source: 'user',
      postScriptName: 'Atlas-Regular',
      faceKey: `sha256:${FIRST_HASH}:single`,
      axisDefinitions: [{ tag: 'wght', name: 'Weight', min: 300, default: 400, max: 800 }],
    });
    registry.register({
      family: 'Atlas Variable',
      weight: 700,
      style: 'normal',
      source: 'user',
      postScriptName: 'Atlas-Bold',
      faceKey: `sha256:${SECOND_HASH}:single`,
      axisDefinitions: [{ tag: 'wght', name: 'Weight', min: 300, default: 400, max: 800 }],
    });

    const catalog = createFontCatalogFromRegistry(registry);
    const entries = catalog.getEntriesForFamily('Atlas Variable');

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.identity.contentHash)).toEqual(
      expect.arrayContaining([FIRST_HASH, SECOND_HASH]),
    );
    expect(entries.map((entry) => entry.identity.postScriptName)).toEqual(
      expect.arrayContaining(['Atlas-Regular', 'Atlas-Bold']),
    );
    expect(entries[0]?.vendor).toBe('Varve Foundry');
    expect(entries[0]?.unitsPerEm).toBe(2048);
    expect(entries[0]?.axes).toEqual([
      { tag: 'wght', name: 'Weight', min: 300, default: 400, max: 800 },
    ]);
    expect(entries[0]?.namedInstances).toEqual([{ name: 'Text', coordinates: { wght: 400 } }]);
  });

  it('keeps family-only registry entries distinct without claiming exact hashes', () => {
    const registry = new FontRegistry([]);
    registry.register({
      family: 'Legacy Sans',
      weight: 400,
      style: 'normal',
      source: 'system',
    });
    registry.register({
      family: 'Legacy Sans',
      weight: 700,
      style: 'normal',
      source: 'system',
    });

    const entries = createFontCatalogFromRegistry(registry).getEntriesForFamily('Legacy Sans');

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.identity.hashAlgorithm === 'unknown')).toBe(true);
    expect(entries[0]?.identity.contentHash).toContain('registry:Legacy Sans:system');
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });
});
