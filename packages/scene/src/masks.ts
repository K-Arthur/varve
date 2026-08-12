// COMPLEXITY: 358 cyclo — see docs/plans/architecture-health-remediation-2026-07-26.md
/**
 * Mask resolution and CRUD operations for the scene graph.
 *
 * A mask is a property on a container (FrameNode, GroupNode, or AdjustmentNode)
 * that designates one of its children as a mask source. The mask type determines
 * how the child is used:
 *   - 'clip': the mask child's outline clips the container's other children
 *   - 'alpha': the mask child's alpha channel modulates the container's other children
 *   - 'luminance': the mask child's luminance (× alpha) modulates the container's
 *     other children per SVG mask spec
 *
 * All operations are pure (immutable Document pattern).
 *
 * Research basis: Figma mask model, Adobe Photoshop layer masks,
 * Affinity Designer pixel/vector masks, SVG <clipPath>/<mask> specs.
 */
import type { Affine, PathPoint } from '@varve/engine';
import type { Document } from './document';
import { resolveNodePaints } from './paint';
import type {
  Mask,
  MaskFillRule,
  MaskType,
  NodeId,
  RasterMaskAsset,
  RasterMaskData,
  RasterMaskSourceIdentity,
  SceneNode,
  ShapeNode,
  VectorMaskData,
} from './types';

export const RASTER_MASK_MAX_DIMENSION = 16_384;
// Portable decoders reliably support 128 Mi pixels; the prior 256 Mi-pixel
// ceiling admitted 16K-square assets that could not be decoded cross-platform.
// Existing supported assets at or below this bound remain unaffected.
export const RASTER_MASK_MAX_DECODED_PIXELS = 134_217_728;
export const RASTER_MASK_MAX_ENCODED_BYTES = 128 * 1024 * 1024;

const PNG_DATA_URL_PATTERN =
  /^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_MAX_CHUNKS = 65_536;
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:%-]{0,255}$/;
const STALE_REASONS = ['source-replaced', 'source-changed', 'legacy-preview-resolution'] as const;
const PROVENANCE_METHODS = ['quick', 'ai-balanced', 'ai-quality'] as const;
const PROVENANCE_RUNTIMES = [
  'typescript',
  'wasm',
  'webgl',
  'webgpu',
  'native-cpu',
  'native-accelerated',
] as const;
const PROVENANCE_ORIGINS = ['native', 'legacy-background-removal-preview'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getOwnRasterMaskAsset(
  doc: Pick<Document, 'rasterMaskAssets'>,
  assetId: string,
): RasterMaskAsset | undefined {
  const assets = doc.rasterMaskAssets;
  return assets && Object.hasOwn(assets, assetId) ? assets[assetId] : undefined;
}

function decodedBase64Length(payload: string): number {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function decodeBase64(payload: string): string | null {
  try {
    return atob(payload);
  } catch {
    return null;
  }
}

function readU32Be(bytes: string, offset: number): number {
  return (
    bytes.charCodeAt(offset) * 0x1000000 +
    bytes.charCodeAt(offset + 1) * 0x10000 +
    bytes.charCodeAt(offset + 2) * 0x100 +
    bytes.charCodeAt(offset + 3)
  );
}

function pngCrc32(bytes: string, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ bytes.charCodeAt(index)) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isLegalPngSampleFormat(bitDepth: number, colorType: number): boolean {
  if (colorType === 0) return [1, 2, 4, 8, 16].includes(bitDepth);
  if (colorType === 2 || colorType === 4 || colorType === 6) {
    return bitDepth === 8 || bitDepth === 16;
  }
  return colorType === 3 && [1, 2, 4, 8].includes(bitDepth);
}

type PngStructureResult = { width: number; height: number } | { error: string };

/** Bounded structural PNG validation; input is capped before this full scan. */
function validatePngStructure(payload: string): PngStructureResult {
  const bytes = decodeBase64(payload);
  if (!bytes || bytes.length < PNG_SIGNATURE.length) {
    return { error: 'must contain the complete PNG signature' };
  }
  if (!PNG_SIGNATURE.every((byte, index) => bytes.charCodeAt(index) === byte)) {
    return { error: 'must contain the PNG signature' };
  }

  let offset: number = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = -1;
  let colorType = -1;
  let sawIhdr = false;
  let sawIdat = false;
  let sawPlte = false;
  let idatEnded = false;
  let idatByteCount = 0;
  let idatPrefix = '';
  let chunkCount = 0;

  while (offset < bytes.length) {
    chunkCount += 1;
    if (chunkCount > PNG_MAX_CHUNKS) return { error: 'contains too many PNG chunks' };
    if (bytes.length - offset < 12) return { error: 'has truncated PNG chunk bounds' };
    const length = readU32Be(bytes, offset);
    const type = bytes.slice(offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) {
      return { error: 'has truncated PNG chunk bounds' };
    }
    if (!/^[A-Za-z]{4}$/.test(type)) return { error: 'has an invalid PNG chunk type' };
    if (readU32Be(bytes, dataEnd) !== pngCrc32(bytes, offset + 4, dataEnd)) {
      return { error: `has an invalid ${type} CRC` };
    }

    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13) {
        return { error: 'must contain a complete 13-byte first IHDR chunk' };
      }
      width = readU32Be(bytes, dataStart);
      height = readU32Be(bytes, dataStart + 4);
      bitDepth = bytes.charCodeAt(dataStart + 8);
      colorType = bytes.charCodeAt(dataStart + 9);
      const compression = bytes.charCodeAt(dataStart + 10);
      const filter = bytes.charCodeAt(dataStart + 11);
      const interlace = bytes.charCodeAt(dataStart + 12);
      if (
        width === 0 ||
        height === 0 ||
        !isLegalPngSampleFormat(bitDepth, colorType) ||
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1)
      ) {
        return { error: 'has invalid IHDR fields' };
      }
      sawIhdr = true;
    } else if (type === 'IHDR') {
      return { error: 'contains multiple IHDR chunks' };
    } else if (type === 'PLTE') {
      const paletteEntries = length / 3;
      if (
        sawPlte ||
        sawIdat ||
        length === 0 ||
        length % 3 !== 0 ||
        length > 768 ||
        colorType === 0 ||
        colorType === 4 ||
        (colorType === 3 && paletteEntries > 2 ** bitDepth)
      ) {
        return { error: 'has an invalid PLTE chunk' };
      }
      sawPlte = true;
    } else if (type === 'IDAT') {
      if (idatEnded || length === 0) return { error: 'has invalid IDAT structure' };
      sawIdat = true;
      idatByteCount += length;
      if (idatPrefix.length < 2) {
        idatPrefix += bytes.slice(dataStart, dataStart + Math.min(length, 2 - idatPrefix.length));
      }
    } else if (type === 'IEND') {
      const cmf = idatPrefix.charCodeAt(0);
      const flg = idatPrefix.charCodeAt(1);
      const validZlibHeader =
        idatPrefix.length === 2 &&
        (cmf & 0x0f) === 8 &&
        cmf >>> 4 <= 7 &&
        ((cmf << 8) + flg) % 31 === 0 &&
        (flg & 0x20) === 0;
      if (
        length !== 0 ||
        !sawIdat ||
        idatByteCount < 6 ||
        !validZlibHeader ||
        (colorType === 3 && !sawPlte)
      ) {
        if (sawIdat && !validZlibHeader) return { error: 'has an invalid IDAT zlib header' };
        return { error: 'has invalid IDAT/IEND structure' };
      }
      if (chunkEnd !== bytes.length) return { error: 'must have a terminal IEND chunk' };
      return { width, height };
    } else {
      if (sawIdat) idatEnded = true;
      if ((type.charCodeAt(0) & 0x20) === 0) {
        return { error: `contains unsupported critical PNG chunk ${type}` };
      }
    }
    offset = chunkEnd;
  }

  if (!sawIhdr) return { error: 'must contain a complete 13-byte first IHDR chunk' };
  if (!sawIdat) return { error: 'must contain image data in an IDAT chunk' };
  return { error: 'must contain a terminal IEND chunk' };
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateSourceIdentity(value: unknown): string | null {
  if (!isRecord(value)) return 'Raster mask source identity must be an object';
  if (!isSafeNonnegativeInteger(value.revision)) {
    return 'Raster mask source identity revision must be a safe nonnegative integer';
  }
  for (const key of ['pixelWidth', 'pixelHeight'] as const) {
    if (
      value[key] !== undefined &&
      (!Number.isInteger(value[key]) ||
        (value[key] as number) <= 0 ||
        (value[key] as number) > RASTER_MASK_MAX_DIMENSION)
    ) {
      return `Raster mask source identity ${key} must be a supported positive integer`;
    }
  }
  if ((value.pixelWidth === undefined) !== (value.pixelHeight === undefined)) {
    return 'Raster mask source identity pixel dimensions must be provided together';
  }
  if (value.kind === 'source-metadata') {
    if ('sha256' in value) {
      return 'Raster mask source identity contains a field from another identity kind';
    }
    if (
      typeof value.locator !== 'string' ||
      value.locator.length === 0 ||
      value.locator.length > 8192
    ) {
      return 'Raster mask source identity locator must be a nonempty string';
    }
    return null;
  }
  if (value.kind === 'content-sha256') {
    if ('locator' in value) {
      return 'Raster mask source identity contains a field from another identity kind';
    }
    if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
      return 'Raster mask source identity SHA-256 must be 64 lowercase hexadecimal characters';
    }
    return null;
  }
  return 'Raster mask source identity kind is unsupported';
}

