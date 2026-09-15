/**
 * Persisted source/recipe ownership for photographic assets.
 *
 * A source asset is immutable. A derived rendition or HDR master records the
 * exact source ids, source revision, decoder identity, and recipe that made
 * it. A downstream pixel repair is therefore either current, deliberately
 * baked to that revision, or visibly stale; it is never silently reinterpreted
 * after a white-balance/profile/demosaic change.
 */

export type PhotoSourceOperation =
  | 'raw-development'
  | 'hdr-radiance'
  | 'hdr-exposure-fusion'
  | 'hdr-master-import';
export type PhotoSourceStatus = 'current' | 'stale' | 'baked';
export type PhotoAssetRole = 'raw-source' | 'developed-raster' | 'hdr-master' | 'sdr-rendition';

export interface PhotoSourceBinding {
  operation: PhotoSourceOperation;
  sourceAssetIds: string[];
  sourceRevision: string;
  derivedAssetId: string;
  /** Range-bearing master used to produce the current display rendition. */
  masterAssetId?: string;
  decoderId?: string;
  recipe: Record<string, unknown>;
  stage: 'source-mosaic' | 'scene-linear' | 'display-linear';
  status: PhotoSourceStatus;
}

export interface PhotoAssetProvenance {
  role: PhotoAssetRole;
  sourceAssetIds: string[];
  sourceRevision: string;
  operation?: PhotoSourceOperation;
  decoderId?: string;
  recipe?: Record<string, unknown>;
}

export interface PhotoSourceValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Provenance on a writable repair layer. Repairs are intentionally baked to
 * the developed source revision in this slice; a later RAW recipe change
 * must therefore be surfaced as stale and require an explicit rebase/reapply.
 */
export interface RetouchProvenance {
  role: 'baked-retouch';
  sourceNodeId: string;
  sourceRevision: string;
  /** The byte-based retouch target is sampled from the rendered SDR image. */
  sourceStage: 'rendered-image';
  policy: 'baked';
}

export function validateRetouchProvenance(value: unknown): PhotoSourceValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['retouch provenance must be an object'] };
  if (value.role !== 'baked-retouch') errors.push('retouch provenance role is unsupported');
  if (!nonEmptyString(value.sourceNodeId)) errors.push('retouch sourceNodeId must be non-empty');
  if (!nonEmptyString(value.sourceRevision)) {
    errors.push('retouch sourceRevision must be non-empty');
  }
  if (value.sourceStage !== 'rendered-image') {
    errors.push('retouch sourceStage is unsupported');
  }
  if (value.policy !== 'baked') errors.push('retouch policy must be baked');
  return { valid: errors.length === 0, errors };
}

export function validatePhotoSourceBinding(value: unknown): PhotoSourceValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['photo source binding must be an object'] };
  if (
    !['raw-development', 'hdr-radiance', 'hdr-exposure-fusion', 'hdr-master-import'].includes(
      value.operation as string,
    )
  ) {
    errors.push('photo source operation is unsupported');
  }
  if (!nonEmptyStringArray(value.sourceAssetIds))
    errors.push('sourceAssetIds must contain asset ids');
  if (!nonEmptyString(value.sourceRevision)) errors.push('sourceRevision must be non-empty');
  if (!nonEmptyString(value.derivedAssetId)) errors.push('derivedAssetId must be non-empty');
  if (value.masterAssetId !== undefined && !nonEmptyString(value.masterAssetId)) {
    errors.push('masterAssetId must be non-empty when present');
  }
  if (value.decoderId !== undefined && !nonEmptyString(value.decoderId))
    errors.push('decoderId must be non-empty when present');
  if (!isRecord(value.recipe)) errors.push('recipe must be a JSON object');
  if (!['source-mosaic', 'scene-linear', 'display-linear'].includes(value.stage as string))
    errors.push('photo source stage is unsupported');
  if (!['current', 'stale', 'baked'].includes(value.status as string))
    errors.push('photo source status is unsupported');
  return { valid: errors.length === 0, errors };
}

export function validatePhotoAssetProvenance(value: unknown): PhotoSourceValidation {
  const errors: string[] = [];
  if (!isRecord(value))
    return { valid: false, errors: ['photo asset provenance must be an object'] };
  if (
    !['raw-source', 'developed-raster', 'hdr-master', 'sdr-rendition'].includes(
      value.role as string,
    )
  ) {
    errors.push('photo asset role is unsupported');
  }
  const sourceAssetIdsValid =
    value.role === 'raw-source' || value.role === 'hdr-master'
      ? Array.isArray(value.sourceAssetIds) && value.sourceAssetIds.every(nonEmptyString)
      : nonEmptyStringArray(value.sourceAssetIds);
  if (!sourceAssetIdsValid) errors.push('sourceAssetIds must contain asset ids');
  if (!nonEmptyString(value.sourceRevision)) errors.push('sourceRevision must be non-empty');
  if (
    value.operation !== undefined &&
    !['raw-development', 'hdr-radiance', 'hdr-exposure-fusion', 'hdr-master-import'].includes(
      value.operation as string,
    )
  ) {
    errors.push('photo asset operation is unsupported');
  }
  if (value.decoderId !== undefined && !nonEmptyString(value.decoderId))
    errors.push('decoderId must be non-empty when present');
  if (value.recipe !== undefined && !isRecord(value.recipe))
    errors.push('recipe must be a JSON object when present');
  return { valid: errors.length === 0, errors };
}

/** Deterministic recipe/source identity suitable for cache keys and staleness checks. */
export function photoSourceRevision(
  sourceHashes: readonly string[],
  decoderId: string,
  recipe: unknown,
): string {
  return `${decoderId}:${sourceHashes.join(',')}:${stableJson(recipe)}`;
}

export function photoSourceStatusLabel(status: PhotoSourceStatus): string {
  switch (status) {
    case 'current':
      return 'Current source recipe';
    case 'stale':
      return 'Needs re-evaluation';
    case 'baked':
      return 'Baked to source revision';
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}
