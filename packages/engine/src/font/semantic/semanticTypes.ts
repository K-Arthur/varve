/**
 * Provider-independent semantic font contracts.
 *
 * Semantic data is derived data. Exact font identity still belongs to
 * `fontIdentity.ts`; this layer describes what Varve knows about a family,
 * face, instance, or artifact and why it believes it.
 */

import type { FontCategory, FontSourceKind, ParsedAxis, ParsedFontMetadata } from '../fontIdentity';

export const FONT_SEMANTIC_SCHEMA_VERSION = 1 as const;
export const FONT_ONTOLOGY_VERSION = '1.0.0' as const;
export const FONT_SEMANTIC_ANALYZER_VERSION = 'deterministic-1' as const;

export type FontSemanticScope = 'family' | 'face' | 'variable-instance' | 'artifact';

export type FontSemanticSource =
  | 'font-table'
  | 'provider'
  | 'measured'
  | 'derived-rule'
  | 'curated'
  | 'local-model'
  | 'user'
  | 'project';

export type EvidenceStrength = 'verified' | 'strong' | 'moderate' | 'weak' | 'unknown';

export type SemanticValueState =
  | 'known'
  | 'unknown'
  | 'not-applicable'
  | 'conflicting'
  | 'unavailable'
  | 'not-analyzed';

export type FontSemanticFacet =
  | 'classification'
  | 'morphology'
  | 'tone'
  | 'use'
  | 'era'
  | 'feature'
  | 'coverage'
  | 'source'
  | 'role'
  | 'organization';

export interface FontSemanticEvidence {
  kind: 'font-table' | 'provider' | 'measurement' | 'curation' | 'coverage' | 'user';
  label: string;
  value?: string | number | boolean;
  note?: string;
}

export interface FontSemanticAssignment {
  tagId: string;
  scope: FontSemanticScope;
  source: FontSemanticSource;
  confidence?: number;
  evidenceStrength: EvidenceStrength;
  evidence?: FontSemanticEvidence[];
  ontologyVersion: string;
  analyzerVersion?: string;
  modelVersion?: string;
  overridable: boolean;
}

export interface FontVisualFeatureVector {
  xHeightRatio?: number;
  capHeightRatio?: number;
  ascenderRatio?: number;
  descenderRatio?: number;
  widthRatio?: number;
  strokeContrast?: number;
  strokeModulation?: number;
  apertureOpenness?: number;
  roundness?: number;
  angularity?: number;
  averageAdvance?: number;
  italicAngle?: number;
  spacingDensity?: number;
  numeralWidthRatio?: number;
  supportedWeightMin?: number;
  supportedWeightMax?: number;
}

export interface FontSemanticConflict {
  tagId: string;
  assignments: FontSemanticAssignment[];
  resolution: 'conservative' | 'user-override' | 'unresolved';
}

export interface FontSemanticProfile {
  schemaVersion: typeof FONT_SEMANTIC_SCHEMA_VERSION;
  familyIdentity: string;
  faceIdentity?: string;
  scope: FontSemanticScope;
  assignments: FontSemanticAssignment[];
  visualFeatures: FontVisualFeatureVector;
  unknownFields: string[];
  conflicts: FontSemanticConflict[];
  ontologyVersion: string;
  profileRevision: string;
  analyzerVersion?: string;
  providerRevision?: string;
  state: SemanticValueState;
}

export interface FontSemanticRecord {
  familyId: string;
  familyName: string;
  aliases: string[];
  profile: FontSemanticProfile;
  faceProfiles: FontSemanticProfile[];
  source: FontSourceKind | 'downloadable';
  sourceKinds: Array<FontSourceKind | 'downloadable'>;
  providerId?: string;
  providerCategory?: string;
  providerOrigin?: 'google' | 'other' | 'icon' | 'unknown';
  upstreamVersion?: string;
  packageVersion?: string;
  weights: number[];
  styles: Array<'normal' | 'italic'>;
  variable: boolean;
  axes: ParsedAxis[];
  scripts: string[];
  languages: string[];
  openTypeFeatures: string[];
  legacyCategory?: FontCategory | string;
  vendor?: string;
  designer?: string;
  foundry?: string;
  license?: string;
  licenseUrl?: string;
  installed: boolean;
  downloadable: boolean;
  isFavorite: boolean;
  recentlyUsedAt?: number;
  userTags: string[];
  projectTags: string[];
}

