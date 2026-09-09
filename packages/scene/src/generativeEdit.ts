/**
 * Persisted, provider-independent generative editing provenance.
 *
 * Pixels live in the normal Document.assets table. This record keeps the
 * recipe and source relationship inspectable without making rendering depend
 * on an installed model or a provider retaining a response.
 */

export const GENERATIVE_EDIT_SCHEMA_VERSION = 1 as const;

export type GenerativeEditMode = 'fill' | 'remove' | 'replace' | 'expand';
export type GenerativeEditQuality = 'draft' | 'balanced' | 'quality';
export type GenerativeEditProviderKind = 'local' | 'remote';
export type GenerativeEditRuntime =
  | 'patchmatch'
  | 'wasm'
  | 'webgpu'
  | 'native-cpu'
  | 'native-accelerated'
  | 'remote';

export interface GenerativeEditProvider {
  kind: GenerativeEditProviderKind;
  id: string;
  modelId?: string;
  modelVersion?: string;
  modelChecksum?: string;
  runtime: GenerativeEditRuntime;
}

export interface GenerativeEditSettings {
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  quality: GenerativeEditQuality;
  contextPadding: number;
  maskExpansion: number;
  feather: number;
}

export interface GenerativeEditVariation {
  id: string;
  assetId: string;
  width: number;
  height: number;
  createdAt: number;
  provider?: GenerativeEditProvider;
}

export interface GenerativeEditRecord {
  schemaVersion: typeof GENERATIVE_EDIT_SCHEMA_VERSION;
  id: string;
  mode: GenerativeEditMode;
  sourceNodeId: string;
  sourceAssetId?: string;
  sourceLocator: string;
  sourceRevision: number;
  placementRevision: string;
  maskAssetId: string;
  maskWidth: number;
  maskHeight: number;
  maskCoordinateSpace: 'source-image-pixels';
  settings: GenerativeEditSettings;
  provider: GenerativeEditProvider;
  variations: GenerativeEditVariation[];
  activeVariationId?: string;
  acceptedVariationId?: string;
  createdAt: number;
  updatedAt: number;
}

const MODES = new Set<GenerativeEditMode>(['fill', 'remove', 'replace', 'expand']);
const QUALITIES = new Set<GenerativeEditQuality>(['draft', 'balanced', 'quality']);
const PROVIDER_KINDS = new Set<GenerativeEditProviderKind>(['local', 'remote']);
const RUNTIMES = new Set<GenerativeEditRuntime>([
  'patchmatch',
  'wasm',
  'webgpu',
  'native-cpu',
  'native-accelerated',
  'remote',
]);

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validProvider(value: unknown): value is GenerativeEditProvider {
  if (!value || typeof value !== 'object') return false;
  const provider = value as Partial<GenerativeEditProvider>;
  return (
    PROVIDER_KINDS.has(provider.kind as GenerativeEditProviderKind) &&
    typeof provider.id === 'string' &&
    provider.id.length > 0 &&
    RUNTIMES.has(provider.runtime as GenerativeEditRuntime)
  );
}

function validSettings(value: unknown): value is GenerativeEditSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<GenerativeEditSettings>;
  return (
    QUALITIES.has(settings.quality as GenerativeEditQuality) &&
    finiteNonNegative(settings.contextPadding) &&
    finiteNonNegative(settings.maskExpansion) &&
    finiteNonNegative(settings.feather) &&
    (settings.prompt === undefined || typeof settings.prompt === 'string') &&
    (settings.negativePrompt === undefined || typeof settings.negativePrompt === 'string') &&
    (settings.seed === undefined || (typeof settings.seed === 'number' && Number.isFinite(settings.seed)))
  );
}

function validVariation(value: unknown): value is GenerativeEditVariation {
  if (!value || typeof value !== 'object') return false;
  const variation = value as Partial<GenerativeEditVariation>;
  return (
    typeof variation.id === 'string' &&
    variation.id.length > 0 &&
    typeof variation.assetId === 'string' &&
    variation.assetId.length > 0 &&
    Number.isSafeInteger(variation.width) &&
    variation.width > 0 &&
    Number.isSafeInteger(variation.height) &&
    variation.height > 0 &&
    finiteNonNegative(variation.createdAt) &&
    (variation.provider === undefined || validProvider(variation.provider))
  );
}

/** Return a stable validation error for a persisted generative edit record. */
export function validateGenerativeEdit(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Generative edit must be an object';
  const edit = value as Partial<GenerativeEditRecord>;
  if (edit.schemaVersion !== GENERATIVE_EDIT_SCHEMA_VERSION) {
    return `Unsupported generative edit schema version: ${String(edit.schemaVersion)}`;
  }
  if (typeof edit.id !== 'string' || edit.id.length === 0) return 'Generative edit id is required';
  if (!MODES.has(edit.mode as GenerativeEditMode)) return 'Generative edit mode is invalid';
  if (typeof edit.sourceNodeId !== 'string' || edit.sourceNodeId.length === 0) {
    return 'Generative edit sourceNodeId is required';
  }
  if (typeof edit.sourceLocator !== 'string') return 'Generative edit sourceLocator is invalid';
  if (!Number.isSafeInteger(edit.sourceRevision) || edit.sourceRevision < 0) {
    return 'Generative edit sourceRevision is invalid';
  }
  if (typeof edit.placementRevision !== 'string' || edit.placementRevision.length === 0) {
    return 'Generative edit placementRevision is required';
  }
  if (typeof edit.maskAssetId !== 'string' || edit.maskAssetId.length === 0) {
    return 'Generative edit maskAssetId is required';
  }
  if (!Number.isSafeInteger(edit.maskWidth) || edit.maskWidth <= 0) return 'Generative edit maskWidth is invalid';
  if (!Number.isSafeInteger(edit.maskHeight) || edit.maskHeight <= 0) return 'Generative edit maskHeight is invalid';
  if (edit.maskCoordinateSpace !== 'source-image-pixels') {
    return 'Generative edit maskCoordinateSpace must be source-image-pixels';
  }
  if (!validSettings(edit.settings)) return 'Generative edit settings are invalid';
  if (!validProvider(edit.provider)) return 'Generative edit provider is invalid';
  if (!Array.isArray(edit.variations) || !edit.variations.every(validVariation)) {
    return 'Generative edit variations are invalid';
  }
  const variationIds = new Set(edit.variations.map((variation) => variation.id));
  if (edit.activeVariationId !== undefined && !variationIds.has(edit.activeVariationId)) {
    return 'Generative edit active variation is missing';
  }
  if (edit.acceptedVariationId !== undefined && !variationIds.has(edit.acceptedVariationId)) {
    return 'Generative edit accepted variation is missing';
  }
  if (!finiteNonNegative(edit.createdAt) || !finiteNonNegative(edit.updatedAt)) {
    return 'Generative edit timestamps are invalid';
  }
  return null;
}

/** Keep only well-formed persisted records; malformed records cannot block a document load. */
export function normalizeGenerativeEdits(value: unknown): Record<string, GenerativeEditRecord> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const valid = Object.fromEntries(
    Object.entries(value).filter(([id, edit]) => {
      return id.length > 0 && validateGenerativeEdit(edit) === null;
    }),
  ) as Record<string, GenerativeEditRecord>;
  return Object.keys(valid).length > 0 ? valid : undefined;
}
