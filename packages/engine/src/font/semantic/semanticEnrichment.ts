import type { FontsourceCatalogRecord } from '../catalogSchema';
import type { FontCategory, ParsedFontMetadata } from '../fontIdentity';
import annotations from './font-semantic-annotations.json';
import { tagDefinition } from './semanticOntology';
import {
  FONT_ONTOLOGY_VERSION,
  FONT_SEMANTIC_ANALYZER_VERSION,
  FONT_SEMANTIC_SCHEMA_VERSION,
  type FontSemanticAssignment,
  type FontSemanticEvidence,
  type FontSemanticInput,
  type FontSemanticProfile,
  type FontSemanticRecord,
  type FontVisualFeatureVector,
} from './semanticTypes';

interface CuratedAnnotation {
  familyId: string;
  assignments: Array<{ tagId: string; confidence: number; note: string }>;
  visualFeatures?: FontVisualFeatureVector;
}

const CURATED = new Map(
  (annotations as CuratedAnnotation[]).map((annotation) => [annotation.familyId, annotation]),
);

function assignment(
  tagId: string,
  scope: FontSemanticAssignment['scope'],
  source: FontSemanticAssignment['source'],
  evidenceStrength: FontSemanticAssignment['evidenceStrength'],
  evidence: FontSemanticEvidence[],
  confidence?: number,
): FontSemanticAssignment {
  return {
    tagId,
    scope,
    source,
    evidenceStrength,
    evidence,
    ...(confidence === undefined ? {} : { confidence }),
    ontologyVersion: FONT_ONTOLOGY_VERSION,
    analyzerVersion:
      source === 'derived-rule' || source === 'measured'
        ? FONT_SEMANTIC_ANALYZER_VERSION
        : undefined,
    overridable: source !== 'font-table' && source !== 'provider',
  };
}