export type SemanticConstraintKind =
  | 'tag'
  | 'coverage'
  | 'feature'
  | 'source'
  | 'availability'
  | 'numeric'
  | 'category';

export interface SemanticConstraint {
  kind: SemanticConstraintKind;
  id: string;
  label: string;
  value?: string | number;
  hard: true;
}

export interface SemanticPreference {
  kind: 'tag' | 'use-case' | 'text';
  id: string;
  label: string;
  value?: string;
}

export interface NumericConstraint {
  field: 'weight' | 'width' | 'x-height' | 'average-width';
  min?: number;
  max?: number;
  raw: string;
}

export interface FontReference {
  familyName: string;
  normalizedName: string;
}

export type FontAvailabilityConstraint = 'installed' | 'downloadable' | 'missing' | 'project';

export interface FontSemanticQuery {
  text: string;
  exactTerms: string[];
  required: SemanticConstraint[];
  preferred: SemanticPreference[];
  excluded: SemanticConstraint[];
  numericRanges: NumericConstraint[];
  similarityTarget?: FontReference;
  intendedRole?: string[];
  availability?: FontAvailabilityConstraint;
  strictness: 'strict' | 'balanced' | 'exploratory';
  chips: Array<{ label: string; kind: 'required' | 'preferred' | 'excluded' | 'ambiguous' }>;
  ambiguities: Array<{ term: string; suggestions: string[] }>;
}

export interface FontSearchReason {
  kind:
    | 'exact-match'
    | 'required-constraint'
    | 'semantic-tag'
    | 'visual-feature'
    | 'use-case'
    | 'coverage'
    | 'feature'
    | 'availability'
    | 'similarity'
    | 'user-preference'
    | 'unknown';
  label: string;
  contribution?: number;
  provenance?: string;
}

export interface FontSearchResult {
  record: FontSemanticRecord;
  score: number;
  reasons: FontSearchReason[];
  unknownRequired: string[];
  excludedMatches: string[];
  status: 'match' | 'unknown';
}

export interface FontSemanticSearchOptions {
  limit?: number;
  strictness?: FontSemanticQuery['strictness'];
  installedOnly?: boolean;
  source?: Array<FontSemanticRecord['source']>;
  diversity?: boolean;
}

export interface FontSemanticUserState {
  tags: string[];
  projectTags: string[];
  hiddenTagIds: string[];
  overrides: Record<string, 'show' | 'hide'>;
  isFavorite: boolean;
  recentlyUsedAt?: number;
}

export interface FontSemanticInput {
  familyId: string;
  familyName: string;
  aliases?: string[];
  source: FontSemanticRecord['source'];
  sourceKinds?: FontSemanticRecord['sourceKinds'];
  providerId?: string;
  providerCategory?: string;
  providerOrigin?: FontSemanticRecord['providerOrigin'];
  upstreamVersion?: string;
  packageVersion?: string;
  weights?: number[];
  styles?: Array<'normal' | 'italic'>;
  variable?: boolean;
  axes?: ParsedAxis[];
  scripts?: string[];
  languages?: string[];
  openTypeFeatures?: string[];
  legacyCategory?: FontCategory | string;
  vendor?: string;
  designer?: string;
  foundry?: string;
  license?: string;
  licenseUrl?: string;
  installed?: boolean;
  downloadable?: boolean;
  profile: FontSemanticProfile;
  faceProfiles?: FontSemanticProfile[];
  userState?: Partial<FontSemanticUserState>;
}

export type FontSemanticProfileMigration = (
  profile: unknown,
  options?: { familyIdentity?: string },
) => FontSemanticProfile;

export type ParsedFontSemanticSource = Pick<ParsedFontMetadata, 'identity'> &
  Partial<ParsedFontMetadata>;