function validateProvenance(value: unknown): string | null {
  if (!isRecord(value)) return 'Raster mask provenance must be an object';
  if (!PROVENANCE_METHODS.includes(value.method as (typeof PROVENANCE_METHODS)[number])) {
    return 'Raster mask provenance method is unsupported';
  }
  if (!PROVENANCE_RUNTIMES.includes(value.runtime as (typeof PROVENANCE_RUNTIMES)[number])) {
    return 'Raster mask provenance runtime is unsupported';
  }
  if (
    typeof value.generatedAt !== 'number' ||
    !Number.isFinite(value.generatedAt) ||
    value.generatedAt < 0 ||
    value.generatedAt > Number.MAX_SAFE_INTEGER
  ) {
    return 'Raster mask provenance generatedAt must be a supported nonnegative timestamp';
  }
  for (const key of ['modelId', 'modelVersion'] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' || value[key].length === 0 || value[key].length > 1024)
    ) {
      return `Raster mask provenance ${key} must be a nonempty string`;
    }
  }
  if (
    value.modelChecksum !== undefined &&
    (typeof value.modelChecksum !== 'string' || !SHA256_PATTERN.test(value.modelChecksum))
  ) {
    return 'Raster mask provenance modelChecksum must be a lowercase SHA-256 digest';
  }
  if (
    value.confidence !== undefined &&
    (typeof value.confidence !== 'number' ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1)
  ) {
    return 'Raster mask provenance confidence must be between zero and one';
  }
  if (value.decontaminate !== undefined && typeof value.decontaminate !== 'boolean') {
    return 'Raster mask provenance decontaminate must be boolean';
  }
  if (
    value.origin !== undefined &&
    !PROVENANCE_ORIGINS.includes(value.origin as (typeof PROVENANCE_ORIGINS)[number])
  ) {
    return 'Raster mask provenance origin is unsupported';
  }
  return null;
}

