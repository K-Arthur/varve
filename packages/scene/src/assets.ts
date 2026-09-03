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

import { sha256Utf8 } from './sha256';
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
  /** Displayed (orientation-normalized) pixel dimensions. */
  naturalWidth: number;
  naturalHeight: number;
  /** Normalized ingestion metadata (EXIF/ICC). Optional. */
  metadata?: import('./types').ImageSourceMetadata;
  /** Animated-media container facts (v2.20+). Optional. */
  animated?: import('./types').AnimatedAssetMetadata;
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
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.animated ? { animated: input.animated } : {}),
  };
}

const ORIENTATION_VALUES = new Set([1, 2, 3, 4, 5, 6, 7, 8]);

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
  if (asset.metadata !== undefined) {
    const metadataError = validateImageSourceMetadata(asset.id, asset.metadata);
    if (metadataError) return metadataError;
  }
  if (asset.animated !== undefined) {
    const animatedError = validateAnimatedAssetMetadata(asset.id, asset.animated);
    if (animatedError) return animatedError;
  }
  return null;
}

/**
 * Structural validation for the animated-media metadata block. Enforces
 * bounds (frame cap, canvas limits) and per-frame shape so malformed or
 * hostile documents fail at load instead of at decode time.
 */
export function validateAnimatedAssetMetadata(
  assetId: string,
  animated: import('./types').AnimatedAssetMetadata,
): string | null {
  if (!animated || typeof animated !== 'object') {
    return `Document asset ${assetId} animated must be an object`;
  }
  const kinds = new Set(['gif', 'apng', 'webp']);
  if (!kinds.has(animated.kind)) {
    return `Document asset ${assetId} animated.kind must be gif/apng/webp`;
  }
  if (!Number.isInteger(animated.frameCount) || animated.frameCount <= 1) {
    return `Document asset ${assetId} animated.frameCount must be > 1`;
  }
  if (!Number.isFinite(animated.durationMs) || animated.durationMs < 0) {
    return `Document asset ${assetId} animated.durationMs must be non-negative`;
  }
  if (
    animated.loopCount !== 'infinite' &&
    (!Number.isInteger(animated.loopCount) || animated.loopCount < 0)
  ) {
    return `Document asset ${assetId} animated.loopCount must be 'infinite' or a count`;
  }
  if (
    !Number.isInteger(animated.width) ||
    !Number.isInteger(animated.height) ||
    animated.width <= 0 ||
    animated.height <= 0
  ) {
    return `Document asset ${assetId} animated canvas size must be positive`;
  }
  if (!Array.isArray(animated.frames) || animated.frames.length !== animated.frameCount) {
    return `Document asset ${assetId} animated.frames must match frameCount`;
  }
  for (const frame of animated.frames) {
    if (!Number.isInteger(frame.index) || frame.index < 0 || frame.index >= animated.frameCount) {
      return `Document asset ${assetId} animated frame index out of range`;
    }
    if (!Number.isFinite(frame.durationMs) || frame.durationMs < 0) {
      return `Document asset ${assetId} animated frame duration must be non-negative`;
    }
    if (
      !Number.isInteger(frame.x) ||
      !Number.isInteger(frame.y) ||
      !Number.isInteger(frame.width) ||
      !Number.isInteger(frame.height) ||
      frame.width <= 0 ||
      frame.height <= 0 ||
      frame.x + frame.width > animated.width ||
      frame.y + frame.height > animated.height
    ) {
      return `Document asset ${assetId} animated frame rect out of canvas bounds`;
    }
    if (frame.blend !== 'source' && frame.blend !== 'over') {
      return `Document asset ${assetId} animated frame blend must be source/over`;
    }
    if (
      frame.disposal !== 'none' &&
      frame.disposal !== 'background' &&
      frame.disposal !== 'previous'
    ) {
      return `Document asset ${assetId} animated frame disposal invalid`;
    }
  }
  return null;
}

