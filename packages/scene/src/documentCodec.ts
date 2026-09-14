/**
 * Canonical document codec for import/export and persistence boundaries.
 *
 * All external document bytes should pass through this module before they enter
 * editor state. The codec migrates, normalizes broken references, and returns
 * structured warnings so callers can report compatibility issues honestly.
 *
 * Research basis: local-first design tools need one migration/validation path
 * across disk, recovery, clipboard, and foreign-format imports; this avoids the
 * drift seen when each surface parses raw JSON independently.
 */

import { normalizeAdjustmentStack } from './adjustmentNormalization';
import {
  hashContent,
  isAssetReferenced,
  mimeTypeFromDataUrl,
  pruneUnusedIccProfiles,
  validateDocumentAsset,
  validateIccProfileEntry,
} from './assets';
import { validateDepthMaskRecipe } from './depthMaskRecipe';
import type { Document } from './document';
import { isContainer, makeGroupNode } from './document';
import {
  type DocumentLike,
  findParentCycle,
  traversalChildren,
  validateAndRepairDocument,
} from './document-utils';
import { normalizeEffectLooks } from './effectLooks';
import { normalizeDocumentEffects } from './effects';
import { normalizeGenerativeEdits } from './generativeEdit';
import { isIconAssetReferenced, validateIconAsset } from './iconAsset';
import { normalizeLogoProject } from './logo/logoProject';
import { isVisualMaskTarget } from './maskCapability';
import {
  getOwnRasterMaskAsset,
  validateMaskSource,
  validateRasterMaskAsset,
  validateRasterMaskDocument,
} from './masks';
import { sanitizeMockupState } from './mockup/normalize';
import { resolveNodePaints } from './paint';
import { validatePhotoSourceBinding, validateRetouchProvenance } from './photoSource';
import { deserializeTiles, type SerializableTiles } from './rasterLayer';
import { normalizeSavedAreaSelections } from './savedAreaSelection';
import { createEmptySelectionSetsData } from './selectionSet';
import { sha256Utf8 } from './sha256';
import { normalizeStrokeIds } from './strokeIdentity';
import { emptyTableModel, tableContentNodeIds } from './table';
import { normalizeTableModelDefensively } from './tableOps';
import {
  type NodeId,
  normalizeImageFillData,
  type Page,
  type RasterMaskAsset,
  type SceneNode,
} from './types';
import {
  CURRENT_DOCUMENT_VERSION,
  migrateDocumentDetailed,
  normalizeLayerColors,
  normalizeLegacyBackgroundRemoval,
  rehydrateEmbeddedAssetSrc,
  serializeDocument as serializeVersionedDocument,
} from './version';

export interface DocumentCodecWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  path?: string;
}

export type DocumentDecodeResult =
  | { ok: true; document: Document; warnings: DocumentCodecWarning[] }
  | { ok: false; warnings: DocumentCodecWarning[]; error: string };

export interface DocumentNormalizeResult {
  document: Document;
  warnings: DocumentCodecWarning[];
}

export interface DocumentClosure {
  nodeIds: Set<NodeId>;
  nodes: Record<NodeId, SceneNode>;
  /** Exact font metadata required by the copied nodes and their styles. */
  fontManifest?: Document['fontManifest'];
  /** Component definitions whose instance or master is in the closure. */
  components?: Document['components'];
  /** Reusable styles referenced by closure nodes. */
  styles?: Document['styles'];
  /** Reusable paints referenced by closure nodes. */
  paints?: Document['paints'];
  /** Variable bindings and their referenced aliases. */
  variableStore?: Document['variableStore'];
  /** Prototype interactions owned by closure nodes. */
  interactions?: Document['interactions'];
  /** Motion timelines/tracks targeting closure nodes. */
  timelines?: Document['timelines'];
  /** Linked text stories referenced by closure text frames. */
  stories?: Document['stories'];
  motionExtensions?: Document['motionExtensions'];
  motionPresets?: Document['motionPresets'];
  rasterMaskAssets?: Document['rasterMaskAssets'];
  /** Image assets (v2.6+) referenced by the closure's nodes — see ./assets.ts. */
  assets?: Document['assets'];
  /** Icon assets referenced by the closure's nodes — see ./iconAsset.ts. */
  iconAssets?: Document['iconAssets'];
  /** Accepted scalar depth resources referenced by effects or mask recipes. */
  depthMaps?: Document['depthMaps'];
  /** Mockup template assets referenced by the closure's nodes (v2.16+). */
  mockupTemplates?: Document['mockupTemplates'];
  /** Generative recipes owned by a node in the closure, including candidates. */
  generativeEdits?: Document['generativeEdits'];
}