/** Validate declared raster asset metadata without decoding PNG headers. */
export function validateRasterMaskAsset(asset: RasterMaskAsset): string | null {
  if (!isRecord(asset)) return 'Raster mask asset must be an object';
  if (typeof asset.id !== 'string' || !ASSET_ID_PATTERN.test(asset.id)) {
    return 'Raster mask asset id must use the portable asset-id syntax';
  }
  if (
    asset.checksum !== undefined &&
    (typeof asset.checksum !== 'string' || !SHA256_PATTERN.test(asset.checksum))
  ) {
    return `Raster mask ${asset.id} checksum must be a lowercase SHA-256 digest`;
  }
  if (
    asset.mimeType !== 'image/png' ||
    !PNG_DATA_URL_PATTERN.test(asset.dataUrl) ||
    asset.dataUrl === 'data:image/png;base64,'
  ) {
    return `Raster mask ${asset.id} must use a valid PNG data URL`;
  }
  const payload = asset.dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  const actualByteLength = decodedBase64Length(payload);
  if (asset.byteLength > RASTER_MASK_MAX_ENCODED_BYTES) {
    return `Raster mask ${asset.id} exceeds the encoded byte limit`;
  }
  if (!Number.isInteger(asset.byteLength) || asset.byteLength !== actualByteLength) {
    return `Raster mask ${asset.id} byteLength must match its decoded PNG payload`;
  }
  const png = validatePngStructure(payload);
  if ('error' in png) return `Raster mask ${asset.id} ${png.error}`;
  if (
    !Number.isInteger(asset.width) ||
    !Number.isInteger(asset.height) ||
    asset.width <= 0 ||
    asset.height <= 0
  ) {
    return `Raster mask ${asset.id} must declare positive dimensions`;
  }
  if (asset.width * asset.height > RASTER_MASK_MAX_DECODED_PIXELS) {
    return `Raster mask ${asset.id} exceeds the decoded pixel limit`;
  }
  if (asset.width > RASTER_MASK_MAX_DIMENSION || asset.height > RASTER_MASK_MAX_DIMENSION) {
    return `Raster mask ${asset.id} exceeds the per-dimension limit of ${RASTER_MASK_MAX_DIMENSION}`;
  }
  if (asset.width !== png.width || asset.height !== png.height) {
    return `Raster mask ${asset.id} declared dimensions must match its PNG IHDR`;
  }
  return null;
}

/** Validate the source union and, when supplied, its document asset reference. */
export function validateMaskSource(
  doc: Document | undefined,
  mask: {
    type: MaskType;
    visible?: boolean;
    sourceNodeId?: NodeId;
    vectorMask?: VectorMaskData;
    rasterMask?: RasterMaskData;
  },
): string | null {
  if (mask.rasterMask && ('sourceNodeId' in mask || 'vectorMask' in mask)) {
    return 'A raster mask source must be exclusive of structural source properties';
  }
  // A sourceNodeId may accompany a vector mask as optional visual content;
  // vectorMask remains the sole geometry source in that compatible form.
  const hasVectorGeometry = Boolean(mask.vectorMask && mask.vectorMask.points.length > 0);
  const structuralSourceCount = hasVectorGeometry ? 1 : Number(Boolean(mask.sourceNodeId));
  const sourceCount = structuralSourceCount + Number(Boolean(mask.rasterMask));
  if (sourceCount !== 1) return 'A mask must define exactly one meaningful source';
  if (mask.rasterMask) {
    if (mask.type !== 'alpha') return 'A raster mask must use alpha mask type';
    if (
      mask.rasterMask.coordinateSpace !== 'source-image-pixels' &&
      mask.rasterMask.coordinateSpace !== 'legacy-preview-pixels' &&
      mask.rasterMask.coordinateSpace !== 'container-local-pixels'
    ) {
      return 'A raster mask must use a supported pixel coordinate space';
    }
    if (
      mask.rasterMask.coordinateSpace === 'container-local-pixels' &&
      (mask.rasterMask.sourceIdentity?.kind !== 'source-metadata' ||
        mask.rasterMask.sourceIdentity.locator !== 'container-local')
    ) {
      return 'A container-local raster mask must carry the container-local source identity';
    }
    if (
      mask.rasterMask.coordinateSpace === 'legacy-preview-pixels' &&
      (mask.rasterMask.staleReason !== 'legacy-preview-resolution' ||
        mask.rasterMask.provenance?.origin !== 'legacy-background-removal-preview')
    ) {
      return 'A legacy preview raster mask must retain preview provenance and staleness';
    }
    if (
      mask.rasterMask.coordinateSpace === 'source-image-pixels' &&
      (mask.rasterMask.staleReason === 'legacy-preview-resolution' ||
        mask.rasterMask.provenance?.origin === 'legacy-background-removal-preview')
    ) {
      return 'Legacy preview status requires the legacy preview coordinate space';
    }
    if (
      typeof mask.rasterMask.assetId !== 'string' ||
      !ASSET_ID_PATTERN.test(mask.rasterMask.assetId) ||
      !mask.rasterMask.sourceIdentity
    ) {
      return 'A raster mask must identify its asset and source identity';
    }
    const identityError = validateSourceIdentity(mask.rasterMask.sourceIdentity);
    if (identityError) return identityError;
    if (
      mask.rasterMask.editRevision !== undefined &&
      !isSafeNonnegativeInteger(mask.rasterMask.editRevision)
    ) {
      return 'A raster mask edit revision must be a safe nonnegative integer';
    }
    if (
      mask.rasterMask.staleReason !== undefined &&
      !STALE_REASONS.includes(mask.rasterMask.staleReason)
    ) {
      return 'A raster mask stale reason is unsupported';
    }
    if (mask.rasterMask.provenance !== undefined) {
      const provenanceError = validateProvenance(mask.rasterMask.provenance);
      if (provenanceError) return provenanceError;
    }
    if (doc && !getOwnRasterMaskAsset(doc, mask.rasterMask.assetId)) {
      return `Missing raster mask asset ${mask.rasterMask.assetId}`;
    }
  }
  return null;
}

function knownIdentityDimensions(
  identity: RasterMaskSourceIdentity,
): { width: number; height: number } | null {
  return identity.pixelWidth !== undefined && identity.pixelHeight !== undefined
    ? { width: identity.pixelWidth, height: identity.pixelHeight }
    : null;
}

function knownOrientedSourceDimensions(
  doc: Document,
  node: SceneNode,
): { width: number; height: number } | null {
  const image = resolvedImageFill(doc, node);
  return image &&
    Number.isInteger(image.imageWidth) &&
    Number.isInteger(image.imageHeight) &&
    image.imageWidth! > 0 &&
    image.imageHeight! > 0
    ? { width: image.imageWidth!, height: image.imageHeight! }
    : null;
}

