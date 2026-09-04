/**
 * Provider-neutral, shipped font catalog schema.
 *
 * The application reads this data synchronously at startup. Only the
 * maintainer-side generator talks to Fontsource metadata endpoints.
 */

export const FONTSOURCE_PROVIDER_ID = 'fontsource' as const;
export const FONT_CATALOG_SCHEMA_VERSION = 1 as const;
export const FONTSOURCE_CDN_HOST = 'cdn.jsdelivr.net' as const;
export const FONTSOURCE_CDN_ORIGIN = `https://${FONTSOURCE_CDN_HOST}` as const;

export interface CatalogAxis {
  tag: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface CatalogLicense {
  id: string;
  name: string;
  url?: string;
  attribution?: string;
  commercial: boolean;
  modification: boolean;
  redistribution: boolean;
  embedding: boolean;
}

export interface FontsourceCatalogRecord {
  providerId: typeof FONTSOURCE_PROVIDER_ID;
  familyId: string;
  familyName: string;
  aliases: string[];
  category: string;
  subsets: string[];
  defaultSubset: string;
  weights: number[];
  styles: Array<'normal' | 'italic'>;
  variable: boolean;
  axes: CatalogAxis[];
  unicodeRange: Record<string, string>;
  upstreamVersion: string;
  packageVersion: string;
  lastModified: string;
  license: CatalogLicense;
  /** Upstream origin when the provider exposes it; absent means unknown. */
  sourceType?: 'google' | 'other' | 'icon' | 'unknown';
}

export interface FontsourceCatalogSnapshot {
  schemaVersion: typeof FONT_CATALOG_SCHEMA_VERSION;
  providerId: typeof FONTSOURCE_PROVIDER_ID;
  sourceUrl: string;
  generatedBy: string;
  generatedAt: string;
  sourceRevision: string;
  checksum: string;
  families: FontsourceCatalogRecord[];
}

export interface FontArtifactRequest {
  familyId: string;
  weight?: number;
  style?: 'normal' | 'italic';
  subset?: string;
  variable?: boolean;
  axes?: Record<string, number>;
  format?: 'woff2' | 'woff' | 'ttf';
}

export interface FontArtifactDescriptor {
  providerId: typeof FONTSOURCE_PROVIDER_ID;
  familyId: string;
  familyName: string;
  packageVersion: string;
  upstreamVersion: string;
  weight?: number;
  style: 'normal' | 'italic';
  subset: string;
  variable: boolean;
  axes: CatalogAxis[];
  format: 'woff2' | 'woff' | 'ttf';
  url: string;
  license: CatalogLicense;
}

const LICENSES: Record<string, CatalogLicense> = {
  'OFL-1.1': {
    id: 'OFL-1.1',
    name: 'SIL Open Font License 1.1',
    url: 'https://scripts.sil.org/OFL',
    commercial: true,
    modification: true,
    redistribution: true,
    embedding: true,
  },
  'Apache-2.0': {
    id: 'Apache-2.0',
    name: 'Apache License 2.0',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    commercial: true,
    modification: true,
    redistribution: true,
    embedding: true,
  },
  'UFL-1.0': {
    id: 'UFL-1.0',
    name: 'Ubuntu Font License 1.0',
    url: 'https://ubuntu.com/legal/font-licence',
    commercial: true,
    modification: true,
    redistribution: true,
    embedding: true,
  },
};

export function licenseForId(id: string): CatalogLicense {
  return (
    LICENSES[id] ?? {
      id,
      name: id || 'Unknown license',
      commercial: false,
      modification: false,
      redistribution: false,
      embedding: false,
    }
  );
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Fontsource catalog schema: ${field} must be a non-empty string`);
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Fontsource catalog schema: ${field} must be a string array`);
  }
}

function assertNumberArray(value: unknown, field: string): asserts value is number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number')) {
    throw new Error(`Fontsource catalog schema: ${field} must be a number array`);
  }
}