function warning(
  code: string,
  message: string,
  severity: DocumentCodecWarning['severity'] = 'warning',
  path?: string,
): DocumentCodecWarning {
  return path ? { code, message, severity, path } : { code, message, severity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateShape(raw: Record<string, unknown>): string | null {
  if (typeof raw.id !== 'string') return 'Document id must be a string';
  if (typeof raw.name !== 'string') return 'Document name must be a string';
  if (!Array.isArray(raw.rootChildren)) return 'Document rootChildren must be an array';
  if (!isRecord(raw.nodes)) return 'Document nodes must be an object';
  if (!isRecord(raw.components)) return 'Document components must be an object';
  if (typeof raw.nextId !== 'number') return 'Document nextId must be a number';
  return null;
}

function validateRuntimeCollections(raw: Record<string, unknown>): string | null {
  if (isRecord(raw.nodes)) {
    for (const [nodeId, node] of Object.entries(raw.nodes)) {
      if (!isRecord(node)) return `Document node ${nodeId} must be an object`;
    }
  }
  if (raw.rasterMaskAssets !== undefined) {
    if (!isRecord(raw.rasterMaskAssets)) return 'Document rasterMaskAssets must be an object';
    for (const [assetId, asset] of Object.entries(raw.rasterMaskAssets)) {
      if (!isRecord(asset)) return `Raster mask asset ${assetId} must be an object`;
    }
  }
  if (raw.assets !== undefined) {
    if (!isRecord(raw.assets)) return 'Document assets must be an object';
    for (const [assetId, asset] of Object.entries(raw.assets)) {
      if (!isRecord(asset)) return `Document asset ${assetId} must be an object`;
    }
  }
  if (raw.depthMaps !== undefined) {
    if (!isRecord(raw.depthMaps)) return 'Document depthMaps must be an object';
    for (const [depthMapId, depthMap] of Object.entries(raw.depthMaps)) {
      if (!isRecord(depthMap)) return `Depth map resource ${depthMapId} must be an object`;
      // Decode-time validation is deliberately deferred to deserializeDepthMap.
      // A newer or corrupt resource must not make the whole document unloadable;
      // the renderer can keep the source pixels and report a controlled warning.
    }
  }
  if (raw.iccProfiles !== undefined) {
    if (!isRecord(raw.iccProfiles)) return 'Document iccProfiles must be an object';
    for (const [profileId, entry] of Object.entries(raw.iccProfiles)) {
      if (!isRecord(entry)) return `ICC profile ${profileId} must be an object`;
    }
  }
  if (raw.generativeEdits !== undefined) {
    if (!isRecord(raw.generativeEdits)) return 'Document generativeEdits must be an object';
  }
  if (raw.iconAssets !== undefined) {
    if (!isRecord(raw.iconAssets)) return 'Document iconAssets must be an object';
    for (const [assetId, asset] of Object.entries(raw.iconAssets)) {
      if (!isRecord(asset)) return `Icon asset ${assetId} must be an object`;
    }
  }
  return null;
}

function maxNumericNodeId(nodes: Record<NodeId, SceneNode>): number {
  let max = 0;
  for (const id of Object.keys(nodes)) {
    // Legacy sequential ids (`n12`) and minted collision-resistant ids
    // (`n12_3fa9...`, ADR-0025) both carry a counter component.
    const match = /^n(\d+)(?:_[0-9a-f]+)?$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

function malformedLegacyBackgroundRemovalWarnings(
  raw: Record<string, unknown>,
): DocumentCodecWarning[] {
  if (!isRecord(raw.nodes)) return [];
  const warnings: DocumentCodecWarning[] = [];
  for (const [nodeId, value] of Object.entries(raw.nodes)) {
    if (!isRecord(value) || !('backgroundRemoval' in value)) continue;
    const legacy = value.backgroundRemoval;
    if (
      legacy === null ||
      typeof legacy !== 'object' ||
      typeof (legacy as { maskDataUrl?: unknown }).maskDataUrl !== 'string'
    ) {
      warnings.push(
        warning(
          'document.invalid-legacy-background-removal',
          `Node ${nodeId} had malformed legacy background removal state; it was removed`,
          'error',
          `${nodeId}.backgroundRemoval`,
        ),
      );
    }
  }
  return warnings;
}

function hasImageFill(doc: Document, node: SceneNode): boolean {
  return (
    node.kind === 'shape' &&
    resolveNodePaints(node as unknown as Parameters<typeof resolveNodePaints>[0], doc).some(
      (fill) => fill.type === 'image' && fill.image,
    )
  );
}

function hasDepthMaskSource(doc: Document, node: SceneNode): boolean {
  if (node.kind !== 'adjustment') return false;
  const sourceId = node.mask?.rasterMask?.depthRecipe?.sourceBinding.nodeId;
  const source = sourceId ? doc.nodes[sourceId] : undefined;
  return source ? hasImageFill(doc, source) : false;
}

/**
 * Upgrade the short content id emitted by the first browser generative-mask
 * implementation. `checksum` is a SHA-256 field, so the old 16-hex FNV id
 * made DocumentCodec discard otherwise valid masks during save/reopen.
 */
function upgradeLegacyRasterMaskChecksum(asset: RasterMaskAsset): RasterMaskAsset {
  if (
    typeof asset.checksum !== 'string' ||
    !/^[a-f0-9]{16}$/.test(asset.checksum) ||
    hashContent(asset.dataUrl) !== asset.checksum
  ) {
    return asset;
  }
  return { ...asset, checksum: sha256Utf8(asset.dataUrl) };
}

function sanitizeRasterMaskState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  const normalizedAssets = Object.entries(doc.rasterMaskAssets ?? {}).map(
    ([assetId, asset]) => [assetId, upgradeLegacyRasterMaskChecksum(asset)] as const,
  );
  const validAssets = Object.fromEntries(
    normalizedAssets.filter(([assetId, asset]) => {
      const error = validateRasterMaskAsset(asset);
      if (!error) return true;
      warnings.push(
        warning('document.invalid-raster-mask', error, 'error', `rasterMaskAssets.${assetId}`),
      );
      return false;
    }),
  );
  const candidate = { ...doc, rasterMaskAssets: validAssets };
  const nodes: Record<NodeId, SceneNode> = {};
  const referencedAssets = new Set<string>();
  const invalidatedAssets = new Set<string>();

  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    const rasterMask = node.mask?.rasterMask;
    if (!rasterMask) {
      nodes[nodeId] = node;
      continue;
    }
    const targetError =
      rasterMask.coordinateSpace === 'source-image-pixels'
        ? !hasImageFill(candidate, node) && !hasDepthMaskSource(candidate, node)
          ? 'Source-pixel raster masks require an image-filled shape node'
          : null
        : rasterMask.coordinateSpace === 'container-local-pixels'
          ? node.kind !== 'frame'
            ? 'Container-local raster masks require a frame node'
            : null
          : rasterMask.coordinateSpace === 'node-local-pixels' && !isVisualMaskTarget(node)
            ? 'Node-local raster masks require a visual leaf node'
            : null;
    const error = validateMaskSource(candidate, node.mask!) ?? targetError;
    if (error) {
      warnings.push(
        warning('document.invalid-raster-mask', `${nodeId}: ${error}`, 'error', `${nodeId}.mask`),
      );
      invalidatedAssets.add(rasterMask.assetId);
      const { mask: _invalidMask, ...rest } = node;
      nodes[nodeId] = rest as SceneNode;
      continue;
    }
    if (rasterMask.depthRecipe) {
      const recipeError = validateDepthMaskRecipe(rasterMask.depthRecipe, candidate);
      if (recipeError) {
        warnings.push(
          warning(
            'document.invalid-depth-mask-recipe',
            `${nodeId}: ${recipeError}; the last resolved raster mask was retained`,
            'warning',
            `${nodeId}.mask.rasterMask.depthRecipe`,
          ),
        );
        // A missing depth resource is recoverable: the immutable resolved
        // coverage can still protect an adjustment's output while the user
        // imports/relinks the map. Only discard the recipe when its source
        // binding cannot be proved safe; image masks can fall back to the
        // established generic raster-mask form.
        const retainAdjustmentRecipe =
          node.kind === 'adjustment' && hasDepthMaskSource(candidate, node);
        nodes[nodeId] = retainAdjustmentRecipe
          ? node
          : ({
              ...node,
              mask: { ...node.mask!, rasterMask: { ...rasterMask, depthRecipe: undefined } },
            } as SceneNode);
        referencedAssets.add(rasterMask.assetId);
        continue;
      }
    }
    referencedAssets.add(rasterMask.assetId);
    nodes[nodeId] = node;
  }

  const rasterMaskAssets = Object.fromEntries(
    Object.entries(validAssets).filter(
      ([assetId]) => !invalidatedAssets.has(assetId) || referencedAssets.has(assetId),
    ),
  );
  return {
    ...doc,
    nodes,
    rasterMaskAssets: Object.keys(rasterMaskAssets).length > 0 ? rasterMaskAssets : undefined,
  };
}

/**
 * Sanitize Document.iconAssets: drop structurally invalid entries with a
 * warning, then prune entries no longer referenced by any node's
 * `iconAssetId`. Unreferenced assets are safe to drop because the icon's
 * vector data already lives in the node subtree (the asset is provenance
 * metadata, not the payload).
 */
function sanitizeIconAssetState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  if (!doc.iconAssets) return doc;
  const validAssets = Object.fromEntries(
    Object.entries(doc.iconAssets).filter(([assetId, asset]) => {
      const error = validateIconAsset(asset);
      if (!error) return true;
      warnings.push(
        warning('document.invalid-icon-asset', error, 'error', `iconAssets.${assetId}`),
      );
      return false;
    }),
  );
  const referenced = Object.fromEntries(
    Object.entries(validAssets).filter(([assetId]) => isIconAssetReferenced(doc, assetId)),
  );
  return {
    ...doc,
    iconAssets: Object.keys(referenced).length > 0 ? referenced : undefined,
  };
}

/**
 * Sanitize Document.assets (v2.6+, see ./assets.ts): drop structurally
 * invalid entries with a warning, materialize `ImageFillData.src` from the
 * (now-valid) asset table so every downstream reader sees a normal src
 * string, then garbage-collect entries no longer referenced by any node or
 * paint. Mirrors sanitizeRasterMaskState's drop/repair/prune shape above.
 */
/**
 * Maximum inline data URL payload size to auto-register as an asset (10 MB).
 * Larger payloads are logged and left inline to avoid blocking document load.
 */
const MAX_INLINE_ASSET_BYTES = 10_000_000;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
]);