function validateSourcePixelDimensions(
  doc: Document,
  node: SceneNode,
  rasterMask: RasterMaskData,
  asset: RasterMaskAsset,
): string | null {
  if (rasterMask.coordinateSpace !== 'source-image-pixels') return null;
  const identityDimensions = knownIdentityDimensions(rasterMask.sourceIdentity);
  if (
    identityDimensions &&
    (asset.width !== identityDimensions.width || asset.height !== identityDimensions.height)
  ) {
    return `${node.id}: Raster mask source identity dimensions must match its asset dimensions`;
  }
  const sourceDimensions = knownOrientedSourceDimensions(doc, node);
  if (
    sourceDimensions &&
    (asset.width !== sourceDimensions.width || asset.height !== sourceDimensions.height)
  ) {
    return `${node.id}: Raster mask dimensions must match the oriented source dimensions`;
  }
  return null;
}

/** Validate every mask source and document-owned raster payload. */
export function validateRasterMaskDocument(doc: Document): string | null {
  for (const [tableKey, asset] of Object.entries(doc.rasterMaskAssets ?? {}) as [
    string,
    unknown,
  ][]) {
    const error = validateRasterMaskAsset(asset as RasterMaskAsset);
    if (error) return error;
    if ((asset as RasterMaskAsset).id !== tableKey) {
      return `Raster mask asset table key ${tableKey} must match asset id`;
    }
  }
  for (const nodeValue of Object.values(doc.nodes) as unknown[]) {
    if (!isRecord(nodeValue)) return 'Document node must be an object';
    const node = nodeValue as unknown as SceneNode;
    if ('fills' in nodeValue && nodeValue.fills !== undefined && !Array.isArray(nodeValue.fills)) {
      return `${String(nodeValue.id)}: fills must be an array`;
    }
    if (!('mask' in nodeValue) || nodeValue.mask === undefined) continue;
    if (!isRecord(node.mask)) return `${node.id}: Mask must be an object`;
    if ('vectorMask' in node.mask) {
      if (!isRecord(node.mask.vectorMask)) return `${node.id}: vectorMask must be an object`;
      if (!Array.isArray(node.mask.vectorMask.points)) {
        return `${node.id}: vectorMask.points must be an array`;
      }
    }
    if ('rasterMask' in node.mask && !isRecord(node.mask.rasterMask)) {
      return `${node.id}: rasterMask must be an object`;
    }
    const error = validateMaskSource(doc, node.mask);
    if (error) return `${node.id}: ${error}`;
    if (node.mask.rasterMask && !isImageShape(doc, node) && node.kind !== 'frame') {
      return `${node.id}: Raster masks may only attach to image-filled shape nodes or frames`;
    }
    if (node.mask.rasterMask) {
      const asset = getOwnRasterMaskAsset(doc, node.mask.rasterMask.assetId);
      if (asset) {
        const dimensionError = validateSourcePixelDimensions(
          doc,
          node,
          node.mask.rasterMask,
          asset,
        );
        if (dimensionError) return dimensionError;
      }
    }
  }
  return null;
}

// ── Resolution ──────────────────────────────────────────────────────────────

/** Return the effective mask for a container or eligible image leaf. */
export function resolveMask(node: SceneNode, doc?: Pick<Document, 'paints'>): Mask | null {
  if (!node.mask || node.mask.visible === false) return null;
  if (node.mask.rasterMask && (isImageShape(doc ?? {}, node) || node.kind === 'frame')) {
    return validateMaskSource(undefined, node.mask) ? null : node.mask;
  }
  if (node.kind !== 'frame' && node.kind !== 'group' && node.kind !== 'adjustment') return null;
  const container = node as SceneNode & { children?: string[] };
  if (validateMaskSource(undefined, node.mask)) return null;
  // Vector masks don't require a sourceNodeId
  if (node.mask.vectorMask && node.mask.vectorMask.points.length > 0) {
    return node.mask;
  }
  // For frames and groups with sourceNodeId, the mask source must be a child.
  if (node.mask.sourceNodeId) {
    if (
      node.kind !== 'adjustment' &&
      container.children &&
      !container.children.includes(node.mask.sourceNodeId)
    ) {
      return null;
    }
    return node.mask;
  }
  // A container-local raster mask (brush-painted layer mask on a frame) has
  // no child source and no vector geometry — it is a complete mask on its own.
  if (node.mask.rasterMask) return node.mask;
  // Mask has neither vectorMask nor sourceNodeId — incomplete
  return null;
}

/** Resolve an active leaf/container raster mask to its document-owned PNG payload. */
export function resolveRasterMaskAsset(
  doc: Pick<Document, 'paints' | 'rasterMaskAssets'>,
  node: SceneNode,
): RasterMaskAsset | null {
  const mask = node.mask;
  if (
    !mask?.rasterMask ||
    mask.type !== 'alpha' ||
    mask.visible === false ||
    'sourceNodeId' in mask ||
    'vectorMask' in mask ||
    !ASSET_ID_PATTERN.test(mask.rasterMask.assetId) ||
    (!isImageShape(doc, node) && node.kind !== 'frame')
  ) {
    return null;
  }
  return getOwnRasterMaskAsset(doc, mask.rasterMask.assetId) ?? null;
}

/** True if the container has an active (visible, valid) mask. */
export function isMasked(node: SceneNode, doc?: Pick<Document, 'paints'>): boolean {
  return resolveMask(node, doc) !== null;
}

/** Return the effective mask type for a container, or null if no active mask. */
export function resolveMaskType(node: SceneNode, doc?: Pick<Document, 'paints'>): MaskType | null {
  const mask = resolveMask(node, doc);
  return mask ? mask.type : null;
}

// ── Find / Validate ─────────────────────────────────────────────────────────

/**
 * Find all container node IDs whose mask references the given sourceNodeId.
 */
export function findNodesUsingMaskSource(doc: Document, sourceId: NodeId): NodeId[] {
  const result: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId === sourceId) {
      result.push(id as NodeId);
    }
  }
  return result;
}

/**
 * Check if a node is used as a mask source by any container.
 */
