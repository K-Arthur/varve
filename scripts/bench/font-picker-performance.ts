import { performance } from 'node:perf_hooks';
import type { FontsourceCatalogRecord } from '../../packages/engine/src/font/catalogSchema';
import { FontSemanticCatalog } from '../../packages/engine/src/font/semantic/semanticCatalog';
import { FontRegistry } from '../../packages/engine/src/fontRegistry';

const WARMUP_RUNS = 8;
const SAMPLE_RUNS = 40;
const OPEN_BUDGET_MS = 150;
const SEARCH_BUDGET_MS = 100;

function syntheticRecord(index: number): FontsourceCatalogRecord {
  const variable = index % 5 === 0;
  return {
    providerId: 'fontsource',
    familyId: `bench-family-${index}`,
    familyName: `Bench Family ${String(index).padStart(5, '0')}`,
    aliases: [`Bench ${index}`],
    category: index % 3 === 0 ? 'sans-serif' : index % 3 === 1 ? 'serif' : 'display',
    subsets: index % 4 === 0 ? ['latin', 'vietnamese'] : ['latin'],
    defaultSubset: 'latin',
    weights: variable ? [100, 400, 700, 900] : [400, 700],
    styles: index % 7 === 0 ? ['normal', 'italic'] : ['normal'],
    variable,
    axes: variable
      ? [
          { tag: 'wght', default: 400, min: 100, max: 900, step: 1 },
          ...(index % 2 === 0 ? [{ tag: 'wdth', default: 100, min: 75, max: 125, step: 1 }] : []),
        ]
      : [],
    unicodeRange: {},
    upstreamVersion: 'bench',
    packageVersion: 'bench.1',
    lastModified: '2026-01-01',
    license: {
      id: 'OFL-1.1',
      name: 'SIL Open Font License 1.1',
      commercial: true,
      modification: true,
      redistribution: true,
      embedding: true,
    },
    sourceType: 'google',
  };
}

function percentile(samples: readonly number[], percentileValue: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function measure(operation: () => void): number {
  const start = performance.now();
  operation();
  return performance.now() - start;
}

/**
 * Mirrors the work performed by FontSelector before rows enter TanStack
 * Virtualizer: deduplicate family names, sort the installed-family list, and
 * flatten the section headers and family rows. Face expansion is deliberately
 * excluded because it depends on the platform registry rather than catalog
 * size and is measured by the browser E2E suite.
 */
function buildPickerRows(catalog: FontSemanticCatalog): number {
  const byName = new Map<string, ReturnType<FontSemanticCatalog['all']>[number]>();
  for (const record of catalog.all()) {
    const key = record.familyName.normalize('NFKD').toLocaleLowerCase();
    byName.set(key, record);
  }
  const records = [...byName.values()].sort((a, b) => a.familyName.localeCompare(b.familyName));
  return records.length + (records.length > 0 ? 1 : 0);
}

function runCase(size: number): {
  size: number;
  coldBuildMs: number;
  openP95Ms: number;
  searchP95Ms: number;
  previewLookupP95Ms: number;
  rows: number;
} {
  const source = Array.from({ length: size }, (_, index) => syntheticRecord(index));
  const buildStart = performance.now();
  const catalog = new FontSemanticCatalog({
    fontsource: source,
    registry: new FontRegistry([]),
  });
  const coldBuildMs = performance.now() - buildStart;

  // Warm the same paths used by a mounted picker before sampling them.
  buildPickerRows(catalog);
  catalog.search('Bench Family 00420', {
    installedOnly: false,
    limit: Number.MAX_SAFE_INTEGER,
    diversity: false,
  });
  catalog.findByFamilyName(`Bench Family ${String(Math.floor(size / 2)).padStart(5, '0')}`);

  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    buildPickerRows(catalog);
    catalog.search('Bench Family 00420', {
      installedOnly: false,
      limit: Number.MAX_SAFE_INTEGER,
      diversity: false,
    });
  }

  const openSamples: number[] = [];
  const searchSamples: number[] = [];
  const previewLookupSamples: number[] = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    openSamples.push(measure(() => buildPickerRows(catalog)));
    searchSamples.push(
      measure(() => {
        catalog.search('Bench Family 00420', {
          installedOnly: false,
          limit: Number.MAX_SAFE_INTEGER,
          diversity: false,
        });
      }),
    );
    previewLookupSamples.push(
      measure(() => {
        catalog.findByFamilyName(`Bench Family ${String(Math.floor(size / 2)).padStart(5, '0')}`);
      }),
    );
  }

  return {
    size,
    coldBuildMs,
    openP95Ms: percentile(openSamples, 0.95),
    searchP95Ms: percentile(searchSamples, 0.95),
    previewLookupP95Ms: percentile(previewLookupSamples, 0.95),
    rows: buildPickerRows(catalog),
  };
}

const results = [runCase(1_000), runCase(10_000)];
console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      runtime: process.version,
      budgets: {
        warmOpenP95Ms: OPEN_BUDGET_MS,
        warmSearchP95Ms: SEARCH_BUDGET_MS,
        readyFacePreview: 'not measured by this Node-only benchmark',
      },
      results,
    },
    null,
    2,
  ),
);

const failed = results.filter(
  (result) => result.openP95Ms > OPEN_BUDGET_MS || result.searchP95Ms > SEARCH_BUDGET_MS,
);
if (failed.length > 0) {
  throw new Error(
    `Font picker warm budget exceeded: ${failed.map((result) => result.size).join(', ')} families`,
  );
}