/** Validate a raw `/v1/fonts` record before it is normalized. */
export function validateFontsourceListRecord(value: unknown, index = 0): void {
  if (!value || typeof value !== 'object') {
    throw new Error(`Fontsource response schema: record ${index} must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const field of [
    'id',
    'family',
    'defSubset',
    'lastModified',
    'category',
    'version',
    'license',
    'type',
  ]) {
    assertString(record[field], `record ${index}.${field}`);
  }
  assertStringArray(record.subsets, `record ${index}.subsets`);
  assertNumberArray(record.weights, `record ${index}.weights`);
  assertStringArray(record.styles, `record ${index}.styles`);
  if (typeof record.variable !== 'boolean') {
    throw new Error(`Fontsource response schema: record ${index}.variable must be boolean`);
  }
}

/** Validate and normalize the official family-list response. */
export function normalizeFontsourceList(
  value: unknown,
  options: { packageVersions?: Record<string, string>; axes?: Record<string, CatalogAxis[]> } = {},
): FontsourceCatalogRecord[] {
  if (!Array.isArray(value)) throw new Error('Fontsource response schema: expected an array');
  return value.map((raw, index) => {
    validateFontsourceListRecord(raw, index);
    const record = raw as Record<string, unknown>;
    const familyId = record.id as string;
    const packageVersion = options.packageVersions?.[familyId];
    if (!packageVersion) {
      throw new Error(`Fontsource response schema: missing exact package version for ${familyId}`);
    }
    const styles = (record.styles as string[]).filter(
      (style): style is 'normal' | 'italic' => style === 'normal' || style === 'italic',
    );
    if (styles.length === 0)
      throw new Error(`Fontsource response schema: no supported styles for ${familyId}`);
    return {
      providerId: FONTSOURCE_PROVIDER_ID,
      familyId,
      familyName: record.family as string,
      aliases: [],
      category: record.category as string,
      subsets: [...(record.subsets as string[])].sort(),
      defaultSubset: record.defSubset as string,
      weights: [...(record.weights as number[])].sort((a, b) => a - b),
      styles: [...new Set(styles)].sort(),
      variable: record.variable as boolean,
      axes: (options.axes?.[familyId] ?? []).map((axis) => ({ ...axis })),
      unicodeRange: {},
      upstreamVersion: record.version as string,
      packageVersion,
      lastModified: record.lastModified as string,
      license: licenseForId(record.license as string),
    } satisfies FontsourceCatalogRecord;
  });
}

function exactVersion(version: string): string {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Fontsource artifact version is not exact: ${version}`);
  }
  return version;
}

function axisSignature(
  record: FontsourceCatalogRecord,
  requested?: Record<string, number>,
): string {
  const tags = Object.keys(requested ?? {}).filter((tag) =>
    record.axes.some((axis) => axis.tag === tag),
  );
  if (tags.length === 0) return record.axes.length > 0 ? 'wght' : '';
  return tags.sort().join('-');
}

/** Resolve one exact, allowlisted Fontsource artifact from local metadata. */
export function resolveFontsourceArtifact(
  record: FontsourceCatalogRecord,
  request: Omit<FontArtifactRequest, 'familyId'> = {},
): FontArtifactDescriptor {
  const subset = request.subset ?? record.defaultSubset;
  if (!record.subsets.includes(subset))
    throw new Error(`Subset "${subset}" is unavailable for ${record.familyName}`);
  const style = request.style ?? 'normal';
  if (!record.styles.includes(style))
    throw new Error(`Style "${style}" is unavailable for ${record.familyName}`);
  const format = request.format ?? 'woff2';
  const variable = request.variable ?? false;
  if (variable && !record.variable)
    throw new Error(`${record.familyName} has no variable artifact`);
  const weight =
    request.weight ?? (record.weights.includes(400) ? 400 : (record.weights[0] ?? 400));
  if (!variable && !record.weights.includes(weight)) {
    throw new Error(`Weight ${weight} is unavailable for ${record.familyName}`);
  }
  const version = exactVersion(packageVersionForArtifact(record, variable));
  const fileName = variable
    ? `${subset}-${axisSignature(record, request.axes)}-${style}.${format}`
    : `${subset}-${weight}-${style}.${format}`;
  const packageName = variable ? `${record.familyId}:vf` : record.familyId;
  const url = `${FONTSOURCE_CDN_ORIGIN}/fontsource/fonts/${packageName}@${version}/${fileName}`;
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== FONTSOURCE_CDN_HOST ||
    url.includes('@latest')
  ) {
    throw new Error('Fontsource artifact URL failed the allowlist check');
  }
  return {
    providerId: FONTSOURCE_PROVIDER_ID,
    familyId: record.familyId,
    familyName: record.familyName,
    packageVersion: version,
    upstreamVersion: record.upstreamVersion,
    weight: variable ? undefined : weight,
    style,
    subset,
    variable,
    axes: record.axes,
    format,
    url,
    license: record.license,
  };
}

