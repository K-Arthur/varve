/**
 * Icon attribution inventory tests.
 */

import { describe, expect, it } from 'vitest';
import type { Document } from './document';
import { createDocumentIconAsset } from './iconAsset';
import {
  collectIconAttribution,
  generateAttributionReportMarkdown,
  generateAttributionReportText,
  hasAttributionRequirements,
} from './iconAttribution';

function docWithAssets(): Document {
  const mdi = createDocumentIconAsset(
    'home',
    'mdi',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>',
    {
      providerId: 'iconify',
      licence: 'Apache License 2.0',
      attribution: 'Material Design Icons',
      provenance: {
        spdxId: 'Apache-2.0',
        licenceUrl: 'https://github.com/Templarian/MaterialDesign/blob/master/LICENSE',
        attributionText: 'Licensed under the Apache License 2.0',
        author: 'Pictogrammers',
        sourceUrl: 'https://github.com/Templarian/MaterialDesign',
        canonicalId: 'iconify:mdi:home',
      },
    },
  );
  const lucide = createDocumentIconAsset(
    'star',
    'lucide',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>',
    {
      providerId: 'iconify',
      licence: 'ISC',
      provenance: { spdxId: 'ISC', attributionText: 'Licensed under the ISC License' },
    },
  );
  const custom = createDocumentIconAsset(
    'my-icon',
    'custom',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>',
    {
      providerId: 'local',
    },
  );
  mdi.id = 'icon-mdi-1';
  lucide.id = 'icon-lucide-1';
  custom.id = 'icon-custom-1';
  return {
    name: 'test',
    id: 'doc-1',
    version: 1,
    nodes: {},
    rootChildren: [],
    pages: [],
    iconAssets: {
      [mdi.id]: mdi,
      [lucide.id]: lucide,
      [custom.id]: custom,
    },
  } as unknown as Document;
}

describe('collectIconAttribution', () => {
  it('collects one entry per embedded asset with provenance', () => {
    const entries = collectIconAttribution(docWithAssets());
    expect(entries).toHaveLength(3);
    const mdi = entries.find((e) => e.iconName === 'home');
    expect(mdi?.licence.spdxId).toBe('Apache-2.0');
    expect(mdi?.pack).toBe('mdi');
    expect(mdi?.sourceUrl).toContain('github.com');
  });

  it('marks licence-less assets as unknown, not verified', () => {
    const entries = collectIconAttribution(docWithAssets());
    const custom = entries.find((e) => e.iconName === 'my-icon');
    expect(custom?.licence.spdxId).toBe('unknown');
    expect(custom?.licence.commercialUse).toBe(false);
    expect(custom?.licence.attributionRequired).toBe(true);
  });

  it('sorts stably by licence, pack, name', () => {
    const entries = collectIconAttribution(docWithAssets());
    const order = entries.map((e) => `${e.licence.spdxId}:${e.pack}:${e.iconName}`);
    expect(order).toEqual([...order].sort());
  });

  it('flags documents with attribution requirements', () => {
    expect(hasAttributionRequirements(docWithAssets())).toBe(true);
    const plain = {
      ...docWithAssets(),
      iconAssets: undefined,
    } as unknown as Document;
    expect(hasAttributionRequirements(plain)).toBe(false);
  });
});

describe('attribution reports', () => {
  it('generates a plain-text report grouped by licence', () => {
    const report = generateAttributionReportText(collectIconAttribution(docWithAssets()));
    expect(report).toContain('Icon Attribution Report');
    expect(report).toContain('Apache License 2.0 (Apache-2.0)');
    expect(report).toContain('"home" from iconify (mdi)');
    expect(report).toContain('Unknown Licence (unknown)');
    expect(report).toContain('Commercial use is NOT permitted');
  });

  it('generates a markdown report with licence URLs', () => {
    const report = generateAttributionReportMarkdown(collectIconAttribution(docWithAssets()));
    expect(report).toContain('# Icon Attribution');
    expect(report).toContain('License URL: https://github.com/Templarian/MaterialDesign');
    expect(report).toContain('- "home" by iconify (mdi)');
  });
});
