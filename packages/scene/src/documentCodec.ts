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

import {
  hashContent,
  isAssetReferenced,
  mimeTypeFromDataUrl,
  pruneUnusedIccProfiles,
  validateDocumentAsset,
  validateIccProfileEntry,
} from './assets';
import type { Document } from './document';
import { isContainer, makeGroupNode } from './document';
import { normalizeDocumentEffects } from './effects';
import { isIconAssetReferenced, validateIconAsset } from './iconAsset';
import { normalizeLogoProject } from './logo/logoProject';
import {
  getOwnRasterMaskAsset,
  validateMaskSource,
  validateRasterMaskAsset,
  validateRasterMaskDocument,
} from './masks';
import { sanitizeMockupState } from './mockup/normalize';
import { resolveNodePaints } from './paint';
import { createEmptySelectionSetsData } from './selectionSet';
import { emptyTableModel } from './table';
import { normalizeTableModelDefensively } from './tableOps';
import { type NodeId, normalizeImageFillData, type Page, type SceneNode } from './types';
import {
  CURRENT_DOCUMENT_VERSION,
  migrateDocumentDetailed,
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
  rasterMaskAssets?: Document['rasterMaskAssets'];
  /** Image assets (v2.6+) referenced by the closure's nodes — see ./assets.ts. */
  assets?: Document['assets'];
  /** Icon assets referenced by the closure's nodes — see ./iconAsset.ts. */
  iconAssets?: Document['iconAssets'];
  /** Mockup template assets referenced by the closure's nodes (v2.16+). */
  mockupTemplates?: Document['mockupTemplates'];
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
  if (raw.iccProfiles !== undefined) {
    if (!isRecord(raw.iccProfiles)) return 'Document iccProfiles must be an object';
    for (const [profileId, entry] of Object.entries(raw.iccProfiles)) {
      if (!isRecord(entry)) return `ICC profile ${profileId} must be an object`;
    }
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

function sanitizeRasterMaskState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  const validAssets = Object.fromEntries(
    Object.entries(doc.rasterMaskAssets ?? {}).filter(([assetId, asset]) => {
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
    const error =
      validateMaskSource(candidate, node.mask!) ??
      (!hasImageFill(candidate, node) && node.kind !== 'frame'
        ? 'Raster masks may only attach to image-filled shape nodes or frames'
        : null);
    if (error) {
      warnings.push(
        warning('document.invalid-raster-mask', `${nodeId}: ${error}`, 'error', `${nodeId}.mask`),
      );
      invalidatedAssets.add(rasterMask.assetId);
      const { mask: _invalidMask, ...rest } = node;
      nodes[nodeId] = rest as SceneNode;
      continue;
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

    if (isContainer(node)) {
      const children: NodeId[] = [];
      for (const childId of node.children) {
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
      nodes[id] = { ...node, id, children } as SceneNode;
    } else if (node.kind === 'table') {
      // Tables carry embedded models that must satisfy span invariants on
      // load; repair defensively instead of trusting serialized data.
      const tableNode = node as unknown as Record<string, unknown>;
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
        nodes[id] = { ...node, id, table: emptyTableModel() } as SceneNode;
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
        nodes[id] = { ...node, id, table: model } as SceneNode;
      }
    } else {
      nodes[id] = { ...node, id } as SceneNode;
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
  document = sanitizeIconAssetState(document, warnings);
  document = sanitizeMockupState(document, warnings);
  document = normalizeDocumentEffects(document);
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
    if (nodeIds.has(id)) return;
    const node = doc.nodes[id];
    if (!node) return;
    nodeIds.add(id);
    nodes[id] = node;
    if (isContainer(node)) {
      for (const childId of node.children) visit(childId);
    }
  }

  for (const id of rootIds) visit(id);
  const rasterMaskAssets: NonNullable<Document['rasterMaskAssets']> = {};
  for (const node of Object.values(nodes)) {
    const assetId = node.mask?.rasterMask?.assetId;
    const asset = assetId ? getOwnRasterMaskAsset(doc, assetId) : undefined;
    if (assetId && asset) rasterMaskAssets[assetId] = asset;
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
  return {
    nodeIds,
    nodes,
    rasterMaskAssets: Object.keys(rasterMaskAssets).length > 0 ? rasterMaskAssets : undefined,
    assets: Object.keys(assets).length > 0 ? assets : undefined,
    iconAssets: Object.keys(iconAssets).length > 0 ? iconAssets : undefined,
    mockupTemplates: Object.keys(mockupTemplates).length > 0 ? mockupTemplates : undefined,
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

    return { ok: true, document: normalized.document, warnings };
  },

  encode(doc: Document): string {
    return serializeVersionedDocument(normalizeDocument(doc).document);
  },

  normalize: normalizeDocument,
  collectNodeClosure,
};
