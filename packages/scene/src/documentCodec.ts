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

import type { Document } from './document';
import { isContainer, makeGroupNode } from './document';
import { validateMaskSource, validateRasterMaskAsset, validateRasterMaskDocument } from './masks';
import type { NodeId, Page, SceneNode } from './types';
import {
  CURRENT_DOCUMENT_VERSION,
  migrateDocumentDetailed,
  normalizeLegacyBackgroundRemoval,
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
  return null;
}

function maxNumericNodeId(nodes: Record<NodeId, SceneNode>): number {
  let max = 0;
  for (const id of Object.keys(nodes)) {
    const match = /^n(\d+)$/.exec(id);
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

function hasImageFill(node: SceneNode): boolean {
  return (
    node.kind === 'shape' &&
    Boolean(node.fills?.some((fill) => fill.type === 'image' && fill.image))
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
      (!hasImageFill(node) ? 'Raster masks may only attach to image-filled shape nodes' : null);
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
  document = sanitizeRasterMaskState(document, warnings);
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
    const asset = assetId ? doc.rasterMaskAssets?.[assetId] : undefined;
    if (assetId && asset) rasterMaskAssets[assetId] = asset;
  }
  return {
    nodeIds,
    nodes,
    rasterMaskAssets: Object.keys(rasterMaskAssets).length > 0 ? rasterMaskAssets : undefined,
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

    const maskError = validateRasterMaskDocument(migration.document as unknown as Document);
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
