/**
 * Icon asset model — types and helpers for icons inserted into documents.
 */
import type { NodeId } from '@varve/scene';

export type IconStorageMode = 'embedded' | 'linked';

export type IconVariantStyle =
  | 'outline'
  | 'filled'
  | 'sharp'
  | 'rounded'
  | 'duotone'
  | 'thin'
  | 'regular'
  | 'bold';

export interface DocumentIconAsset {
  id: string;
  providerId?: string;
  name: string;
  prefix: string;
  storageMode: IconStorageMode;
  svg: string;
  style: IconVariantStyle;
  availableStyles: IconVariantStyle[];
  licence?: string;
  attribution?: string;
  tags: string[];
  viewBox: string;
  defaultWidth: number;
  defaultHeight: number;
  overrides: IconOverrides;
  instanceNodeIds: NodeId[];
  createdAt: number;
  updatedAt: number;
  hash: string;
  // -------------------------------------------------------------------------
  // Provenance (optional, added 2026-08-04 — old documents load unchanged)
  // -------------------------------------------------------------------------
  /** SPDX identifier of the pack licence (e.g. "Apache-2.0"), when known. */
  spdxId?: string;
  /** URL of the full licence text. */
  licenceUrl?: string;
  /** Attribution text required by the licence, when applicable. */
  attributionText?: string;
  /** Pack author name. */
  author?: string;
  /** URL to the icon source (author/pack page). */
  sourceUrl?: string;
  /** Pack version at retrieval time. */
  sourceVersion?: string;
  /** Unix ms when the icon data was retrieved. */
  retrievedAt?: number;
  /** Sanitizer/normalizer version that produced the embedded SVG. */
  sanitizerVersion?: string;
  /** Globally stable provider id:pack:name identifier. */
  canonicalId?: string;
  /** monotone vs multicolor palette. */
  paletteType?: 'monotone' | 'multicolor';
}

export interface IconOverrides {
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  width?: number;
  height?: number;
  opacity?: number;
  rotation?: number;
  style?: IconVariantStyle;
}

export interface IconInsertOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  asComponent?: boolean;
  overrides?: IconOverrides;
}

/** Provenance fields accepted at creation (all optional). */
export interface IconProvenance {
  spdxId?: string;
  licenceUrl?: string;
  attributionText?: string;
  author?: string;
  sourceUrl?: string;
  sourceVersion?: string;
  retrievedAt?: number;
  sanitizerVersion?: string;
  canonicalId?: string;
  paletteType?: 'monotone' | 'multicolor';
}