/**
 * Normalize inline image fills — detect images with inline data URLs that
 * lack an assetId, create deduplicated asset entries, and set assetId on
 * the fill. This ensures drag-and-drop, paste, and import-created image
 * fills benefit from content-hash dedup and portable archive packing.
 *
 * Runs as part of DocumentCodec.decode so every loaded document is normalized.
 * The src field is preserved (rehydrateEmbeddedAssetSrc will continue to work);
 * the assetId is added alongside it.
 */
function normalizeInlineImageFills(doc: Document, warnings: DocumentCodecWarning[]): Document {
  let changed = false;
  let assets = doc.assets ? { ...doc.assets } : undefined;

  /**
   * Process a single ImageFillData, creating an asset if it has an inline
   * data URL but no assetId. Returns the (possibly updated) image fill data.
   */
  function processImageFill(
    imageFill: {
      src?: string;
      assetId?: string;
      imageWidth?: number;
      imageHeight?: number;
    },
    nodeId: string,
    fillIndex: number,
  ): void {
    const src = imageFill.src;
    if (!src?.startsWith('data:image/')) return;
    if (imageFill.assetId) return; // already registered

    // Check MIME type
    const mimeType = mimeTypeFromDataUrl(src);
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      warnings.push(
        warning(
          'document.unsupported-inline-image-format',
          `Image fill on node ${nodeId} fill[${fillIndex}] has unsupported format '${mimeType}'`,
          'warning',
          `${nodeId}.fills[${fillIndex}]`,
        ),
      );
      return;
    }

    // Check payload size (approximate from data URL length)
    const payloadStart = src.indexOf(',') + 1;
    const payload = payloadStart > 0 ? src.slice(payloadStart) : '';
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    const approxSize = Math.floor((payload.length * 3) / 4) - padding;
    if (approxSize > MAX_INLINE_ASSET_BYTES) {
      warnings.push(
        warning(
          'document.oversized-inline-image',
          `Image fill on node ${nodeId} fill[${fillIndex}] (${approxSize} bytes) exceeds inline asset limit`,
          'info',
          `${nodeId}.fills[${fillIndex}]`,
        ),
      );
      // Don't block load — leave inline
      return;
    }

    const hash = hashContent(src);
    const assetId = `asset-${hash}`;

    // Check if asset already exists
    if (assets?.[assetId]) {
      imageFill.assetId = assetId;
      changed = true;
      return;
    }

    // Create the asset entry
    if (!assets) assets = {};
    assets[assetId] = {
      id: assetId,
      storage: 'embedded' as const,
      mimeType,
      dataUrl: src,
      naturalWidth: imageFill.imageWidth ?? 0,
      naturalHeight: imageFill.imageHeight ?? 0,
      byteLength: approxSize,
      hash,
    };
    imageFill.assetId = assetId;
    changed = true;
  }

  // Scan all nodes
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (!node?.fills) continue;
    for (let i = 0; i < node.fills.length; i++) {
      const fill = node.fills[i];
      if (fill?.type === 'image' && fill.image) {
        processImageFill(fill.image, nodeId, i);
      }
    }
  }

  // Scan shared paints
  if (doc.paints) {
    for (const [paintId, paint] of Object.entries(doc.paints)) {
      if (paint.fill?.type === 'image' && paint.fill.image) {
        processImageFill(paint.fill.image, `paint:${paintId}`, 0);
      }
    }
  }

  if (!changed) return doc;
  return { ...doc, assets };
}

function sanitizeImageAssetState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  const validAssets = Object.fromEntries(
    Object.entries(doc.assets ?? {}).filter(([assetId, asset]) => {
      const error = validateDocumentAsset(asset);
      if (!error) return true;
      warnings.push(warning('document.invalid-image-asset', error, 'error', `assets.${assetId}`));
      return false;
    }),
  );
  const withValidAssets: Document = {
    ...doc,
    assets: Object.keys(validAssets).length > 0 ? validAssets : undefined,
  };
  const rehydrated = rehydrateEmbeddedAssetSrc(
    withValidAssets as unknown as Record<string, unknown>,
  ) as unknown as Document;

  const referencedAssets = Object.fromEntries(
    Object.entries(validAssets).filter(([assetId]) => isAssetReferenced(rehydrated, assetId)),
  );
  // ICC profiles are validated and pruned with the same pass: an entry with
  // invalid payload is dropped (with a warning), and entries no longer
  // referenced by any surviving asset metadata are garbage-collected.
  const validProfiles = Object.fromEntries(
    Object.entries(rehydrated.iccProfiles ?? {}).filter(([profileId, entry]) => {
      const error = validateIccProfileEntry(entry);
      if (!error) return true;
      warnings.push(
        warning('document.invalid-icc-profile', error, 'error', `iccProfiles.${profileId}`),
      );
      return false;
    }),
  );
  const withProfiles = {
    ...rehydrated,
    iccProfiles: Object.keys(validProfiles).length > 0 ? validProfiles : undefined,
  };
  const prunedProfiles = pruneUnusedIccProfiles(withProfiles);
  return {
    ...prunedProfiles,
    assets: Object.keys(referencedAssets).length > 0 ? referencedAssets : undefined,
  };
}

function normalizeImageFillGeometry(doc: Document): Document {
  const normalizeImage = (image: NonNullable<SceneNode['fills']>[number]['image']) => {
    if (!image) return image;
    const asset = image.assetId ? doc.assets?.[image.assetId] : undefined;
    return normalizeImageFillData(
      image,
      asset ? { width: asset.naturalWidth, height: asset.naturalHeight } : undefined,
    );
  };
  const nodes = Object.fromEntries(
    Object.entries(doc.nodes).map(([nodeId, node]) => [
      nodeId,
      node.fills
        ? {
            ...node,
            fills: node.fills.map((fill) =>
              fill.type === 'image' && fill.image
                ? { ...fill, image: normalizeImage(fill.image) }
                : fill,
            ),
          }
        : node,
    ]),
  ) as Record<NodeId, SceneNode>;
  const paints = doc.paints
    ? Object.fromEntries(
        Object.entries(doc.paints).map(([paintId, paint]) => [
          paintId,
          paint.fill.type === 'image' && paint.fill.image
            ? {
                ...paint,
                fill: { ...paint.fill, image: normalizeImage(paint.fill.image) },
              }
            : paint,
        ]),
      )
    : undefined;

  return {
    ...doc,
    nodes,
    ...(paints ? { paints } : {}),
  };
}

/** Validate photographic source bindings without discarding unknown operations. */
function validatePhotoSourceState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    for (const [fillIndex, fill] of (node.fills ?? []).entries()) {
      if (fill.type !== 'image' || !fill.image?.photoSource) continue;
      const binding = fill.image.photoSource;
      const validation = validatePhotoSourceBinding(binding);
      if (!validation.valid) {
        warnings.push(
          warning(
            'document.invalid-photo-source',
            `Photo source binding was retained for manual recovery: ${validation.errors.join('; ')}`,
            'warning',
            `nodes.${nodeId}.fills.${fillIndex}.image.photoSource`,
          ),
        );
        continue;
      }
      const missingSources = binding.sourceAssetIds.filter((assetId) => !doc.assets?.[assetId]);
      if (!doc.assets?.[binding.derivedAssetId]) missingSources.push(binding.derivedAssetId);
      if (binding.masterAssetId && !doc.assets?.[binding.masterAssetId]) {
        missingSources.push(binding.masterAssetId);
      }
      if (missingSources.length > 0) {
        warnings.push(
          warning(
            'document.missing-photo-source-assets',
            `Photo source binding references missing asset(s): ${missingSources.join(', ')}`,
            'warning',
            `nodes.${nodeId}.fills.${fillIndex}.image.photoSource`,
          ),
        );
      }
    }
  }
  return doc;
}

