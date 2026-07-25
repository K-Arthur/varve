/**
 * Document-level content-addressed image assets (v2.6+).
 *
 * Generalizes the `RasterMaskAsset` pattern (see masks.ts) from raster masks
 * to image fills: an asset's bytes are stored once in `Document.assets` and
 * referenced by id from any number of `ImageFillData.assetId` fields, on any
 * node's `fills[]` or a shared `Paint`. Per-usage placement (fit/x/y/scale)
 * stays on `ImageFillData` so each usage can be cropped/positioned
 * independently while sharing the same source bytes.
 *
 * See docs/audits/smart-object-feasibility-audit.md for the decision record.
 */
import type { DocumentAsset } from './types';

interface AssetDoc {
  assets?: Record<string, DocumentAsset>;
}

interface AssetNodeMap {
  nodes: Record<string, { fills?: Array<{ type: string; image?: { assetId?: string } }> }>;
  paints?: Record<string, { fill: { type: string; image?: { assetId?: string } } }>;
}

/**
 * Sync, non-cryptographic content hash (two-lane FNV-1a, 64 bits as hex).
 * Used for create-time dedup, not integrity/security — same tradeoff already
 * made by `compactSourceLocator` in masks.ts. Sync is a hard requirement:
 * document migrations (version.ts) run synchronously over raw JSON and must
 * be able to compute the same hash a live editing session would.
 */
export function hashContent(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

/** Decoded byte length of a base64 data URL, without allocating the buffer. */
export function decodedDataUrlByteLength(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (!payload) return 0;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/**
 * MIME type parsed from a `data:<mime>;base64,...` prefix. `ImageFillData`
 * has no separate mime field — the data URL itself is the source of truth.
 */
export function mimeTypeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)/.exec(dataUrl);
  return match?.[1] || 'application/octet-stream';
}

export interface EmbeddedAssetInput {
  dataUrl: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
}

/** Pure factory: same bytes always produce the same asset id. */
export function createEmbeddedAsset(input: EmbeddedAssetInput): DocumentAsset {
  const hash = hashContent(input.dataUrl);
  return {
    id: `asset-${hash}`,
    storage: 'embedded',
    mimeType: input.mimeType,
    dataUrl: input.dataUrl,
    naturalWidth: input.naturalWidth,
    naturalHeight: input.naturalHeight,
    byteLength: decodedDataUrlByteLength(input.dataUrl),
    hash,
  };
}

/** Structural validation for a persisted DocumentAsset. Mirrors masks.ts's validateRasterMaskAsset. */
export function validateDocumentAsset(asset: DocumentAsset): string | null {
  if (!asset || typeof asset !== 'object') return 'Document asset must be an object';
  if (typeof asset.id !== 'string' || asset.id.length === 0) {
    return 'Document asset id must be a non-empty string';
  }
  if (asset.storage !== 'embedded') {
    return `Document asset ${asset.id} has an unsupported storage kind`;
  }
  if (typeof asset.mimeType !== 'string' || asset.mimeType.length === 0) {
    return `Document asset ${asset.id} must have a mimeType`;
  }
  if (typeof asset.dataUrl !== 'string' || !asset.dataUrl.startsWith('data:')) {
    return `Document asset ${asset.id} must have a valid data URL`;
  }
  if (!Number.isFinite(asset.naturalWidth) || asset.naturalWidth < 0) {
    return `Document asset ${asset.id} naturalWidth must be a non-negative number`;
  }
  if (!Number.isFinite(asset.naturalHeight) || asset.naturalHeight < 0) {
    return `Document asset ${asset.id} naturalHeight must be a non-negative number`;
  }
  const actualByteLength = decodedDataUrlByteLength(asset.dataUrl);
  if (!Number.isInteger(asset.byteLength) || asset.byteLength !== actualByteLength) {
    return `Document asset ${asset.id} byteLength must match its decoded payload`;
  }
  if (typeof asset.hash !== 'string' || asset.hash.length === 0) {
    return `Document asset ${asset.id} must have a hash`;
  }
  return null;
}

export function getAsset(doc: AssetDoc, assetId: string): DocumentAsset | undefined {
  return doc.assets?.[assetId];
}

/** Insert or overwrite one asset entry. */
export function upsertAsset<T extends AssetDoc>(doc: T, asset: DocumentAsset): T {
  const existing = doc.assets?.[asset.id];
  if (
    existing &&
    existing.hash === asset.hash &&
    existing.dataUrl === asset.dataUrl &&
    existing.naturalWidth === asset.naturalWidth &&
    existing.naturalHeight === asset.naturalHeight
  ) {
    return doc;
  }
  return { ...doc, assets: { ...doc.assets, [asset.id]: asset } };
}

/**
 * Create-or-reuse: hashes `input.dataUrl` and returns the existing asset id
 * if identical content is already stored, otherwise creates a new entry.
 * This is the single choke point that makes "place the same image twice"
 * dedup automatically, with no separate user action required.
 */
export function findOrCreateEmbeddedAsset<T extends AssetDoc>(
  doc: T,
  input: EmbeddedAssetInput,
): { document: T; assetId: string } {
  const asset = createEmbeddedAsset(input);
  const existing = getAsset(doc, asset.id);
  if (existing) return { document: doc, assetId: asset.id };
  return { document: upsertAsset(doc, asset), assetId: asset.id };
}

/** True if any node's fills or any shared Paint references `assetId`. */
export function isAssetReferenced(doc: AssetNodeMap, assetId: string): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (node.fills?.some((fill) => fill.type === 'image' && fill.image?.assetId === assetId)) {
      return true;
    }
  }
  if (doc.paints) {
    for (const paint of Object.values(doc.paints)) {
      if (paint.fill.type === 'image' && paint.fill.image?.assetId === assetId) return true;
    }
  }
  return false;
}

/** Garbage-collect asset entries no longer referenced by any node or paint. */
export function pruneUnusedAssets<T extends AssetDoc & AssetNodeMap>(doc: T): T {
  if (!doc.assets) return doc;
  const kept = Object.fromEntries(
    Object.entries(doc.assets).filter(([assetId]) => isAssetReferenced(doc, assetId)),
  );
  if (Object.keys(kept).length === Object.keys(doc.assets).length) return doc;
  return { ...doc, assets: Object.keys(kept).length > 0 ? kept : undefined };
}