export function isMaskSource(doc: Document, sourceId: NodeId): boolean {
  return findNodesUsingMaskSource(doc, sourceId).length > 0;
}

/**
 * Validate that no mask references point to non-existent nodes.
 * Returns list of container NodeIds with dangling mask references.
 */
export function validateMasks(doc: Document): NodeId[] {
  const dangling: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId && !doc.nodes[n.mask.sourceNodeId]) {
      dangling.push(id as NodeId);
    } else if (n.mask && validateMaskSource(doc, n.mask)) {
      dangling.push(id as NodeId);
    } else if (
      n.mask?.sourceNodeId &&
      n.kind !== 'adjustment' &&
      doc.nodes[n.mask.sourceNodeId]?.kind === 'adjustment'
    ) {
      // A frame/group cannot clip to an adjustment (no renderable geometry).
      dangling.push(id as NodeId);
    }
  }
  return dangling;
}

/**
 * Remove mask references to the given source node from all container nodes.
 * Returns a new Document with the masks cleared.
 */
export function clearMaskSource(doc: Document, sourceId: NodeId): Document {
  let nodes = { ...doc.nodes };
  for (const [id, node] of Object.entries(nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId === sourceId) {
      const { mask: _unused, ...rest } = n;
      nodes = { ...nodes, [id]: rest as SceneNode };
    }
  }
  return { ...doc, nodes };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isContainerNode(node: SceneNode): node is SceneNode & { mask?: Mask; children: string[] } {
  return node.kind === 'frame' || node.kind === 'group' || node.kind === 'adjustment';
}

function resolvedImageFill(doc: Pick<Document, 'paints'>, node: SceneNode) {
  if (node.kind !== 'shape') return undefined;
  return resolveNodePaints(node as unknown as Parameters<typeof resolveNodePaints>[0], doc).find(
    (fill) => fill.type === 'image' && fill.image,
  )?.image;
}

function isImageShape(doc: Pick<Document, 'paints'>, node: SceneNode): node is ShapeNode {
  return node.kind === 'shape' && Boolean(resolvedImageFill(doc, node));
}

/**
 * Source-metadata identities are bounded, while embedded image data URLs can
 * be several megabytes. Keep a deterministic compact locator in the identity
 * descriptor; the image fill remains the authoritative full source.
 */
function compactSourceLocator(locator: string): string {
  if (locator.length <= 8192) return locator;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < locator.length; index++) {
    const code = locator.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  const prefixEnd = locator.indexOf(',');
  const mediaType = prefixEnd > 0 ? locator.slice(0, Math.min(prefixEnd, 96)) : 'embedded-source';
  const digest = `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
  return `${mediaType};length=${locator.length};fingerprint=${digest}`;
}

/**
 * Returns true if the node can own a mask. Containers own structural masks;
 * image-filled ShapeNodes own source-pixel raster alpha masks.
 */
export function canNodeHaveMask(node: SceneNode, doc?: Pick<Document, 'paints'>): boolean {
  return isContainerNode(node) || isImageShape(doc ?? {}, node);
}

/**
 * Return whether a node can provide geometric clip data for a container mask.
 * Keep this predicate beside mask CRUD so commands, inspectors, and document
 * validation cannot disagree about which sources are safe to trace.
 */
export function canBeClipMaskSource(node: SceneNode): boolean {
  if (node.kind === 'shape') {
    const shapeKind = node.shape.kind;
    if (shapeKind === 'line' || shapeKind === 'arrow') return false;
    if (shapeKind === 'path' && !node.shape.closed) return false;
    return true;
  }
  if (node.kind === 'path') return node.closed;
  return node.kind === 'frame';
}

// ── CRUD Operations ─────────────────────────────────────────────────────────

const VALID_MASK_TYPES: MaskType[] = ['clip', 'alpha', 'luminance'];

function imageSourceIdentity(
  doc: Pick<Document, 'paints'>,
  node: ShapeNode,
  revision: number,
): RasterMaskSourceIdentity {
  const image = resolvedImageFill(doc, node);
  return {
    kind: 'source-metadata',
    locator: compactSourceLocator(image?.src ?? node.id),
    ...(image?.imageWidth !== undefined ? { pixelWidth: image.imageWidth } : {}),
    ...(image?.imageHeight !== undefined ? { pixelHeight: image.imageHeight } : {}),
    revision,
  };
}

function rasterAssetsEqual(left: RasterMaskAsset, right: RasterMaskAsset): boolean {
  return (
    left.id === right.id &&
    left.mimeType === right.mimeType &&
    left.dataUrl === right.dataUrl &&
    left.width === right.width &&
    left.height === right.height &&
    left.byteLength === right.byteLength &&
    left.checksum === right.checksum
  );
}

function isRasterAssetReferenced(doc: Document, assetId: string, exceptNodeId?: NodeId): boolean {
  return Object.values(doc.nodes).some(
    (node) => node.id !== exceptNodeId && node.mask?.rasterMask?.assetId === assetId,
  );
}

function withoutUnreferencedAsset(doc: Document, assetId: string): Document {
  if (isRasterAssetReferenced(doc, assetId) || !getOwnRasterMaskAsset(doc, assetId)) return doc;
  const rasterMaskAssets = { ...doc.rasterMaskAssets };
  delete rasterMaskAssets[assetId];
  return {
    ...doc,
    rasterMaskAssets: Object.keys(rasterMaskAssets).length > 0 ? rasterMaskAssets : undefined,
  };
}

/**
 * Store an immutable PNG asset and attach it as a source-pixel alpha mask.
 * Existing asset ids may be reused only when their payload metadata is equal.
 */
export function addRasterMaskAsset(
  doc: Document,
  nodeId: NodeId,
  asset: RasterMaskAsset,
  rasterMask?: Partial<Omit<RasterMaskData, 'assetId' | 'coordinateSpace'>>,
  opts?: { coordinateSpace?: 'source-image-pixels' | 'container-local-pixels' },
): Document {
  const node = doc.nodes[nodeId];
  const isImage = node !== undefined && isImageShape(doc, node);
  const isFrame = node?.kind === 'frame';
  const coordinateSpace = opts?.coordinateSpace ?? 'source-image-pixels';
  if (!node || (!isImage && !isFrame) || validateRasterMaskAsset(asset)) return doc;
  if (coordinateSpace === 'container-local-pixels' && !isFrame) return doc;
  if (coordinateSpace === 'source-image-pixels' && !isImage) return doc;
  const existing = getOwnRasterMaskAsset(doc, asset.id);
  if (existing && !rasterAssetsEqual(existing, asset)) return doc;

  const revision = rasterMask?.sourceIdentity?.revision ?? 1;
  const sourceIdentity =
    coordinateSpace === 'container-local-pixels'
      ? ({ kind: 'source-metadata', locator: 'container-local', revision } as const)
      : (rasterMask?.sourceIdentity ?? imageSourceIdentity(doc, node as ShapeNode, revision));
  const maskData: RasterMaskData = {
    assetId: asset.id,
    coordinateSpace,
    sourceIdentity,
    ...(rasterMask?.editRevision !== undefined ? { editRevision: rasterMask.editRevision } : {}),
    ...(rasterMask?.staleReason !== undefined ? { staleReason: rasterMask.staleReason } : {}),
    ...(rasterMask?.provenance !== undefined ? { provenance: rasterMask.provenance } : {}),
  };
  const mask: Mask = { type: 'alpha', visible: true, rasterMask: maskData };
  const candidate = {
    ...doc,
    rasterMaskAssets: { ...doc.rasterMaskAssets, [asset.id]: asset },
  };
  if (
    validateMaskSource(candidate, mask) ||
    validateSourcePixelDimensions(candidate, node, maskData, asset)
  ) {
    return doc;
  }

  const updated: Document = {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: { ...node, mask } },
    rasterMaskAssets: { ...doc.rasterMaskAssets, [asset.id]: asset },
  };
  const priorAssetId = node.mask?.rasterMask?.assetId;
  return priorAssetId && priorAssetId !== asset.id
    ? withoutUnreferencedAsset(updated, priorAssetId)
    : updated;
}

/** Replace one image node's raster asset without mutating shared payloads. */
export function updateRasterMaskAsset(
  doc: Document,
  nodeId: NodeId,
  asset: RasterMaskAsset,
): Document {
  const node = doc.nodes[nodeId];
  const currentMask = node?.mask;
  const current = currentMask?.rasterMask;
  if (!node || !currentMask || !current || !(isImageShape(doc, node) || node.kind === 'frame')) {
    return doc;
  }
  if (validateRasterMaskAsset(asset)) return doc;
  const existing = getOwnRasterMaskAsset(doc, asset.id);
  if (existing && !rasterAssetsEqual(existing, asset)) return doc;
  if (current.assetId === asset.id && existing && rasterAssetsEqual(existing, asset)) return doc;
  if (validateSourcePixelDimensions(doc, node, current, asset)) return doc;
  const currentEditRevision = current.editRevision ?? 0;
  if (
    !isSafeNonnegativeInteger(currentEditRevision) ||
    currentEditRevision === Number.MAX_SAFE_INTEGER
  ) {
    return doc;
  }
  const updated: Document = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...node,
        mask: {
          ...currentMask,
          rasterMask: {
            ...current,
            assetId: asset.id,
            editRevision: currentEditRevision + 1,
          },
        },
      },
    },
    rasterMaskAssets: { ...doc.rasterMaskAssets, [asset.id]: asset },
  };
  return withoutUnreferencedAsset(updated, current.assetId);
}

/** Remove one node's raster mask and garbage-collect its unshared asset. */
export function removeRasterMaskAsset(doc: Document, nodeId: NodeId): Document {
  const node = doc.nodes[nodeId];
  const assetId = node?.mask?.rasterMask?.assetId;
  if (!node || !assetId) return doc;
  const { mask: _removed, ...rest } = node;
  const updated: Document = {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: rest as SceneNode },
  };
  return withoutUnreferencedAsset(updated, assetId);
}

/**
 * Detect cycles in the mask graph.
 * A mask cycle exists when container A has a mask referencing child B,
 * and B (or one of B's descendants, if B is a container) has a mask
 * referencing A (or one of A's ancestors).
 *
 * @returns Array of cycle paths, each an ordered list of node IDs forming a cycle.
 *         Empty array when no cycles exist.
 */
export function detectMaskCycles(doc: Document): NodeId[][] {
  const cycles: NodeId[][] = [];
  const visited = new Set<NodeId>();
  const inStack = new Set<NodeId>();
  const path: NodeId[] = [];

  function visit(nid: NodeId): void {
    if (inStack.has(nid)) {
      // Found a cycle — extract the path from the start of the cycle
      const cycleStart = path.indexOf(nid);
      if (cycleStart >= 0) {
        cycles.push([...path.slice(cycleStart), nid]);
      }
      return;
    }
    if (visited.has(nid)) return;

    visited.add(nid);
    inStack.add(nid);
    path.push(nid);

    const node = doc.nodes[nid];
    const n = node as SceneNode & { mask?: Mask; children?: NodeId[] };
    if (n.mask?.sourceNodeId && n.mask.visible !== false) {
      const srcId = n.mask.sourceNodeId;
      const srcNode = doc.nodes[srcId];
      // Follow mask source if the source is itself a container (nested masks)
      if (srcNode && isContainerNode(srcNode)) {
        visit(srcId);
      }
    }
    // Also check children recursively for their own masks
    if (n.children) {
      for (const childId of n.children) {
        visit(childId);
      }
    }

    path.pop();
    inStack.delete(nid);
  }

  for (const nid of Object.keys(doc.nodes)) {
    if (!visited.has(nid as NodeId)) {
      visit(nid as NodeId);
    }
  }

  return cycles;
}

/**
 * Add a mask to a container node.
 *
 * @param doc - The document
 * @param containerId - The container node ID (frame, group, or adjustment)
 * @param sourceNodeId - Optional child node ID to use as mask source.
 *        May be omitted when vectorMask is provided.
 * @param type - The mask type ('clip', 'alpha', or 'luminance')
 * @param opts - Optional mask properties
 * @returns A new document with the mask added, or the same document if invalid
 */
export function addMask(
  doc: Document,
  containerId: NodeId,
  sourceNodeId: NodeId | undefined,
  type: MaskType,
  opts?: {
    inverted?: boolean;
    feather?: number;
    density?: number;
    linked?: boolean;
    visible?: boolean;
    transform?: Affine;
    hideMaskSource?: boolean;
    vectorMask?: VectorMaskData;
    fillRule?: MaskFillRule;
  },
): Document {
  const container = doc.nodes[containerId];
  if (!container) return doc;
  if (!isContainerNode(container)) return doc;
  if (!VALID_MASK_TYPES.includes(type)) return doc;

  // Structural masks need a node source, vector geometry, or both. When both
  // are present, vector geometry is meaningful and the node is visual content.
  if (!sourceNodeId && (!opts?.vectorMask || opts.vectorMask.points.length === 0)) return doc;

  // Source must exist if specified
  if (sourceNodeId && !doc.nodes[sourceNodeId]) return doc;

  // Source must be a child of the container (frames and groups only)
  if (sourceNodeId && container.kind !== 'adjustment') {
    const children = container.children;
    if (children && !children.includes(sourceNodeId)) return doc;
    // Adjustment nodes have no renderable geometry — a frame/group cannot
    // clip or trace to an adjustment as its mask source. Only an
    // adjustment's own spatial mask may reference an arbitrary node.
    if (doc.nodes[sourceNodeId]?.kind === 'adjustment') return doc;
    if (type === 'clip' && !opts?.vectorMask && !canBeClipMaskSource(doc.nodes[sourceNodeId]!)) {
      return doc;
    }
  }

  const presentation = {
    type,
    visible: opts?.visible ?? true,
    ...(opts?.inverted ? { inverted: true } : {}),
    ...(opts?.feather !== undefined && opts.feather > 0 ? { feather: opts.feather } : {}),
    ...(opts?.density !== undefined && opts.density < 1 ? { density: opts.density } : {}),
    ...(opts?.linked === false ? { linked: false } : {}),
    ...(opts?.transform ? { transform: opts.transform } : {}),
    ...(opts?.hideMaskSource ? { hideMaskSource: true } : {}),
    ...(opts?.fillRule ? { fillRule: opts.fillRule } : {}),
  };
  const vectorMask = opts?.vectorMask?.points.length ? opts.vectorMask : undefined;
  const cleaned: Mask = vectorMask
    ? sourceNodeId
      ? { ...presentation, vectorMask, sourceNodeId }
      : { ...presentation, vectorMask }
    : { ...presentation, sourceNodeId: sourceNodeId! };

  // Check for cycles before adding the mask
  const testDoc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [containerId]: { ...container, mask: cleaned } as SceneNode,
    },
  };
  const cycles = detectMaskCycles(testDoc);
  if (cycles.length > 0) {
    return doc; // Reject masks that would create cycles
  }

  const nodes = {
    ...doc.nodes,
    [containerId]: { ...container, mask: cleaned } as SceneNode,
  };

  return { ...doc, nodes };
}

/**
 * Remove the mask from a container node.
 * Does not remove the mask source node itself.
 *
 * @returns A new document with the mask removed, or the same document if no mask existed.
 */
export function removeMask(doc: Document, containerId: NodeId): Document {
  const container = doc.nodes[containerId];
  if (!container) return doc;
  if (!container.mask) return doc;

  if (container.mask.rasterMask) return removeRasterMaskAsset(doc, containerId);
  if (!isContainerNode(container)) return doc;

  const { mask: _unused, ...rest } = container;
  const nodes = {
    ...doc.nodes,
    [containerId]: rest as SceneNode,
  };

  return { ...doc, nodes };
}

/**
 * Update a specific property on a container's mask.
 * Returns the same document if no mask exists or the value is unchanged.
 */
function updateMaskProperty<T>(
  doc: Document,
  containerId: NodeId,
  key: string,
  value: T | undefined,
  shouldInclude?: (value: T | undefined) => boolean,
): Document {
  const container = doc.nodes[containerId];
  if (!container) return doc;
  if (!container.mask) return doc;
  const isLeafRasterProperty =
    isImageShape(doc, container) &&
    Boolean(container.mask.rasterMask) &&
    (key === 'visible' || key === 'inverted' || key === 'feather' || key === 'density');
  if (!isContainerNode(container) && !isLeafRasterProperty) return doc;

  const include = shouldInclude ? shouldInclude(value) : value !== undefined;
  const currentValue = (container.mask as unknown as Record<string, unknown>)[key];
  if ((include && Object.is(currentValue, value)) || (!include && !(key in container.mask))) {
    return doc;
  }
  const cleaned: Mask = include
    ? ({ ...container.mask, [key]: value } as Mask)
    : (() => {
        const { [key]: _removed, ...rest } = container.mask as unknown as Record<string, unknown>;
        return rest as unknown as Mask;
      })();

  const nodes = {
    ...doc.nodes,
    [containerId]: { ...container, mask: cleaned } as SceneNode,
  };

  return { ...doc, nodes };
}

/** Toggle mask visibility. */
export function setMaskVisible(doc: Document, containerId: NodeId, visible: boolean): Document {
  return updateMaskProperty(doc, containerId, 'visible', visible);
}

/** Toggle mask inversion. */
export function setMaskInverted(doc: Document, containerId: NodeId, inverted: boolean): Document {
  return updateMaskProperty(doc, containerId, 'inverted', inverted || undefined, (v) => !!v);
}

/** Set mask feather radius in world-space pixels (0 to remove feather). */
export function setMaskFeather(doc: Document, containerId: NodeId, feather: number): Document {
  const clamped = Math.max(0, feather);
  return updateMaskProperty(doc, containerId, 'feather', clamped > 0 ? clamped : undefined, (v) => {
    return (v as number) > 0;
  });
}

/** Set mask density (0-1). 1 = full effect, 0 = no effect. */
export function setMaskDensity(doc: Document, containerId: NodeId, density: number): Document {
  const clamped = Math.max(0, Math.min(1, density));
  return updateMaskProperty(doc, containerId, 'density', clamped < 1 ? clamped : undefined, (v) => {
    return (v as number) < 1;
  });
}

/** Toggle whether the mask is linked to its container transform. */
export function setMaskLinked(doc: Document, containerId: NodeId, linked: boolean): Document {
  return updateMaskProperty(
    doc,
    containerId,
    'linked',
    linked ? undefined : false,
    (v) => v === false,
  );
}

/** Set the independent mask transform (only meaningful when linked === false). */
export function setMaskTransform(
  doc: Document,
  containerId: NodeId,
  transform: Affine | undefined,
): Document {
  return updateMaskProperty(doc, containerId, 'transform', transform, (v) => v !== undefined);
}

/** Change the mask type ('clip', 'alpha', or 'luminance'). */
export function setMaskType(doc: Document, containerId: NodeId, type: MaskType): Document {
  if (!VALID_MASK_TYPES.includes(type)) return doc;
  const container = doc.nodes[containerId];
  const sourceId = container?.mask?.sourceNodeId;
  if (
    type === 'clip' &&
    container &&
    sourceId &&
    !container.mask?.vectorMask &&
    container.kind !== 'adjustment' &&
    (!doc.nodes[sourceId] || !canBeClipMaskSource(doc.nodes[sourceId]!))
  ) {
    return doc;
  }
  return updateMaskProperty(doc, containerId, 'type', type);
}

/** Toggle whether the mask source node is hidden from direct rendering. */
export function setMaskHideSource(
  doc: Document,
  containerId: NodeId,
  hideSource: boolean,
): Document {
  return updateMaskProperty(
    doc,
    containerId,
    'hideMaskSource',
    hideSource || undefined,
    (v) => !!v,
  );
}

/** Set the vector mask path data for a container's mask. */
export function setMaskVectorPath(
  doc: Document,
  containerId: NodeId,
  points: PathPoint[],
  closed: boolean,
  fillRule?: MaskFillRule,
): Document {
  if (points.length === 0) {
    const node = doc.nodes[containerId];
    if (!node || !isContainerNode(node) || !node.mask?.vectorMask) return doc;
    if (!node.mask.sourceNodeId) return removeMask(doc, containerId);
  }
  return updateMaskProperty(
    doc,
    containerId,
    'vectorMask',
    points.length > 0
      ? ({ points, closed, fillRule: fillRule ?? 'nonzero' } as VectorMaskData)
      : undefined,
  );
}

/** Set the fill rule for a clip/vector mask. */
export function setMaskFillRule(
  doc: Document,
  containerId: NodeId,
  fillRule: MaskFillRule,
): Document {
  return updateMaskProperty(doc, containerId, 'fillRule', fillRule);
}

/**
 * Mark a node's raster mask as stale when its source image has changed.
 *
 * Increments the source identity revision, sets the stale reason, and
 * disables the mask (visible: false). The existing mask asset is preserved
 * in the document so the user can re-enable it or re-run background removal.
 */
export function markMaskStale(
  doc: Document,
  nodeId: NodeId,
  reason: 'source-replaced' | 'source-changed',
): Document {
  const node = doc.nodes[nodeId];
  if (!node?.mask?.rasterMask) return doc;
  const currentRevision = node.mask.rasterMask.sourceIdentity.revision;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...node,
        mask: {
          ...node.mask,
          visible: false,
          rasterMask: {
            ...node.mask.rasterMask,
            staleReason: reason,
            sourceIdentity: {
              ...node.mask.rasterMask.sourceIdentity,
              revision: Number.isSafeInteger(currentRevision + 1) ? currentRevision + 1 : 1,
            },
          },
        },
      },
    },
  };
}

/** Check if a mask has a self-contained vector path (not dependent on a child node). */
export function hasVectorMask(mask: {
  type?: MaskType;
  visible?: boolean;
  sourceNodeId?: NodeId;
  vectorMask?: VectorMaskData;
}): boolean {
  return !!mask.vectorMask && mask.vectorMask.points.length > 0;
}

/** Check if a mask has a source node reference. */
export function hasSourceNode(mask: {
  type?: MaskType;
  visible?: boolean;
  sourceNodeId?: NodeId;
  vectorMask?: VectorMaskData;
}): boolean {
  return !!mask.sourceNodeId;
}

/** Get all mask source node IDs in the document (for invalidation tracking). */
export function getAllMaskSourceIds(doc: Document): Set<NodeId> {
  const sources = new Set<NodeId>();
  for (const node of Object.values(doc.nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId) {
      sources.add(n.mask.sourceNodeId);
    }
  }
  return sources;
}

/** Change the mask source node (must be a child of the container). */
export function setMaskSourceNode(
  doc: Document,
  containerId: NodeId,
  sourceNodeId: NodeId,
): Document {
  const container = doc.nodes[containerId];
  if (!container) return doc;
  if (!isContainerNode(container)) return doc;
  if (!container.mask) return doc;

  if (!doc.nodes[sourceNodeId]) return doc;
  // For frames and groups, source must be a child
  if (container.kind !== 'adjustment') {
    const children = container.children;
    if (children && !children.includes(sourceNodeId)) return doc;
    // Adjustment nodes have no renderable geometry as a mask source for
    // frame/group containers (see addMask).
    if (doc.nodes[sourceNodeId]?.kind === 'adjustment') return doc;
    if (container.mask.type === 'clip' && !container.mask.vectorMask) {
      const source = doc.nodes[sourceNodeId];
      if (!source || !canBeClipMaskSource(source)) return doc;
    }
  }

  // Retargeting a mask source can introduce a cycle (e.g. B's mask now
  // points at A while A's mask points at B) — the same pre-check addMask
  // applies, re-run here because setMaskSourceNode bypassed it.
  const testDoc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [containerId]: { ...container, mask: { ...container.mask, sourceNodeId } } as SceneNode,
    },
  };
  if (detectMaskCycles(testDoc).length > 0) return doc;

  return updateMaskProperty(doc, containerId, 'sourceNodeId', sourceNodeId);
}