function uniqueAssignments(assignments: FontSemanticAssignment[]): FontSemanticAssignment[] {
  const seen = new Set<string>();
  return assignments.filter((item) => {
    const key = `${item.tagId}:${item.scope}:${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function profileRevision(
  familyIdentity: string,
  assignments: readonly FontSemanticAssignment[],
): string {
  const signature = assignments
    .map((item) => `${item.tagId}:${item.scope}:${item.source}`)
    .sort()
    .join('|');
  return `font-profile:${FONT_SEMANTIC_SCHEMA_VERSION}:${familyIdentity}:${signature}`;
}

export function createFontSemanticProfile(
  familyIdentity: string,
  assignments: FontSemanticAssignment[],
  visualFeatures: FontVisualFeatureVector = {},
  options: Pick<FontSemanticProfile, 'scope' | 'faceIdentity'> &
    Partial<Pick<FontSemanticProfile, 'providerRevision' | 'state'>> = { scope: 'family' },
): FontSemanticProfile {
  const unique = uniqueAssignments(assignments);
  return {
    schemaVersion: FONT_SEMANTIC_SCHEMA_VERSION,
    familyIdentity,
    ...(options.faceIdentity ? { faceIdentity: options.faceIdentity } : {}),
    scope: options.scope,
    assignments: unique,
    visualFeatures,
    unknownFields: [],
    conflicts: [],
    ontologyVersion: FONT_ONTOLOGY_VERSION,
    profileRevision: profileRevision(familyIdentity, unique),
    analyzerVersion: FONT_SEMANTIC_ANALYZER_VERSION,
    ...(options.providerRevision ? { providerRevision: options.providerRevision } : {}),
    state: options.state ?? 'known',
  };
}

function categoryTag(category: string): string | undefined {
  switch (category.toLocaleLowerCase()) {
    case 'sans-serif':
      return 'classification.sans';
    case 'serif':
      return 'classification.serif';
    case 'monospace':
      return 'classification.monospace';
    case 'display':
      return 'classification.display';
    case 'handwriting':
      return 'classification.handwriting';
    case 'icons':
      return 'classification.symbol';
    default:
      return undefined;
  }
}

const subsetToScript: Record<string, string> = {
  latin: 'latn',
  'latin-ext': 'latn',
  cyrillic: 'cyrl',
  'cyrillic-ext': 'cyrl',
  greek: 'grek',
  'greek-ext': 'grek',
  arabic: 'arab',
  hebrew: 'hebr',
  devanagari: 'deva',
  japanese: 'kana',
  korean: 'hang',
  'chinese-simplified': 'hani',
  'chinese-traditional': 'hani',
  thai: 'thai',
};

const scriptToTag: Record<string, string> = {
  latn: 'coverage.script.latn',
  cyrl: 'coverage.script.cyrl',
  grek: 'coverage.script.grek',
  arab: 'coverage.script.arab',
  hebr: 'coverage.script.hebr',
  deva: 'coverage.script.deva',
  hani: 'coverage.script.hani',
  hang: 'coverage.script.hang',
  kana: 'coverage.script.kana',
  thai: 'coverage.script.thai',
};

function sourceEvidence(label: string, value?: string): FontSemanticEvidence[] {
  return [{ kind: 'provider', label, ...(value ? { value } : {}) }];
}

function curatedAssignments(familyId: string): FontSemanticAssignment[] {
  const annotation = CURATED.get(familyId);
  if (!annotation) return [];
  return annotation.assignments.flatMap((item) => {
    if (!tagDefinition(item.tagId)) return [];
    return [
      assignment(
        item.tagId,
        'family',
        'curated',
        item.confidence >= 0.8 ? 'strong' : 'moderate',
        [{ kind: 'curation', label: 'Varve specimen review', note: item.note }],
        item.confidence,
      ),
    ];
  });
}

function curatedFeatures(familyId: string): FontVisualFeatureVector {
  return CURATED.get(familyId)?.visualFeatures ?? {};
}

function catalogAssignments(record: FontsourceCatalogRecord): FontSemanticAssignment[] {
  const assignments: FontSemanticAssignment[] = [];
  const category = categoryTag(record.category);
  if (category) {
    assignments.push(
      assignment(
        category,
        'family',
        'provider',
        'moderate',
        sourceEvidence('Fontsource category', record.category),
        0.7,
      ),
    );
  }
  assignments.push(
    assignment(
      'source.fontsource',
      'family',
      'provider',
      'verified',
      sourceEvidence('Fontsource catalog', record.familyId),
      1,
    ),
    assignment(
      'source.downloadable',
      'artifact',
      'provider',
      'verified',
      sourceEvidence('Exact catalog artifact', record.packageVersion),
      1,
    ),
  );
  if (record.license.commercial && record.license.redistribution) {
    assignments.push(
      assignment(
        'source.open-source',
        'family',
        'provider',
        'verified',
        sourceEvidence('License', record.license.id),
        0.98,
      ),
    );
  }
  if (record.variable) {
    assignments.push(
      assignment(
        'feature.variable',
        'family',
        'font-table',
        'strong',
        sourceEvidence('Fontsource variable flag', 'true'),
        0.86,
      ),
    );
  }
  if (record.axes.some((axis) => axis.tag === 'wdth')) {
    assignments.push(
      assignment(
        'feature.axis-width',
        'family',
        'font-table',
        'strong',
        sourceEvidence('Fontsource axis', 'wdth'),
        0.9,
      ),
    );
  }
  if (record.axes.some((axis) => axis.tag === 'opsz')) {
    assignments.push(
      assignment(
        'feature.axis-optical-size',
        'family',
        'font-table',
        'strong',
        sourceEvidence('Fontsource axis', 'opsz'),
        0.9,
      ),
    );
  }
  if (record.styles.includes('italic')) {
    assignments.push(
      assignment(
        'feature.italic',
        'face',
        'provider',
        'moderate',
        sourceEvidence('Available style', 'italic'),
        0.72,
      ),
    );
  }
  const scripts = new Set(
    record.subsets
      .map((subset) => subsetToScript[subset])
      .filter((value): value is string => Boolean(value)),
  );
  for (const script of scripts) {
    const tagId = scriptToTag[script];
    if (tagId)
      assignments.push(
        assignment(
          tagId,
          'family',
          'provider',
          'verified',
          sourceEvidence('Fontsource subset', script),
          0.95,
        ),
      );
  }
  if (record.subsets.includes('vietnamese')) {
    assignments.push(
      assignment(
        'coverage.language.vietnamese',
        'family',
        'provider',
        'verified',
        sourceEvidence('Fontsource subset', 'vietnamese'),
        0.95,
      ),
    );
  }
  if (record.subsets.length >= 3) {
    assignments.push(
      assignment(
        'use.multilingual',
        'family',
        'derived-rule',
        'moderate',
        sourceEvidence('Multiple catalog subsets', String(record.subsets.length)),
        0.62,
      ),
    );
  }
  return assignments;
}

function catalogFeatures(record: FontsourceCatalogRecord): FontVisualFeatureVector {
  const curated = curatedFeatures(record.familyId);
  const widthAxis = record.axes.find((axis) => axis.tag === 'wdth');
  return {
    ...curated,
    ...(widthAxis && widthAxis.default < 95 ? { widthRatio: widthAxis.default / 100 } : {}),
    supportedWeightMin: record.weights[0],
    supportedWeightMax: record.weights.at(-1),
  };
}

/** Build a family profile from provider facts plus reviewed, optional annotations. */
export function semanticRecordFromFontsource(
  record: FontsourceCatalogRecord,
  installed = false,
): FontSemanticRecord {
  const assignments = [...catalogAssignments(record), ...curatedAssignments(record.familyId)];
  const scripts = [
    ...new Set(
      record.subsets
        .map((subset) => subsetToScript[subset])
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const profile = createFontSemanticProfile(record.familyId, assignments, catalogFeatures(record), {
    scope: 'family',
    providerRevision: `${record.packageVersion}:${record.lastModified}`,
  });
  return {
    familyId: record.familyId,
    familyName: record.familyName,
    aliases: [...record.aliases],
    profile,
    faceProfiles: [],
    source: installed ? 'user' : 'downloadable',
    sourceKinds: [installed ? 'user' : 'downloadable'],
    providerId: record.providerId,
    providerCategory: record.category,
    providerOrigin: record.sourceType ?? 'unknown',
    upstreamVersion: record.upstreamVersion,
    packageVersion: record.packageVersion,
    weights: [...record.weights],
    styles: [...record.styles],
    variable: record.variable,
    axes: record.axes.map((axis) => ({ ...axis, name: axis.tag })),
    scripts,
    languages: record.subsets.includes('vietnamese') ? ['vietnamese'] : [],
    openTypeFeatures: [],
    legacyCategory: record.category,
    license: record.license.name,
    licenseUrl: record.license.url,
    installed,
    downloadable: true,
    isFavorite: false,
    userTags: [],
    projectTags: [],
  };
}

function parsedCategory(category: FontCategory): string | undefined {
  return categoryTag(category);
}

function parsedAssignments(meta: ParsedFontMetadata): FontSemanticAssignment[] {
  const assignments: FontSemanticAssignment[] = [];
  const category = parsedCategory(meta.category);
  if (category) {
    assignments.push(
      assignment(
        category,
        'face',
        'derived-rule',
        'moderate',
        [{ kind: 'measurement', label: 'Parser category', value: meta.category }],
        0.58,
      ),
    );
  }
  for (const script of meta.scripts) {
    const tagId = scriptToTag[script] ?? (script ? `coverage.script.${script}` : undefined);
    if (tagId && tagDefinition(tagId)) {
      assignments.push(
        assignment(
          tagId,
          'face',
          'font-table',
          'verified',
          [{ kind: 'font-table', label: 'OpenType script', value: script }],
          0.98,
        ),
      );
    }
  }
  for (const feature of meta.openTypeFeatures) {
    const featureTag =
      feature === 'tnum'
        ? 'feature.tnum'
        : feature === 'onum'
          ? 'feature.onum'
          : feature === 'liga'
            ? 'feature.liga'
            : feature === 'smcp'
              ? 'feature.small-caps'
              : undefined;
    if (featureTag)
      assignments.push(
        assignment(
          featureTag,
          'face',
          'font-table',
          'verified',
          [{ kind: 'font-table', label: 'OpenType feature', value: feature }],
          0.99,
        ),
      );
  }
  if (meta.isVariable)
    assignments.push(
      assignment(
        'feature.variable',
        'family',
        'font-table',
        'verified',
        [{ kind: 'font-table', label: 'fvar table', value: true }],
        1,
      ),
    );
  if (meta.axes.some((axis) => axis.tag === 'wdth'))
    assignments.push(
      assignment(
        'feature.axis-width',
        'family',
        'font-table',
        'verified',
        [{ kind: 'font-table', label: 'fvar axis', value: 'wdth' }],
        1,
      ),
    );
  if (meta.axes.some((axis) => axis.tag === 'opsz'))
    assignments.push(
      assignment(
        'feature.axis-optical-size',
        'family',
        'font-table',
        'verified',
        [{ kind: 'font-table', label: 'fvar axis', value: 'opsz' }],
        1,
      ),
    );
  if (meta.hasColorGlyphs)
    assignments.push(
      assignment(
        'feature.color-glyphs',
        'artifact',
        'font-table',
        'verified',
        [{ kind: 'font-table', label: 'Color glyph table', value: true }],
        1,
      ),
    );
  if (meta.identity.subfamilyName.toLocaleLowerCase().includes('italic'))
    assignments.push(
      assignment(
        'feature.italic',
        'face',
        'font-table',
        'strong',
        [{ kind: 'font-table', label: 'Subfamily name', value: meta.identity.subfamilyName }],
        0.85,
      ),
    );
  return assignments;
}

export function profileFromParsedFontMetadata(meta: ParsedFontMetadata): FontSemanticProfile {
  const units = meta.unitsPerEm || 1;
  const visualFeatures: FontVisualFeatureVector = {
    ...(meta.xHeight === undefined ? {} : { xHeightRatio: meta.xHeight / units }),
    ...(meta.capHeight === undefined ? {} : { capHeightRatio: meta.capHeight / units }),
    ascenderRatio: meta.ascender / units,
    descenderRatio: Math.abs(meta.descender) / units,
    supportedWeightMin: meta.isVariable
      ? meta.axes.find((axis) => axis.tag === 'wght')?.min
      : undefined,
    supportedWeightMax: meta.isVariable
      ? meta.axes.find((axis) => axis.tag === 'wght')?.max
      : undefined,
  };
  const profile = createFontSemanticProfile(
    meta.identity.familyName,
    parsedAssignments(meta),
    visualFeatures,
    {
      scope: 'face',
      faceIdentity: meta.identity.postScriptName,
      state: 'known',
    },
  );
  profile.unknownFields.push('designer', 'foundry', 'strokeContrast', 'apertureOpenness');
  return profile;
}

export function semanticInputFromParsedFont(meta: ParsedFontMetadata): FontSemanticInput {
  const faceProfile = profileFromParsedFontMetadata(meta);
  const familyId = `local:${meta.identity.familyName.toLocaleLowerCase()}`;
  return {
    familyId,
    familyName: meta.identity.familyName,
    source: meta.source,
    sourceKinds: [meta.source],
    weights: [weightFromSubfamily(meta.identity.subfamilyName)],
    styles: [
      meta.identity.subfamilyName.toLocaleLowerCase().includes('italic') ? 'italic' : 'normal',
    ],
    variable: meta.isVariable,
    axes: meta.axes,
    scripts: meta.scripts,
    languages: meta.languages ?? [],
    openTypeFeatures: meta.openTypeFeatures,
    legacyCategory: meta.category,
    vendor: meta.vendor,
    license: meta.license,
    licenseUrl: meta.licenseUrl,
    installed: meta.source !== 'missing',
    downloadable: false,
    profile: createFontSemanticProfile(
      familyId,
      faceProfile.assignments.map((item) => ({ ...item, scope: 'family' })),
      faceProfile.visualFeatures,
      { scope: 'family' },
    ),
    faceProfiles: [faceProfile],
  };
}

function weightFromSubfamily(subfamily: string): number {
  const value = subfamily.toLocaleLowerCase();
  if (value.includes('thin')) return 100;
  if (value.includes('extra light') || value.includes('extralight')) return 200;
  if (value.includes('light')) return 300;
  if (value.includes('medium')) return 500;
  if (value.includes('semi') || value.includes('demi')) return 600;
  if (value.includes('bold')) return 700;
  if (value.includes('extra') || value.includes('ultra')) return 800;
  if (value.includes('black') || value.includes('heavy')) return 900;
  return 400;
}

export function mergeFontSemanticInput(
  base: FontSemanticRecord,
  input: FontSemanticInput,
): FontSemanticRecord {
  const faces = [...base.faceProfiles, ...(input.faceProfiles ?? [])];
  const uniqueFaces = new Map(
    faces.map((profile) => [profile.faceIdentity ?? profile.profileRevision, profile]),
  );
  const assignments = [...base.profile.assignments, ...input.profile.assignments].map((item) => ({
    ...item,
  }));
  return {
    ...base,
    ...input,
    sourceKinds: [...new Set([...base.sourceKinds, ...(input.sourceKinds ?? [input.source])])],
    weights: [...new Set([...base.weights, ...(input.weights ?? [])])].sort((a, b) => a - b),
    styles: [...new Set([...base.styles, ...(input.styles ?? [])])],
    axes: input.axes?.length ? input.axes : base.axes,
    scripts: [...new Set([...base.scripts, ...(input.scripts ?? [])])],
    languages: [...new Set([...base.languages, ...(input.languages ?? [])])],
    openTypeFeatures: [...new Set([...base.openTypeFeatures, ...(input.openTypeFeatures ?? [])])],
    installed: base.installed || input.installed === true,
    downloadable: base.downloadable || input.downloadable === true,
    profile: createFontSemanticProfile(
      base.profile.familyIdentity,
      assignments,
      {
        ...base.profile.visualFeatures,
        ...input.profile.visualFeatures,
      },
      { scope: 'family' },
    ),
    faceProfiles: [...uniqueFaces.values()],
  };
}