/** Keep baked repair metadata recoverable while surfacing malformed ownership. */
function validateRetouchProvenanceState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (node.kind !== 'rasterLayer' || !node.retouchProvenance) continue;
    const provenance = node.retouchProvenance;
    const validation = validateRetouchProvenance(provenance);
    if (!validation.valid) {
      warnings.push(
        warning(
          'document.invalid-retouch-provenance',
          `Retouch provenance was retained for manual recovery: ${validation.errors.join('; ')}`,
          'warning',
          `nodes.${nodeId}.retouchProvenance`,
        ),
      );
      continue;
    }
    if (!doc.nodes[provenance.sourceNodeId]) {
      warnings.push(
        warning(
          'document.missing-retouch-source',
          `Retouch layer ${nodeId} references missing source node ${provenance.sourceNodeId}; its pixels were retained`,
          'warning',
          `nodes.${nodeId}.retouchProvenance.sourceNodeId`,
        ),
      );
    }
  }
  return doc;
}

function normalizeRasterTiles(
  nodeId: NodeId,
  node: SceneNode,
  warnings: DocumentCodecWarning[],
): SceneNode {
  if (node.kind !== 'rasterLayer') return node;
  if (node.tiles instanceof Map) return node;

  const rawTiles = (node as unknown as { tiles?: unknown }).tiles;
  if (!isRecord(rawTiles)) {
    warnings.push(
      warning(
        'document.raster-tiles-missing',
        `Raster layer ${nodeId} had no valid tile collection; it was opened empty`,
        'warning',
        `${nodeId}.tiles`,
      ),
    );
    return { ...node, tiles: new Map() };
  }

  const tiles = deserializeTiles(rawTiles as SerializableTiles);
  if (Object.keys(rawTiles).length !== tiles.size) {
    warnings.push(
      warning(
        'document.raster-tiles-repaired',
        `Raster layer ${nodeId} contained invalid tile data; invalid tiles were discarded`,
        'warning',
        `${nodeId}.tiles`,
      ),
    );
  }
  return { ...node, tiles };
}

function isSupportedClipSource(node: SceneNode | undefined): boolean {
  if (!node) return false;
  if (node.kind === 'frame') return true;
  if (node.kind !== 'shape') return false;
  return (
    node.shape.kind !== 'line' &&
    node.shape.kind !== 'arrow' &&
    (node.shape.kind !== 'path' || node.shape.closed)
  );
}

/**
 * Recover malformed structural masks at the persistence boundary. Keeping the
 * container and its children is lossless; only the unusable relationship is
 * removed, with a warning callers can surface to the user.
 */
function sanitizeStructuralMaskState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  let changed = false;
  const nodes: Record<NodeId, SceneNode> = { ...doc.nodes };
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    const mask = node.mask;
    if (!mask || mask.rasterMask) continue;

    let error = validateMaskSource(doc, mask);
    if (!error && !['clip', 'alpha', 'luminance'].includes(mask.type)) {
      error = 'Mask type is unsupported';
    }
    if (!error && mask.vectorMask && !mask.vectorMask.closed) {
      error = 'Vector masks must use a closed path';
    }
    if (!error && mask.sourceNodeId) {
      const source = doc.nodes[mask.sourceNodeId];
      if (!source) {
        error = `Missing mask source ${mask.sourceNodeId}`;
      } else if (isContainer(node) && !node.children.includes(mask.sourceNodeId)) {
        error = `Mask source ${mask.sourceNodeId} must be a direct child of ${nodeId}`;
      } else if (mask.type === 'clip' && !mask.vectorMask && !isSupportedClipSource(source)) {
        error = `Mask source ${mask.sourceNodeId} cannot produce a closed clipping outline`;
      }
    }
    if (!error) continue;

    const { mask: _invalidMask, ...rest } = node;
    nodes[nodeId] = rest as SceneNode;
    changed = true;
    warnings.push(
      warning(
        'document.invalid-structural-mask',
        `${nodeId}: ${error}`,
        'warning',
        `${nodeId}.mask`,
      ),
    );
  }
  return changed ? { ...doc, nodes } : doc;
}