/** Structural validation for the normalized ingestion metadata block. */
export function validateImageSourceMetadata(
  assetId: string,
  metadata: import('./types').ImageSourceMetadata,
): string | null {
  if (!metadata || typeof metadata !== 'object') {
    return `Document asset ${assetId} metadata must be an object`;
  }
  if (metadata.orientation !== undefined && !ORIENTATION_VALUES.has(metadata.orientation)) {
    return `Document asset ${assetId} metadata.orientation must be an EXIF value 1-8`;
  }
  if (metadata.pixelWidth !== undefined && !Number.isInteger(metadata.pixelWidth)) {
    return `Document asset ${assetId} metadata.pixelWidth must be an integer`;
  }
  if (metadata.pixelHeight !== undefined && !Number.isInteger(metadata.pixelHeight)) {
    return `Document asset ${assetId} metadata.pixelHeight must be an integer`;
  }
  if (metadata.iccProfileId !== undefined && typeof metadata.iccProfileId !== 'string') {
    return `Document asset ${assetId} metadata.iccProfileId must be a string`;
  }
  if (
    metadata.iccStatus !== undefined &&
    !['valid', 'invalid', 'none'].includes(metadata.iccStatus)
  ) {
    return `Document asset ${assetId} metadata.iccStatus must be valid/invalid/none`;
  }
  if (metadata.colorEncoding !== undefined) {
    const encodingError = validateRasterColorEncoding(assetId, metadata.colorEncoding);
    if (encodingError) return encodingError;
  }
  return null;
}

