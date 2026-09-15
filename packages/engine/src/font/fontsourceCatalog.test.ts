import { describe, expect, it } from 'vitest';
import {
  FontsourceCatalogStore,
  resolveFontsourceArtifact,
  searchFontsourceCatalog,
  validateFontsourceCatalogSnapshot,
} from './fontsourceCatalog';

const snapshot = {
  schemaVersion: 1,
  providerId: 'fontsource',
  sourceUrl: 'https://api.fontsource.org/v1/fonts',
  generatedBy: 'test',
  generatedAt: '2026-08-31T00:00:00.000Z',
  sourceRevision: 'test:1',
  checksum: 'test',
  families: [
    {
      providerId: 'fontsource',
      familyId: 'test-sans',
      familyName: 'Test Sans',
      aliases: ['TSans'],
      category: 'sans-serif',
      subsets: ['latin', 'cyrillic'],
      defaultSubset: 'latin',
      weights: [400, 700],
      styles: ['normal', 'italic'],
      variable: false,
      axes: [],
      unicodeRange: { latin: 'U+0000-00FF' },
      upstreamVersion: 'v1',
      packageVersion: '5.3.0',
      lastModified: '2026-01-01',
      license: {
        id: 'OFL-1.1',
        name: 'SIL Open Font License 1.1',
        commercial: true,
        modification: true,
        redistribution: true,
        embedding: true,
      },
    },
  ],
} as const;

describe('FontsourceCatalogStore', () => {
  it('validates a shipped snapshot and searches without fetch', () => {
    const store = new FontsourceCatalogStore(validateFontsourceCatalogSnapshot(snapshot));
    expect(store.size).toBe(1);
    expect(store.search({ query: 'tsans' })[0]?.familyId).toBe('test-sans');
    expect(store.search({ style: 'italic', weight: 700 })).toHaveLength(1);
  });

  it('publishes installation state reactively', () => {
    const store = new FontsourceCatalogStore(validateFontsourceCatalogSnapshot(snapshot));
    let notifications = 0;
    store.subscribe(() => notifications++);
    store.setInstalled('test-sans', true);
    expect(store.isInstalled('test-sans')).toBe(true);
    expect(store.search({})[0]?.installState).toBe('installed');
    expect(notifications).toBe(1);
  });
});

describe('Fontsource schema and artifact resolver', () => {
  it('rejects schema drift and floating package versions', () => {
    expect(() => validateFontsourceCatalogSnapshot({ ...snapshot, schemaVersion: 2 })).toThrow(
      /schema version/,
    );
    expect(() =>
      validateFontsourceCatalogSnapshot({
        ...snapshot,
        families: [{ ...snapshot.families[0], packageVersion: 'latest' }],
      }),
    ).toThrow(/exact package version/);
  });

  it('resolves a precise static artifact without provider metadata requests', () => {
    const record = validateFontsourceCatalogSnapshot(snapshot).families[0]!;
    const artifact = resolveFontsourceArtifact(record, {
      weight: 700,
      style: 'italic',
      subset: 'cyrillic',
    });
    expect(artifact.url).toBe(
      'https://cdn.jsdelivr.net/fontsource/fonts/test-sans@5.3.0/cyrillic-700-italic.woff2',
    );
    expect(artifact.url).not.toContain('@latest');
    expect(artifact.providerId).toBe('fontsource');
  });

  it('ranks exact and prefix matches before loose matches', () => {
    const records = validateFontsourceCatalogSnapshot({
      ...snapshot,
      families: [
        snapshot.families[0]!,
        { ...snapshot.families[0]!, familyId: 'test-sans-pro', familyName: 'Test Sans Pro' },
        { ...snapshot.families[0]!, familyId: 'display-test', familyName: 'Display Test' },
      ],
    }).families;
    expect(
      searchFontsourceCatalog(records, { query: 'test sans' }).map((item) => item.familyName),
    ).toEqual(['Test Sans', 'Test Sans Pro']);
  });
});