function normalizeDocument(doc: Document): DocumentNormalizeResult {
  const warnings = malformedLegacyBackgroundRemovalWarnings(
    doc as unknown as Record<string, unknown>,
  );
  const safeNodes: Record<NodeId, SceneNode> = {};
  for (const [nodeId, node] of Object.entries(doc.nodes ?? {}) as [string, unknown][]) {
    if (isRecord(node)) {
      safeNodes[nodeId] = node as unknown as SceneNode;
    } else {
      warnings.push(
        warning(
          'document.invalid-node',
          `Document node ${nodeId} was not an object and was removed`,
          'error',
          `nodes.${nodeId}`,
        ),
      );
    }
  }
  doc = { ...doc, nodes: safeNodes };
  doc = normalizeLayerColors(doc as unknown as Record<string, unknown>) as unknown as Document;
  doc = normalizeLegacyBackgroundRemoval(
    doc as unknown as Record<string, unknown>,
  ) as unknown as Document;
  const nodes: Record<NodeId, SceneNode> = {};

  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!node || node.id !== id) {
      warnings.push(
        warning('document.node-id-normalized', `Node ${id} had a mismatched id`, 'warning', id),
      );
    }

    const nodeWithStrokeIds =
      'strokes' in node
        ? ({
            ...node,
            strokes: normalizeStrokeIds(
              id,
              (node as SceneNode & { strokes?: import('./types').Stroke[] }).strokes,
            ),
          } as SceneNode)
        : node;

    const rawChildren = (nodeWithStrokeIds as { children?: unknown }).children;
    if (isContainer(nodeWithStrokeIds) || Array.isArray(rawChildren)) {
      const children: NodeId[] = [];
      for (const childId of traversalChildren(nodeWithStrokeIds)) {
        if (doc.nodes[childId]) {
          children.push(childId);
        } else {
          warnings.push(
            warning(
              'document.orphan-child',
              `Container ${id} referenced missing child ${childId}`,
              'warning',
              `${id}.children`,
            ),
          );
        }
      }
      nodes[id] = { ...nodeWithStrokeIds, id, children } as SceneNode;
    } else if (nodeWithStrokeIds.kind === 'table') {
      // Tables carry embedded models that must satisfy span invariants on
      // load; repair defensively instead of trusting serialized data.
      const tableNode = nodeWithStrokeIds as unknown as Record<string, unknown>;
      const tableRaw = tableNode.table;
      const { model, issues } = normalizeTableModelDefensively(tableRaw);
      if (!model) {
        warnings.push(
          warning(
            'document.invalid-table',
            `Table node ${id} has no valid table model`,
            'warning',
            id,
          ),
        );
        nodes[id] = { ...nodeWithStrokeIds, id, table: emptyTableModel() } as SceneNode;
      } else {
        if (issues.length > 0) {
          warnings.push(
            warning(
              'document.table-repaired',
              `Table node ${id} was repaired (${issues.length} issue(s))`,
              'warning',
              `${id}.table`,
            ),
          );
        }
        nodes[id] = { ...nodeWithStrokeIds, id, table: model } as SceneNode;
      }
    } else {
      nodes[id] = normalizeRasterTiles(id, { ...nodeWithStrokeIds, id } as SceneNode, warnings);
    }
  }

  const rootChildren: NodeId[] = [];
  for (const rootId of doc.rootChildren) {
    if (nodes[rootId]) {
      rootChildren.push(rootId);
    } else {
      warnings.push(
        warning('document.orphan-root', `Root referenced missing node ${rootId}`, 'warning'),
      );
    }
  }

  let pages: Page[] | undefined;
  if (doc.pages) {
    pages = [];
    for (const page of doc.pages) {
      if (!nodes[page.contentRoot]) {
        nodes[page.contentRoot] = makeGroupNode(page.contentRoot, {
          name: `${page.name} content`,
          children: [],
        });
        warnings.push(
          warning(
            'document.page-content-root-missing',
            `Page ${page.id} referenced missing content root ${page.contentRoot}; an empty content root was created`,
            'warning',
            `pages.${page.id}.contentRoot`,
          ),
        );
      }

      const backgrounds: NodeId[] = [];
      for (const backgroundId of page.backgrounds) {
        if (nodes[backgroundId]) {
          backgrounds.push(backgroundId);
        } else {
          warnings.push(
            warning(
              'document.page-background-missing',
              `Page ${page.id} referenced missing background ${backgroundId}`,
              'warning',
              `pages.${page.id}.backgrounds`,
            ),
          );
        }
      }

      pages.push({ ...page, backgrounds });
      if (!rootChildren.includes(page.contentRoot)) {
        rootChildren.push(page.contentRoot);
        warnings.push(
          warning(
            'document.page-content-root-rooted',
            `Page ${page.id} content root ${page.contentRoot} was restored to rootChildren`,
            'warning',
            `pages.${page.id}.contentRoot`,
          ),
        );
      }
    }
  }

  const activePageId =
    pages && pages.length > 0
      ? pages.some((page) => page.id === doc.activePageId)
        ? doc.activePageId
        : pages[0]?.id
      : undefined;
  if (doc.activePageId !== activePageId) {
    warnings.push(
      warning(
        'document.active-page-normalized',
        activePageId
          ? `Active page normalized to ${activePageId}`
          : 'Active page cleared because the document has no valid pages',
        'warning',
        'activePageId',
      ),
    );
  }

  const minNextId = maxNumericNodeId(nodes) + 1;
  const nextId = Math.max(doc.nextId, minNextId, 1);

  let document: Document = {
    ...doc,
    formatVersion: CURRENT_DOCUMENT_VERSION,
    rootChildren,
    nodes,
    nextId,
    components: doc.components ?? {},
    pages,
    activePageId,
  };
  document = normalizeImageFillGeometry(document);
  document = normalizeInlineImageFills(document, warnings);
  document = sanitizeStructuralMaskState(document, warnings);
  document = sanitizeRasterMaskState(document, warnings);
  document = sanitizeImageAssetState(document, warnings);
  document = validatePhotoSourceState(document, warnings);
  document = validateRetouchProvenanceState(document, warnings);
  document = sanitizeIconAssetState(document, warnings);
  document = sanitizeMockupState(document, warnings);
  document = normalizeDocumentEffects(document);
  document = { ...document, generativeEdits: normalizeGenerativeEdits(document.generativeEdits) };

  const savedSelections = normalizeSavedAreaSelections(document.savedAreaSelections);
  document = { ...document, savedAreaSelections: savedSelections.selections };
  if (savedSelections.dropped > 0) {
    warnings.push(
      warning(
        'document.invalid-saved-selection',
        `Dropped ${savedSelections.dropped} malformed saved area selection${savedSelections.dropped === 1 ? '' : 's'}`,
        'warning',
        'savedAreaSelections',
      ),
    );
  }

  // Adjustment and object-local filter entries share the engine's FilterIR
  // contract, but they are still persisted scene data and need the same
  // defensive normalization as legacy visual effects. Without this pass a
  // malformed NaN/Infinity value can reach a kernel or a raster allocation.
  const normalizedNodes: Record<NodeId, SceneNode> = {};
  for (const [nodeId, node] of Object.entries(document.nodes)) {
    let nextNode = node;
    if (node.kind === 'adjustment' && node.adjustments !== undefined) {
      const result = normalizeAdjustmentStack(node.adjustments, nodeId);
      if (result.changed) {
        nextNode = { ...nextNode, adjustments: result.adjustments } as SceneNode;
      }
      if (result.dropped > 0) {
        warnings.push(
          warning(
            'document.invalid-adjustment',
            `Adjustment layer ${nodeId} dropped ${result.dropped} malformed filter entr${result.dropped === 1 ? 'y' : 'ies'}`,
            'warning',
            `${nodeId}.adjustments`,
          ),
        );
      }
      if (result.unknown > 0) {
        warnings.push(
          warning(
            'document.unknown-adjustment',
            `Adjustment layer ${nodeId} preserved ${result.unknown} unsupported filter entr${result.unknown === 1 ? 'y' : 'ies'} as pass-through content`,
            'info',
            `${nodeId}.adjustments`,
          ),
        );
      }
    }
    if (nextNode.smartFilters !== undefined) {
      const result = normalizeAdjustmentStack(nextNode.smartFilters, nodeId);
      if (result.changed) {
        nextNode = { ...nextNode, smartFilters: result.adjustments } as SceneNode;
      }
      if (result.dropped > 0) {
        warnings.push(
          warning(
            'document.invalid-smart-filter',
            `Object filter stack on ${nodeId} dropped ${result.dropped} malformed filter entr${result.dropped === 1 ? 'y' : 'ies'}`,
            'warning',
            `${nodeId}.smartFilters`,
          ),
        );
      }
      if (result.unknown > 0) {
        warnings.push(
          warning(
            'document.unknown-smart-filter',
            `Object Filter stack on ${nodeId} preserved ${result.unknown} unsupported filter entr${result.unknown === 1 ? 'y' : 'ies'} as pass-through content`,
            'info',
            `${nodeId}.smartFilters`,
          ),
        );
      }
    }
    normalizedNodes[nodeId] = nextNode;
  }
  document = { ...document, nodes: normalizedNodes };
  const effectLooks = normalizeEffectLooks(document.effectLooks);
  if (effectLooks !== undefined) document = { ...document, effectLooks };
  if (!document.selectionSets) {
    document = { ...document, selectionSets: createEmptySelectionSetsData() };
  }
  if (document.logoProject !== undefined) {
    document = { ...document, logoProject: normalizeLogoProject(document.logoProject) };
  }
  return { document, warnings };
}