function generateId(): string {
  return `icon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashSvg(svg: string): string {
  let hash = 0;
  for (let i = 0; i < svg.length; i++) {
    hash = ((hash << 5) - hash + svg.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export function createDocumentIconAsset(
  name: string,
  prefix: string,
  svg: string,
  options: {
    providerId?: string;
    style?: IconVariantStyle;
    availableStyles?: IconVariantStyle[];
    licence?: string;
    attribution?: string;
    tags?: string[];
    viewBox?: string;
    storageMode?: IconStorageMode;
    provenance?: IconProvenance;
  } = {},
): DocumentIconAsset {
  const now = Date.now();
  return {
    id: generateId(),
    providerId: options.providerId,
    name,
    prefix,
    storageMode: options.storageMode ?? 'embedded',
    svg,
    style: options.style ?? 'outline',
    availableStyles: options.availableStyles ?? ['outline'],
    licence: options.licence,
    attribution: options.attribution,
    tags: options.tags ?? [],
    viewBox: options.viewBox ?? '0 0 24 24',
    defaultWidth: 24,
    defaultHeight: 24,
    overrides: {},
    instanceNodeIds: [],
    createdAt: now,
    updatedAt: now,
    hash: hashSvg(svg),
    ...(options.provenance ?? {}),
  };
}

export function updateIconAssetSvg(asset: DocumentIconAsset, newSvg: string): DocumentIconAsset {
  return { ...asset, svg: newSvg, hash: hashSvg(newSvg), updatedAt: Date.now() };
}

export function mergeIconOverrides(base: IconOverrides, override: IconOverrides): IconOverrides {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined)),
  };
}

export function isSameIconAsset(a: DocumentIconAsset, b: DocumentIconAsset): boolean {
  if (a.providerId && b.providerId) return a.providerId === b.providerId && a.style === b.style;
  return a.hash === b.hash;
}

export function effectiveIconDimensions(
  asset: DocumentIconAsset,
  instanceOverrides?: IconOverrides,
): { width: number; height: number } {
  const merged = instanceOverrides
    ? mergeIconOverrides(asset.overrides, instanceOverrides)
    : asset.overrides;
  return {
    width: merged.width ?? asset.defaultWidth,
    height: merged.height ?? asset.defaultHeight,
  };
}

// ---------------------------------------------------------------------------
// Validation (used by DocumentCodec and tests)
// ---------------------------------------------------------------------------

/**
 * Structural validation for a persisted `DocumentIconAsset`. Returns an error
 * message, or null when the asset is well-formed. Deliberately permissive:
 * optional provenance fields (provider, licence, attribution) are free-form
 * metadata and do not gate validity.
 */
export function validateIconAsset(asset: unknown): string | null {
  if (asset === null || typeof asset !== 'object' || Array.isArray(asset)) {
    return 'Icon asset must be an object';
  }
  const raw = asset as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0)
    return 'Icon asset id must be a non-empty string';
  if (typeof raw.name !== 'string') return 'Icon asset name must be a string';
  if (typeof raw.prefix !== 'string') return 'Icon asset prefix must be a string';
  if (raw.storageMode !== 'embedded' && raw.storageMode !== 'linked') {
    return 'Icon asset storageMode must be "embedded" or "linked"';
  }
  if (typeof raw.svg !== 'string' || raw.svg.length === 0) {
    return 'Icon asset svg must be a non-empty string';
  }
  if (typeof raw.viewBox !== 'string') return 'Icon asset viewBox must be a string';
  if (typeof raw.hash !== 'string') return 'Icon asset hash must be a string';
  if (typeof raw.defaultWidth !== 'number' || typeof raw.defaultHeight !== 'number') {
    return 'Icon asset default dimensions must be numbers';
  }
  if (typeof raw.createdAt !== 'number' || typeof raw.updatedAt !== 'number') {
    return 'Icon asset timestamps must be numbers';
  }
  if (raw.tags !== undefined && !Array.isArray(raw.tags)) return 'Icon asset tags must be an array';
  if (
    raw.overrides !== undefined &&
    (raw.overrides === null || typeof raw.overrides !== 'object')
  ) {
    return 'Icon asset overrides must be an object';
  }
  if (raw.instanceNodeIds !== undefined && !Array.isArray(raw.instanceNodeIds)) {
    return 'Icon asset instanceNodeIds must be an array';
  }
  // Optional provenance fields: loose type checks only.
  for (const key of [
    'spdxId',
    'licenceUrl',
    'attributionText',
    'author',
    'sourceUrl',
    'sourceVersion',
    'canonicalId',
  ] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') {
      return `Icon asset ${key} must be a string`;
    }
  }
  for (const key of ['retrievedAt'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'number') {
      return `Icon asset ${key} must be a number`;
    }
  }
  if (
    raw.paletteType !== undefined &&
    raw.paletteType !== 'monotone' &&
    raw.paletteType !== 'multicolor'
  ) {
    return 'Icon asset paletteType must be "monotone" or "multicolor"';
  }
  return null;
}

/**
 * Deterministic stable id for a sanitized icon payload. Used to deduplicate
 * embedded icon assets within a document (same provider icon + style embeds
 * once). Not a cryptographic digest — collisions are mitigated by the id
 * prefix plus hash suffix.
 */
export function iconAssetIdFor(prefix: string, svgHash: string): string {
  const safePrefix = prefix
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase()
    .slice(0, 24);
  return `icon-${safePrefix || 'asset'}-${svgHash}`;
}

/** True when at least one node in the document references the icon asset. */
export function isIconAssetReferenced(
  doc: {
    nodes: Record<string, { iconAssetId?: string }>;
  },
  assetId: string,
): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (node.iconAssetId === assetId) return true;
  }
  return false;
}
