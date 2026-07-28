/**
 * Icon asset model — types and helpers for icons inserted into documents.
 */
import type { NodeId } from '@strata/scene';

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