function collectNodeClosure(doc: Document, rootIds: NodeId[]): DocumentClosure {
  const nodeIds = new Set<NodeId>();
  const nodes: Record<NodeId, SceneNode> = {};

  function visit(id: NodeId): void {
    const pending = [id];
    while (pending.length > 0) {
      const currentId = pending.pop()!;
      if (nodeIds.has(currentId)) continue;
      const node = doc.nodes[currentId];
      if (!node) continue;
      nodeIds.add(currentId);
      nodes[currentId] = node;
      if (isContainer(node)) {
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          pending.push(node.children[index]!);
        }
      }
      // Table cell scene content is intentionally outside the table's child
      // list. It is still part of the editable closure and must travel with
      // the table without becoming an additional visible paste root.
      if (node.kind === 'table') {
        for (const contentId of tableContentNodeIds(node.table)) pending.push(contentId);
      }
    }
  }

  for (const id of rootIds) visit(id);

  const visitFillReferences = (fill: unknown): void => {
    if (!fill || typeof fill !== 'object') return;
    const pattern = (fill as { pattern?: { tileSrc?: unknown } }).pattern;
    if (typeof pattern?.tileSrc === 'string' && doc.nodes[pattern.tileSrc]) {
      visit(pattern.tileSrc);
    }
  };

  // Component masters, path-text targets, linked-story frames, masks, table
  // cell content, and interaction/motion targets are dependencies rather than
  // visible paste roots. Keep discovering those dependencies iteratively so a
  // copied fragment remains editable without turning support nodes into
  // additional top-level pastes.
  let scanned = 0;
  while (scanned < nodeIds.size) {
    const pending = [...nodeIds];
    const id = pending[scanned++];
    if (!id) continue;
    const node = nodes[id];
    if (!node) continue;
    const candidate = node as SceneNode & {
      componentId?: NodeId;
      pathId?: NodeId;
      pathTextSettings?: { pathNodeId?: NodeId };
      storyBinding?: { storyId?: NodeId };
      slots?: Record<string, NodeId>;
      propertyOverrides?: Record<string, string | boolean | NodeId>;
      mask?: {
        sourceNodeId?: NodeId;
        matteSource?: { kind?: string; nodeId?: NodeId };
        rasterMask?: { depthRecipe?: { sourceBinding?: { nodeId?: NodeId } } };
      };
      effects?: Array<{ mask?: { source?: { kind?: string; nodeId?: NodeId } } }>;
    };
    const component = candidate.componentId ? doc.components[candidate.componentId] : undefined;
    if (component) {
      visit(component.masterRootId);
      for (const slot of component.slots) {
        if (slot.defaultContentId) visit(slot.defaultContentId);
      }
      for (const property of component.properties ?? []) {
        if (typeof property.defaultValue === 'string' && doc.nodes[property.defaultValue]) {
          visit(property.defaultValue);
        }
      }
      for (const variant of component.variants ?? []) {
        for (const value of Object.values(variant.propertyValues)) {
          if (typeof value === 'string' && doc.nodes[value]) visit(value);
        }
      }
    }
    for (const childId of Object.values(candidate.slots ?? {})) visit(childId);
    for (const value of Object.values(candidate.propertyOverrides ?? {})) {
      if (typeof value === 'string') visit(value);
    }
    if (candidate.pathId) visit(candidate.pathId);
    if (candidate.pathTextSettings?.pathNodeId) visit(candidate.pathTextSettings.pathNodeId);
    if (candidate.mask?.sourceNodeId) visit(candidate.mask.sourceNodeId);
    if (candidate.mask?.matteSource?.kind === 'scene-node' && candidate.mask.matteSource.nodeId) {
      visit(candidate.mask.matteSource.nodeId);
    }
    if (candidate.mask?.rasterMask?.depthRecipe?.sourceBinding?.nodeId) {
      visit(candidate.mask.rasterMask.depthRecipe.sourceBinding.nodeId);
    }
    for (const effect of candidate.effects ?? []) {
      if (effect.mask?.source?.kind === 'scene-node' && effect.mask.source.nodeId) {
        visit(effect.mask.source.nodeId);
      }
    }
    if (candidate.kind === 'frame' && candidate.mockup) {
      for (const binding of Object.values(candidate.mockup.surfaceBindings)) {
        if (binding.mode === 'live' && binding.nodeId) visit(binding.nodeId);
      }
    }
    for (const fill of candidate.fills ?? []) visitFillReferences(fill);
    if (candidate.styleId) {
      const style = doc.styles?.[candidate.styleId];
      if (style?.type === 'color') visitFillReferences(style.fill);
      if (style?.type === 'effect') {
        for (const effect of style.effects) {
          if (effect.mask?.source.kind === 'scene-node') visit(effect.mask.source.nodeId);
        }
      }
    }
    for (const paintId of candidate.paintRefs ?? []) {
      const paint = doc.paints?.[paintId];
      if (paint) visitFillReferences(paint.fill);
    }
    const storyId = candidate.storyBinding?.storyId;
    const story = storyId ? doc.stories?.[storyId] : undefined;
    if (story) for (const frameId of story.thread) visit(frameId);

    // Interaction payloads are intentionally open-ended, but these keys are
    // the supported node-reference positions. Walking them here preserves a
    // cross-root prototype link while avoiding accidental treatment of labels
    // or arbitrary string values as node IDs.
    const visitInteractionRefs = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) visitInteractionRefs(entry);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        if (
          (childKey === 'nodeId' ||
            childKey === 'targetId' ||
            childKey === 'overlayId' ||
            childKey === 'newTargetId' ||
            childKey === 'containerId') &&
          typeof childValue === 'string'
        ) {
          visit(childValue);
        } else {
          visitInteractionRefs(childValue);
        }
      }
    };
    for (const interaction of doc.interactions?.[id] ?? []) visitInteractionRefs(interaction);

    for (const timeline of Object.values(doc.timelines ?? {})) {
      if (timeline.tracks.some((track) => track.nodeId === id)) {
        for (const track of timeline.tracks) visit(track.nodeId);
      }
    }

    for (const edit of Object.values(doc.generativeEdits ?? {})) {
      if (edit.sourceNodeId === id || edit.resultNodeId === id) {
        visit(edit.sourceNodeId);
        if (edit.resultNodeId) visit(edit.resultNodeId);
      }
    }
  }

  const components: NonNullable<Document['components']> = {};
  const styles: NonNullable<Document['styles']> = {};
  const paints: NonNullable<Document['paints']> = {};
  const interactions: NonNullable<Document['interactions']> = {};
  const stories: NonNullable<Document['stories']> = {};
  const timelines: NonNullable<Document['timelines']> = {};
  const motionExtensions: NonNullable<Document['motionExtensions']> = {};
  const motionPresets: NonNullable<Document['motionPresets']> = {};
  const variableIds = new Set<string>();
  const collectionIds = new Set<string>();
  const timelineIds = new Set<string>();
  for (const node of Object.values(nodes)) {
    const candidate = node as SceneNode & {
      componentId?: NodeId;
      styleId?: string;
      paintRefs?: string[];
      bindings?: Record<string, { variableId?: string }>;
      storyBinding?: { storyId?: NodeId };
    };
    if (candidate.componentId) {
      const component = doc.components[candidate.componentId];
      if (component && nodeIds.has(component.masterRootId)) components[component.id] = component;
    }
    if (candidate.styleId && doc.styles?.[candidate.styleId]) {
      styles[candidate.styleId] = doc.styles[candidate.styleId]!;
    }
    for (const paintId of candidate.paintRefs ?? []) {
      const paint = doc.paints?.[paintId];
      if (paint) paints[paintId] = paint;
    }
    for (const binding of Object.values(candidate.bindings ?? {})) {
      if (binding.variableId) variableIds.add(binding.variableId);
    }
    const nodeInteractions = doc.interactions?.[node.id];
    if (nodeInteractions) interactions[node.id] = nodeInteractions;
    const storyId = candidate.storyBinding?.storyId;
    if (storyId && doc.stories?.[storyId]) stories[storyId] = doc.stories[storyId]!;
    for (const [timelineId, timeline] of Object.entries(doc.timelines ?? {})) {
      if (timeline.tracks.some((track) => nodeIds.has(track.nodeId))) {
        timelineIds.add(timelineId);
        timelines[timelineId] = timeline;
      }
    }
  }
  // Include nested motion timelines and the variable collections/aliases that
  // own every referenced variable. Alias values may use either a variable id
  // or its authored name, and may cross collection boundaries, so resolve the
  // transitive chain before slicing the store.
  let changed = true;
  while (changed) {
    changed = false;
    for (const timeline of Object.values(timelines)) {
      for (const track of timeline.tracks) {
        if (track.nestedTimelineId && !timelineIds.has(track.nestedTimelineId)) {
          const nested = doc.timelines?.[track.nestedTimelineId];
          if (nested) {
            timelineIds.add(nested.id);
            timelines[nested.id] = nested;
            changed = true;
          }
        }
      }
    }
  }
  const variableStoreSource = doc.variableStore;
  const variableByName = new Map(
    Object.values(variableStoreSource?.variables ?? {}).map((variable) => [
      variable.name,
      variable,
    ]),
  );
  const collectionVariableIds = (
    collection: NonNullable<Document['variableStore']>['collections'][string],
  ) => {
    const ids = [...collection.variableIds];
    const walkGroups = (groups: typeof collection.groups): void => {
      for (const group of groups ?? []) {
        ids.push(...group.variableIds);
        walkGroups(group.groups);
      }
    };
    walkGroups(collection.groups);
    return ids;
  };
  let variableClosureChanged = true;
  while (variableClosureChanged) {
    variableClosureChanged = false;
    for (const id of [...variableIds]) {
      const variable = variableStoreSource?.variables[id];
      if (!variable) continue;
      for (const raw of Object.values(variable.valuesByMode)) {
        if (typeof raw !== 'string') continue;
        for (const match of raw.matchAll(/\{([^}]+)\}/g)) {
          const target = variableStoreSource?.variables[match[1]!] ?? variableByName.get(match[1]!);
          if (target && !variableIds.has(target.id)) {
            variableIds.add(target.id);
            variableClosureChanged = true;
          }
        }
      }
    }
    for (const collection of Object.values(variableStoreSource?.collections ?? {})) {
      if (!collectionVariableIds(collection).some((id) => variableIds.has(id))) continue;
      if (!collectionIds.has(collection.id)) {
        collectionIds.add(collection.id);
        variableClosureChanged = true;
      }
      for (const variableId of collectionVariableIds(collection)) {
        if (!variableIds.has(variableId)) {
          variableIds.add(variableId);
          variableClosureChanged = true;
        }
      }
    }
  }
  const variableStore = doc.variableStore
    ? {
        ...doc.variableStore,
        variables: Object.fromEntries(
          Object.entries(doc.variableStore.variables).filter(([id]) => variableIds.has(id)),
        ),
        collections: Object.fromEntries(
          Object.entries(doc.variableStore.collections).filter(([id]) => collectionIds.has(id)),
        ),
        activeCollectionId: collectionIds.has(doc.variableStore.activeCollectionId)
          ? doc.variableStore.activeCollectionId
          : '',
      }
    : undefined;
  for (const [id, extension] of Object.entries(doc.motionExtensions ?? {})) {
    if (nodeIds.has(extension.nodeId)) motionExtensions[id] = extension;
  }
  for (const [id, preset] of Object.entries(doc.motionPresets ?? {})) {
    if (timelineIds.has(preset.timelineId)) motionPresets[id] = preset;
  }
  const rasterMaskAssets: NonNullable<Document['rasterMaskAssets']> = {};
  const depthMapIds = new Set<string>();
  for (const node of Object.values(nodes)) {
    const assetId = node.mask?.rasterMask?.assetId;
    const asset = assetId ? getOwnRasterMaskAsset(doc, assetId) : undefined;
    if (assetId && asset) rasterMaskAssets[assetId] = asset;
    const correctionAssetId = node.mask?.rasterMask?.depthRecipe?.correction?.assetId;
    const correctionAsset = correctionAssetId
      ? getOwnRasterMaskAsset(doc, correctionAssetId)
      : undefined;
    if (correctionAsset) rasterMaskAssets[correctionAsset.id] = correctionAsset;
    const recipeDepthMapId = node.mask?.rasterMask?.depthRecipe?.depthMapId;
    if (recipeDepthMapId) depthMapIds.add(recipeDepthMapId);
    for (const effect of ('effects' in node ? node.effects : []) ?? []) {
      if (effect.type === 'depthBlur') depthMapIds.add(effect.depthMapId);
    }
  }
  const depthMaps: NonNullable<Document['depthMaps']> = {};
  for (const id of depthMapIds) {
    const resource = doc.depthMaps?.[id];
    if (resource) depthMaps[id] = resource;
  }
  const assets: NonNullable<Document['assets']> = {};
  for (const node of Object.values(nodes)) {
    for (const fill of node.fills ?? []) {
      const assetId = fill.type === 'image' ? fill.image?.assetId : undefined;
      const asset = assetId ? doc.assets?.[assetId] : undefined;
      if (assetId && asset) assets[assetId] = asset;
    }
    if (node.kind === 'frame' && node.mockup) {
      for (const binding of Object.values(node.mockup.surfaceBindings)) {
        const asset =
          binding.mode === 'snapshot' && binding.assetId
            ? doc.assets?.[binding.assetId]
            : undefined;
        if (asset) assets[asset.id] = asset;
      }
    }
  }
  const iconAssets: NonNullable<Document['iconAssets']> = {};
  for (const node of Object.values(nodes)) {
    const assetId = node.iconAssetId;
    const asset = assetId ? doc.iconAssets?.[assetId] : undefined;
    if (assetId && asset) iconAssets[assetId] = asset;
  }
  const mockupTemplates: NonNullable<Document['mockupTemplates']> = {};
  for (const node of Object.values(nodes)) {
    if (node.kind !== 'frame' || !node.mockup) continue;
    const template = node.mockup.templateId
      ? doc.mockupTemplates?.[node.mockup.templateId]
      : undefined;
    if (template) mockupTemplates[template.id] = template;
  }
  // Template-referenced raster assets (photographic plate, clip/occlusion
  // coverage) are part of the resource closure even though no node fill
  // points at them directly.
  for (const template of Object.values(mockupTemplates)) {
    const referenced = [
      template.plateImage?.assetId,
      ...template.surfaces.flatMap((surface) => [
        surface.clipMaskAssetId,
        surface.occlusionMaskAssetId,
      ]),
    ];
    for (const assetId of referenced) {
      const asset = assetId ? doc.assets?.[assetId] : undefined;
      if (assetId && asset) assets[assetId] = asset;
    }
  }
  const generativeEdits: NonNullable<Document['generativeEdits']> = {};
  for (const [editId, edit] of Object.entries(doc.generativeEdits ?? {})) {
    if (nodeIds.has(edit.sourceNodeId) || (edit.resultNodeId && nodeIds.has(edit.resultNodeId))) {
      generativeEdits[editId] = edit;
      for (const variation of edit.variations) {
        const asset = doc.assets?.[variation.assetId];
        if (asset) assets[asset.id] = asset;
        if (variation.thumbnailAssetId) {
          const thumbnail = doc.assets?.[variation.thumbnailAssetId];
          if (thumbnail) assets[thumbnail.id] = thumbnail;
        }
        if (variation.contextAssetId) {
          const context = doc.assets?.[variation.contextAssetId];
          if (context) assets[context.id] = context;
        }
      }
      const maskIds = [
        edit.maskAssetId,
        edit.masks.userMaskAssetId,
        edit.masks.inferenceMaskAssetId,
        edit.masks.compositeMaskAssetId,
      ];
      for (const maskId of maskIds) {
        if (maskId) {
          const mask = getOwnRasterMaskAsset(doc, maskId);
          if (mask) rasterMaskAssets[mask.id] = mask;
        }
      }
      for (const sourceAssetId of [edit.sourceAssetId, edit.sourceSnapshotAssetId]) {
        const sourceAsset = sourceAssetId ? doc.assets?.[sourceAssetId] : undefined;
        if (sourceAsset) assets[sourceAsset.id] = sourceAsset;
      }
    }
  }
  const fontManifest = collectFontManifestClosure(doc, nodes, styles);
  return {
    nodeIds,
    nodes,
    ...(fontManifest ? { fontManifest } : {}),
    components: Object.keys(components).length > 0 ? components : undefined,
    styles: Object.keys(styles).length > 0 ? styles : undefined,
    paints: Object.keys(paints).length > 0 ? paints : undefined,
    variableStore:
      variableStore && Object.keys(variableStore.variables).length > 0 ? variableStore : undefined,
    interactions: Object.keys(interactions).length > 0 ? interactions : undefined,
    timelines: Object.keys(timelines).length > 0 ? timelines : undefined,
    stories: Object.keys(stories).length > 0 ? stories : undefined,
    motionExtensions: Object.keys(motionExtensions).length > 0 ? motionExtensions : undefined,
    motionPresets: Object.keys(motionPresets).length > 0 ? motionPresets : undefined,
    rasterMaskAssets: Object.keys(rasterMaskAssets).length > 0 ? rasterMaskAssets : undefined,
    depthMaps: Object.keys(depthMaps).length > 0 ? depthMaps : undefined,
    assets: Object.keys(assets).length > 0 ? assets : undefined,
    iconAssets: Object.keys(iconAssets).length > 0 ? iconAssets : undefined,
    mockupTemplates: Object.keys(mockupTemplates).length > 0 ? mockupTemplates : undefined,
    generativeEdits: Object.keys(generativeEdits).length > 0 ? generativeEdits : undefined,
  };
}