/** Structural validation for the canonical raster colour encoding block. */
export function validateRasterColorEncoding(
  assetId: string,
  encoding: import('@varve/shared').RasterColorEncoding,
): string | null {
  if (!encoding || typeof encoding !== 'object') {
    return `Document asset ${assetId} colorEncoding must be an object`;
  }
  if (!['rgb', 'gray', 'cmyk', 'unknown'].includes(encoding.model)) {
    return `Document asset ${assetId} colorEncoding.model must be rgb/gray/cmyk/unknown`;
  }
  if (
    encoding.primaries !== undefined &&
    !['srgb', 'display-p3', 'adobe-rgb', 'pro-photo', 'rec2020', 'unknown'].includes(
      encoding.primaries,
    )
  ) {
    return `Document asset ${assetId} colorEncoding.primaries is not a supported primaries family`;
  }
  if (
    encoding.transfer !== undefined &&
    ![
      'srgb',
      'gamma22',
      'gamma18',
      'prophoto',
      'rec2020',
      'linear',
      'pq',
      'hlg',
      'unknown',
    ].includes(encoding.transfer)
  ) {
    return `Document asset ${assetId} colorEncoding.transfer is not a supported transfer`;
  }
  if (
    encoding.matrixCoefficients !== undefined &&
    !['rgb', 'bt709', 'bt601', 'bt2020-ncl', 'bt2020-cl', 'identity', 'unknown'].includes(
      encoding.matrixCoefficients,
    )
  ) {
    return `Document asset ${assetId} colorEncoding.matrixCoefficients is invalid`;
  }
  if (
    encoding.videoRange !== undefined &&
    !['full', 'limited', 'unknown'].includes(encoding.videoRange)
  ) {
    return `Document asset ${assetId} colorEncoding.videoRange must be full/limited/unknown`;
  }
  if (encoding.bitDepth !== undefined) {
    const valid =
      encoding.bitDepth === 8 ||
      encoding.bitDepth === 10 ||
      encoding.bitDepth === 12 ||
      encoding.bitDepth === 16 ||
      encoding.bitDepth === 'float16' ||
      encoding.bitDepth === 'float32';
    if (!valid) {
      return `Document asset ${assetId} colorEncoding.bitDepth must be 8/10/12/16/float16/float32`;
    }
  }
  if (
    encoding.alphaMode !== undefined &&
    !['straight', 'premultiplied', 'unknown'].includes(encoding.alphaMode)
  ) {
    return `Document asset ${assetId} colorEncoding.alphaMode must be straight/premultiplied/unknown`;
  }
  if (
    ![
      'embedded-icc',
      'cicp',
      'named',
      'format-default',
      'user-assigned',
      'assumed',
      'legacy-assumed-srgb',
      'unknown',
    ].includes(encoding.provenance)
  ) {
    return `Document asset ${assetId} colorEncoding.provenance is invalid`;
  }
  if (encoding.profileId !== undefined && typeof encoding.profileId !== 'string') {
    return `Document asset ${assetId} colorEncoding.profileId must be a string`;
  }
  if (
    encoding.profileFingerprint !== undefined &&
    (typeof encoding.profileFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(encoding.profileFingerprint))
  ) {
    return `Document asset ${assetId} colorEncoding.profileFingerprint must be a SHA-256 hex digest`;
  }
  if (
    encoding.diagnostics !== undefined &&
    (!Array.isArray(encoding.diagnostics) ||
      encoding.diagnostics.some((d) => typeof d !== 'string'))
  ) {
    return `Document asset ${assetId} colorEncoding.diagnostics must be an array of strings`;
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

// ── ICC profile registry ─────────────────────────────────────────────────────

interface IccProfileDoc {
  iccProfiles?: Record<string, import('./types').IccProfileEntry>;
  assets?: Record<string, { metadata?: import('./types').ImageSourceMetadata }>;
}

/** Byte-safe content hash for profile payloads (base64 string lane). */
export function hashProfilePayload(profileBase64: string): string {
  return hashContent(profileBase64);
}

/** Create-or-reuse a registry entry for a base64-encoded ICC profile. */
export function upsertIccProfile<T extends IccProfileDoc>(
  doc: T,
  profileBase64: string,
  description?: string,
): { document: T; profileId: string } {
  const hash = hashProfilePayload(profileBase64);
  const fingerprint = sha256Utf8(profileBase64);
  let id = `icc-${hash}`;
  const existing = doc.iccProfiles?.[id];
  if (existing?.profileBase64 === profileBase64) {
    if (existing.fingerprint === fingerprint) return { document: doc, profileId: id };
    return {
      document: {
        ...doc,
        iccProfiles: { ...doc.iccProfiles, [id]: { ...existing, fingerprint } },
      },
      profileId: id,
    };
  }
  // The legacy FNV id is kept for compact backward-compatible documents.
  // A collision must not silently reuse unrelated profile bytes, so new
  // colliding payloads get a deterministic SHA-256 suffix.
  if (existing) id = `icc-${hash}-${fingerprint.slice(0, 16)}`;
  const byteLength = Math.max(0, Math.floor((profileBase64.length * 3) / 4));
  const entry: import('./types').IccProfileEntry = {
    id,
    profileBase64,
    byteLength,
    hash,
    fingerprint,
    ...(description ? { description } : {}),
  };
  return {
    document: { ...doc, iccProfiles: { ...doc.iccProfiles, [id]: entry } },
    profileId: id,
  };
}

/** True when any asset metadata references `profileId`. */
export function isIccProfileReferenced(doc: IccProfileDoc, profileId: string): boolean {
  for (const asset of Object.values(doc.assets ?? {})) {
    if (asset?.metadata?.iccProfileId === profileId) return true;
  }
  return false;
}

/** Garbage-collect profile entries no longer referenced by any asset. */
export function pruneUnusedIccProfiles<T extends IccProfileDoc>(doc: T): T {
  if (!doc.iccProfiles) return doc;
  const kept = Object.fromEntries(
    Object.entries(doc.iccProfiles).filter(([profileId]) => isIccProfileReferenced(doc, profileId)),
  );
  if (Object.keys(kept).length === Object.keys(doc.iccProfiles).length) return doc;
  return { ...doc, iccProfiles: Object.keys(kept).length > 0 ? kept : undefined };
}

/** Structural validation for a persisted IccProfileEntry. */
export function validateIccProfileEntry(entry: import('./types').IccProfileEntry): string | null {
  if (!entry || typeof entry !== 'object') return 'ICC profile entry must be an object';
  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    return 'ICC profile id must be a non-empty string';
  }
  if (typeof entry.profileBase64 !== 'string' || entry.profileBase64.length < (128 * 4) / 3) {
    return `ICC profile ${entry.id} must have a base64 payload`;
  }
  if (!Number.isInteger(entry.byteLength) || entry.byteLength <= 0) {
    return `ICC profile ${entry.id} must have a positive byteLength`;
  }
  if (typeof entry.hash !== 'string' || entry.hash.length === 0) {
    return `ICC profile ${entry.id} must have a hash`;
  }
  if (entry.fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(entry.fingerprint)) {
    return `ICC profile ${entry.id} fingerprint must be a SHA-256 hex digest`;
  }
  if (entry.profileClass !== undefined && typeof entry.profileClass !== 'string') {
    return `ICC profile ${entry.id} profileClass must be a string`;
  }
  if (entry.colorSpace !== undefined && typeof entry.colorSpace !== 'string') {
    return `ICC profile ${entry.id} colorSpace must be a string`;
  }
  if (entry.version !== undefined && typeof entry.version !== 'string') {
    return `ICC profile ${entry.id} version must be a string`;
  }
  if (
    entry.renderingIntent !== undefined &&
    (!Number.isInteger(entry.renderingIntent) ||
      entry.renderingIntent < 0 ||
      entry.renderingIntent > 3)
  ) {
    return `ICC profile ${entry.id} renderingIntent must be 0-3`;
  }
  return null;
}
