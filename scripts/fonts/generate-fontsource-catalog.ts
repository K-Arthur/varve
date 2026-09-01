import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const API = 'https://api.fontsource.org/v1';
const output = resolve('packages/engine/src/font/fontsource-catalog.json');
const concurrency = 8;

interface ListRecord {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  defSubset: string;
  variable: boolean;
  lastModified: string;
  category: string;
  version: string;
  license: string;
}

interface VersionResponse {
  latest: string;
  latestVariable?: string;
}

interface AxisResponse {
  axes?: Record<
    string,
    { default: string | number; min: string | number; max: string | number; step: string | number }
  >;
}

interface DetailResponse {
  unicodeRange?: Record<string, string>;
}

function number(value: string | number): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid axis value: ${String(value)}`);
  return result;
}

async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url);
    if (response.ok) return (await response.json()) as T;
    if (response.status !== 429 || attempt === 3) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const delayMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 10_000)));
  }
  throw new Error(`${url} did not return a response`);
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

const list = await fetchJson<ListRecord[]>(`${API}/fonts`);
if (!Array.isArray(list) || list.length === 0) throw new Error('Fontsource returned no families');

const explicitPackageVersion = process.env.VARVE_FONT_CATALOG_PACKAGE_VERSION ?? '5.3.0';
if (!/^\d+\.\d+\.\d+$/.test(explicitPackageVersion)) {
  throw new Error(
    `VARVE_FONT_CATALOG_PACKAGE_VERSION must be an exact semver, got ${explicitPackageVersion}`,
  );
}
const versions =
  process.env.VARVE_FONT_CATALOG_FETCH_VERSIONS === '1'
    ? await mapConcurrent(list, async (item) => {
        const response = await fetchJson<VersionResponse>(
          `${API}/version/${encodeURIComponent(item.id)}`,
        );
        const version = item.variable
          ? (response.latestVariable ?? response.latest)
          : response.latest;
        if (!/^\d+\.\d+\.\d+$/.test(version))
          throw new Error(`No exact package version for ${item.id}`);
        return [item.id, version] as const;
      })
    : list.map((item) => [item.id, explicitPackageVersion] as const);

const variableItems = list.filter((item) => item.variable);
let axes: readonly (readonly [
  string,
  { tag: string; default: number; min: number; max: number; step: number }[],
])[];
if (process.env.VARVE_FONT_CATALOG_FETCH_AXES === '1') {
  axes = await mapConcurrent(variableItems, async (item) => {
    const response = await fetchJson<AxisResponse>(
      `${API}/variable/${encodeURIComponent(item.id)}`,
    );
    const normalized = Object.entries(response.axes ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, axis]) => ({
        tag,
        default: number(axis.default),
        min: number(axis.min),
        max: number(axis.max),
        step: number(axis.step),
      }));
    return [item.id, normalized] as const;
  });
} else {
  try {
    const existing = JSON.parse(await readFile(output, 'utf8')) as {
      families?: Array<{ familyId: string; axes?: unknown }>;
    };
    axes = (existing.families ?? []).flatMap((item) =>
      Array.isArray(item.axes)
        ? [
            [
              item.familyId,
              item.axes as {
                tag: string;
                default: number;
                min: number;
                max: number;
                step: number;
              }[],
            ] as const,
          ]
        : [],
    );
  } catch {
    axes = [];
  }
}

const packageVersions = Object.fromEntries(versions);
const axisMap = Object.fromEntries(axes);
// The list endpoint is the stable, low-volume source used for the shipped
// index. Detailed unicode ranges are optional because the API rate-limits
// bulk detail crawls; a maintainer can opt into them for a release snapshot.
const unicodeRangeMap: Record<string, Record<string, string>> = {};
if (process.env.VARVE_FONT_CATALOG_FETCH_DETAILS === '1') {
  const unicodeRanges = await mapConcurrent(list, async (item) => {
    const response = await fetchJson<DetailResponse>(`${API}/fonts/${encodeURIComponent(item.id)}`);
    if (response.unicodeRange && typeof response.unicodeRange !== 'object') {
      throw new Error(`Invalid unicodeRange for ${item.id}`);
    }
    return [item.id, response.unicodeRange ?? {}] as const;
  });
  Object.assign(unicodeRangeMap, Object.fromEntries(unicodeRanges));
}
const families = list
  .map((item) => ({
    providerId: 'fontsource',
    familyId: item.id,
    familyName: item.family,
    aliases: [],
    category: item.category,
    subsets: [...item.subsets].sort(),
    defaultSubset: item.defSubset,
    weights: [...item.weights].sort((a, b) => a - b),
    styles: [
      ...new Set(
        item.styles.filter(
          (style): style is 'normal' | 'italic' => style === 'normal' || style === 'italic',
        ),
      ),
    ].sort(),
    variable: item.variable,
    axes: axisMap[item.id] ?? [],
    unicodeRange: unicodeRangeMap[item.id] ?? {},
    // The current list endpoint omits the historical upstream release field;
    // use the exact package version from /version/{id} until the provider
    // exposes a distinct value again. Never emit an undefined schema field.
    upstreamVersion: item.version ?? packageVersions[item.id],
    packageVersion: packageVersions[item.id],
    lastModified: item.lastModified,
    license: licenseFor(item.license),
  }))
  .sort((a, b) => a.familyId.localeCompare(b.familyId));

const generatedAt = process.env.VARVE_FONT_CATALOG_GENERATED_AT ?? new Date().toISOString();
const provenance = {
  schemaVersion: 1,
  providerId: 'fontsource',
  sourceUrl: `${API}/fonts`,
  generatedBy: 'scripts/fonts/generate-fontsource-catalog.ts@1',
  generatedAt,
  sourceRevision: `fontsource:${families.length}:${families.at(-1)?.familyId ?? 'none'}`,
  checksum: '',
  families,
};
const canonical = JSON.stringify(provenance);
provenance.checksum = createHash('sha256').update(canonical).digest('hex');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
console.log(`Wrote ${families.length} Fontsource families to ${output}`);

function licenseFor(id: string) {
  if (id === 'OFL-1.1')
    return {
      id,
      name: 'SIL Open Font License 1.1',
      url: 'https://scripts.sil.org/OFL',
      commercial: true,
      modification: true,
      redistribution: true,
      embedding: true,
    };
  if (id === 'Apache-2.0')
    return {
      id,
      name: 'Apache License 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
      commercial: true,
      modification: true,
      redistribution: true,
      embedding: true,
    };
  if (id === 'UFL-1.0')
    return {
      id,
      name: 'Ubuntu Font License 1.0',
      url: 'https://ubuntu.com/legal/font-licence',
      commercial: true,
      modification: true,
      redistribution: true,
      embedding: true,
    };
  return {
    id,
    name: id || 'Unknown license',
    commercial: false,
    modification: false,
    redistribution: false,
    embedding: false,
  };
}