/**
 * Keep the font manifest scoped to the transported resource closure. A full
 * document manifest must not leak unrelated font metadata into a clipboard
 * fragment, while legacy family-only entries still need to travel with the
 * text so the receiving document can report the unresolved request honestly.
 */
function collectFontManifestClosure(
  doc: Document,
  nodes: Record<NodeId, SceneNode>,
  styles: NonNullable<Document['styles']>,
): Document['fontManifest'] | undefined {
  const manifest = doc.fontManifest;
  if (!manifest) return undefined;

  const required = new Set<string>();
  const families = new Set<string>();
  const add = (family: string | undefined, reference: unknown): void => {
    const normalized = family?.trim().toLowerCase();
    if (!normalized) return;
    families.add(normalized);
    if (
      reference &&
      typeof reference === 'object' &&
      typeof (reference as { artifactHash?: unknown }).artifactHash === 'string'
    ) {
      const candidate = reference as { artifactHash: string; collectionIndex?: number };
      required.add(
        `${normalized}\u0000${candidate.artifactHash.toLowerCase()}:${candidate.collectionIndex ?? 'single'}`,
      );
      return;
    }
    required.add(normalized);
  };

  for (const node of Object.values(nodes)) {
    const text = node.kind === 'text' ? node : undefined;
    add(text?.fontFamily, text?.fontReference);
    for (const paragraph of text?.richText?.paragraphs ?? []) {
      for (const run of paragraph.runs ?? []) {
        add(run.format?.fontFamily, run.format?.fontReference);
      }
    }
  }
  for (const style of Object.values(styles)) {
    const candidate = style as unknown as {
      type?: string;
      fontFamily?: string;
      fontReference?: unknown;
      format?: { fontFamily?: string; fontReference?: unknown };
      characterFormat?: { fontFamily?: string; fontReference?: unknown };
    };
    if (candidate.type === 'text') add(candidate.fontFamily, candidate.fontReference);
    add(candidate.format?.fontFamily, candidate.format?.fontReference);
    add(candidate.characterFormat?.fontFamily, candidate.characterFormat?.fontReference);
  }

  const fonts = manifest.fonts.filter((entry) => {
    const family = entry.familyName.trim().toLowerCase();
    if (!families.has(family)) return false;
    if (!entry.fontReference) return families.has(family);
    return required.has(
      `${family}\u0000${entry.fontReference.artifactHash.toLowerCase()}:${entry.fontReference.collectionIndex ?? 'single'}`,
    );
  });
  if (fonts.length === 0) return undefined;
  const relevantFamilies = new Set(fonts.map((entry) => entry.familyName.toLowerCase()));
  const replacements = manifest.replacements?.filter(
    (replacement) =>
      relevantFamilies.has(replacement.original.toLowerCase()) ||
      relevantFamilies.has(replacement.replacement.toLowerCase()),
  );
  return {
    ...manifest,
    fonts,
    ...(replacements && replacements.length > 0 ? { replacements } : {}),
  };
}