function packageVersionForArtifact(record: FontsourceCatalogRecord, _variable: boolean): string {
  return record.packageVersion;
}

export interface CatalogSearchOptions {
  query?: string;
  category?: string;
  variable?: boolean;
  weight?: number;
  style?: 'normal' | 'italic';
  subset?: string;
  limit?: number;
}

export interface CatalogSearchResult extends FontsourceCatalogRecord {
  score: number;
  installState: 'available-to-download' | 'installed';
}

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Search a shipped catalog without allocations or network access per query. */
export function searchFontsourceCatalog(
  records: readonly FontsourceCatalogRecord[],
  options: CatalogSearchOptions = {},
  installed = new Set<string>(),
): CatalogSearchResult[] {
  const query = normalized(options.query ?? '');
  const results: CatalogSearchResult[] = [];
  for (const record of records) {
    if (options.category && record.category !== options.category) continue;
    if (options.variable !== undefined && record.variable !== options.variable) continue;
    if (options.weight !== undefined && !record.weights.includes(options.weight)) continue;
    if (options.style && !record.styles.includes(options.style)) continue;
    if (options.subset && !record.subsets.includes(options.subset)) continue;
    const name = normalized(record.familyName);
    const id = normalized(record.familyId);
    const alias = record.aliases.some((item) => normalized(item).includes(query));
    if (query && !name.includes(query) && !id.includes(query) && !alias) continue;
    const score = !query
      ? 0
      : name === query
        ? 100
        : name.startsWith(query)
          ? 80
          : id.startsWith(query)
            ? 60
            : 40;
    results.push({
      ...record,
      score,
      installState: installed.has(record.familyId) ? 'installed' : 'available-to-download',
    });
  }
  results.sort((a, b) => b.score - a.score || a.familyName.localeCompare(b.familyName));
  return results.slice(0, options.limit ?? 50);
}

/** Validate the generated snapshot at the application boundary. */
export function validateFontsourceCatalogSnapshot(value: unknown): FontsourceCatalogSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Font catalog must be an object');
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schemaVersion !== FONT_CATALOG_SCHEMA_VERSION)
    throw new Error('Unsupported font catalog schema version');
  if (snapshot.providerId !== FONTSOURCE_PROVIDER_ID)
    throw new Error('Unsupported font catalog provider');
  assertString(snapshot.sourceUrl, 'snapshot.sourceUrl');
  assertString(snapshot.generatedBy, 'snapshot.generatedBy');
  assertString(snapshot.generatedAt, 'snapshot.generatedAt');
  assertString(snapshot.sourceRevision, 'snapshot.sourceRevision');
  assertString(snapshot.checksum, 'snapshot.checksum');
  if (!Array.isArray(snapshot.families)) throw new Error('Font catalog families must be an array');
  for (const [index, family] of snapshot.families.entries()) {
    if (!family || typeof family !== 'object')
      throw new Error(`Font catalog family ${index} must be an object`);
    const item = family as Record<string, unknown>;
    for (const field of [
      'providerId',
      'familyId',
      'familyName',
      'category',
      'defaultSubset',
      'upstreamVersion',
      'packageVersion',
      'lastModified',
    ]) {
      assertString(item[field], `family ${index}.${field}`);
    }
    assertStringArray(item.aliases, `family ${index}.aliases`);
    assertStringArray(item.subsets, `family ${index}.subsets`);
    assertNumberArray(item.weights, `family ${index}.weights`);
    assertStringArray(item.styles, `family ${index}.styles`);
    if (item.providerId !== FONTSOURCE_PROVIDER_ID || typeof item.variable !== 'boolean') {
      throw new Error(`Font catalog family ${index} has invalid provider or variable flag`);
    }
    if (
      item.sourceType !== undefined &&
      item.sourceType !== 'google' &&
      item.sourceType !== 'other' &&
      item.sourceType !== 'icon' &&
      item.sourceType !== 'unknown'
    ) {
      throw new Error(`Font catalog family ${index} has invalid source type`);
    }
    if (
      item.packageVersion === 'latest' ||
      (item.packageVersion as string).split('.').length !== 3
    ) {
      throw new Error(`Font catalog family ${index} must have an exact package version`);
    }
  }
  return value as FontsourceCatalogSnapshot;
}