export const DocumentCodec = {
  decode(json: string): DocumentDecodeResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid JSON',
        warnings: [warning('document.invalid-json', 'Document JSON could not be parsed', 'error')],
      };
    }

    const legacyWarnings = isRecord(parsed) ? malformedLegacyBackgroundRemovalWarnings(parsed) : [];

    if (isRecord(parsed)) {
      const runtimeError = validateRuntimeCollections(parsed);
      if (runtimeError) {
        return {
          ok: false,
          error: runtimeError,
          warnings: [warning('document.invalid-shape', runtimeError, 'error')],
        };
      }
    }

    const migration = migrateDocumentDetailed(parsed);
    if (!migration) {
      return {
        ok: false,
        error: 'Document payload was not an object',
        warnings: [
          warning('document.invalid-shape', 'Document payload was not an object', 'error'),
        ],
      };
    }

    const shapeError = validateShape(migration.document);
    if (shapeError) {
      return {
        ok: false,
        error: shapeError,
        warnings: [warning('document.invalid-shape', shapeError, 'error')],
      };
    }

    // Parent-graph cycle guard: world-transform composition, render walks,
    // and hit testing must never loop forever on a corrupt document.
    const cycle = findParentCycle(migration.document as unknown as DocumentLike);
    if (cycle) {
      const errorMessage = `Document contains a parent cycle: ${cycle.join(' -> ')}`;
      return {
        ok: false,
        error: errorMessage,
        warnings: [warning('document.parent-cycle', errorMessage, 'error')],
      };
    }

    let maskError: string | null;
    try {
      maskError = validateRasterMaskDocument(migration.document as unknown as Document);
    } catch (error) {
      maskError = `Invalid raster mask structure: ${error instanceof Error ? error.message : 'unknown validation error'}`;
    }
    if (maskError) {
      return {
        ok: false,
        error: maskError,
        warnings: [warning('document.invalid-raster-mask', maskError, 'error')],
      };
    }

    const normalized = normalizeDocument(migration.document as unknown as Document);
    const warnings = [...normalized.warnings];
    for (const legacyWarning of legacyWarnings) {
      if (
        !warnings.some(
          (item) => item.code === legacyWarning.code && item.path === legacyWarning.path,
        )
      ) {
        warnings.push(legacyWarning);
      }
    }
    if (migration.migrated) {
      warnings.unshift(
        warning(
          'document.migrated',
          `Document migrated from ${migration.fromVersion} to ${migration.toVersion}`,
          'info',
        ),
      );
    }
    warnings.unshift(
      ...migration.warnings.map((message) =>
        warning('document.forward-compatibility', message, 'warning'),
      ),
    );

    const repaired = validateAndRepairDocument(normalized.document);
    if (repaired.repaired.changed) {
      warnings.unshift(
        warning('document.repaired', 'Document references were repaired at load time', 'warning'),
      );
    }

    return { ok: true, document: repaired.repaired.doc as Document, warnings };
  },

  encode(doc: Document): string {
    return serializeVersionedDocument(normalizeDocument(doc).document);
  },

  normalize: normalizeDocument,
  collectNodeClosure,
};
